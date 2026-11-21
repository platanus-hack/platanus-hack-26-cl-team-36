# Mi Tema — extensión de Firefox

Extensión de Firefox que cambia el diseño de sitios web aplicando **temas**.
Un tema es CSS + la lista de features (comportamientos JS) que se activan en ese sitio.

Hoy los temas vienen empaquetados en la extensión y solo existe el de YouTube (PoC).
La idea es que a futuro los temas vengan de una API (ver [Hacia la API](#hacia-la-api)).

## Estructura

```
extension/
├── src/                      ← todo lo que va dentro de la extensión (.xpi)
│   ├── manifest.json
│   ├── background/
│   │   ├── index.js          ← botón ON/OFF + resuelve el tema de cada página e inyecta su CSS
│   │   ├── temas.js          ← lógica pura (validar temas, elegir tema por URL); testeable con Node
│   │   └── proveedor-local.js← lee los temas de src/temas/
│   ├── content/
│   │   ├── registro.js       ← registro de features (globalThis.MiTema)
│   │   └── motor.js          ← genérico: pide el tema, pone la clase mi-tema, corre features
│   ├── features/             ← comportamientos JS reutilizables, configurables por el tema
│   │   ├── modo-foco.js
│   │   └── modo-foco.css
│   ├── temas/                ← temas locales (hoy hacen el papel de la API)
│   │   ├── index.json        ← lista de ids
│   │   └── youtube/
│   │       ├── tema.json     ← dominios, features y sus opciones
│   │       └── tema.css
│   └── icons/
├── scripts/                  ← herramientas de desarrollo (no se empaquetan)
│   └── clonar-perfil.js      ← `npm run perfil:clonar`
├── test/                     ← tests con node:test (sin dependencias)
├── .perfil-dev/              ← perfil de Firefox para `npm run dev:sesion` (ignorado por git)
└── web-ext-artifacts/        ← builds (ignorado por git)
```

## Cómo funciona

1. En cada página, `content/motor.js` le pide al background el tema para esa URL.
2. El background busca el tema en sus **proveedores** (hoy solo `proveedor-local.js`),
   inyecta el CSS con `scripting.insertCSS` y le devuelve al motor las features y opciones.
3. El motor pone la clase `mi-tema` en `<html>` (todo el CSS del tema cuelga de ella) y
   ejecuta las features en cada navegación y cambio del DOM.
4. El botón de la extensión guarda `activo` en `storage`; el motor quita/pone la clase al instante.

## Requisitos

- Firefox 140 o superior
- Node.js 22 o superior

## Probarla localmente

Desde la raíz del repo (o desde `extension/`, da lo mismo):

```bash
npm install   # la primera vez
npm run dev
```

Se abre un Firefox aparte con la extensión cargada en youtube.com. Cada vez que
guardas un archivo de `src/`, la extensión se recarga sola y las pestañas del
sitio se refrescan para mostrar el cambio. Ese refresco solo ocurre con la
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

Si el diseño no se aplica, revisa en `about:addons` → la extensión → "Permisos"
que tenga acceso al sitio.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Firefox con la extensión, recarga al guardar |
| `npm run dev:sesion` | Igual, con perfil persistente |
| `npm run perfil:clonar` | Copia tu perfil de Firefox a `.perfil-dev/` |
| `npm test` | Tests de la lógica de temas y validación de `src/temas/` |
| `npm run lint` | Valida la extensión con `web-ext lint` |
| `npm run check` | `test` + `lint` |
| `npm run build` | Genera el .zip en `web-ext-artifacts/` |

Para depurar: el motor y las features se ven en la consola de la pestaña; el
background en `about:debugging` → la extensión → "Inspeccionar".

## Agregar un tema (sitio nuevo)

1. Crea `src/temas/<id>/tema.json` y `src/temas/<id>/tema.css`. Todo el CSS va bajo `html.mi-tema`.
2. Agrega `<id>` a `src/temas/index.json`.
3. Agrega el dominio a `host_permissions` y `content_scripts.matches` en `manifest.json`.
4. `npm run check`.

```json
{
  "nombre": "YouTube morado",
  "dominios": ["youtube.com"],
  "features": { "modo-foco": { "rutas": ["/watch"], "ancla": "ytd-watch-metadata #title" } },
  "eventosNavegacion": ["yt-navigate-finish"]
}
```

`dominios` incluye subdominios. `eventosNavegacion` son eventos propios del sitio
cuando navega sin recargar (SPA); además el motor siempre reacciona a cambios del DOM.

## Agregar una feature

1. Crea `src/features/<id>.js` que llame a `MiTema.registrarFeature("<id>", { actualizar(opciones) { … } })`.
   `actualizar` se llama muchas veces: debe ser idempotente (revisar si algo ya existe antes de insertarlo).
2. Agrégala a `content_scripts.js` en `manifest.json`, **después** de `content/registro.js` y antes de `content/motor.js`.
3. Lo específico de cada sitio (selectores, rutas) va en las opciones del tema, no en la feature.

## Hacia la API

La idea es agregar `src/background/proveedor-api.js` con la misma forma que el
proveedor local (`buscar(url) → tema | null`) y ponerlo primero en la lista
`proveedores` de `background/index.js`. El local queda como respaldo. La API
debería devolver lo mismo que `tema.json` más `id` y `css` (el contenido de
`tema.css`); `normalizarTema` en `background/temas.js` es el contrato.

Lo que hay que tener en cuenta:

- **La API solo puede mandar datos (CSS + config), nunca JS.** MV3 y Mozilla prohíben
  ejecutar código remoto. Los comportamientos tienen que existir como features en la extensión.
- **Permisos de sitios:** para aplicar temas en cualquier sitio, `matches` y `host_permissions`
  pasarían a `<all_urls>` (o pedir permisos por sitio con `permissions.request`).
  La URL de la API también va en `host_permissions`.
- **Privacidad:** si se le manda a la API la URL o el dominio que visita el usuario, hay que
  declararlo en `data_collection_permissions` del manifest. Alternativa que evita eso: descargar
  el catálogo completo de temas y elegir localmente con `temaParaUrl`.

## Instalarla de forma permanente

Firefox solo instala de forma permanente extensiones firmadas por Mozilla. Puedes
firmarla sin publicarla:

1. Crea una cuenta en addons.mozilla.org.
2. Genera tus credenciales en https://addons.mozilla.org/developers/addon/api/key/
3. Ejecuta:
   ```bash
   export WEB_EXT_API_KEY="user:xxxx:xxx"
   export WEB_EXT_API_SECRET="xxxxxxxx"
   npm run sign
   ```
4. Queda un `.xpi` firmado en `web-ext-artifacts/`. Arrástralo a Firefox para instalarlo.

Cada versión nueva que firmes necesita un número de `version` mayor en `manifest.json`.
No cambies `browser_specific_settings.gecko.id`: AMO lo trataría como otra extensión.
