# web_mapper

El **Mapeador**: dada una URL y una tarea, lee el DOM para encontrar la **ruta de referencia**, el camino más corto
que cumple la tarea, y la verifica repitiéndola. Es la contraparte del [evaluador](../web_evaluator/README.md), que
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
```

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). La ruta queda en `agents/.runs/<id>/reference/<viewport>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. La ruta queda en `agents/.runs/reference/<viewport>/`. |
| `--viewports` | Viewports separados por coma: `desktop` (1024x768, el de `first_time` y `hurried`) y `mobile` (390x844). Por defecto, `desktop`. |
| `--model`, `--effort` | Modelo y nivel de esfuerzo (por defecto `claude-opus-5-5`, `high`). |
| `--output` | Otra carpeta base en vez de `agents/.runs/<id>/`. |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |

Usa tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: lee las opciones y mapea cada viewport. |
| `mapper/reference.py` | Un viewport: explorar, destilar, verificar, minimizar y escribir. |
| `mapper/explore.py` | El ciclo: vista del DOM → modelo → acción → historial. |
| `mapper/page_view.py` | La vista: encabezados, elementos interactivos con ref y estado, y texto visible. |
| `mapper/operate.py` | Ejecuta una acción sobre un elemento y registra el paso. |
| `mapper/locators.py` | Localizadores estables de cada elemento: rol y nombre, texto, href, ruta CSS. |
| `mapper/prompts.py`, `mapper/decider.py` | Prompt, esquema de la decisión y llamada a Claude Code. |
| `mapper/route.py` | Pasos, destilación y totales. |
| `mapper/replay.py` | Verificación por repetición y minimización. |
| `mapper/quote.py`, `mapper/output.py` | Comprobación de la cita y escritura de la ruta. |

1. **Explorar.** En cada turno el modelo recibe la vista del DOM y una captura, y responde una acción: `click`,
   `fill` o `select` sobre una ref, `press`, `back`, `scroll`, o el final `done`, `blocked` o `give_up`. El texto de la
   página llega desde la pantalla actual. `done` lleva la respuesta y una cita textual de la página; si la cita no está
   en el texto visible, se rechaza. No puede ir a una URL
   ni usar un elemento oculto: primero debe abrir lo que lo muestra.
2. **Destilar.** Se corta cada vuelta que regresa a un nodo ya visitado (URL normalizada más título, como en el
   evaluador), desde donde se llegó a él. Las acciones dentro de una página se conservan. Si esa candidata no verifica,
   se prueba cortar desde donde se salió del nodo, porque volver atrás puede conservar el estado de la página.
3. **Verificar y minimizar.** La ruta se repite en un contexto nuevo con los localizadores registrados. Si llega al
   mismo nodo final y la cita está en la página, queda `verified`. Después se prueba quitar cada acción que no cambia
   de página y se conserva la ruta más corta que sigue verificando. Esta fase no llama al modelo.
- **Límites:** 40 acciones, 60 turnos y 15 minutos de exploración. Los envíos de formularios POST o con contraseña se
  cancelan, como en el evaluador.
- **Pasos mínimos** (`min_steps`) en la unidad del evaluador: un clic o una tecla es 1, escribir o elegir en una lista
  es 2 (clic y tecleo), cada elemento que estaba fuera de pantalla suma un scroll, y suma otro si al final la cita no
  está en pantalla (`quote_scrolls`), porque el juez decide con la captura final.

## Salida

```
agents/.runs/<tarea>/reference/<viewport>/
├── route.json        estado, respuesta, cita, totales, pasos, exploración y verificación
├── route.md
├── step_NN.png       la pantalla después de cada paso (step_00 es el inicio)
└── claude_code.log
```

`status` es `verified`, `unverified` (la repetición no llegó o no encontró la cita) o `not_found` (la exploración
terminó sin respuesta).

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude: el recorrido completo usa un modelo guionizado sobre un sitio local.
