# Chameleon — extensión de Firefox

Extensión de Firefox (Manifest V3) que cambia el diseño de sitios web aplicando
temas (CSS + features JS) sobre la página original. No reemplaza el HTML/JS del
sitio: el sitio carga normal y nosotros modificamos encima.

La API (`../backend/`) decide qué tema va en cada sitio; por ahora devuelve solo el id
y el contenido vive en `src/temas/<id>/` (hoy: youtube y gmail). A futuro la API traerá
el tema completo: todo lo específico de un sitio debe poder expresarse como **datos**
(CSS + `tema.json`), no como código.

## Estructura

- `src/`: lo único que se empaqueta (`webExt.sourceDir`). Todo lo demás queda fuera del .xpi.
- `src/background/index.js`: botón ON/OFF (`activo` en `storage.local`) y mensaje `tema:aplicar`: resuelve el tema e inyecta su CSS con `scripting.insertCSS`.
- `src/background/temas.js`: lógica pura (`normalizarTema`, `resolverTema`). Sin `browser.*`: se testea con Node.
- `src/background/api.js`: `consultarTema(url)`: `POST {urlDeLaApi()}/temas/buscar` con `{ url: origen }`. `{success: true, tema}` → id; `{success: false}` → null; caído/timeout (2 s)/respuesta rara → lanza.
- `src/background/temas-locales.js`: `cargarTemaLocal(id)` lee `src/temas/<id>/`.
- `src/background/config.js`: `urlDeLaApi()`. En modo desarrollo (extensión temporal) usa la API local (`API_URL_LOCAL`); instalada, la de AWS (`API_URL_AWS`).
- Content scripts, en este orden: `src/content/registro.js` → `src/content/plantillas.js` → `src/content/transicion.js` → `src/componentes/*.js` → `src/features/*.js` → `src/content/motor.js`.
- `src/content/plantillas.js`: `MiTema.plantillas.leerCampos` (lee datos de la página según reglas de una plantilla) y `MiTema.dom.crear` (crea elementos sin `innerHTML`; `href`/`src` pasan por `urlSegura`).
- `src/content/transicion.js` + `.css`: `MiTema.transicion.animar(activar, aplicar)`, la "ola de adaptación" al apretar el botón (View Transitions; sin ellas, una versión liviana; con `prefers-reduced-motion`, un fundido). Solo la llama el cambio de `activo` en storage, nunca la carga ni la navegación. Todo su CSS va bajo `html[data-mt-transicion]`, que existe solo mientras dura.
- `src/features/vista.js`: reemplaza una sección por una vista dibujada con un componente del catálogo (`src/componentes/`), según una plantilla en el `tema.json`. La sección original queda oculta con `data-mt-oculto` y los clics se reenvían a sus elementos.
- `src/temas/<id>/tema.json` + `tema.css`. El id es el nombre de la carpeta y es lo que devuelve la API.
- `test/`: `node:test`. `temas-locales.test.js` valida cada tema de `src/temas/`.
- `scripts/`: herramientas de desarrollo en Node, sin dependencias. `clonar-perfil.js` copia un perfil real de Firefox a `.perfil-dev/` quitando su asociación al grupo de perfiles (`scripts/lib/perfiles-firefox.js`).

## Reglas del proyecto

- **Solo Firefox.** Usar la API `browser.*` (con promesas), no `chrome.*`.
- **Background = `background.scripts` con `"type": "module"`.** Firefox no soporta `background.service_worker`; nunca lo agregues.
- **El motor es genérico.** `content/motor.js` no debe mencionar ningún sitio. Lo específico (selectores, rutas, eventos de navegación) va en `tema.json` como opciones de features.
- **Sin código remoto.** Los temas (y la API) solo aportan CSS y configuración. Todo JS vive en `src/features/`.
- **Sin API no hay tema.** Si el backend no responde o dice `success: false`, el motor no toca la página (ni siquiera agrega la clase `mi-tema`). No agregar respaldos locales sin que se pida.
- **Todo el CSS de un tema va bajo `html.mi-tema`**, así el botón apaga el diseño completo. Las features usan clases extra (`html.mi-tema.mi-tema-foco`).
- **JS maneja estado y clases; CSS maneja lo visual.** Evitar estilos inline desde JS.
- **Los sitios suelen ser SPA.** Cada feature expone `actualizar(opciones)` idempotente; el motor la llama en cada evento de `eventosNavegacion` y cuando el DOM cambia. Nunca insertar algo sin revisar antes si ya existe.
- **Vistas = componente del catálogo + plantilla.** Lo específico del sitio (selectores, campos, qué clickear) va en la plantilla del `tema.json`, nunca en el componente. Un componente nuevo solo si ningún componente existente sirve; debe servir para otros sitios.
- **Componentes sin `innerHTML`:** todo con `MiTema.dom.crear`. El texto de la página va como texto y las URLs pasan por `urlSegura` (bloquea `javascript:`/`data:`); así una plantilla remota nunca puede ejecutar código.
- **Si una vista falla o no encuentra datos, se deja la página original** (nunca una vista a medias).
- **Content scripts comparten global:** envolver cada archivo en una IIFE y exponer solo vía `globalThis.MiTema`.
- **Nunca guardar una referencia fija a `document.documentElement` ni observar `document.body`.** Gmail reemplaza el `<html>` completo al cargar (`document.open`/`write`) y otros sitios pisan sus clases. Leer `document.documentElement` cada vez y observar `document` (que sobrevive). El motor repone `mi-tema` y `data-mt-tema` en `marcarHtml()`.
- **Selectores:** preferir etiquetas propias del sitio (`ytd-*`) e `id`s sobre clases generadas. Si no se conoce la estructura actual del sitio, pedir al usuario que copie el HTML del elemento desde el inspector en lugar de adivinar.
- **IDs y clases propias con prefijo `mt-`** para no chocar con el sitio.
- **Privacidad:** a la API se le envía solo el origen (`new URL(url).origin`), nunca ruta ni parámetros. Por eso `data_collection_permissions` declara `browsingActivity`; si se envía algo más, actualizarlo.
- **El content script corre en todos los sitios http(s)** (`matches`/`host_permissions` = `http://*/*`, `https://*/*`), solo en el frame principal. Lo que se carga en todas las páginas debe ser liviano y no tocar la página hasta saber que hay tema.
- **`host_permissions` sin puerto:** Firefox no acepta puertos en los patrones (`http://localhost:4747/*` no da permiso y la request sale como CORS con preflight).
- **No cambiar `browser_specific_settings.gecko.id`** (AMO lo trataría como otra extensión).
- **Nunca correr web-ext con el perfil real del usuario** (`--firefox-profile=default-release`, una ruta a `~/Library/Application Support/Firefox/Profiles/...`, etc.), ni en modo copia. Con los grupos de perfiles de Firefox (versión 160 o superior), la copia se registra en el grupo y reescribe `profiles.ini`/`installs.ini` apuntando a una carpeta temporal. Para usar los datos del usuario: `npm run perfil:clonar`. Si se modifica ese script, mantener `sanitizarPrefs` (quita `toolkit.profiles.*`/`browser.profiles.*`) y los `--pref` de grupo de `dev:sesion`.

## Agregar un sitio

`{ dominio, tema: "<id>" }` en `SITIOS` de `../backend/temas.js` + carpeta `src/temas/<id>/` con `tema.json` y `tema.css`. El manifest no cambia. `npm run check` desde la raíz verifica que cada tema del backend exista en la extensión.

## Agregar un componente

`src/componentes/<id>.js` con `MiTema.registrarComponente("<id>", { dibujar(items, opciones, contexto) {…} })` que devuelve un `Element` hecho con `MiTema.dom.crear`; `contexto` trae `abrir(item, evento)`, `viendoOriginal()` y `alternarOriginal()`. CSS en `src/componentes/<id>.css`, scopeado por su clase. Ambos en `content_scripts` del manifest (el test de orden lo verifica).

Para conocer el HTML actual de un sitio antes de escribir una plantilla, no adivinar: pedir al usuario el HTML del elemento o sondearlo con un Firefox headless.

## Agregar una feature

`src/features/<id>.js` con `MiTema.registrarFeature("<id>", { actualizar(opciones) {…} })`, listado en `content_scripts.js` entre `content/registro.js` y `content/motor.js`. Su CSS base (si tiene) en `src/features/<id>.css` y en `content_scripts.css`.

## Comandos (desde `extension/`; `dev`, `dev:sesion`, `check` y `build` también desde la raíz del repo)

- `npm run dev:backend` (desde la raíz): levanta el backend en `localhost:4747`. En modo desarrollo la extensión usa esta API: sin él no se aplica ningún tema.
- `npm run dev`: abre Firefox con la extensión cargada en youtube.com; al guardar recarga la extensión y refresca las pestañas con tema (las que tienen `data-mt-tema` en `<html>`; solo en modo desarrollo, vía `onInstalled` con `temporary`).
- `npm run dev:sesion`: igual, con perfil persistente en `.perfil-dev/`. La ruta del perfil debe llevar `./`: sin barra, web-ext la trata como *nombre* de perfil (`-P`) y Firefox no arranca (`ECONNREFUSED`).
- `npm run perfil:clonar`: clona un perfil real de Firefox a `.perfil-dev/` (interactivo; `-- --perfil "<nombre>"` para elegir directo).
- `npm run check`: `npm test` + `npm run lint` (desde la raíz, también los tests del backend). Correr antes de dar algo por terminado; debe quedar sin errores.
- `npm run build`: genera el .zip en `web-ext-artifacts/`.
- `npm run sign`: firma como "unlisted" en AMO. Lee `WEB_EXT_API_KEY` y `WEB_EXT_API_SECRET` de `extension/.env` (ver `.env.example`, ignorado por git) o del entorno. Nunca leer, mostrar ni commitear `.env`.
