# guide

La **Guía** encuentra la **ruta de referencia** de una tarea u objetivo leyendo el DOM y mirando capturas: la más
corta verificada entre las que explora. Cada objetivo pasa por separado por la Guía y por el
[Visitante](../visitor/README.md), que solo ve capturas; con herramientas web, la Guía debe lograrlo al menos igual de
bien, y los intentos del Visitante se comparan con su ruta. Dónde va cada pieza está en
[arquitectura](../../../docs/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

## Uso

```bash
uv run main.py route --task wom.cl/baja-fibra
uv run main.py route --task sii.cl/exencion-contribuciones --viewports desktop,mobile
uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal de Providencia"
uv run main.py route --site https://www.wom.cl/ --routes all
uv run main.py route --url https://www.wom.cl/ --revision r1 --goal baja-fibra
uv run main.py adopt --goal wom.cl/baja-fibra
```

`route`:

| Opción | Qué hace |
|---|---|
| `--task <host>/<id>` | Una tarea de [`agents/tasks/`](../../tasks/). |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`; el objetivo es `libre-<palabras>-<hash>` de la instrucción. |
| `--site <url>` | El último catálogo del sitio, del [Catalogador](../cataloger/README.md): la ruta de sus objetivos sin `exclusion`, primero los menos prominentes, en desktop. |
| `--url`, `--revision` y `--goal` | El objetivo `--goal` del catálogo de esa revisión, en desktop, en una corrida de la revisión. Si no hay catálogo, el objetivo falta, tiene `exclusion` o empieza en otro host, o la ruta no queda `verified`, la corrida termina `failed` y la salida es 1. |
| `--routes N` | Con `--site`: deja hasta N objetivos con ruta verificada, o todos con `all` (por defecto 0); los que ya tienen una corrida verificada para la misma instrucción cuentan y no se rehacen. |
| `--rerun` | Con `--site`: rehace también las rutas ya verificadas. |
| `--viewports` | Viewports separados por coma: `desktop` (1024x768, el del perfil `desktop` del Visitante) y `mobile` (390x844). Por defecto, `desktop`. |
| `--shorter N` | Exploraciones más que buscan una ruta más corta que la primera verificada (por defecto 1; con `--revision`, 0). |

`adopt`:

| Opción | Qué hace |
|---|---|
| `--goal <host>/<id>` | Objetivo cuyas propuestas del Visitante (`proposals.json` de sus corridas) se verifican contra su ruta vigente. |

En los dos: `--model` y `--effort` (por defecto `claude-opus-5-5`, `high`) y `--cdp-url` para un navegador remoto.

Usa tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan. Cada ruta es
una corrida de guide en el almacén de [`shared.store`](../../shared/README.md) (`AGENTS_STORE` o `agents/.runs/`).

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py`, `guide/route_command.py`, `guide/adopt_command.py` | Punto de entrada y cada subcomando. |
| `guide/catalog_routes.py` | Qué objetivos de un catálogo se mapean y dónde queda cada ruta. |
| `guide/reference.py` | Una ruta: explorar, destilar, verificar, minimizar, buscar una más corta y escribir. |
| `guide/candidates.py` | Rutas candidatas, cuál gana y la instrucción que pide una más corta. |
| `guide/explore.py` | El ciclo: vista del DOM → modelo → acción → historial. |
| `guide/page_view.py` | La vista: encabezados, elementos interactivos con ref y estado, y texto visible. |
| `guide/operate.py` | Ejecuta una acción sobre un elemento y registra el paso. |
| `guide/locators.py` | Localizadores estables de cada elemento: rol y nombre, texto, href, ruta CSS. |
| `guide/prompts.py`, `guide/decider.py` | Prompt, esquema de la decisión y llamada a Claude Code. |
| `guide/route.py` | Pasos, destilación y totales. |
| `guide/replay.py` | Verificación por repetición y minimización. |
| `guide/quote.py`, `guide/output.py` | Comprobación de la cita y escritura de la ruta. |
| `guide/adopt.py` | Verificación y adopción de una ruta propuesta por el Visitante. |
| `guide/config.py` | Modelo y límites. |

El navegador, Claude Code, los nodos, los viewports y el objetivo del catálogo están en
[`agents/shared/`](../../shared/README.md).

### Ruta (`route`)

1. **Explorar.** En cada turno el modelo recibe la vista del DOM y una captura, y responde una acción: `click`,
   `fill` o `select` sobre una ref, `press`, `back`, `scroll`, o el final `done`, `blocked` o `give_up`. El texto de la
   página llega desde la pantalla actual. `done` lleva la respuesta y una cita textual de la página (dos palabras o
   más; se compara sin espacios ni mayúsculas); si la cita no está en el texto que se puede mostrar (sin lo oculto ni
   lo recortado, como un acordeón cerrado), se rechaza. No puede ir a una URL, seguir un enlace a otro host ni usar un elemento oculto: primero debe abrir lo que lo muestra. Si un
   elemento que estaba a la vista se oculta al actuar, como la diapositiva de un carrusel, se espera a que vuelva; al
   repetir la ruta también, y menos al probar quitar un paso. Cinco rechazos iguales seguidos (misma acción y motivo)
   terminan la exploración con `repeated_rejection`.
2. **Destilar.** Se corta cada vuelta que regresa a un nodo ya visitado (URL normalizada más título, como en el
   Visitante), desde donde se llegó a él. Las acciones dentro de una página se conservan. Si esa candidata no verifica,
   se prueba cortar desde donde se salió del nodo, porque volver atrás puede conservar el estado de la página.
3. **Verificar y minimizar.** La ruta se repite en un contexto nuevo con los localizadores registrados. Si llega al
   mismo nodo final y la cita está en la página, queda `verified`. Después se prueba quitar cada acción que no cambia
   de página y se conserva la ruta más corta que sigue verificando. Esta fase no llama al modelo.
4. **Buscar una más corta.** Con `--shorter N`, después de la primera ruta verificada se explora hasta N veces más con
   la ruta conocida en la instrucción, pidiendo una estrictamente más corta y atendiendo a lo que destaca en la
   captura. Cada candidata pasa por los pasos 2 y 3 con su propia cita. Queda la verificada con menos `min_steps` (a
   igualdad, menos acciones); `search` en route.json registra cada intento.
- **Límites:** los de `guide/config.py`. Los envíos nativos de formularios POST o con contraseña se cancelan, como en
  el Visitante.
- **Pasos mínimos** (`min_steps`) en la unidad del Visitante: un clic o una tecla es 1, escribir o elegir en una lista
  es 2 (clic y tecleo), cada elemento que estaba fuera de pantalla suma un scroll, y suma otro si al final la cita no
  está en pantalla (`quote_scrolls`), porque el juez decide con la captura final.

### Adopción (`adopt`)

Cuando un intento del Visitante logra la tarea con menos pasos que la referencia, su corrida deja `proposals.json` con
la clave de esa ruta. `adopt` toma, por ruta vigente, la propuesta más corta sin revisar y la repite con
localizadores sacados del texto y el href que el Visitante registró de cada elemento clicado. Si llega a la página
final del intento, la cita de la referencia está en ella y tiene menos `min_steps`, la ruta adoptada es una corrida
nueva de guide cuyos `inputs` son la ruta anterior y la corrida del Visitante. Cada propuesta termina `promoted`,
`not_shorter`, `unverified` o `stale`, y el resultado queda en `adoption.json` de una corrida nueva con esos mismos
`inputs`: `succeeded` con la ruta adoptada, o `failed` con solo `adoption.json`. Una propuesta revisada no se repite.

## Salida

```
<host>/guide/<id>/<viewport>/<run>/
├── manifest.json     inputs: la corrida del catálogo, si el objetivo vino de uno
├── route.json        estado, respuesta, cita, totales, pasos, exploración, verificación y búsqueda
├── route.md
├── step_NN.png       la pantalla después de cada paso (step_00 es el inicio)
├── trace.json        el avance en vivo; al terminar, la ruta verificada (`succeeded`) o lo explorado (`failed`)
└── claude_code.log
```

Mientras explora, cada paso sube al almacén su `step_NN.png` y `trace.json` (`steps` con la forma de route.json), sin
esperar al final. Cada paso lleva, como los del Visitante, `decided_at`, `executed_at` y `settled_at` (ISO con zona)
y `seconds_since_start`. Con `--shorter`, trace.json sigue la exploración en curso: al empezar otra vuelve a cero
pasos. Al terminar con la ruta verificada, trace.json pasa a ella y se quitan las capturas que no usa; sin ruta
verificada conserva los pasos explorados y sus capturas (las que route.json pisaría quedan como `explore_NN.png`).

La respuesta que encontró la ruta queda en `answer` de route.json: es la que va en `expected_answer` al promover un
objetivo a tarea.

`status` de route.json es `verified`, `unverified` (la repetición no llegó o no encontró la cita) o `not_found` (la
exploración terminó sin respuesta); la corrida termina `succeeded` en los tres casos y `failed` si falló el programa.
La ruta vigente de un objetivo para una instrucción es la de su corrida `succeeded` más nueva de esa instrucción.

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude: el recorrido completo usa un modelo guionizado sobre sitios locales.
