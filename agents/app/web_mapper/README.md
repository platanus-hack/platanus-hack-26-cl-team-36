# web_mapper

El **Mapeador** lee el DOM de un sitio. Con `goals` cataloga los **objetivos** que el sitio ofrece a un visitante,
clasificados según [niveles de tarea](../../../docs/agents/niveles-de-tarea.md). Con `route` encuentra la **ruta de
referencia** de una tarea, la más corta verificada entre las que explora. Es la contraparte del [evaluador](../web_evaluator/README.md), que
solo ve capturas: sus intentos se comparan con esta ruta. Dónde va cada pieza está en
[arquitectura](../../../docs/agents/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

Usa módulos del evaluador (navegador, Claude Code local, nodos y perfiles) desde `../web_evaluator`.

## Uso

```bash
uv run main.py route --task wom-baja-fibra
uv run main.py route --task sii-exencion-contribuciones --viewports desktop,mobile
uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal de Providencia"
uv run main.py goals --url https://www.wom.cl/ --routes all
uv run main.py adopt --id wom-baja-fibra
```

`route`:

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). La ruta queda en `agents/.runs/<id>/reference/<viewport>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. La ruta queda en `agents/.runs/reference/<viewport>/`. |
| `--viewports` | Viewports separados por coma: `desktop` (1024x768, el de `first_time` y `hurried`) y `mobile` (390x844). Por defecto, `desktop`. |
| `--shorter N` | Exploraciones más que buscan una ruta más corta que la primera verificada (por defecto 1). |
| `--output` | Otra carpeta base en vez de `agents/.runs/<id>/`. |

`goals`:

| Opción | Qué hace |
|---|---|
| `--url` | Página inicial del sitio. El catálogo queda en `agents/.runs/<host>/goals/`. |
| `--pages`, `--depth` | Topes del esquema (por defecto 30 páginas y profundidad 2). |
| `--routes N` | Deja hasta N objetivos con ruta verificada, o todos con `all` (por defecto 0); las ya verificadas cuentan. Cada ruta queda en `agents/.runs/<id>/reference/desktop/`. |
| `--shorter N` | Como en `route`. |
| `--rerun` | Rehace el catálogo y las rutas. Sin esta opción se reutiliza `goals.json` y no se vuelve a mapear una ruta ya verificada. |
| `--output` | Otra carpeta en vez de `agents/.runs/<host>/goals/`. |

`adopt`:

| Opción | Qué hace |
|---|---|
| `--id` | Tarea u objetivo cuyas propuestas del evaluador (`reference/<viewport>/proposed.json`) se verifican. |

En los dos: `--model` y `--effort` (por defecto `claude-opus-5-5`, `high`) y `--cdp-url` para un navegador remoto.

Usa tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py`, `mapper/route_command.py`, `mapper/goals_command.py` | Punto de entrada y cada subcomando. |
| `mapper/reference.py` | Una ruta: explorar, destilar, verificar, minimizar, buscar una más corta y escribir. |
| `mapper/candidates.py` | Rutas candidatas, cuál gana y la instrucción que pide una más corta. |
| `mapper/explore.py` | El ciclo: vista del DOM → modelo → acción → historial. |
| `mapper/page_view.py` | La vista: encabezados, elementos interactivos con ref y estado, y texto visible. |
| `mapper/operate.py` | Ejecuta una acción sobre un elemento y registra el paso. |
| `mapper/locators.py` | Localizadores estables de cada elemento: rol y nombre, texto, href, ruta CSS. |
| `mapper/prompts.py`, `mapper/decider.py`, `mapper/claude.py` | Prompt, esquema de la decisión y llamadas a Claude Code. |
| `mapper/route.py` | Pasos, destilación y totales. |
| `mapper/replay.py` | Verificación por repetición y minimización. |
| `mapper/quote.py`, `mapper/output.py` | Comprobación de la cita y escritura de la ruta. |
| `mapper/outline.py`, `mapper/crawl.py` | Esquema de cada página y recorrido del sitio. |
| `mapper/catalog.py`, `mapper/goal_rules.py` | Objetivos propuestos por el modelo; validación y campos sin modelo. |
| `mapper/goals.py`, `mapper/goal_routes.py`, `mapper/goals_output.py` | El objetivo, sus rutas y la escritura del catálogo. |
| `mapper/adopt.py`, `mapper/adopt_command.py` | Verificación y adopción de una ruta propuesta por el evaluador. |

### Ruta (`route`)

1. **Explorar.** En cada turno el modelo recibe la vista del DOM y una captura, y responde una acción: `click`,
   `fill` o `select` sobre una ref, `press`, `back`, `scroll`, o el final `done`, `blocked` o `give_up`. El texto de la
   página llega desde la pantalla actual. `done` lleva la respuesta y una cita textual de la página; si la cita no está
   en el texto que se puede mostrar (sin lo oculto ni lo recortado, como un acordeón cerrado), se rechaza. No puede ir
   a una URL, seguir un enlace a otro host ni usar un elemento oculto: primero debe abrir lo que lo muestra. Si un
   elemento que estaba a la vista se oculta al actuar, como la diapositiva de un carrusel, se espera a que vuelva; al
   repetir la ruta también, y menos al probar quitar un paso.
2. **Destilar.** Se corta cada vuelta que regresa a un nodo ya visitado (URL normalizada más título, como en el
   evaluador), desde donde se llegó a él. Las acciones dentro de una página se conservan. Si esa candidata no verifica,
   se prueba cortar desde donde se salió del nodo, porque volver atrás puede conservar el estado de la página.
3. **Verificar y minimizar.** La ruta se repite en un contexto nuevo con los localizadores registrados. Si llega al
   mismo nodo final y la cita está en la página, queda `verified`. Después se prueba quitar cada acción que no cambia
   de página y se conserva la ruta más corta que sigue verificando. Esta fase no llama al modelo.
4. **Buscar una más corta.** Con `--shorter N`, después de la primera ruta verificada se explora hasta N veces más con
   la ruta conocida en la instrucción, pidiendo una estrictamente más corta y atendiendo a lo que destaca en la
   captura. Cada candidata pasa por los pasos 2 y 3 con su propia cita. Queda la verificada con menos `min_steps` (a
   igualdad, menos acciones); `search` en route.json registra cada intento.
- **Límites:** los de `mapper/config.py`. Los envíos nativos de formularios POST o con contraseña se cancelan, como en
  el evaluador.
- **Pasos mínimos** (`min_steps`) en la unidad del evaluador: un clic o una tecla es 1, escribir o elegir en una lista
  es 2 (clic y tecleo), cada elemento que estaba fuera de pantalla suma un scroll, y suma otro si al final la cita no
  está en pantalla (`quote_scrolls`), porque el juez decide con la captura final.

### Objetivos (`goals`)

1. **Esquema, sin modelo.** Recorre en anchura las páginas del mismo sitio, primero los enlaces del encabezado, una
   página a la vez y sin enviar formularios. De cada una guarda título, encabezados, enlaces por zona (navegación,
   contenido, pie), formularios, botones y señales de barrera.
2. **Catálogo, con el modelo.** El modelo lee el esquema y propone objetivos con `description`, `level`, `parent`,
   `intent`, `submits_form`, `evidence` y `entry`, aplicando las reglas de niveles de tarea.
3. **Campos sin modelo.** Se valida lo que propuso el modelo; lo que se descarta o corrige queda en `issues`.
   `prominence` sale del primer elemento de la ruta verificada en la página inicial o, sin ruta, de dónde está `entry`;
   `gates` de las señales de sus páginas de evidencia (solo campos visibles de formularios del contenido, no del
   encabezado ni del pie) y `complexity` de las acciones de la ruta, sin scrolls, si verificó.
4. **Rutas.** Con `--routes N`, se mapean los `user_goal` sin `login`, `personal_data` ni `bot_check`, primero los
   menos prominentes. Como el Mapeador no envía formularios, en un objetivo `transact` la instrucción le pide llegar
   hasta el paso anterior al envío; la ruta no prueba el envío.
5. **Para el evaluador.** Cada objetivo guarda `instruction`, la tarea que reciben el Mapeador y el evaluador, y
   `exclusion`, por qué el evaluador no lo intenta (nivel o barrera) o `null`.

### Adopción (`adopt`)

Cuando un intento del evaluador logra la tarea con menos pasos que la referencia, deja `proposed.json` junto a ella.
`adopt` la repite con localizadores sacados del texto y el href que el evaluador registró de cada elemento clicado.
Si llega a la página final del intento, la cita de la referencia está en ella y tiene menos `min_steps`, reemplaza a
route.json. `status` de la propuesta queda `promoted`, `not_shorter`, `unverified` o `stale`.

## Salida

```
agents/.runs/<tarea>/reference/<viewport>/
├── route.json        estado, respuesta, cita, totales, pasos, exploración, verificación y búsqueda
├── route.md
├── proposed.json     ruta propuesta por el evaluador, si alguna vez usó menos pasos
├── step_NN.png       la pantalla después de cada paso (step_00 es el inicio)
└── claude_code.log
```

`status` es `verified`, `unverified` (la repetición no llegó o no encontró la cita) o `not_found` (la exploración
terminó sin respuesta).

```
agents/.runs/<host>/goals/
├── outline.json      el esquema del sitio
├── goals.json        los objetivos: cada uno tiene la forma de una tarea de agents/tasks/ y se promueve copiándolo
├── goals.md          tabla agrupada por summary
├── summary.md/json   resumen del sitio, que escribe el evaluador
└── claude_code.log
```

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude: el recorrido completo y el catálogo usan un modelo guionizado sobre sitios locales.
