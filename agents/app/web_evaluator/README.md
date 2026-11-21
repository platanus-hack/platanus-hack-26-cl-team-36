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
uv run main.py --task wom-baja-fibra --css ../../.runs/diseno/www.wom.cl/<fecha-hora>/rep-01/tema.css
```

| Opción | Qué hace |
|---|---|
| `--task <id>` | Una tarea de [`agents/tasks/`](../../tasks/). Las corridas quedan en `agents/.runs/<id>/`. |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`. Las corridas quedan en `agents/.runs/`. |
| `--goals <goals.json>` | Un catálogo del [Mapeador](../web_mapper/README.md): una tanda por objetivo, como con `--task`. Ver [catálogo](#catálogo). |
| `--profiles` | Perfiles separados por coma: `first_time`, `hurried`, `mobile` (por defecto, los tres; con `--goals`, `first_time`) y los [exploradores](#exploradores) `explorador`, `explorador_buscador`, `explorador_pie` y `explorador_contenido`, que solo corren si se piden. |
| `--engine` | `claude-code` (por defecto), `api` o `bedrock` (Claude en Amazon Bedrock, con tus credenciales de AWS). |
| `--model`, `--effort` | Modelo y nivel de esfuerzo de los usuarios (por defecto `claude-sonnet-5-5`, `medium`; con `--engine bedrock`, `claude-haiku-5-5`). |
| `--output` | Otra carpeta para las corridas. |
| `--browser` | `local` (Chromium, por defecto) o `agentcore` (AgentCore Browser en AWS, una sesión por usuario). |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |
| `--record-video` | Graba un video `.webm` de cada intento (al tamaño del viewport), además de las capturas de cada paso. El reporte enlaza el video y marca en qué minuto ocurre cada paso. |
| `--css <archivo>` | Aplica un tema en cada página de cada usuario y en la del criterio, como la extensión: clase `mi-tema` en `<html>` y el CSS en `<style id="mt-tema-css">`, desde que se crea cada documento y repuestos si el sitio los quita. La tanda guarda una copia en `tema.css` y registra archivo y sha256 corto en `route_tree.json` (`tema`) y en el reporte, para comparar tandas con y sin tema. Un tema con `url(`, `image-set(`, `@import`, `expression(`, `javascript:` o barra invertida se rechaza: el filtro de la extensión lo borraría. Todas las tandas, con y sin tema, ignoran la CSP del sitio (`bypass_csp`, como `insertCSS` en la extensión), para que lo único distinto sea el tema. Con `--goals`, las tandas con un tema se planean y resumen aparte (`summary-tema-<sha>.md`). Los temas salen del [diseñador](../web_designer/README.md). |

Por defecto usa tu **Claude Code local** (`--engine claude-code`): no necesita clave de API, solo tener `claude`
instalado y con sesión iniciada, y consume los límites de tu plan. Con una clave de API puedes usar la herramienta
oficial de computer use:

```bash
export ANTHROPIC_API_KEY=...
uv run main.py --engine api --task wom-baja-fibra
```

## Exploradores

Los perfiles por defecto intentan la tarea en línea recta, así que su árbol sale casi como una cadena. Los
**exploradores** buscan a propósito varias formas de llegar: abren una rama, vuelven y abren otra, y anotan lo que
encuentran. Sirven para dibujar el grafo de caminos de una tarea (la pestaña «Telaraña» del
[backoffice](../../../backoffice/)), no para medir cuánto le cuesta a una persona.

```bash
uv run main.py --task metro-tarifa-sabado \
    --profiles explorador,explorador_buscador,explorador_pie,explorador_contenido \
    --model claude-haiku-5-5 --effort medium --record-video
```

- **Procedimiento:** su prompt trae el cuerpo de la skill
  [`explorar-caminos`](../../../.claude/skills/explorar-caminos/SKILL.md) (inventario de candidatas, abanico de
  ramas de máximo 3 clics, cierre en la página que responde, hallazgos con cita). Como `.claude/skills/` no se
  despliega, los exploradores solo corren en local; `agentcore_app.py` los rechaza.
- **Primera rama distinta:** cada explorador abre su rama 1, obligatoriamente, por un lugar distinto de la página
  inicial: el menú principal (`explorador`), el buscador (`explorador_buscador`), el pie de página (`explorador_pie`)
  o los enlaces del contenido (`explorador_contenido`). Va en su prompt como «TU PRIMERA RAMA» (`Profile.primera_rama`).
  Así la tanda se abre en ramas distintas desde el primer clic.
- **Presupuesto propio:** 30 acciones y 420 s (`EXPLORADOR_MAX_*` en `config.py`), en vez de 15 y 180 s: con Haiku y 4
  usuarios en paralelo cada acción toma 12 a 15 s. Tras cada acción el harness le dice cuántas acciones y segundos le
  quedan, y la lista de páginas vistas con su id (`p1`, `p2`...).
- **No termina en el abanico:** si un explorador usa `done`, `give_up` o `blocked` con más del 40 % de sus acciones y
  de su tiempo por delante, el harness no termina el intento: le responde con un error que le pide abrir otra rama
  (hasta 3 veces; después acepta el fin). Haiku tiende a terminar apenas ve la respuesta y el grafo quedaba en 2 o 3
  ramas. Cada rechazo queda en `incidents`. Solo con `--engine claude-code`.
- **`volver_a_nodo`:** una acción más, solo para exploradores y solo con `--engine claude-code`, con
  `"nodo": "p3"`: el harness lleva la pestaña a la URL que guardó al ver esa página, en 1 acción. Solo tienen id (y
  se puede volver a) las páginas http(s) del mismo sitio que la URL inicial (mismo dominio registrable, por ejemplo
  `bibliotecanacional.gob.cl`): no las de otro sitio al que se llegó por un enlace ni las páginas de error del
  navegador. Con `--engine api` vuelven con `alt+Left`.
- **Cómo queda en el árbol:** cada `volver_a_nodo` es un **salto**: queda en `branches` con `"salto": true` y la
  acción `volver a «<título>»`, para que el backoffice dibuje la vuelta, pero la ruta recomendada nunca lo usa porque
  no es un camino que una persona pueda seguir. En un intento con éxito, un tramo cuenta como éxito solo si desde su
  destino el usuario llegó a la página final por tramos hacia adelante (sin saltos, retrocesos ni vueltas con un clic
  a una página ya vista); las ramas que exploró y abandonó cuentan como fallo, a la profundidad que sea. Volver con un
  clic a una página ya vista se marca `revisit`: no es señal de error, pero ese tramo cuenta como exploración, salvo
  que llegue a la página final. Así el grafo tiene nodos con varias salidas (el inicio, sobre todo) en vez de una
  línea, sin que la exploración infle los éxitos.
- **El reporte** muestra los límites de cada perfil y, en la tabla, pasos y tiempo junto a su tope.

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
[formas de datos](../../../docs/formas-de-datos.md), sección 5: `id`, `host`, `start_url` y `description`.
`wom-baja-fibra`, `sii-exencion-contribuciones` y `dt-reclamo-despido` salen de
[tareas en sitios chilenos](../../../docs/tareas-sitios-chilenos.md). Otras cinco (`bn-socio-prestamo-domicilio`,
`metro-tarifa-sabado`, `sernac-retracto-compra-online`, `uchile-arancel-medicina` e `ine-fecha-ipc-noviembre`) tienen
varias rutas comprobadas y señuelos, para probar a los [exploradores](#exploradores). `expected_answer` sirve para
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
- **Límites:** 15 acciones y 3 minutos por intento (los exploradores, 30 acciones y 7 minutos); al agotarse, el resultado es
  `abandoned`. Los envíos de formularios POST o con contraseña se cancelan como red de seguridad.
- **Capturas:** si Chromium responde `Unable to capture screenshot` (pasa a veces a media navegación), la captura se
  reintenta 2 veces con una espera corta. Si Playwright se queda esperando que carguen las fuentes (15 s), la captura
  sale directo por CDP (`Page.captureScreenshot`), sin esa espera, con su propio tope de 10 s.
- **Descargas y enlaces rotos:** un enlace a un archivo que abre una pestaña nueva (un PDF con `target=_blank`) deja una
  pestaña en blanco que solo descarga y que no se puede capturar: se cierra y el usuario sigue en la anterior; el paso
  registra `download:<url>` en sus eventos. Una página `chrome-error://` (enlace roto o sitio caído) cuenta como
  error visible.
- **Red de seguridad:** si las acciones de un turno siguen corriendo 60 s después del límite de tiempo (el navegador se
  colgó), el intento termina por tiempo y queda anotado en `incidents`. Cada respuesta de `claude -p` (usuarios y
  juez) se espera como máximo `CLAUDE_CODE_TIMEOUT_S` (180 s); después, error claro en vez de esperar para siempre.
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
├── tema.css            solo con --css: el tema aplicado (route_tree.json lo registra en `tema`)
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
propuesta de ruta, el plan de un catálogo, el resumen a partir de archivos, la aplicación de un tema con `--css` y
los exploradores (skill en el prompt, límites propios, `volver_a_nodo` y ramas en el árbol).
