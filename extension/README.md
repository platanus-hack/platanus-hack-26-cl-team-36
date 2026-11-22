# Chameleon — extensión de Firefox y Chrome

Extensión de Firefox y Chrome (el mismo código para los dos) que cambia el diseño de sitios web aplicando **temas**.
Un tema es CSS + la lista de features (comportamientos JS) que se activan en esa página.

En cada página, la extensión le consulta al backend (`backend/`) la **revisión** de esa página: el
tema que generaron los agentes para ella. El backend busca la revisión en DynamoDB y, si
terminó, devuelve el `tema.css` que quedó en S3 (y el `tema.json`, si el diseñador lo dejó).
Si no hay revisión lista, o el backend no responde, la página queda tal cual. La extensión no
trae temas empaquetados ni dispara revisiones. Ver [La API](#la-api).

## Estructura

```
extension/
├── src/                         ← todo lo que va dentro de la extensión (.xpi de Firefox, .zip de Chrome)
│   ├── manifest.json
│   ├── background/              ← módulos ES: event page en Firefox, service worker en Chrome
│   │   ├── index.js             ← badge ON/OFF, tema de cada página (consulta, caché, inyección del CSS) y votos
│   │   ├── config.js            ← URL de la API (AWS o local)
│   │   ├── api.js               ← cliente de la API: GET /revisiones (el POST existe, sin uso)
│   │   ├── revisiones.js        ← lógica pura de las revisiones: lee la respuesta y arma el tema
│   │   ├── css-remoto.js        ← sanea el CSS que llega de la API
│   │   ├── tema-remoto.js       ← sanea las features del tema.json que llega de la API
│   │   ├── temas.js             ← normalizarTema: el contrato de un tema
│   │   ├── cache-temas.js       ← guarda en el equipo la última respuesta de cada página
│   │   ├── fuentes.js           ← lógica pura: suma fuentes/fuentes.css si el tema nombra una fuente MT
│   │   ├── votos.js             ← lógica pura de las opiniones (votos): registro, compresión, topes
│   │   └── almacen-votos-idb.js ← guarda los votos en IndexedDB
│   ├── popup/                   ← lo que abre el ícono de la barra
│   │   ├── popup.html/.css/.js  ← interruptor ON/OFF, opinión sobre la página y ajustes (efectos, idioma)
│   │   ├── estado.js            ← lógica pura del popup; testeable con Node
│   │   ├── interruptor.js/.css  ← animación del camaleón del interruptor
│   │   └── idioma.js/.css       ← animación del cambio de idioma
│   ├── comun/                   ← scripts clásicos que comparten popup, background y content scripts
│   │   ├── idioma.js            ← diccionario es/en de todo texto visible
│   │   └── efectos.js           ← efectos del encendido y apagado: llamativos o sutiles
│   ├── content/                 ← content scripts, en todas las páginas http(s)
│   │   ├── registro.js          ← registro de features y componentes (globalThis.MiTema)
│   │   ├── captura.js           ← captura el HTML de la página para una opinión
│   │   ├── plantillas.js        ← lee datos de la página según una plantilla; crea elementos seguros
│   │   ├── transicion.js/.css   ← la "metamorfosis" al encender o apagar con el interruptor
│   │   └── motor.js             ← genérico: pide el tema, pone la clase mi-tema, corre features
│   ├── features/                ← comportamientos JS reutilizables, configurables por el tema
│   │   ├── vista.js/.css        ← agrega o reemplaza una sección con un componente
│   │   └── modo-foco.js/.css    ← botón que alterna html.mi-tema-foco (ningún tema lo activa hoy)
│   ├── componentes/             ← catálogo de piezas de interfaz que usan las vistas
│   │   ├── atajo.js/.css        ← formulario corto que arma el enlace directo a una página de resultados
│   │   ├── lanzador.js/.css     ← accesos directos a las tareas más buscadas
│   │   ├── buscador.js/.css     ← paleta de comandos (⌘K) para saltar a cualquier tarea del sitio
│   │   └── cartelera.js/.css    ← destacado, fila y lista de contenido con imagen (ningún tema la activa hoy)
│   ├── fuentes/                 ← fuentes variables (OFL) que un tema usa nombrando "MT Inter", "MT Geist"…
│   │   ├── fuentes.css          ← sus @font-face
│   │   └── *.woff2, OFL-*.txt   ← los archivos y la licencia de cada familia
│   └── icons/                   ← ícono de la extensión y de la barra (ON/OFF), copiados del kit de marca
├── scripts/                     ← herramientas de desarrollo (no se empaquetan)
│   ├── clonar-perfil.js         ← `npm run perfil:clonar`
│   ├── lib/perfiles-firefox.js  ← encuentra los perfiles de Firefox y prepara una copia segura
│   └── sincronizar-marca.js     ← `npm run brand:sync` y `brand:check`
├── test/                        ← tests con node:test (sin dependencias)
│   └── fixtures/metro/          ← tema.css y tema.json de ejemplo para metro.cl
├── .env.example                 ← credenciales de AMO para `npm run sign`
├── CLAUDE.md                    ← reglas del proyecto para agentes
├── .perfil-dev/                 ← perfil de Firefox para `npm run dev:sesion` (ignorado por git)
└── web-ext-artifacts/           ← builds (ignorado por git)
```

## Cómo funciona

1. En cada página http(s), `content/motor.js` le pide al background el tema para esa URL.
2. El background le consulta a la API la revisión de la página (`api.js`, `revisiones.js`). Si
   está lista, sanea su CSS (`css-remoto.js`) y las features de su `tema.json` (`tema-remoto.js`),
   inyecta el CSS con `scripting.insertCSS` y le devuelve al motor el tema. Si está en curso, el
   motor vuelve a preguntar, primero a los 3 s y cada vez más espaciado (hasta cada 15 s),
   mientras siga en la página. Si no hay revisión, falló o la API no responde, el motor no toca
   la página. La respuesta lista queda guardada en el equipo (`cache-temas.js`): en las visitas
   siguientes el tema se aplica al cargar, sin esperar a la API, y se revalida con ella.
3. El motor pone la clase `mi-tema` en `<html>` (todo el CSS del tema cuelga de ella) y
   ejecuta las features en cada navegación y cambio del DOM.
4. El ícono de la barra abre un popup con un interruptor ON/OFF grande, que guarda `activo` en
   `storage`; el motor anima el cambio y quita/pone la clase. El popup también pide tu opinión
   sobre la página (Mejor / Peor / comentario), que se guarda solo en tu equipo: con una copia
   limpia de la página si tiene tema, solo el comentario si no lo tiene, y nada en ventanas privadas.
   En sus ajustes se eligen el idioma (es/en) y los efectos del cambio (llamativos o sutiles).

## Requisitos

- Firefox 140 o superior, o Chrome 148 o superior
- Node.js 22 o superior

## Probarla localmente

Desde la raíz del repo (o desde `extension/`, da lo mismo):

```bash
npm install           # la primera vez
npm run dev           # Firefox con la extensión
```

Se abre un Firefox aparte con la extensión cargada en metro.cl, que ya tiene una revisión
terminada. También en modo desarrollo la extensión usa la API de AWS (ver [La API](#la-api)),
así que no hace falta levantar el backend. Cada vez que guardas un archivo de `src/`, la
extensión se recarga sola y las pestañas que tenían un tema se refrescan para mostrar el
cambio. Ese refresco solo ocurre con la extensión cargada en modo desarrollo (web-ext o
about:debugging), nunca instalada.

Ese Firefox usa un perfil temporal (sin tus sesiones). Para quedar logueado
entre pruebas usa `npm run dev:sesion`, que guarda el perfil en `.perfil-dev/`.

**Con tus datos de siempre:** `npm run perfil:clonar` copia uno de tus perfiles de Firefox
(sesiones, marcadores, extensiones) a `.perfil-dev/`, y desde ahí `npm run dev:sesion` lo usa.
Se clona una sola vez; repítelo cuando quieras refrescar la copia. El clon queda sin tu
cuenta de Firefox (Sync) y sin tus pestañas abiertas. Para elegir el perfil sin que te
pregunte: `npm run perfil:clonar -- --perfil "<nombre>"`.

> ⚠️ Nunca uses `--firefox-profile` de web-ext con tu perfil real (ni en modo copia).
> Con los grupos de perfiles de Firefox, la copia se registra en tu grupo y deja tu perfil
> apuntando a una carpeta temporal que se borra al cerrar. `perfil:clonar` evita eso.

**Sin Node:** en Firefox abre `about:debugging` → "Este Firefox" →
"Cargar complemento temporal…" y elige `src/manifest.json`.

### En Chrome

```bash
npm run dev:chrome    # Chrome con la extensión
```

Igual que `npm run dev`, pero abre un Chrome aparte (perfil temporal) con la extensión cargada en
metro.cl. Al guardar un archivo de `src/` se recarga y refresca las pestañas con tema.

**Sin Node, o en tu Chrome de siempre:** abre `chrome://extensions`, activa **Modo de desarrollador**
(arriba a la derecha), aprieta **Cargar descomprimida** y elige la carpeta `src/`. Queda instalada
también después de reiniciar Chrome. Después de cambiar algo, aprieta el botón de recargar de su
tarjeta: las pestañas con tema se refrescan solas.

Chrome 148 o superior es obligatorio (`minimum_chrome_version`): desde esa versión Chrome tiene la
API `browser.*` que usa la extensión.

Si el diseño no se aplica: revisa que la página tenga una revisión terminada
(`curl "https://api.chameleonmode.app/revisiones?url=<url>"`), que el interruptor esté
encendido, y en `about:addons` → la extensión → "Permisos" (en Chrome, `chrome://extensions` → la
extensión → "Detalles" → "Acceso a sitios") que tenga acceso a los sitios.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Firefox con la extensión, recarga al guardar |
| `npm run dev:sesion` | Igual, con perfil persistente |
| `npm run dev:chrome` | Chrome con la extensión, recarga al guardar |
| `npm run perfil:clonar` | Copia tu perfil de Firefox a `.perfil-dev/` |
| `npm run dev:backend` | La API en `localhost:4747` (desde la raíz; ver [La API](#la-api) para usarla) |
| `npm test` | Tests de la lógica (revisiones, saneamiento del CSS, votos, popup…) |
| `npm run lint` | Valida la extensión con `web-ext lint` |
| `npm run check` | `brand:check` + `test` + `lint` (desde la raíz, también los tests de `backend/`, `infra/siembra/` y `backoffice/`) |
| `npm run brand:sync` | Copia los íconos de `docs/marca/chameleonmode-v1/` a `src/icons/` (desde `extension/`) |
| `npm run brand:check` | Revisa, sin escribir, que `src/icons/` sea igual al kit de marca (desde `extension/`) |
| `npm run build` | Genera el .zip en `web-ext-artifacts/` |
| `npm run build:chrome` | El mismo .zip, como `chameleon-mode-chrome-<versión>.zip`, para instalar en Chrome |

Para depurar: el motor y las features se ven en la consola de la pestaña; el
background en `about:debugging` → la extensión → "Inspeccionar" (en Chrome: `chrome://extensions` →
la extensión → "service worker").

## De dónde sale el tema de una página

De su revisión: los agentes en AWS catalogan la página, la recorren y el diseñador escribe un
`tema.css` (todo bajo `html.mi-tema`) y, si corresponde, un `tema.json` con las vistas que agrega
(ver [Vistas](#vistas)). No hay que tocar la extensión ni el manifest para que un
sitio tenga tema. La extensión **no** pide revisiones (cada una corre agentes y cuesta; ver el
TODO en `background/index.js`): se piden desde la raíz con `just aws revision <url>` o
`just aws seed <url>...`. Una revisión vale solo para esa página (la URL sin query ni hash, y
sin `www.`).

**Fuentes:** el CSS de un tema no puede declarar `@font-face` ni `url()`, pero puede usar las
fuentes variables que trae la extensión (`src/fuentes/`, OFL 1.1) solo nombrándolas:
`font-family: "MT Inter", "MT Inter Fallback", Inter, system-ui, sans-serif`. Hay `"MT Inter"`
(wght, opsz), `"MT Serif"` (wght, opsz), `"MT Archivo"` (wght, wdth), `"MT Geist"` y
`"MT Geist Mono"` (wght), cada una con su `"… Fallback"` (una fuente del sistema con sus
métricas). El background inyecta `fuentes/fuentes.css` solo si el tema nombra alguna, y el
navegador descarga cada archivo solo si un texto lo usa. Privacidad: esas páginas podrían ver
las URLs `moz-extension://<uuid>/fuentes/*.woff2` (p. ej. por Resource Timing; no verificamos
si Firefox crea esas entradas para CSS inyectado), y el uuid es estable por instalación, así
que podría servir para reconocer al mismo navegador entre sitios con tema. Por eso la hoja solo
va en páginas con tema que nombra una fuente MT.

Un tema (`normalizarTema` en `background/temas.js`) también puede traer `features` y
`eventosNavegacion`. De la API llegan solo las `features` del `tema.json` que deja el diseñador, si
lo deja: la feature `vista`, con los componentes `atajo`, `lanzador` y `buscador` (las sanea
`background/tema-remoto.js`, espejo exacto del validador del diseñador; ver [Vistas](#vistas)).
`temaDeRevision` (`background/revisiones.js`) no pasa `eventosNavegacion`, así que hoy siempre
llega vacío. Son eventos propios del sitio cuando navega sin recargar (SPA), p. ej.
`yt-navigate-finish`; además el motor siempre reacciona a cambios del DOM.

## Vistas

Además de CSS, un tema puede sumar una interfaz nueva a la página, junto a una sección o en su
lugar, con la feature `vista`. Es lo único que la API manda además del CSS. Ejemplo: el kit de
metro.cl (`test/fixtures/metro/tema.json`) suma en la portada una paleta para buscar cualquier
tarea (`buscador`), un formulario que lleva directo al planificador de viajes (`atajo`) y accesos
a las tareas más buscadas (`lanzador`). Recortado (sin el buscador y con menos items y textos):

```json
{
  "features": {
    "vista": [
      {
        "id": "planificar",
        "rutas": ["/"],
        "contenedor": "body > div:has(> #home)",
        "reemplazar": false,
        "componente": "atajo",
        "datos": [
          { "nombre": "inicio", "etiqueta": { "es": "Origen", "en": "Origin" }, "opciones": "#binicio", "requerido": true },
          { "nombre": "fin", "etiqueta": { "es": "Destino", "en": "Destination" }, "opciones": "#fin", "requerido": true }
        ],
        "opciones": {
          "destino": "/el-viaje/planificador/",
          "invertir": ["inicio", "fin"],
          "textos": {
            "es": { "titulo": "Planifica tu viaje", "boton": "Ver ruta" },
            "en": { "titulo": "Plan your trip", "boton": "See route" }
          }
        }
      },
      {
        "id": "tareas",
        "rutas": ["/"],
        "contenedor": "body > div:has(#carouselBanners)",
        "reemplazar": false,
        "componente": "lanzador",
        "datos": [
          {
            "titulo": { "es": "Carga tu bip!", "en": "Top up your bip!" },
            "detalle": { "es": "Recarga saldo para viajar", "en": "Add credit to travel" },
            "enlace": "/el-viaje/carga-bip"
          },
          {
            "titulo": { "es": "Plano de Red", "en": "Network map" },
            "detalle": { "es": "El mapa completo de las líneas", "en": "The full map of every line" },
            "enlace": "/el-viaje/plano-de-red"
          }
        ],
        "opciones": { "max": 6, "textos": { "es": { "titulo": "MetroServicio" }, "en": { "titulo": "MetroServicio" } } }
      }
    ]
  }
}
```

- **El código** es un componente del catálogo (`src/componentes/`), dentro de la extensión.
- **Lo específico del sitio son datos**, en la feature `vista` del tema: en qué páginas (`rutas`),
  junto a qué sección (`contenedor`), qué componente, sus items (`datos`) y sus `opciones`. El
  atajo copia las opciones de cada campo de un `<select>` de la página (`opciones` del item es su
  selector), así siguen al día. Si el sitio cambia su HTML, se arregla el tema, no la extensión.
- **La página original no se pierde.** Con `reemplazar: false` (como en metro.cl) la vista va
  justo antes del contenedor y este sigue visible; si no, el contenedor queda oculto debajo y
  vuelve a verse con el interruptor apagado. Si la vista falla, no encuentra el contenedor o se
  queda sin items, se deja la página original.

Lo que acepta `sanearTema` (`background/tema-remoto.js`) de un tema de la API:

- Solo la feature `vista`, hasta 6 vistas con `id` distinto. Otra feature se descarta.
- En cada vista, solo `id`, `rutas`, `contenedor`, `reemplazar`, `componente` (`atajo`, `lanzador`
  o `buscador`), `datos` y `opciones`; `datos` y `opciones` son obligatorios. Una clave que no
  conoce, u otro componente, descarta la vista entera.
- Hasta 8 campos de atajo, 12 tareas de lanzador y 40 de buscador. Un item que no valida se
  descarta solo y la vista sigue.
- Enlaces, `rutas` y `destino` solo como rutas del mismo sitio (`/…`, nunca `//host`), y nada que
  cargue recursos de otro host (sin imágenes). Los textos de los items van por idioma
  (`{ "es", "en" }`, con el español obligatorio).

`features/vista.js` también sabe leer los items de la página con una plantilla (`items`, `campos`
y `accion`: qué elementos leer, cómo sacar cada campo y qué elemento original clickear; las reglas
de `campos` están en `src/content/plantillas.js`), pero la API no la acepta: ver
[Modo foco y cartelera](#modo-foco-y-cartelera).

**Agregar un componente:** `src/componentes/<id>.js` con
`MiTema.registrarComponente("<id>", { dibujar(items, opciones, contexto) { … } })`, que devuelve
un elemento armado con `MiTema.dom.crear` (nunca `innerHTML`), más su CSS en
`src/componentes/<id>.css`. Ambos van en `content_scripts` del manifest, después de
`content/plantillas.js` y antes de `content/motor.js`. Para que un tema de la API lo pueda usar,
además va en `COMPONENTES` (con sus esquemas) de `background/tema-remoto.js` y en el validador
del diseñador (ver [La API](#la-api)).

## Modo foco y cartelera

La feature `modo-foco` (un botón que alterna la clase `mi-tema-foco` en `<html>`; qué se oculta lo
decide el CSS del tema) y el componente `cartelera` (un item destacado, una fila deslizable y una
lista compacta, para contenido con imagen) vienen en la extensión y se cargan en todas las páginas
(`content_scripts` del manifest), pero hoy ningún tema los activa:

- La API no los acepta: `sanearTema` descarta `modo-foco` como feature desconocida y una vista
  con `cartelera` como componente no permitido (`test/tema-remoto.test.js`). Tampoco acepta
  plantillas, y la cartelera lee sus items de la página con una.
- La extensión no trae temas locales, y el popup no los activa.

Los usaba, junto con `eventosNavegacion`, el tema de YouTube que la extensión traía empaquetado;
se quitó cuando los temas pasaron a salir solo de las revisiones. Para que la API los pueda
mandar, hay que admitirlos en `tema-remoto.js` y en el validador del diseñador. Así los activaba
ese tema (recortado):

```json
{
  "features": {
    "modo-foco": { "rutas": ["/watch"], "ancla": "ytd-watch-metadata #title" },
    "vista": [{
      "id": "portada",
      "rutas": ["/"],
      "contenedor": "ytd-browse[page-subtype=\"home\"] ytd-rich-grid-renderer",
      "items": "#contents > ytd-rich-item-renderer yt-lockup-view-model",
      "campos": {
        "titulo": { "selector": "a.ytLockupMetadataViewModelTitle" },
        "enlace": { "selector": "a.ytLockupMetadataViewModelTitle", "atributo": "href" },
        "imagen": { "selector": "a.ytLockupViewModelContentImage", "atributo": "href",
                    "patron": "[?&]v=([\\w-]{11})", "formato": "https://i.ytimg.com/vi/$1/hqdefault.jpg" }
      },
      "accion": { "selector": "a.ytLockupMetadataViewModelTitle" },
      "componente": "cartelera",
      "opciones": { "fila": 8 }
    }]
  },
  "eventosNavegacion": ["yt-navigate-finish"]
}
```

Con `accion`, un clic en un item acciona el elemento original (el sitio navega a su manera), y la
cartelera trae un botón "Ver original" que muestra la sección oculta.

## Agregar una feature

1. Crea `src/features/<id>.js` que llame a `MiTema.registrarFeature("<id>", { actualizar(opciones) { … } })`.
   `actualizar` se llama muchas veces: debe ser idempotente (revisar si algo ya existe antes de insertarlo).
2. Agrégala a `content_scripts.js` en `manifest.json`, **después** de `content/registro.js` y antes de `content/motor.js`.
3. Lo específico de cada sitio (selectores, rutas) va en las opciones del tema, no en la feature.
4. Para que un tema de la API la active, admítela en `sanearTema` (`background/tema-remoto.js`) y en
   el validador del diseñador (ver [La API](#la-api)).

## La API

En cada página, la extensión consulta su **revisión** (`background/revisiones.js`):

```
GET <URL de la API>/revisiones?url=https%3A%2F%2Fwww.metro.cl%2F      ← la URL sin query ni hash
```

| Respuesta | Qué hace la extensión |
| --- | --- |
| `200 { "success": true, "revision", "status": "done", "css", "tema"? }` | Sanea el CSS (`background/css-remoto.js`, mismas reglas que el diseñador) y las `features` del `tema` (`background/tema-remoto.js`), lo aplica como tema `rev-<revision>` y guarda la respuesta en el equipo |
| `200` con `status: "queued"` o `"running"` | Vuelve a preguntar mientras siga en la página: a los 3 s y cada vez más espaciado, hasta cada 15 s, durante 10 min como mucho |
| `404` (la página no tiene revisión), `failed`, error o más de 5 s sin responder | Nada |

El backend busca la revisión de la página en la tabla DynamoDB `chameleon-revisiones` y lee el
`tema.css` de S3 (`css_key` de la revisión), y el `tema.json` si el diseñador lo dejó (`tema_key`).
No se consulta en ventanas privadas ni con el
interruptor apagado.

**La extensión no dispara revisiones.** `POST /revisiones` sí lo hace (una página nueva corre los
agentes en AgentCore, que cuesta), pero por ahora solo lo usan `just aws revision` y
`just aws seed`. Volver a dispararlas desde la extensión es un TODO en `background/index.js`
(`pedirRevision` en `api.js` sigue lista para eso).

La URL de la API sale de `src/background/config.js`:

- **Por defecto, la API desplegada en AWS** (`https://api.chameleonmode.app`, ver
  [infra/README.md](../infra/README.md)), instalada o en modo desarrollo (`npm run dev`,
  `just local up`). Los cambios de `backend/` llegan ahí solos después de mergearse.
- **La API local** (`npm run dev:backend`, `http://localhost:4747`), solo en modo desarrollo y si se
  pide, para probar cambios del backend: en la consola del background (ver arriba cómo abrirla),
  `browser.storage.local.set({ apiLocal: true })` (`false` vuelve a AWS). Sin
  `REVISIONES_TABLA`, `ALMACEN_BUCKET` y credenciales de AWS, el backend local no tiene revisiones.

`host_permissions` del manifest debe cubrir los dos dominios **sin puerto**: Firefox no
acepta puertos en esos patrones, y con puerto la request sale como CORS y falla. Hoy los
cubren `http://*/*` y `https://*/*`.

Lo que hay que tener en cuenta:

- **La API solo puede mandar datos (CSS + config), nunca JS.** MV3, Mozilla y Google prohíben
  ejecutar código remoto. Los comportamientos tienen que existir como features en la extensión.
- **Las features de la API** pasan por `sanearTema` (`background/tema-remoto.js`) en `temaDeRevision`
  (`background/revisiones.js`); `normalizarTema` es el contrato. Una feature o un componente nuevo
  para temas remotos se agrega allí y en el validador del diseñador
  (`agents/app/web_designer/disenador/tema_json.py`), con los mismos
  topes: `agents/app/web_designer/tests/test_contrato.py` lo verifica.
- **Permisos y privacidad:** la extensión corre en todos los sitios http(s) y, con el interruptor
  encendido y fuera de ventanas privadas, le envía al backend la URL sin query ni hash de cada
  página que visitas (para consultar su revisión). Por eso pide acceso a todos los sitios y el
  manifest declara `browsingActivity` en `data_collection_permissions`; Firefox lo muestra
  al instalar.
- **Latencia:** en la primera visita a una página, el tema se aplica cuando la API responde (hasta
  5 s); mientras, se ve el diseño original. La respuesta queda guardada en el equipo
  (`background/cache-temas.js`, en `storage.local`: las 50 de uso más reciente, hasta 2 MB) y en las
  visitas siguientes el tema se aplica al cargar y se revalida con la API: si trae otro CSS, lo
  cambia en la página (las features nuevas llegan en la próxima carga), y un 404 lo olvida.

## Instalarla de forma permanente en Firefox (.xpi no listado)

Firefox solo instala de forma permanente extensiones firmadas por Mozilla. La firmamos
como **no listada**: no aparece en la tienda y se distribuye como `.xpi` descargable.

### Con `just publish` (lo normal)

Con un número de versión mayor que el último publicado:

```bash
just publish v0.3.0
```

Crea el tag `v0.3.0` sobre `main` tal como está en GitHub y lo sube a este repo y al repo
personal ([infra/README.md](../infra/README.md)). Ahí el workflow `Publicar extensión` toma la
versión del tag, corre los tests, firma en Mozilla y crea un release con el `.xpi` (y el `.zip` para
Chrome, ver [Instalarla en Chrome](#instalarla-en-chrome-zip)) en
[brayanmoreno/hackathon-grupo36/releases](https://github.com/brayanmoreno/hackathon-grupo36/releases).
El comando espera a que termine (unos minutos) y muestra el link. Ese repo es privado: solo el
equipo puede descargarlo desde ahí. Para el resto, al terminar corre `Descarga pública de la extensión`
(`.github/workflows/descarga-extension.yml`), que copia el `.xpi` y el `.zip` al almacén y los deja en
https://chameleonmode.app/descargas/firefox y https://chameleonmode.app/descargas/chrome, los botones de descarga de
la portada ([backoffice/README.md](../backoffice/README.md#la-descarga-de-la-extensión)).

- No hace falta cambiar `version` en `manifest.json`: manda el tag.
- Mozilla no firma dos veces la misma versión. Si la firma falla después de subirla, usa el
  número siguiente en vez de repetir el tag.

### A mano

1. Crea una cuenta en addons.mozilla.org y genera tus credenciales en
   https://addons.mozilla.org/developers/addon/api/key/ (si te pide aceptar el acuerdo
   de distribución, acéptalo).
2. Copia `extension/.env.example` como `extension/.env` y completa tus claves
   (`.env` está en `.gitignore`; nunca subas las claves al repo). Luego, desde la raíz:
   ```bash
   npm run sign
   ```
   También funciona sin `.env` si exportas `WEB_EXT_API_KEY` y `WEB_EXT_API_SECRET` en la
   terminal; si existen ambas, mandan las variables exportadas.
3. En unos minutos queda el `.xpi` firmado en `extension/web-ext-artifacts/`.
4. Súbelo a un release de GitHub (o cualquier link https). Quien abra ese link en Firefox
   puede instalarla.

La extensión instalada usa la API en AWS, así que funciona en cualquier computador sin
levantar el backend.

- Cada versión nueva que firmes necesita un número de `version` mayor en `manifest.json`.
- El id (`browser_specific_settings.gecko.id`) queda asociado a la cuenta de AMO que firma
  primero: para firmar versiones siguientes desde otra cuenta, agréguenla como autora en AMO.
  No cambies el id: AMO lo trataría como otra extensión.
- Instálala en tu Firefox normal, no en el de `npm run dev:sesion`: ahí web-ext carga la
  versión de desarrollo con el mismo id.

## Instalarla en Chrome (.zip)

Chrome no instala extensiones de fuera de su tienda con un archivo, como Firefox con el `.xpi`. Lo que
sí se puede, sin publicarla, es cargarla **desempaquetada** en modo desarrollador:

1. Descarga `chameleon-mode-chrome-<versión>.zip` del release (`just publish` lo adjunta junto al `.xpi`),
   o genéralo con `npm run build:chrome` (queda en `extension/web-ext-artifacts/`).
2. Descomprímelo en una carpeta que no vayas a borrar: Chrome la lee desde ahí.
3. En `chrome://extensions`, activa **Modo de desarrollador** y aprieta **Cargar descomprimida**; elige
   esa carpeta.

- Necesita Chrome 148 o superior.
- No se actualiza sola: para una versión nueva, reemplaza el contenido de la carpeta y aprieta el
  botón de recargar en la tarjeta de la extensión.
- Para Chrome, una extensión desempaquetada siempre está "en modo desarrollo" (`installType`
  "development"): por eso refresca las pestañas con tema al recargarla, y acepta `apiLocal` (ver
  [La API](#la-api)). Sin `apiLocal`, usa la API de AWS como la instalada en Firefox.
- La opción para que no haga falta el modo desarrollador es publicarla en la Chrome Web Store como
  "no listada" (solo se encuentra con el link), pero eso pasa por la revisión de Google.
