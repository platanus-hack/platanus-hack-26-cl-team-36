# visitor

El **Visitante**: dada una URL y una tarea en lenguaje natural, lanza usuarios sintéticos que intentan la tarea en un
navegador como lo haría una persona, viendo solo capturas, y une sus recorridos en un árbol de rutas que indica cuál
termina con menos errores. Su diseño está en [docs/agents/evaluador.md](../../../docs/agents/evaluador.md); dónde va
cada pieza, en [arquitectura](../../../docs/agents/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync                              # crea .venv con Python 3.12 e instala las dependencias
uv run playwright install chromium
```

## Uso

```bash
uv run main.py --task wom.cl/baja-fibra
uv run main.py --task sii.cl/exencion-contribuciones --profiles mobile --effort low
uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal de Providencia"
uv run main.py --site https://www.wom.cl/ --limit 3
uv run main.py --task wom.cl/baja-fibra --css ../../.runs/diseno/www.wom.cl/<fecha-hora>/rep-01/tema.css
```

| Opción | Qué hace |
|---|---|
| `--task <host>/<id>` | Una tarea de [`agents/tasks/`](../../tasks/). |
| `--url` y `--instruction` | Una URL y una tarea libres, en vez de `--task`; el id del objetivo sale de la instrucción. |
| `--site <url>` | El último catálogo del sitio, del [Catalogador](../cataloger/README.md): una tanda por objetivo, como con `--task`. Ver [catálogo](#catálogo). |
| `--profiles` | Perfiles separados por coma: `first_time`, `hurried`, `mobile` (por defecto, los tres; con `--site`, `first_time`) y los [exploradores](#exploradores) `explorador`, `explorador_buscador`, `explorador_pie` y `explorador_contenido`, que solo corren si se piden. |
| `--engine` | `claude-code` (por defecto), `api` o `bedrock` (Claude en Amazon Bedrock, con tus credenciales de AWS). |
| `--model`, `--effort` | Modelo y nivel de esfuerzo de los usuarios (por defecto `claude-sonnet-5-5`, `medium`; con `--engine bedrock`, `claude-sonnet-4-6`). |
| `--browser` | `local` (Chromium, por defecto) o `agentcore` (AgentCore Browser en AWS, una sesión por usuario). |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |
| `--record-video` | Graba un video `.webm` de cada intento (al tamaño del viewport), además de las capturas de cada paso. El reporte enlaza el video y marca en qué minuto ocurre cada paso. |
| `--css <archivo>` | Aplica un tema en cada página de cada usuario y en la del criterio, como la extensión: clase `mi-tema` en `<html>` y el CSS en `<style id="mt-tema-css">`, desde que se crea cada documento y repuestos si el sitio los quita. La tanda guarda una copia en `tema.css` y registra archivo y sha256 corto en `route_tree.json` (`tema`) y en el reporte, para comparar tandas con y sin tema. Un tema con `url(`, `image-set(`, `@import`, `expression(`, `javascript:` o barra invertida se rechaza: el filtro de la extensión lo borraría. Todas las tandas, con y sin tema, ignoran la CSP del sitio (`bypass_csp`, como `insertCSS` en la extensión), para que lo único distinto sea el tema. Con `--site`, una corrida con tema no cuenta como hecha para el sitio sin tema ni al revés, y [summary](../summary/README.md) con `--css` resume solo las de ese tema. Los temas salen del [diseñador](../web_designer/README.md). |

Por defecto usa tu **Claude Code local** (`--engine claude-code`): no necesita clave de API, solo tener `claude`
instalado y con sesión iniciada, y consume los límites de tu plan. Con una clave de API puedes usar la herramienta
oficial de computer use:

```bash
export ANTHROPIC_API_KEY=...
uv run main.py --engine api --task wom.cl/baja-fibra
```

## Exploradores

Los perfiles por defecto intentan la tarea en línea recta, así que su árbol sale casi como una cadena. Los
**exploradores** buscan a propósito varias formas de llegar: abren una rama, vuelven y abren otra, y anotan lo que
encuentran. Sirven para dibujar el grafo de caminos de una tarea (la pestaña «Telaraña» del
[backoffice](../../../backoffice/)), no para medir cuánto le cuesta a una persona.

```bash
uv run main.py --task metro.cl/tarifa-sabado \
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

El mismo Visitante corre en [AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/), con Claude en Amazon
Bedrock y AgentCore Browser, y gasta de la cuenta de AWS del proyecto en vez de tu plan. La
[CLI de AgentCore](https://github.com/aws/agentcore-cli) construye una imagen con esta carpeta, según el `Dockerfile`,
y la despliega; su configuración está en [`infra/agentcore/`](../../../infra/README.md#carpetas), junto al resto de la
infraestructura. La entrada en AWS es `agentcore_app.py`; `main.py` es el comando local. El runtime desplegado se llama
`web_evaluator_image`.

La imagen hace falta porque el driver de Playwright es un binario de Node que necesita `libatomic`, y la imagen que
AgentCore usa para el código en zip no la trae: sin ella, cada tanda termina a los 2 s con *Connection closed while
reading from the driver*. La imagen no instala Chromium, porque en AWS el navegador es AgentCore Browser. La construye
CodeBuild en arm64 al desplegar. Su contexto es `agents/`, para que entre `agents/shared/`; para revisarla en local,
desde `agents/`: `docker build --platform linux/arm64 -f app/visitor/Dockerfile .`.

En AWS se usa solo Claude Sonnet 4.6, tanto para los usuarios sintéticos como para el juez (`BEDROCK_USER_MODEL` y
`BEDROCK_JUDGE_MODEL` en `config.py`); el pedido no puede cambiarlo. La cuenta del proyecto no tiene acceso en Bedrock a
Claude Opus 4.7 ni a los modelos posteriores: responden *is not available for this account* y solo AWS puede
habilitarlos. Se llama por el endpoint `bedrock-runtime` con el perfil de inferencia de EE.UU.,
`us.anthropic.claude-sonnet-4-6`, que reparte entre us-east-1, us-east-2 y us-west-2.

Sonnet 4.6 no acepta el toolset de computer use (`computer_toolset_20260801`, desde Opus 4.7), así que con él
`ApiEngine` declara la herramienta anterior, `computer_20251124` con la beta `computer-use-2025-11-24`, y le da el
tamaño de la pantalla a partir de la primera captura (ver `LEGACY_COMPUTER_MODELS` en `actions.py`). Tampoco acepta el
esfuerzo `xhigh`. El endpoint no acepta la caché automática, así que `ApiEngine` marca el punto de caché a mano. Ojo:
Sonnet 4.6 puede errar más la puntería de los clics que Sonnet 5.5, y esos errores se cuentan como fricción del sitio;
conviene comparar una misma tarea en local y en AWS antes de confiar en los resultados.

Con `export AWS_PROFILE=<perfil de la cuenta del proyecto>`, una prueba de concepto en tres pasos:

```bash
just local visit https://example.com "Encontrar el enlace More information" --profiles first_time \
    --engine bedrock --browser agentcore   # 1. desde tu computador: ¿la cuenta deja usar Claude y el navegador?
just aws deploy                            # 2. despliega (al mergear a main lo hace el workflow AgentCore)
just aws visit wom.cl/baja-fibra           # 3. la tanda corre en AgentCore; el reporte queda en agents/.runs/aws/
```

`just aws status` muestra lo desplegado y `just aws logs` los logs del runtime (`--follow` para seguirlos). Los tres
buscan el runtime en la cuenta, así que funcionan aunque lo haya desplegado el CI. La respuesta llega en stream: un
aviso cada 20 s y, al final, el resultado de cada perfil y `report.md`. La corrida queda en `AGENTS_STORE` si el
runtime lo define; si no, en una carpeta temporal de la sesión, y se pierde al cerrarla.

## Catálogo

Con `--site` corre, uno tras otro, los objetivos sin `exclusion` que tienen una ruta verificada de la Guía para
algún perfil, con la `instruction` del catálogo. Cada tanda es una corrida de visitor que nombra en `inputs` el catálogo
y las rutas con que se comparó. Si una falla, termina como `failed` y siguen las demás. El resumen del sitio lo escribe [summary](../summary/README.md).

| Opción | Qué hace |
|---|---|
| `--goal <id>` | Solo ese objetivo; se puede repetir. |
| `--limit N` | Como máximo N tandas nuevas. |
| `--rerun` | Repite los objetivos que ya tienen una corrida que terminó bien (por defecto se omiten). |

## Tareas

Cada archivo `agents/tasks/<host>/<id>.json` es una tarea: un objetivo de su host con su propio id, con la forma de
[formas de datos](../../../docs/formas-de-datos.md), sección 5: `id`, `host`, `start_url` y `description`.
`wom.cl/baja-fibra`, `sii.cl/exencion-contribuciones` y `dt.gob.cl/reclamo-despido` salen de
[tareas en sitios chilenos](../../../docs/tareas-sitios-chilenos.md). Otras cinco
(`bibliotecanacional.gob.cl/socio-prestamo-domicilio`, `metro.cl/tarifa-sabado`, `sernac.cl/retracto-compra-online`,
`uchile.cl/arancel-medicina` e `ine.gob.cl/fecha-ipc-noviembre`) tienen varias rutas comprobadas y señuelos, para
probar a los [exploradores](#exploradores). `expected_answer` sirve para
revisar el resultado a mano: el juez todavía no lo usa, decide con un criterio que propone a partir de la tarea.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: lee las opciones y lanza una tanda o las de un catálogo. |
| `agentcore_app.py` | Punto de entrada en AgentCore Runtime: recibe la tarea por HTTP y responde en stream. |
| `visitor/batch.py` | Una tanda: criterio de éxito, usuarios en paralelo, veredictos, árbol y reporte. |
| `visitor/harness.py` | El ciclo de cada usuario: captura → modelo → acción → registro. |
| `visitor/turns.py` | Pedidos del modelo, sus resultados y el fin de un intento. |
| `visitor/claude_code_engine.py`, `visitor/api_engine.py` | Cómo decide el modelo: `claude -p` o computer use por la API o Bedrock. |
| `visitor/judge.py` | El juez: propone el criterio de éxito y da el veredicto de cada intento. |
| `visitor/browsers.py`, `visitor/actions.py` | Qué navegador usa la tanda (local, CDP o AgentCore Browser) y las acciones que puede pedir el agente. |
| `visitor/recording.py` | Los pasos y el recorrido (`Step`, `Run`), y las señales que se leen del DOM solo para el registro. |
| `visitor/route_tree.py`, `visitor/report.py` | El árbol de rutas, la ruta recomendada y `report.md`. |
| `visitor/hesitation.py` | Dónde dudó o se equivocó cada usuario, para el reporte. |
| `visitor/comparison.py` | La comparación de cada intento con la ruta de referencia de la [Guía](../guide/README.md). |
| `visitor/proposal.py` | La propuesta de ruta cuando un intento logra la tarea con menos pasos que la referencia. |
| `visitor/catalog_run.py` | Las tandas de un catálogo. |
| `visitor/profiles.py`, `visitor/config.py` | Los perfiles de usuario, su prompt y los límites. |

La sesión del navegador, la red de seguridad de formularios, el proceso de Claude Code y los nodos están en
[`agents/shared/`](../../shared/README.md).

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

Cada tanda es una corrida en el almacén de [`shared.store`](../../shared/README.md) (`AGENTS_STORE` o
`agents/.runs/`, fuera de git):

```
<host>/visitor/<id>/<run>/
├── manifest.json     inputs: las corridas de guide con que se comparó y, con --site, la del catálogo
├── criteria.json
├── <perfil>/         step_NN.png, run.json, claude_code.log y, con --record-video, video.webm
├── route_tree.json   nodos, ramas y ruta recomendada
├── tema.css          solo con --css: el tema aplicado (route_tree.json lo registra en `tema`)
├── comparison.json   solo si hay ruta de referencia
├── proposals.json    solo si un intento usó menos pasos que una ruta
└── report.md
```

Si el objetivo tiene una ruta vigente de la Guía, verificada para el viewport del perfil, el reporte la compara con
cada intento ([fórmulas](../../../docs/agents/niveles-de-tarea.md), sección 5). El avance se informa como llegada a la
página final de la ruta. Si un intento logra la tarea con menos pasos, `proposals.json` lo guarda (la clave de la
ruta, sus pasos con el elemento clicado y sus nodos) y el reporte lo dice; `adopt` de la Guía la verifica.

## Pruebas

```bash
uv run pytest -q
```

Las pruebas no llaman a Claude: cubren el árbol, los motores y las acciones del navegador sobre páginas locales, la
propuesta de ruta, el plan de un catálogo, la aplicación de un tema con `--css` y los exploradores (skill en el
prompt, límites propios, `volver_a_nodo` y ramas en el árbol).
