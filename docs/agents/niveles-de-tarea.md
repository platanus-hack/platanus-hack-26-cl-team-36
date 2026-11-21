# Niveles de tarea: cómo clasificar los objetivos de un sitio

**Qué es este documento.** Una investigación para el **mapeador** (`web_mapper`), el agente que lee el DOM de un
sitio, descubre todos los objetivos que ofrece a sus visitantes y, para cada uno, busca la **ruta de referencia**: el
camino más corto que lo logra. Responde si la práctica de UX, la investigación en HCI y los benchmarks de agentes web
clasifican tareas por niveles, qué clasificación adopta nuestro catálogo de objetivos y con qué regla se asigna cada
valor sin analítica ni personas reales. Es para quien construye el mapeador y para quien compara sus rutas con las
del [evaluador](evaluador.md). Los términos están en el [glosario](../glosario.md). Fecha: 2026-11-21.

## Resumen

- **No hay una clasificación única; hay cuatro ejes independientes.** Jerarquía (Cockburn, HTA, GOMS), importancia
  (Top Tasks, red routes, CUJ), tipo de intención (Broder, Rose y Levinson, Kellar, WebArena) y dificultad (bandas
  por pasos de Online-Mind2Web). Ninguna fuente los combina; el catálogo toma uno de cada eje.
- **Sin personas se puede calcular** el nivel, la intención, la complejidad y las barreras. **No se puede** calcular
  la importancia: Top Tasks necesita votos, las red routes frecuencia de uso y los CUJ indicadores de negocio. El DOM
  da la **prominencia**, que mide lo que el sitio destaca, no lo que el visitante necesita.
- **Solo los objetivos `user_goal` van al evaluador.** Los `summary` agrupan; los `subfunction` (iniciar sesión,
  buscar) son tramos de otros.
- **La complejidad sale de la ruta de referencia:** hasta 5 pasos es `easy`, de 6 a 10 `medium`, 11 o más `hard`.
- **Para comparar un intento con la ruta bastan tres datos de la ruta:** pasos, páginas distintas y nodos clave. Con
  ellos se calculan la eficiencia (SPL), la desorientación (*lostness*), el avance por nodos clave y la similitud.

## 1. Qué clasificaciones existen

| Marco | Qué clasifica | Niveles o valores | Qué necesita | ¿Sin personas? |
|---|---|---|---|---|
| Cockburn | Casos de uso | `summary` (varias sesiones), `user goal` (una, 2–20 min), `subfunction` | Objetivo y ruta | **Sí** |
| HTA | Tareas | Objetivo, subobjetivos, operaciones y planes, en árbol | Análisis experto | Sin niveles con nombre |
| GOMS / KLM | Conducta experta | Objetivos, métodos, operadores con tiempo (K, P, H, M) | Acciones | Sí; tiempo experto |
| Teoría de la actividad | Actividad | Actividad (motivo), acción (meta), operación (condiciones) | Observación | Sin reglas |
| Top Tasks | Tareas de un sitio | Ranking por votos de una lista de hasta 100 tareas | Encuesta | **No** |
| Red routes | Rutas de un producto | Matriz: cuántas personas la hacen × con qué frecuencia | Uso real | **No** |
| CUJ (Google) | Recorridos | Objetivo con pasos, priorizado por indicadores de negocio | KPIs | **No** |
| Broder | Búsquedas web | Navegacional, informacional, transaccional | La consulta | No aplica en un sitio |
| Rose y Levinson | Búsquedas web | Navegacional; informacional (cerrada, abierta, sin dirección...); recurso | La consulta | Parcial |
| Kellar y otros | Tareas web | Buscar un dato, recolectar, navegar sin meta, transacción | Diario de uso | Sí, por el final |
| WebArena | Tareas | Búsqueda de información, navegación, operación de contenido y configuración | Verificación | **Sí** |
| Online-Mind2Web | Tareas | `easy` ≤5 pasos, `medium` 6–10, `hard` ≥11, sobre la ruta humana | Ruta | **Sí** |
| AssistantBench | Tareas | Por acierto de modelos sin navegador | Modelos | Mide otra cosa |

Mind2Web, WebVoyager y WebLINX agrupan por sitio, sin niveles. Sobre barreras: WebVoyager omite los sitios con login
o CAPTCHA; Online-Mind2Web quita los que tienen CAPTCHA; Mind2Web pide no escribir datos personales y registra sin
ejecutar las acciones que cambian estado (*Click (Fake)*); ST-WebAgentBench exige confirmar antes de operaciones
irreversibles (borrar, comprar, enviar formularios).

## 2. Qué se adopta y qué se descarta de la propuesta inicial

| Campo propuesto | Decisión | Por qué |
|---|---|---|
| `level` | Se mantiene, como **filtro** | Cockburn da una prueba aplicable. Solo `user_goal` se evalúa. |
| `type` (Broder) | Pasa a `intent`, con valores de WebArena | Broder clasifica búsquedas; en un sitio todo sería navegacional. |
| `priority` | Pasa a `prominence` | Ninguna fuente valida la prominencia como sustituto de Top Tasks. |
| `complexity` | Se mantiene | Online-Mind2Web es la única fuente con umbrales por pasos de referencia. |
| `gate` | Pasa a `gates` (lista) | Las barreras se combinan. Se agregan `personal_data` y `bot_check`. |
| — | Se agregan `parent` y `reference_route` | Para agrupar bajo un `summary` y calcular las métricas. |

## 3. El esquema de un objetivo

Ejemplo sobre la tarea de WOM de [`agents/tasks/`](../../agents/tasks/); la ruta no está medida. Se conservan los
campos de [formas de datos](../formas-de-datos.md), sección 5.

```json
{
  "id": "wom-baja-fibra",
  "host": "www.wom.cl",
  "start_url": "https://www.wom.cl/",
  "description": "Encuentra cómo dar de baja tu servicio de Internet Fibra.",
  "level": "user_goal",
  "parent": "wom-gestionar-servicio",
  "intent": "find_info",
  "prominence": "buried",
  "complexity": "easy",
  "gates": [],
  "expected_answer": "Llamar al 103 desde una línea WOM, o al 22 337 7600.",
  "success": { "element_visible": { "role": "heading", "name": "Baja de servicios" } },
  "reference_route": {
    "steps": 4,
    "pages": 3,
    "nodes": ["wom.cl/ | WOM", "wom.cl/ayuda | Ayuda", "wom.cl/ayuda/baja | Baja de servicios"],
    "key_nodes": ["wom.cl/ayuda/baja | Baja de servicios"],
    "actions": [
      { "action": "click", "element": { "role": "link", "name": "Ayuda" } },
      { "action": "scroll" },
      { "action": "click", "element": { "role": "link", "name": "Baja de servicios" } },
      { "action": "scroll" }
    ]
  }
}
```

| Campo | Valores | Regla de asignación |
|---|---|---|
| `level` | `summary`, `user_goal`, `subfunction` | `subfunction` si su final no vale solo (iniciar sesión, buscar, abrir un menú) o si su ruta es tramo de dos o más objetivos. `summary` si exige dos o más `user_goal` o algo fuera de una sesión (esperar un correo). Si no, `user_goal`; el modelo aplica la prueba de Cockburn: "¿puede irse satisfecho después de esto?". |
| `parent` | `id` de un `summary`, o `null` | El `summary` que lo contiene, si existe. |
| `intent` | `find_info`, `reach_page`, `transact` | Por el final de la ruta. `transact` si el último paso envía un formulario o cambia estado (pagar, enviar, contratar, dar de baja). `find_info` si el éxito es una respuesta que se lee (hay `expected_answer`). Si no, `reach_page`: llegar a una página o recurso. |
| `prominence` | `primary`, `secondary`, `buried` | Por el primer elemento de la ruta en `start_url`, viewport de escritorio. `primary`: visible en la primera pantalla sin interactuar. `secondary`: exige abrir un menú del encabezado o desplazarse hasta tres pantallas. Si no, `buried`. |
| `complexity` | `easy`, `medium`, `hard` | Por `reference_route.steps`: ≤5, 6–10, ≥11. |
| `gates` | Lista de `login`, `personal_data`, `side_effect`, `bot_check`; vacía = abierto | `login`: un `input type=password` o `autocomplete` `username`, `current-password` u `one-time-code`. `personal_data`: `autocomplete` de nombre, `email`, `tel`, dirección, `bday` o `cc-*`, o un RUT (sin token; por la etiqueta). `side_effect`: el último paso es un `POST` o cambia estado. `bot_check`: iframe de reCAPTCHA, hCaptcha o Turnstile. |
| `reference_route.steps` | entero | Pasos de la ruta más corta, contados con las acciones del evaluador: clic, campo escrito, tecla o desplazamiento. |
| `reference_route.pages` | entero | Páginas distintas de la ruta, incluida `start_url`. |
| `reference_route.nodes` | lista | Nodos con la identidad del árbol de rutas del evaluador: URL normalizada más título. |
| `reference_route.key_nodes` | lista | Nodos por los que pasa toda ruta que logra el objetivo; con varias rutas, su intersección. |

Los cortes de `prominence` siguen a NN/g: el 57 % del tiempo de lectura ocurre en la primera pantalla y el 81 % en
las tres primeras (2018).

**Qué hace el evaluador con cada barrera.** Sin barreras, evalúa entero. Con `side_effect`, hasta el paso anterior al
envío: el éxito es llegar a la confirmación sin enviar, como el *Click (Fake)* de Mind2Web; el harness ya cancela los
`POST`. Con `login` o `personal_data`, queda fuera salvo que haya cuenta de prueba. Con `bot_check`, queda fuera.

**Qué se descarta.** Los objetivos de final abierto (recolectar y navegar sin meta en Kellar, la búsqueda sin
dirección de Rose y Levinson). NN/g exige una sola interpretación y un final claro para medir éxito. El mapeador los
reescribe como tarea cerrada o no los incluye.

## 4. Lo que la ruta de referencia tiene que entregar

| Dato de la ruta | Para qué |
|---|---|
| ℓ = `steps` | Eficiencia (SPL) |
| R = `pages` | Desorientación |
| `nodes` | Similitud de secuencia |
| `key_nodes` | Avance y etapa donde se detuvo un fracaso |

Del intento, todo sale del `run.json`: p = pasos dados, T = páginas visitadas en total, N = páginas distintas, la
secuencia de nodos y s ∈ {0, 1}, el veredicto del juez.

## 5. Métricas: un intento contra la ruta de referencia

| Métrica | Fórmula | Lectura | Fuente |
|---|---|---|---|
| Éxito | s ∈ {0, 1} | Lo decide el juez | — |
| Eficiencia | e = s · ℓ / max(p, ℓ); por tanda, SPL = promedio de e | 1 = logró por la ruta óptima; 0,5 = con el doble de pasos | Anderson y otros, 2018 |
| Desorientación | L = (N/T − 1)² + (R/N − 1)² | 0 = sin desorientación; umbrales en las notas | Smith, 1996 |
| Avance | k / K: nodos clave alcanzados sobre el total | En un fracaso, el primer nodo no alcanzado es la etapa | WebCanvas, 2024 |
| Similitud | \|LCS(intento, referencia)\| / \|intento\|, sobre nodos | Cerca de 1 = siguió la ruta óptima | Gwizdka y Spence, 2005 |

- **SPL** viene de navegación de robots (ℓ: camino más corto; p: camino recorrido). Sus autores la llaman estricta y
  proponen calibrarla midiendo el SPL de personas.
- **La desorientación tiene la fórmula sin confirmar.** Smith llama S al total de páginas; aquí es T para no chocar
  con el éxito. Akçapınar y otros la imprimen sin raíz cuadrada; MeasuringU la muestra solo como imagen y dice que va
  de 0 a 1. R es "páginas mínimas para completar la tarea" en MeasuringU y "enlaces de la ruta óptima" en Akçapınar.
  Umbrales: perdido sobre 0,5, no perdido bajo 0,4, indeterminado entre ambos (MeasuringU); perdido desde 0,42
  (Akçapınar). Hasta leer el original, guardar también N/T (revisitas) y R/N (desvío) por separado.
- **WebCanvas** define además ES = L / P (largo del recorrido sobre puntaje por nodos clave). No se adopta: SPL mide
  lo mismo y no se indefine cuando P = 0.
- **Gwizdka y Spence** hallaron que la similitud con la ruta óptima predice la desorientación y el éxito al buscar
  una página, y advierten que la ruta óptima puede no ser única.
- **El tiempo no se compara.** KLM da tiempo experto (P = 1,1 s, M = 1,35 s, K = 0,20 s a 55 palabras por minuto),
  pero el tiempo del agente lo domina la latencia del modelo. Los pasos sí son comparables.

## 6. Lo que queda abierto

- **La importancia real.** Sin votos ni analítica no se sabe cuáles son las Top Tasks. Una baja de servicio
  `buried` es un hallazgo, no una tarea menor; las salvaguardas del glosario suelen ser poco prominentes.
- **Si las bandas de Online-Mind2Web se trasladan.** Cuentan pasos de una persona; los nuestros incluyen
  desplazamientos de un agente que solo ve capturas. Con el límite actual de 15 acciones, un `hard` deja poco margen:
  falta fijar `max_steps` en función de ℓ.
- **La fórmula original de la desorientación** (raíz, definición de R, umbral), hasta leer Smith 1996.
- **Rutas más cortas que la del mapeador.** Si un intento usa menos pasos que ℓ, e pasaría de 1: se acota con
  min(1, e) y se registra el caso para corregir la ruta.
- **Escritorio y móvil.** La prominencia y la ruta cambian con el viewport; `mobile` necesitaría su propia ruta.
- **El acuerdo del modelo en `level` e `intent`.** Clasificar a mano los objetivos de los tres sitios de
  [tareas en sitios chilenos](../tareas-sitios-chilenos.md) y medir cuántos coinciden con el mapeador.

## Fuentes

Leídas (al menos en parte):

- Cockburn. *Writing Effective Use Cases*, borrador. <https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf>
- Rose y Levinson. *Understanding User Goals in Web Search.* WWW 2004.
  <https://courses.ischool.berkeley.edu/i141/f05/readings/rose_www04.pdf>
- Kellar, Watters y Shepherd. *A field study characterizing Web-based information-seeking tasks.* JASIST, 2007.
  <https://wiki.eecs.yorku.ca/course_archive/2009-10/W/4461/_media/kellar07.pdf>
- McGovern. *What Really Matters: Focusing on Top Tasks.* A List Apart. <https://alistapart.com/>
- GOV.UK. *Benchmarking and performance measurement of content transformation.* 2017. <https://insidegovuk.blog.gov.uk/>
- Google SRE. *Product-Focused Reliability for SRE.* <https://sre.google/resources/practices-and-processes/>
- The Decision Lab. *Red Route Usability.* <https://thedecisionlab.com/reference-guide/design/red-route-usability>
- NN/g. *Writing Tasks for Quantitative and Qualitative Usability Studies*; *Scrolling and Attention*, 2018.
- Xue y otros. *An Illusion of Progress?* (Online-Mind2Web). 2025. <https://arxiv.org/abs/2504.01382>
- Deng y otros, *Mind2Web*, 2023, arXiv 2306.06070. Zhou y otros, *WebArena*, 2023, arXiv 2307.13854.
- He y otros, *WebVoyager*, 2024, arXiv 2401.13919. Yoran y otros, *AssistantBench*, 2024, arXiv 2407.15711.
- Pan y otros, *WebCanvas*, 2024, arXiv 2406.12373. Levy y otros, *ST-WebAgentBench*, 2024, arXiv 2410.06703.
- Lù y otros, *WebLINX*, 2024, arXiv 2402.05930 *(solo el resumen)*.
- Anderson y otros. *On Evaluation of Embodied Navigation Agents.* 2018. <https://arxiv.org/abs/1807.06757>
- Gwizdka y Spence. *Predicting Outcomes of Web Navigation.* WWW 2005.
  <https://archives.iw3c2.org/www2005/proceedings/docs/p892.pdf>
- Akçapınar, Altun y Menteş. *Eğitim ve Bilim* 37(163), 2012. <https://educationandscience.ted.org.tr/>
- MeasuringU. *Lostness.* <https://measuringu.com/lostness/> *(la fórmula está en una imagen que no se leyó)*
- Wikipedia: *Keystroke-level model*, *GOMS*, *Hierarchical task analysis*, *Activity theory*. MDN: `autocomplete`.

Solo citadas por otras fuentes:

- Broder. *A taxonomy of web search.* SIGIR Forum, 2002. El PDF no respondió; definiciones vía Rose y Levinson.
- Smith. *Towards a practical measure of hypertext usability.* 1996. Card, Moran y Newell, sobre KLM. CACM, 1980.
- Travis, sobre red routes (la página de Userfocus no respondió). Jobs To Be Done, vía Google SRE. Google SRE
  Workbook, *Implementing SLOs*, para la definición textual de CUJ.
