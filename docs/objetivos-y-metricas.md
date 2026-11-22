# Objetivos y métricas

Cómo clasifica el [Catalogador](../agents/app/cataloger/README.md) los objetivos de un sitio y con qué métricas se
compara un intento del [Visitante](../agents/app/visitor/README.md) con la ruta de referencia de la
[Guía](../agents/app/guide/README.md). El esquema está en
[`shared.catalog.goal`](../agents/shared/src/shared/catalog/goal.py) y las métricas, en
[`visitor/comparison.py`](../agents/app/visitor/visitor/comparison.py). Los términos están en el
[glosario](glosario.md).

## En breve

- **Solo los objetivos `user_goal` sin barreras excluyentes van a la Guía y al Visitante.** Los `summary` agrupan;
  los `subfunction` (iniciar sesión, buscar) son tramos de otros.
- **Sin personas reales no se puede medir la importancia de una tarea.** El DOM da la **prominencia**, que mide lo
  que el sitio destaca, y el modelo del catálogo estima la **demanda**.
- **La complejidad sale de las acciones de la ruta de referencia, sin scrolls:** hasta 5 es `easy`, de 6 a 10
  `medium`, 11 o más `hard`.
- **Para comparar un intento con la ruta bastan cuatro datos de la ruta:** pasos, páginas distintas, nodos y nodos
  clave. Con ellos se calculan la eficiencia (SPL), la desorientación (*lostness*), la llegada y la similitud.

## De dónde sale cada campo

| Campo | Decisión | Por qué |
|---|---|---|
| `level` | Niveles de Cockburn, como **filtro** | Cockburn da una prueba aplicable. Solo `user_goal` se evalúa. |
| `intent` | Categorías de WebArena | Equivalentes a las de Broder, pero definidas para tareas dentro de un sitio y con verificación. |
| `prominence` | Reemplaza a la importancia | Ninguna fuente valida la prominencia como sustituto de Top Tasks. |
| `complexity` | Bandas por acciones | Hay dos esquemas por pasos humanos: Online-Mind2Web (≤5, 6–10, ≥11) y VisualWebArena (≤3, 4–9, ≥10). Se adopta Online-Mind2Web porque es web abierta y real. |
| `gates` | Lista, no un valor | Las barreras se combinan: `login`, `personal_data`, `side_effect`, `bot_check`. |
| `parent`, `reference_route` | Se agregan | Para agrupar bajo un `summary` y calcular las métricas. |

## El esquema de un objetivo

Ejemplo de un objetivo de `goals.json`, sobre la tarea de WOM de [`agents/tasks/wom.cl/`](../agents/tasks/wom.cl/). Los
cinco primeros campos son la forma de una tarea escrita a mano: un objetivo se promueve a tarea copiándolo.

```json
{
  "id": "baja-fibra",
  "host": "wom.cl",
  "start_url": "https://www.wom.cl/",
  "description": "Encuentra cómo dar de baja tu servicio de Internet Fibra.",
  "expected_answer": null,
  "level": "user_goal",
  "parent": "gestionar-servicio",
  "intent": "find_info",
  "evidence": ["https://www.wom.cl/ayuda/"],
  "entry": "https://www.wom.cl/ayuda/",
  "submits_form": false,
  "prominence": "buried",
  "gates": [],
  "instruction": "Encuentra cómo dar de baja tu servicio de Internet Fibra.",
  "exclusion": null,
  "demand": "common",
  "estimated_steps": 4
}
```

| Campo | Valores | Regla de asignación |
|---|---|---|
| `level` | `summary`, `user_goal`, `subfunction` | `subfunction` si su final no vale solo (iniciar sesión, buscar, abrir un menú) o si su ruta es tramo de dos o más objetivos (regla propia). `summary` si exige dos o más `user_goal` o algo fuera de una sesión (esperar un correo). Si no, `user_goal`; el modelo aplica la prueba de Cockburn: "¿puede irse satisfecho después de esto?". |
| `parent` | `id` de un `summary`, o `null` | El `summary` que lo contiene, si existe. |
| `intent` | `find_info`, `reach_page`, `transact` | Por el final de la ruta. `transact` si el último paso cambia algo en el sitio o en la cuenta (pagar, contratar, recargar, enviar una solicitud o reclamo, dar de baja en línea); enviar una consulta para leer un resultado (buscar, consultar un estado o una deuda, simular, calcular) es `find_info`. `find_info` si el éxito es una respuesta que se lee (hay `expected_answer`). Si no, `reach_page`: llegar a una página o recurso. |
| `submits_form` | `true`, `false` | `true` si no se cumple sin llenar y enviar un formulario, consultas incluidas. |
| `prominence` | `primary`, `secondary`, `buried` | Por el primer elemento de la ruta en `start_url`, viewport de escritorio. `primary`: visible en la primera pantalla sin interactuar. `secondary`: está en las tres primeras pantallas o en un menú del encabezado. Si no, `buried`. |
| `complexity` | `easy`, `medium`, `hard` | Por `reference_route.actions`, sin scrolls: ≤5, 6–10, ≥11. |
| `gates` | Lista de `login`, `personal_data`, `side_effect`, `bot_check`; vacía = abierto | `login`: un `input type=password` o `autocomplete` `username`, `current-password`, `new-password` u `one-time-code`; o el modelo marca `requires_login`; o la entrada va a un subdominio (`ucampus.`, `mi.`, `sso.`, `login.`, `portal.`…) o ruta (`/login`, `/mi-cuenta`…) de autenticación, o la descripción es sobre datos propios («tus notas», «matricularse», «Mi …»). `personal_data`, solo si `submits_form` o `transact`, en un campo visible que no sea búsqueda ni lista: `autocomplete` de nombre, `email`, `tel`, dirección, `bday` o `cc-*`, o una etiqueta o `name` de RUT, nombre de la persona, teléfono, correo o dirección (muchos formularios no declaran `autocomplete`). `side_effect`: es `transact`. `bot_check`: iframe de reCAPTCHA, hCaptcha o Turnstile. |
| `instruction` | texto | La tarea que reciben la Guía y el Visitante: `description` más, en `transact`, la orden de llegar hasta el paso anterior al envío sin enviar, y en `reach_page`, la de terminar en esa página. |
| `exclusion` | texto o `null` | Por qué no se intenta: `nivel …` si no es `user_goal`, `barrera …` si tiene `login`, `personal_data` o `bot_check`. `null` si se intenta. |
| `demand` | `top`, `common`, `rare` | Cuánta gente viene a la página a hacerlo, según el modelo del catálogo; `top` son sus 3 a 6 tareas principales. |
| `estimated_steps` | entero | Pasos que el modelo del catálogo estima para lograrlo. Con `demand`, ordena qué objetivos recorre una revisión. |
| `reference_route.steps` | entero | Pasos de la ruta más corta, contados con las acciones del Visitante: clic, campo escrito, tecla o desplazamiento. Es una cota inferior para quien solo ve la pantalla: un desplazamiento por cada elemento fuera de ella y a lo más uno para leer la respuesta. |
| `reference_route.actions` | entero | Acciones de la ruta sin los desplazamientos: clic, campo escrito, opción elegida o tecla. Online-Mind2Web y Mind2Web no registran scroll. |
| `reference_route.pages` | entero | Páginas distintas de la ruta, incluida `start_url`. |
| `reference_route.nodes` | lista | Nodos con la identidad del árbol de rutas del Visitante: URL normalizada más título. |
| `reference_route.key_nodes` | lista | Nodos por los que pasa toda ruta que logra el objetivo. Con una ruta, su nodo final; con varias, los nodos comunes a todas. |

`complexity`, la prominencia por ruta y los números de `reference_route` están en `summary.json`; la respuesta, en
`answer` del `route.json` de la Guía.

Los cortes de `prominence` siguen a NN/g: el 57 % del tiempo de visualización ocurre en la primera pantalla y el 81 %
en las tres primeras (2018, pantalla de 1920×1080). Equiparar abrir un menú con desplazarse es decisión propia.

**Qué hace el Visitante con cada barrera.** Sin barreras, evalúa entero. Con `side_effect`, hasta el paso anterior al
envío: el éxito es llegar a la confirmación sin enviar, como el *Click (Fake)* de Mind2Web; el harness ya cancela el
envío de formularios `method=post` o con contraseña; no bloquea `fetch`/XHR. Con `login`, `personal_data` o
`bot_check`, queda fuera (`exclusion`).

**Qué se descarta.** Los objetivos de final abierto (recolectar y navegar sin meta en Kellar, la búsqueda sin
dirección de Rose y Levinson). NN/g exige una sola interpretación y un final claro para medir éxito. El Catalogador los
reescribe como tarea cerrada o no los incluye.

## Lo que entrega la ruta de referencia

| Dato de la ruta | Para qué |
|---|---|
| ℓ = `steps` | Eficiencia (SPL) |
| R = `pages` | Desorientación |
| `nodes` | Similitud de secuencia |
| `key_nodes` | Llegada: con una ruta, su página final |

Del intento, todo sale del `run.json`: p = pasos dados, T = páginas visitadas en total, N = páginas distintas, la
secuencia de nodos y s ∈ {0, 1}: si pasó por la página final de la ruta.

## Métricas: un intento contra la ruta de referencia

| Métrica | Fórmula | Lectura | Fuente |
|---|---|---|---|
| Éxito | s ∈ {0, 1} | Lo decide el programa: llegó a la página final de la ruta | — |
| Eficiencia | e = s · ℓ / max(p, ℓ); por tanda, SPL = promedio de e | 1 = logró por la ruta óptima; 0,5 = con el doble de pasos | Anderson y otros, 2018 |
| Desorientación | L = √((N/T − 1)² + (R/N − 1)²) | 0 = sin desorientación; umbrales en las notas | Smith, 1996 |
| Llegada | Pasó por la página final de la ruta (`reached_final_node`) | Es el nodo clave de la ruta; de él sale el éxito | WebCanvas, 2024 |
| Similitud | \|LCS(intento, referencia)\| / \|intento\|, sobre nodos | Cerca de 1 = siguió la ruta óptima | Gwizdka y Spence, 2005 |

- **SPL** viene de navegación de robots (ℓ: camino más corto; p: camino recorrido). Sus autores la llaman estricta y
  proponen calibrarla midiendo el SPL de personas.
- **Desorientación.** Smith llama S al total de páginas; aquí es T. MeasuringU (derivada de Smith, p. 374), Gwizdka y
  Spence 2007 y UXtweak la dan con raíz cuadrada: es la distancia al punto ideal (1, 1). Akçapınar la imprime sin raíz;
  se descarta. Se guardan también N/T y R/N por separado, y R/N se acota a 1: un intento que se detuvo antes de
  recorrer la ruta no cuenta como desvío. R es "páginas mínimas para completar la tarea" en MeasuringU y "enlaces de
  la ruta óptima" en Akçapınar. Umbrales, ambos atribuidos a Smith: perdido sobre 0,5, no perdido bajo 0,4,
  indeterminado entre ambos (según MeasuringU); perdido desde 0,42 (según Akçapınar).
- **WebCanvas** define además ES = L / P (largo del recorrido sobre puntaje por nodos clave). No se adopta: SPL
  compara con la ruta óptima y no se indefine cuando P = 0. Sus nodos clave pueden ser páginas o acciones; aquí solo
  páginas (URL y título). Online-Mind2Web tiene su propia eficiencia: pasos del agente sobre el largo de referencia,
  en las tareas logradas.
- **Gwizdka y Spence (2005).** La razón LCS/largo del intento (LCSlenMax) predijo la desorientación observada; el
  éxito lo predijo mejor una puntuación de alineamiento (LCSMax). Suponen ruta óptima única y advierten que puede
  haber varias.
- **El tiempo no se compara.** KLM da tiempo experto (P = 1,1 s, M = 1,35 s, K = 0,20 s a 55 palabras por minuto),
  pero el tiempo del agente lo domina la latencia del modelo. Los pasos sí son comparables.

## Fuentes

Leídas (al menos en parte):

- Cockburn. *Writing Effective Use Cases*, borrador. <https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf>
- Rose y Levinson. *Understanding User Goals in Web Search.* WWW 2004.
  <https://courses.ischool.berkeley.edu/i141/f05/readings/rose_www04.pdf>
- Kellar, Watters y Shepherd. *A field study characterizing Web-based information-seeking tasks.* JASIST, 2007.
  <https://wiki.eecs.yorku.ca/course_archive/2009-10/W/4461/_media/kellar07.pdf>
- McGovern. *What Really Matters: Focusing on Top Tasks.* A List Apart.
  <https://alistapart.com/article/what-really-matters-focusing-on-top-tasks/>
- NN/g. *Writing Tasks for Quantitative and Qualitative Usability Studies*.
  <https://www.nngroup.com/articles/test-tasks-quant-qualitative/>; *Scrolling and Attention*, 2018.
  <https://www.nngroup.com/articles/scrolling-and-attention/>
- Xue y otros. *An Illusion of Progress?* (Online-Mind2Web). 2025. <https://arxiv.org/abs/2504.01382>
- Deng y otros, *Mind2Web*, 2023, arXiv 2306.06070. Zhou y otros, *WebArena*, 2023, arXiv 2307.13854.
- Pan y otros, *WebCanvas*, 2024, arXiv 2406.12373.
- Koh y otros, *VisualWebArena*, 2024, arXiv 2401.13649.
- Anderson y otros. *On Evaluation of Embodied Navigation Agents.* 2018. <https://arxiv.org/abs/1807.06757>
- Gwizdka y Spence. *Predicting Outcomes of Web Navigation.* WWW 2005.
  <https://archives.iw3c2.org/www2005/proceedings/docs/p892.pdf>
- Gwizdka y Spence. *Implicit measures of lostness and success in web navigation.* Interacting with Computers, 2007.
  <http://eprints.rclis.org/13686/1/GwizdkaJ_SpenceI_WebLostness_IwC_2007.pdf>
- Akçapınar, Altun y Menteş. *Eğitim ve Bilim* 37(163), 2012.
  <https://educationandscience.ted.org.tr/article/download/1008/993>
- MeasuringU. *Lostness.* <https://measuringu.com/lostness/>
- UXtweak. *Lostness metric.* <https://uxtweak.com/help/website-testing-results/analysis-lostness-metric>
- Wikipedia: *Keystroke-level model*. MDN: `autocomplete`.

Solo citadas por otras fuentes:

- Broder. *A taxonomy of web search.* SIGIR Forum, 2002. El PDF no respondió; definiciones vía Rose y Levinson.
- Smith. *Towards a practical measure of hypertext usability.* 1996. Card, Moran y Newell, sobre KLM. CACM, 1980.
