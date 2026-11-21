# Mi Tema — extensión de Firefox

Extensión de Firefox que cambia el diseño de sitios web aplicando **temas**.
Un tema es CSS + la lista de features (comportamientos JS) que se activan en ese sitio.

En cada página, la extensión le pregunta al backend (`backend/`) qué tema corresponde.
Si el backend dice que no hay tema, o no responde, la página queda tal cual. Por ahora el
backend solo dice el id del tema; el CSS vive en la extensión (`src/temas/<id>/`).
Hoy hay dos temas: YouTube y Gmail. Ver [La API](#la-api).

## Estructura

```
extension/
├── src/                      ← todo lo que va dentro de la extensión (.xpi)
│   ├── manifest.json
│   ├── background/
│   │   ├── index.js          ← botón ON/OFF + resuelve el tema de cada página e inyecta su CSS
│   │   ├── config.js         ← URL del backend
│   │   ├── api.js            ← pregunta al backend: POST /temas/buscar
│   │   ├── temas-locales.js  ← carga src/temas/<id>/
│   │   └── temas.js          ← lógica pura (validar temas, decidir el tema); testeable con Node
│   ├── content/
│   │   ├── registro.js       ← registro de features (globalThis.MiTema)
│   │   └── motor.js          ← genérico: pide el tema, pone la clase mi-tema, corre features
│   ├── features/             ← comportamientos JS reutilizables, configurables por el tema
│   │   ├── modo-foco.js
│   │   └── modo-foco.css
│   ├── temas/                ← CSS y config de cada tema; la API dice cuál usar
│   │   ├── youtube/
│   │   │   ├── tema.json     ← nombre, features y sus opciones
│   │   │   └── tema.css
│   │   └── gmail/
│   └── icons/
├── scripts/                  ← herramientas de desarrollo (no se empaquetan)
│   └── clonar-perfil.js      ← `npm run perfil:clonar`
├── test/                     ← tests con node:test (sin dependencias)
├── .perfil-dev/              ← perfil de Firefox para `npm run dev:sesion` (ignorado por git)
└── web-ext-artifacts/        ← builds (ignorado por git)
```

## Cómo funciona

1. En cada página http(s), `content/motor.js` le pide al background el tema para esa URL.
2. El background le pregunta a la API (`api.js`). Si la API responde `success: true` con un
   id de tema, carga ese tema desde `src/temas/<id>/` (`temas-locales.js`), inyecta su CSS con
   `scripting.insertCSS` y le devuelve al motor las features y opciones.
   Si la API responde `success: false` o no responde, no hay tema y el motor no toca la página.
3. El motor pone la clase `mi-tema` en `<html>` (todo el CSS del tema cuelga de ella) y
   ejecuta las features en cada navegación y cambio del DOM.
4. El botón de la extensión guarda `activo` en `storage`; el motor quita/pone la clase al instante.

## Requisitos

- Firefox 140 o superior
- Node.js 22 o superior

## Probarla localmente

Desde la raíz del repo (o desde `extension/`, da lo mismo):

```bash
npm install           # la primera vez
npm run dev:backend   # terminal 1: la API (sin ella no se aplica ningún tema)
npm run dev           # terminal 2: Firefox con la extensión
```

Se abre un Firefox aparte con la extensión cargada en youtube.com. Cada vez que
guardas un archivo de `src/`, la extensión se recarga sola y las pestañas que
tenían un tema se refrescan para mostrar el cambio. Ese refresco solo ocurre con la
extensión cargada en modo desarrollo (web-ext o about:debugging), nunca instalada.

Ese Firefox usa un perfil temporal (sin tu sesión de YouTube). Para quedar logueado
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

Si el diseño no se aplica: revisa que el backend esté corriendo, y en `about:addons` →
la extensión → "Permisos" que tenga acceso a los sitios.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Firefox con la extensión, recarga al guardar |
| `npm run dev:sesion` | Igual, con perfil persistente |
| `npm run perfil:clonar` | Copia tu perfil de Firefox a `.perfil-dev/` |
| `npm run dev:backend` | La API en `localhost:3000` (desde la raíz) |
| `npm test` | Tests de la lógica de temas y validación de `src/temas/` |
| `npm run lint` | Valida la extensión con `web-ext lint` |
| `npm run check` | `test` + `lint` |
| `npm run build` | Genera el .zip en `web-ext-artifacts/` |

Para depurar: el motor y las features se ven en la consola de la pestaña; el
background en `about:debugging` → la extensión → "Inspeccionar".

## Agregar un tema (sitio nuevo)

1. En el backend, agrega el sitio a `SITIOS` en `backend/temas.js`: `{ dominio: "ejemplo.com", tema: "<id>" }`.
   El dominio incluye sus subdominios.
2. En la extensión, crea `src/temas/<id>/tema.json` y `src/temas/<id>/tema.css`.
   Todo el CSS va bajo `html.mi-tema`.
3. `npm run check` desde la raíz (revisa que cada tema del backend exista en la extensión).

No hace falta tocar el manifest: la extensión corre en todos los sitios http(s).

```json
{
  "nombre": "YouTube morado",
  "features": { "modo-foco": { "rutas": ["/watch"], "ancla": "ytd-watch-metadata #title" } },
  "eventosNavegacion": ["yt-navigate-finish"]
}
```

Solo `nombre` es obligatorio en la práctica (el tema de Gmail no tiene más).
`eventosNavegacion` son eventos propios del sitio cuando navega sin recargar (SPA);
además el motor siempre reacciona a cambios del DOM.

## Agregar una feature

1. Crea `src/features/<id>.js` que llame a `MiTema.registrarFeature("<id>", { actualizar(opciones) { … } })`.
   `actualizar` se llama muchas veces: debe ser idempotente (revisar si algo ya existe antes de insertarlo).
2. Agrégala a `content_scripts.js` en `manifest.json`, **después** de `content/registro.js` y antes de `content/motor.js`.
3. Lo específico de cada sitio (selectores, rutas) va en las opciones del tema, no en la feature.

## La API

Para probar la conexión, levanta el backend en otra terminal (desde la raíz del repo):

```bash
npm run dev:backend   # http://localhost:3000
```

En cada página, la extensión hace:

```
POST http://localhost:3000/temas/buscar
{ "url": "https://www.youtube.com" }      ← solo el origen, nunca la ruta ni parámetros
```

| Respuesta | Qué hace la extensión |
| --- | --- |
| `200 { "success": true, "tema": "youtube" }` | Aplica el tema `src/temas/youtube/` |
| `404 { "success": false, "error": "…" }` | Nada: el sitio no tiene tema |
| Backend caído, error o más de 2 s sin responder | Nada; avisa en la consola del background |

Hoy el backend responde `success: true` para YouTube (`youtube.com` y subdominios) y Gmail
(`mail.google.com`), y `success: false` para el resto.

La URL del backend está en `src/background/config.js`. `host_permissions` del manifest
debe cubrir su dominio **sin puerto**: Firefox no acepta puertos en esos patrones, y con
puerto la request sale como CORS y falla. Hoy lo cubre `http://*/*`.

Lo que hay que tener en cuenta:

- **La API solo puede mandar datos (CSS + config), nunca JS.** MV3 y Mozilla prohíben
  ejecutar código remoto. Los comportamientos tienen que existir como features en la extensión.
- **Cuando la API devuelva el tema completo** (CSS + config) en vez del id, `resolverTema` en
  `background/temas.js` es el lugar para usarlo directo; `normalizarTema` es el contrato.
- **Permisos y privacidad:** la extensión corre en todos los sitios http(s) y le envía al
  backend el origen de cada página que visitas. Por eso pide acceso a todos los sitios y el
  manifest declara `browsingActivity` en `data_collection_permissions`; Firefox lo muestra
  al instalar.
- **Latencia:** el tema se aplica cuando la API responde. Con la API desplegada, una
  respuesta lenta muestra un instante el diseño original; ahí conviene guardar respuestas en caché.

## Instalarla de forma permanente (.xpi no listado)

Firefox solo instala de forma permanente extensiones firmadas por Mozilla. La firmamos
como **no listada**: no aparece en la tienda y se distribuye como `.xpi` descargable.

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

Mientras la API esté en `localhost:3000`, la extensión instalada solo aplica temas en un
computador que tenga el backend corriendo (`npm run dev:backend`).

- Cada versión nueva que firmes necesita un número de `version` mayor en `manifest.json`.
- El id (`browser_specific_settings.gecko.id`) queda asociado a la cuenta de AMO que firma
  primero: para firmar versiones siguientes desde otra cuenta, agréguenla como autora en AMO.
  No cambies el id: AMO lo trataría como otra extensión.
- Instálala en tu Firefox normal, no en el de `npm run dev:sesion`: ahí web-ext carga la
  versión de desarrollo con el mismo id.
