# web_evaluator

Dada una URL y una tarea en lenguaje natural, lanza usuarios sintéticos que intentan la tarea en un navegador como lo
haría una persona, y une sus recorridos en un árbol de rutas que indica cuál termina con menos errores. Es el
**evaluador** de [docs/agents/](../../../docs/agents/README.md); dónde va cada pieza está en
[arquitectura](../../../docs/agents/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync                              # crea .venv con Python 3.12 e instala las dependencias
uv run playwright install chromium
```

## Uso

```bash
uv run main.py --task wom-baja-fibra
uv run main.py --task sii-exencion-contribuciones --profiles mobile --effort low
uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal de Providencia"
```

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). Las corridas quedan en `agents/.runs/<id>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. Las corridas quedan en `agents/.runs/`. |
| `--profiles` | Perfiles separados por coma: `first_time`, `hurried`, `mobile` (por defecto, los tres). |
| `--engine` | `claude-code` (por defecto) o `api`. |
| `--model`, `--effort` | Modelo y nivel de esfuerzo de los usuarios (por defecto `claude-sonnet-5-5`, `medium`). |
| `--output` | Otra carpeta para las corridas. |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |
| `--record-video` | Graba un video `.webm` de cada intento (al tamaño del viewport), además de las capturas de cada paso. El reporte enlaza el video y marca en qué minuto ocurre cada paso. |

Por defecto usa tu **Claude Code local** (`--engine claude-code`): no necesita clave de API, solo tener `claude`
instalado y con sesión iniciada, y consume los límites de tu plan. Con una clave de API puedes usar la herramienta
oficial de computer use:

```bash
export ANTHROPIC_API_KEY=...
uv run main.py --engine api --task wom-baja-fibra
```

## Tareas

Cada archivo de [`agents/tasks/`](../../tasks/) es una tarea con la forma de
[formas de datos](../../../docs/formas-de-datos.md), sección 5: `id`, `host`, `start_url` y `description`. Las tres
que hay salen de [tareas en sitios chilenos](../../../docs/tareas-sitios-chilenos.md). `expected_answer` sirve para
revisar el resultado a mano: el juez todavía no lo usa, decide con un criterio que propone a partir de la tarea.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: lee las opciones y lanza una tanda. |
| `batch.py` | Una tanda: criterio de éxito, usuarios en paralelo, veredictos, árbol y reporte. |
| `harness.py` | El ciclo de cada usuario: captura → modelo → acción → registro. |
| `engines.py` | Cómo decide el modelo: `ClaudeCodeEngine` (`claude -p`) o `ApiEngine` (computer use). |
| `judge.py` | El juez: propone el criterio de éxito y da el veredicto de cada intento. |
| `browser.py`, `actions.py` | El navegador (Playwright y Chromium) y las acciones que puede pedir el agente. |
| `recording.py` | Los pasos y el recorrido (`Step`, `Run`), y las señales que se leen del DOM solo para el registro. |
| `route_tree.py`, `report.py` | El árbol de rutas, la ruta recomendada y `report.md`. |
| `profiles.py`, `config.py` | Los perfiles de usuario, su prompt y los límites. |

- **El agente solo ve la pantalla:** recibe capturas del viewport y nunca HTML ni DOM. Solo puede hacer clic por
  coordenadas, usar el teclado y hacer scroll. Zoom, arrastre, hover y el resto de acciones están desactivados. El DOM
  se lee únicamente para el registro.
- **Expectativa:** cada acción va acompañada de una frase con lo que el agente espera que pase (campo obligatorio en
  `claude-code`, herramienta `expectation` en `api`). Una acción sin expectativa no se ejecuta.
- **Límites:** 15 acciones y 3 minutos por intento; al agotarse, el resultado es `abandoned`. Los envíos de
  formularios POST o con contraseña se cancelan como red de seguridad.
- **Resultados del juez:** `success`, `failed` (terminó en un estado equivocado) o `abandoned`.
- **Árbol:** un nodo es una URL normalizada más el título de la página. Una rama es la acción entre dos nodos,
  identificada por el texto del elemento clicado. La ruta recomendada es la de menor costo, con
  costo = -ln((éxitos+1)/(éxitos+fallos+2)) por rama.

## Salida

```
agents/.runs/<tarea>/<fecha-hora>/
├── criteria.json
├── <perfil>/           step_NN.png, run.json, claude_code.log y, con --record-video, video.webm
├── route_tree.json     nodos, ramas y ruta recomendada
└── report.md
```

`agents/.runs/` queda fuera de git.

Con `--record-video`, cada pestaña que abre el usuario tiene su propio video (`video.webm`, `video-2.webm`...). Los
minutos del reporte son del primero. Un intento de 3 minutos ocupa del orden de 15 a 30 MB.

## Pruebas

```bash
uv run pytest -q
```

Las pruebas no llaman a Claude: cubren el árbol, los motores y las acciones del navegador sobre páginas locales.
