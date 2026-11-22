# Chameleon — extensión de Firefox

Extensión de Firefox que cambia el diseño de sitios web aplicando **temas**.
Un tema es CSS + la lista de features (comportamientos JS) que se activan en ese sitio.

En cada página, la extensión le consulta al backend (`backend/`) la **revisión** de esa página: el
tema que generaron los agentes para ella. El backend busca la revisión en DynamoDB y, si
terminó, devuelve el `tema.css` que quedó en S3. Si no hay revisión lista, o el backend no
responde, la página queda tal cual. La extensión no trae temas empaquetados ni dispara
revisiones. Ver [La API](#la-api).

## Estructura

```
extension/
├── src/                      ← todo lo que va dentro de la extensión (.xpi)
│   ├── manifest.json
│   ├── background/
│   │   ├── index.js          ← badge ON/OFF + consulta la revisión de cada página e inyecta su CSS + votos
│   │   ├── config.js         ← URL del backend
│   │   ├── api.js            ← pregunta al backend: GET /revisiones
│   │   ├── revisiones.js     ← lógica pura de las revisiones; testeable con Node
│   │   ├── css-remoto.js     ← sanea el CSS que llega de la API
│   │   └── temas.js          ← lógica pura (validar temas); testeable con Node
│   ├── popup/                ← lo que abre el ícono de la barra
│   │   ├── popup.html/.css/.js ← interruptor ON/OFF + opinión sobre la página
│   │   └── estado.js         ← lógica pura del popup; testeable con Node
│   ├── content/
│   │   ├── registro.js       ← registro de features y componentes (globalThis.MiTema)
│   │   ├── plantillas.js     ← lee datos de la página según una plantilla; crea elementos seguros
│   │   └── motor.js          ← genérico: pide el tema, pone la clase mi-tema, corre features
│   ├── features/             ← comportamientos JS reutilizables, configurables por el tema
│   │   ├── modo-foco.js/.css
│   │   └── vista.js/.css     ← reemplaza una sección por una vista hecha con un componente
│   ├── componentes/          ← catálogo de piezas de interfaz que usan las vistas
│   │   └── cartelera.js/.css
│   ├── fuentes/              ← fuentes variables (OFL) que un tema usa nombrando "MT Inter", "MT Geist"…
│   └── icons/
├── scripts/                  ← herramientas de desarrollo (no se empaquetan)
│   └── clonar-perfil.js      ← `npm run perfil:clonar`
├── test/                     ← tests con node:test (sin dependencias)
├── .perfil-dev/              ← perfil de Firefox para `npm run dev:sesion` (ignorado por git)
└── web-ext-artifacts/        ← builds (ignorado por git)
```

## Cómo funciona

1. En cada página http(s), `content/motor.js` le pide al background el tema para esa URL.
2. El background le consulta a la API la revisión de la página (`api.js`, `revisiones.js`). Si
   está lista, sanea su CSS (`css-remoto.js`), lo inyecta con `scripting.insertCSS` y le devuelve
   al motor el tema. Si está en curso, el motor vuelve a preguntar cada 15 s mientras siga en la
   página. Si no hay revisión, falló o la API no responde, el motor no toca la página.
3. El motor pone la clase `mi-tema` en `<html>` (todo el CSS del tema cuelga de ella) y
   ejecuta las features en cada navegación y cambio del DOM.
4. El ícono de la barra abre un popup con un interruptor ON/OFF grande, que guarda `activo` en
   `storage`; el motor anima el cambio y quita/pone la clase. El popup también pide tu opinión
   sobre la página (Mejor / Peor / comentario), que se guarda solo en tu equipo: con una copia
   limpia de la página si tiene tema, solo el comentario si no lo tiene, y nada en ventanas privadas.

## Requisitos

- Firefox 140 o superior
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

Si el diseño no se aplica: revisa que la página tenga una revisión terminada
(`curl "https://api.chameleonmode.app/revisiones?url=<url>"`), que el interruptor esté
encendido, y en `about:addons` → la extensión → "Permisos" que tenga acceso a los sitios.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Firefox con la extensión, recarga al guardar |
| `npm run dev:sesion` | Igual, con perfil persistente |
| `npm run perfil:clonar` | Copia tu perfil de Firefox a `.perfil-dev/` |
| `npm run dev:backend` | La API en `localhost:4747` (desde la raíz; ver [La API](#la-api) para usarla) |
| `npm test` | Tests de la lógica (revisiones, saneamiento del CSS, votos, popup…) |
| `npm run lint` | Valida la extensión con `web-ext lint` |
| `npm run check` | `test` + `lint` |
| `npm run build` | Genera el .zip en `web-ext-artifacts/` |

Para depurar: el motor y las features se ven en la consola de la pestaña; el
background en `about:debugging` → la extensión → "Inspeccionar".

## De dónde sale el tema de una página

De su revisión: los agentes en AWS catalogan la página, la recorren y el diseñador escribe un
`tema.css` (todo bajo `html.mi-tema`). No hay que tocar la extensión ni el manifest para que un
sitio tenga tema. La extensión **no** pide revisiones (cada una corre agentes y cuesta; ver el
TODO en `background/index.js`): se piden desde la raíz con `just aws revision <url>` o
`just aws seed <url>...`. Una revisión vale solo para esa página (la URL sin query ni hash, y
sin `www.`).

**Fuentes:** el CSS de un tema no puede declarar `@font-face` ni `url()`, pero puede usar las
fuentes variables que trae la extensión (`src/fuentes/`, OFL 1.1) solo nombrándolas:
`font-family: "MT Inter", "MT Inter Fallback", Inter, system-ui, sans-serif`. Hay `"MT Inter"`
(wght, opsz), `"MT Source Serif"` (wght, opsz), `"MT Archivo"` (wght, wdth), `"MT Geist"` y
`"MT Geist Mono"` (wght), cada una con su `"… Fallback"` (una fuente del sistema con sus
métricas). El background inyecta `fuentes/fuentes.css` solo si el tema nombra alguna, y el
navegador descarga cada archivo solo si un texto lo usa.

Un tema (`normalizarTema` en `background/temas.js`) también puede traer `features` y
`eventosNavegacion`, pero hoy la API solo manda CSS:

```json
{
  "features": { "modo-foco": { "rutas": ["/watch"], "ancla": "ytd-watch-metadata #title" } },
  "eventosNavegacion": ["yt-navigate-finish"]
}
```

`eventosNavegacion` son eventos propios del sitio cuando navega sin recargar (SPA);
además el motor siempre reacciona a cambios del DOM.

## Vistas: cambiar una sección completa

Además de CSS, un tema puede reemplazar una sección entera de la página por una interfaz
nueva. Ejemplo: en YouTube, la grilla de la portada pasa a ser una "cartelera" (un video
destacado, una fila deslizable y una lista compacta). Hoy ningún tema lo usa: la API solo manda CSS.

- **El código** es un componente del catálogo (`src/componentes/cartelera.js`), dentro de la extensión.
- **Lo específico del sitio es una plantilla** (datos), en la feature `vista` del tema:
  qué sección reemplazar, cómo leer cada item, qué componente usar y qué elemento original
  clickear. Si el sitio cambia su HTML, se arregla la plantilla, no la extensión.
- **La sección original sigue debajo, oculta.** Al hacer clic en un item se acciona el
  elemento original (el sitio navega a su manera), el botón "Ver original" la muestra, y si
  la vista falla o no encuentra datos se deja la página original.

```json
"vista": [{
  "id": "portada",
  "rutas": ["/"],
  "contenedor": "ytd-browse[page-subtype=\"home\"] ytd-rich-grid-renderer",
  "items": "#contents > ytd-rich-item-renderer yt-lockup-view-model",
  "campos": {
    "titulo": { "selector": "a.ytLockupMetadataViewModelTitle" },
    "enlace": { "selector": "a.ytLockupMetadataViewModelTitle", "atributo": "href" },
    "imagen": { "selector": "a", "atributo": "href", "patron": "[?&]v=([\\w-]{11})",
                "formato": "https://i.ytimg.com/vi/$1/hqdefault.jpg" }
  },
  "accion": { "selector": "a.ytLockupMetadataViewModelTitle" },
  "componente": "cartelera",
  "opciones": { "fila": 8, "textos": { "titulo": "Para ti" } }
}]
```

Las reglas de `campos` (texto, atributo, varias partes unidas, patrón y formato, alternativas)
están documentadas en `src/content/plantillas.js`.

**Agregar un componente:** `src/componentes/<id>.js` con
`MiTema.registrarComponente("<id>", { dibujar(items, opciones, contexto) { … } })`, que devuelve
un elemento armado con `MiTema.dom.crear` (nunca `innerHTML`), más su CSS en
`src/componentes/<id>.css`. Ambos van en `content_scripts` del manifest, después de
`content/plantillas.js` y antes de `content/motor.js`.

## Agregar una feature

1. Crea `src/features/<id>.js` que llame a `MiTema.registrarFeature("<id>", { actualizar(opciones) { … } })`.
   `actualizar` se llama muchas veces: debe ser idempotente (revisar si algo ya existe antes de insertarlo).
2. Agrégala a `content_scripts.js` en `manifest.json`, **después** de `content/registro.js` y antes de `content/motor.js`.
3. Lo específico de cada sitio (selectores, rutas) va en las opciones del tema, no en la feature.

## La API

En cada página, la extensión consulta su **revisión** (`background/revisiones.js`):

```
GET <URL de la API>/revisiones?url=https%3A%2F%2Fwww.metro.cl%2F      ← la URL sin query ni hash
```

| Respuesta | Qué hace la extensión |
| --- | --- |
| `200 { "success": true, "revision", "status": "done", "css" }` | Sanea el CSS (`background/css-remoto.js`, mismas reglas que el diseñador) y lo aplica como tema `rev-<revision>` |
| `200` con `status: "queued"` o `"running"` | Vuelve a preguntar cada 15 s (hasta 10 min) mientras siga en la página |
| `404` (la página no tiene revisión), `failed`, error o más de 5 s sin responder | Nada |

El backend busca la revisión de la página en la tabla DynamoDB `chameleon-revisiones` y lee el
`tema.css` de S3 (`css_key` de la revisión). No se consulta en ventanas privadas ni con el
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
  pide, para probar cambios del backend: en `about:debugging` → la extensión → "Inspeccionar", en la
  consola, `browser.storage.local.set({ apiLocal: true })` (`false` vuelve a AWS). Sin
  `REVISIONES_TABLA`, `ALMACEN_BUCKET` y credenciales de AWS, el backend local no tiene revisiones.

`host_permissions` del manifest debe cubrir los dos dominios **sin puerto**: Firefox no
acepta puertos en esos patrones, y con puerto la request sale como CORS y falla. Hoy los
cubren `http://*/*` y `https://*/*`.

Lo que hay que tener en cuenta:

- **La API solo puede mandar datos (CSS + config), nunca JS.** MV3 y Mozilla prohíben
  ejecutar código remoto. Los comportamientos tienen que existir como features en la extensión.
- **Cuando la API mande features** además del CSS, `temaDeRevision` en
  `background/revisiones.js` es el lugar para pasarlas; `normalizarTema` es el contrato.
- **Permisos y privacidad:** la extensión corre en todos los sitios http(s) y, con el interruptor
  encendido y fuera de ventanas privadas, le envía al backend la URL sin query ni hash de cada
  página que visitas (para consultar su revisión). Por eso pide acceso a todos los sitios y el
  manifest declara `browsingActivity` en `data_collection_permissions`; Firefox lo muestra
  al instalar.
- **Latencia:** el tema se aplica cuando la API responde. Con la API desplegada, una
  respuesta lenta muestra un instante el diseño original; ahí conviene guardar respuestas en caché.

## Instalarla de forma permanente (.xpi no listado)

Firefox solo instala de forma permanente extensiones firmadas por Mozilla. La firmamos
como **no listada**: no aparece en la tienda y se distribuye como `.xpi` descargable.

### Con `just publish` (lo normal)

Con un número de versión mayor que el último publicado:

```bash
just publish v0.3.0
```

Crea el tag `v0.3.0` sobre `main` tal como está en GitHub y lo sube a este repo y al repo
personal ([infra/README.md](../infra/README.md)). Ahí el workflow `Publicar extensión` toma la
versión del tag, corre los tests, firma en Mozilla y crea un release con el `.xpi` en
[brayanmoreno/hackathon-grupo36/releases](https://github.com/brayanmoreno/hackathon-grupo36/releases).
El comando espera a que termine (unos minutos) y muestra el link. Ese repo es privado: solo el
equipo puede descargarlo.

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
