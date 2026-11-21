# Mi Tema — extensión de Firefox

Extensión de Firefox (Manifest V3) que cambia el diseño de sitios web aplicando
temas (CSS + features JS) sobre la página original. No reemplaza el HTML/JS del
sitio: el sitio carga normal y nosotros modificamos encima.

Hoy los temas vienen de `src/temas/` y solo existe YouTube (PoC). A futuro vendrán
de una API: todo lo específico de un sitio debe poder expresarse como **datos**
(CSS + `tema.json`), no como código.

## Estructura

- `src/`: lo único que se empaqueta (`webExt.sourceDir`). Todo lo demás queda fuera del .xpi.
- `src/background/index.js`: botón ON/OFF (`activo` en `storage.local`) y mensaje `tema:aplicar`: busca el tema en los proveedores e inyecta su CSS con `scripting.insertCSS`.
- `src/background/temas.js`: lógica pura (`normalizarTema`, `temaParaUrl`, `buscarEnProveedores`). Sin `browser.*`: se testea con Node.
- `src/background/proveedor-api.js`: `POST {API_URL}/temas/buscar` con `{ url: origen }` (backend en `../backend/`). Vacío/204 = sin tema; error o timeout (2 s) = se sigue con el siguiente proveedor.
- `src/background/proveedor-local.js`: lee `src/temas/` (respaldo). Un proveedor = `{ nombre, buscar(url) → tema | null }`; el orden está en `proveedores` de `background/index.js`.
- `src/background/config.js`: `API_URL`.
- `src/content/registro.js` → `src/features/*.js` → `src/content/motor.js`: content scripts, en ese orden.
- `src/temas/<id>/tema.json` + `tema.css`, listados en `src/temas/index.json`.
- `test/`: `node:test`. `temas-locales.test.js` valida cada tema de `src/temas/`.
- `scripts/`: herramientas de desarrollo en Node, sin dependencias. `clonar-perfil.js` copia un perfil real de Firefox a `.perfil-dev/` quitando su asociación al grupo de perfiles (`scripts/lib/perfiles-firefox.js`).

## Reglas del proyecto

- **Solo Firefox.** Usar la API `browser.*` (con promesas), no `chrome.*`.
- **Background = `background.scripts` con `"type": "module"`.** Firefox no soporta `background.service_worker`; nunca lo agregues.
- **El motor es genérico.** `content/motor.js` no debe mencionar ningún sitio. Lo específico (selectores, rutas, eventos de navegación) va en `tema.json` como opciones de features.
- **Sin código remoto.** Los temas (y la futura API) solo aportan CSS y configuración. Todo JS vive en `src/features/`.
- **Todo el CSS de un tema va bajo `html.mi-tema`**, así el botón apaga el diseño completo. Las features usan clases extra (`html.mi-tema.mi-tema-foco`).
- **JS maneja estado y clases; CSS maneja lo visual.** Evitar estilos inline desde JS.
- **Los sitios suelen ser SPA.** Cada feature expone `actualizar(opciones)` idempotente; el motor la llama en cada evento de `eventosNavegacion` y cuando el DOM cambia. Nunca insertar algo sin revisar antes si ya existe.
- **Content scripts comparten global:** envolver cada archivo en una IIFE y exponer solo vía `globalThis.MiTema`.
- **Selectores:** preferir etiquetas propias del sitio (`ytd-*`) e `id`s sobre clases generadas. Si no se conoce la estructura actual del sitio, pedir al usuario que copie el HTML del elemento desde el inspector en lugar de adivinar.
- **IDs y clases propias con prefijo `mt-`** para no chocar con el sitio.
- **Privacidad:** a la API se le envía solo el origen (`new URL(url).origin`), nunca ruta ni parámetros. Por eso `data_collection_permissions` declara `browsingActivity`; si se envía algo más, actualizarlo.
- **`host_permissions` sin puerto:** Firefox no acepta puertos en los patrones (`http://localhost:3000/*` no da permiso y la request sale como CORS con preflight). Usar `http://localhost/*`.
- **No cambiar `browser_specific_settings.gecko.id`** (AMO lo trataría como otra extensión).
- **Nunca correr web-ext con el perfil real del usuario** (`--firefox-profile=default-release`, una ruta a `~/Library/Application Support/Firefox/Profiles/...`, etc.), ni en modo copia. Con los grupos de perfiles de Firefox (versión 160 o superior), la copia se registra en el grupo y reescribe `profiles.ini`/`installs.ini` apuntando a una carpeta temporal. Para usar los datos del usuario: `npm run perfil:clonar`. Si se modifica ese script, mantener `sanitizarPrefs` (quita `toolkit.profiles.*`/`browser.profiles.*`) y los `--pref` de grupo de `dev:sesion`.

## Agregar un sitio

Nuevo tema en `src/temas/<id>/`, su id en `src/temas/index.json`, y el dominio en `host_permissions` y `content_scripts.matches` del manifest.

## Agregar una feature

`src/features/<id>.js` con `MiTema.registrarFeature("<id>", { actualizar(opciones) {…} })`, listado en `content_scripts.js` entre `content/registro.js` y `content/motor.js`. Su CSS base (si tiene) en `src/features/<id>.css` y en `content_scripts.css`.

## Comandos (desde `extension/`; `dev`, `dev:sesion`, `check` y `build` también desde la raíz del repo)

- `npm run dev:backend` (desde la raíz): levanta el backend en `localhost:3000`. Sin él la extensión funciona igual (usa los temas locales).
- `npm run dev`: abre Firefox con la extensión cargada en youtube.com; al guardar recarga la extensión y refresca las pestañas del sitio (solo en modo desarrollo, vía `onInstalled` con `temporary`).
- `npm run dev:sesion`: igual, con perfil persistente en `.perfil-dev/`. La ruta del perfil debe llevar `./`: sin barra, web-ext la trata como *nombre* de perfil (`-P`) y Firefox no arranca (`ECONNREFUSED`).
- `npm run perfil:clonar`: clona un perfil real de Firefox a `.perfil-dev/` (interactivo; `-- --perfil "<nombre>"` para elegir directo).
- `npm run check`: `npm test` + `npm run lint`. Correr antes de dar algo por terminado; debe quedar sin errores.
- `npm run build`: genera el .zip en `web-ext-artifacts/`.
- `npm run sign`: firma como "unlisted" en AMO (requiere `WEB_EXT_API_KEY` y `WEB_EXT_API_SECRET`).
