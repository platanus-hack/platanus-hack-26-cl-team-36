# guide

La **Guía** encuentra la **ruta de referencia** de una tarea u objetivo leyendo el DOM y mirando capturas: la más
corta verificada entre las que explora. Cada objetivo pasa por separado por la Guía y por el
[Visitante](../visitor/README.md), que solo ve capturas; con herramientas web, la Guía debe lograrlo al menos igual de
bien, y los intentos del Visitante se comparan con su ruta. Dónde va cada pieza está en
[arquitectura](../../../docs/agents/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

## Uso

```bash
uv run main.py route --task wom-baja-fibra
uv run main.py route --task sii-exencion-contribuciones --viewports desktop,mobile
uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal de Providencia"
uv run main.py route --goals ../../.runs/www.wom.cl/goals/goals.json --routes all
uv run main.py adopt --id wom-baja-fibra
```

`route`:

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). La ruta queda en `agents/.runs/<id>/reference/<viewport>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. La ruta queda en `agents/.runs/reference/<viewport>/`. |
| `--goals <goals.json>` | Un catálogo del [Catalogador](../cataloger/README.md): la ruta de sus objetivos sin `exclusion`, primero los menos prominentes, en desktop. Cada ruta queda en `agents/.runs/<id>/reference/desktop/`. |
| `--routes N` | Con `--goals`: deja hasta N objetivos con ruta verificada, o todos con `all` (por defecto 0); las ya verificadas para la misma instrucción cuentan y no se rehacen. |
| `--rerun` | Con `--goals`: rehace también las rutas ya verificadas. |
| `--viewports` | Viewports separados por coma: `desktop` (1024x768, el de `first_time` y `hurried`) y `mobile` (390x844). Por defecto, `desktop`. |
| `--shorter N` | Exploraciones más que buscan una ruta más corta que la primera verificada (por defecto 1). |
| `--output` | Otra carpeta base en vez de `agents/.runs/<id>/`. |

`adopt`:

| Opción | Qué hace |
|---|---|
| `--id` | Tarea u objetivo cuyas propuestas del Visitante (`reference/<viewport>/proposed.json`) se verifican. |

En los dos: `--model` y `--effort` (por defecto `claude-opus-5-5`, `high`) y `--cdp-url` para un navegador remoto.

Usa tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan.

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
   página llega desde la pantalla actual. `done` lleva la respuesta y una cita textual de la página; si la cita no está
   en el texto que se puede mostrar (sin lo oculto ni lo recortado, como un acordeón cerrado), se rechaza. No puede ir
   a una URL, seguir un enlace a otro host ni usar un elemento oculto: primero debe abrir lo que lo muestra. Si un
   elemento que estaba a la vista se oculta al actuar, como la diapositiva de un carrusel, se espera a que vuelva; al
   repetir la ruta también, y menos al probar quitar un paso.
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

Cuando un intento del Visitante logra la tarea con menos pasos que la referencia, deja `proposed.json` junto a ella.
`adopt` la repite con localizadores sacados del texto y el href que el Visitante registró de cada elemento clicado.
Si llega a la página final del intento, la cita de la referencia está en ella y tiene menos `min_steps`, reemplaza a
route.json. `status` de la propuesta queda `promoted`, `not_shorter`, `unverified` o `stale`.

## Salida

```
agents/.runs/<tarea>/reference/<viewport>/
├── route.json        estado, respuesta, cita, totales, pasos, exploración, verificación y búsqueda
├── route.md
├── proposed.json     ruta propuesta por el Visitante, si alguna vez usó menos pasos
├── step_NN.png       la pantalla después de cada paso (step_00 es el inicio)
└── claude_code.log
```

La respuesta que encontró la ruta queda en `answer` de route.json: es la que va en `expected_answer` al promover un
objetivo a tarea.

`status` es `verified`, `unverified` (la repetición no llegó o no encontró la cita) o `not_found` (la exploración
terminó sin respuesta).

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude: el recorrido completo usa un modelo guionizado sobre sitios locales.
