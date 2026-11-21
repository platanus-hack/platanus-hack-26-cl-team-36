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
uv run main.py --goals ../../.runs/www.wom.cl/goals/goals.json --limit 3
```

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). Las corridas quedan en `agents/.runs/<id>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. Las corridas quedan en `agents/.runs/`. |
| `--goals <goals.json>` | Un catálogo del [Mapeador](../web_mapper/README.md): una tanda por objetivo, como con `--task`. Ver [catálogo](#catálogo). |
| `--profiles` | Perfiles separados por coma: `first_time`, `hurried`, `mobile` (por defecto, los tres; con `--goals`, `first_time`). |
| `--engine` | `claude-code` (por defecto), `api` o `bedrock` (Claude en Amazon Bedrock, con tus credenciales de AWS). |
| `--model`, `--effort` | Modelo y nivel de esfuerzo de los usuarios (por defecto `claude-sonnet-5-5`, `medium`; con `--engine bedrock`, `claude-haiku-5-5`). |
| `--output` | Otra carpeta para las corridas. |
| `--browser` | `local` (Chromium, por defecto) o `agentcore` (AgentCore Browser en AWS, una sesión por usuario). |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |
| `--record-video` | Graba un video `.webm` de cada intento (al tamaño del viewport), además de las capturas de cada paso. El reporte enlaza el video y marca en qué minuto ocurre cada paso. |

Por defecto usa tu **Claude Code local** (`--engine claude-code`): no necesita clave de API, solo tener `claude`
instalado y con sesión iniciada, y consume los límites de tu plan. Con una clave de API puedes usar la herramienta
oficial de computer use:

```bash
export ANTHROPIC_API_KEY=...
uv run main.py --engine api --task wom-baja-fibra
```

## En AWS (AgentCore)

El mismo evaluador corre en [AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/), con Claude en Amazon
Bedrock y AgentCore Browser, y gasta de la cuenta de AWS de la hackatón en vez de tu plan. La
[CLI de AgentCore](https://github.com/aws/agentcore-cli) empaqueta esta carpeta para arm64 y la despliega; su
configuración está en [`infra/agentcore/`](../../../infra/README.md#carpetas), junto al resto de la infraestructura. La
entrada en AWS es `agentcore_app.py`; `main.py` sigue siendo el comando local.

En AWS se usa solo Claude Haiku 5.5, tanto para los usuarios sintéticos como para el juez (`BEDROCK_USER_MODEL` y
`BEDROCK_JUDGE_MODEL` en `config.py`); el pedido no puede cambiarlo. En us-east-2, Haiku 5.5 solo se sirve por
perfiles de inferencia que reparten entre regiones, así que se llama por el endpoint `bedrock-runtime` con el perfil de
EE.UU., `us.anthropic.claude-haiku-5-5`, que usa us-east-1, us-east-2 y us-west-2
([ficha del modelo en AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)).
Ese endpoint no acepta la caché automática, así que `ApiEngine` marca el punto de caché a mano. Ojo: Haiku puede errar
más la puntería de los clics que Sonnet, y esos errores se cuentan como fricción del sitio; conviene comparar una misma
tarea en local y en AWS antes de confiar en los resultados.

Con `export AWS_PROFILE=<perfil de la cuenta de la hackatón>`, una prueba de concepto en tres pasos:

```bash
just local explore https://example.com "Encontrar el enlace More information" --profiles first_time \
    --engine bedrock --browser agentcore   # 1. desde tu computador: ¿la cuenta deja usar Claude y el navegador?
just aws deploy                            # 2. despliega (al mergear a main lo hace el workflow AgentCore)
just aws explore wom-baja-fibra            # 3. la tanda corre en AgentCore; el reporte queda en agents/.runs/aws/
```

`just aws status` muestra lo desplegado y `just aws logs` los logs del runtime. La respuesta llega en stream: un
aviso cada 20 s y, al final, el resultado de cada perfil y `report.md`. Las capturas de cada paso quedan en AWS y
se pierden al cerrar la sesión.

## Catálogo

Con `--goals` corre, uno tras otro, los objetivos sin `exclusion` que tienen una ruta verificada del Mapeador para
algún perfil, con la `instruction` que el Mapeador guardó. Cada tanda queda en `agents/.runs/<id del objetivo>/`. Si
una falla, siguen las demás. Al final escribe `summary.md` y `summary.json` junto al catálogo: por objetivo, sus
clasificaciones, los pasos mínimos del Mapeador y cuántas rutas exploró, el resultado y los pasos de cada perfil, la
eficiencia y quién necesitó menos pasos; y los totales del sitio. Los objetivos sin tanda aparecen con el motivo.

| Opción | Qué hace |
|---|---|
| `--goal <id>` | Solo ese objetivo; se puede repetir. |
| `--limit N` | Como máximo N tandas nuevas. |
| `--rerun` | Repite los objetivos que ya tienen tanda (por defecto se omiten). |
| `--summary` | Solo reescribe el resumen desde los archivos, sin correr nada. |

## Tareas

Cada archivo de [`agents/tasks/`](../../tasks/) es una tarea con la forma de
[formas de datos](../../../docs/formas-de-datos.md), sección 5: `id`, `host`, `start_url` y `description`. Las tres
que hay salen de [tareas en sitios chilenos](../../../docs/tareas-sitios-chilenos.md). `expected_answer` sirve para
revisar el resultado a mano: el juez todavía no lo usa, decide con un criterio que propone a partir de la tarea.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: lee las opciones y lanza una tanda. |
| `agentcore_app.py` | Punto de entrada en AgentCore Runtime: recibe la tarea por HTTP y responde en stream. |
| `batch.py` | Una tanda: criterio de éxito, usuarios en paralelo, veredictos, árbol y reporte. |
| `harness.py` | El ciclo de cada usuario: captura → modelo → acción → registro. |
| `engines.py` | Cómo decide el modelo: `ClaudeCodeEngine` (`claude -p`) o `ApiEngine` (computer use). |
| `judge.py` | El juez: propone el criterio de éxito y da el veredicto de cada intento. |
| `browser.py`, `actions.py` | El navegador (Playwright y Chromium) y las acciones que puede pedir el agente. |
| `recording.py` | Los pasos y el recorrido (`Step`, `Run`), y las señales que se leen del DOM solo para el registro. |
| `route_tree.py`, `report.py` | El árbol de rutas, la ruta recomendada y `report.md`. |
| `reference.py` | La comparación de cada intento con la ruta de referencia del [Mapeador](../web_mapper/README.md). |
| `proposal.py` | La propuesta de ruta cuando un intento logra la tarea con menos pasos que la referencia. |
| `goals_run.py`, `site_summary.py` | Las tandas de un catálogo y el resumen del sitio. |
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
├── reference_comparison.json   solo si hay ruta de referencia
└── report.md
```

`agents/.runs/` queda fuera de git.

Si `agents/.runs/<tarea>/reference/` tiene una ruta verificada para el viewport del perfil, el reporte la compara con
cada intento ([fórmulas](../../../docs/agents/niveles-de-tarea.md), sección 5). El avance se informa como llegada a la
página final de la ruta. Si un intento logra la tarea con menos pasos, deja `reference/<viewport>/proposed.json` (sus
pasos con el elemento clicado, sus nodos y la tanda) y el reporte lo dice; `adopt` del Mapeador la verifica.

## Pruebas

```bash
uv run pytest -q
```

Las pruebas no llaman a Claude: cubren el árbol, los motores y las acciones del navegador sobre páginas locales, la
propuesta de ruta, el plan de un catálogo y el resumen a partir de archivos.
