# Especificación del backoffice, versión 0

> Evaluador = Visitante ([`agents/app/visitor/`](../agents/app/visitor/README.md)).

| | |
|---|---|
| **Estado** | Listo para que alguien lo tome (2026-11-21) |
| **Diseño de referencia** | [Claude Design: Backoffice evaluador UX](https://claude.ai/artifact/6qTPUK8RCgK9tZgXEbwQos), seis pantallas |
| **Qué sigue** | Construir la v0 descrita en la sección 4 sobre las corridas que ya produce el evaluador |

## 1. Qué es

Una web interna para ver qué pasa cuando se "gatilla" una página:

1. **Recorrido.** Se abre la página y se recorre entera.
2. **Inventario.** Se listan las acciones que ofrece, con su categoría y su prioridad.
3. **Happy path.** Para cada tarea, un agente que lee el DOM encuentra el camino ideal.
4. **Usuarios de visión.** Usuarios sintéticos que solo ven capturas intentan la misma tarea, como lo haría una
   persona.
5. **Refinador.** Con la diferencia entre 3 y 4, propone módulos para agregar al front (generados con UX/UI gen) y
   los vuelve a medir con los mismos usuarios.

La diferencia entre el happy path y lo que hicieron los usuarios de visión es el hallazgo principal. El backoffice
existe para mostrarla.

## 2. El diseño

El [Claude Design](https://claude.ai/artifact/6qTPUK8RCgK9tZgXEbwQos) tiene una pantalla por etapa. Usa la tarea
`wom-baja-fibra` con capturas reales del [spike de alcance](../.spikes/2026-11-21-alcance-cambios-wom.md). **Las
cifras son ilustrativas.**

| Pantalla | Qué muestra |
|---|---|
| 01 Corridas | El campo para gatillar una URL, las 5 etapas y una grilla de corridas con captura y avance por etapa. |
| 02 Inventario | Las acciones marcadas sobre la captura (tamaño = prioridad, color = categoría) y las tareas que salen de ellas. |
| 03 Telaraña | La vista principal. Inicio al centro, cada anillo es un paso, el happy path es el eje y las rutas de los usuarios salen como ramas con su captura. Grosor = intentos; color = cómo terminaron. Se filtra por perfil. |
| 04 Replay | Un intento paso a paso: captura con el punto del clic, lo que el usuario esperaba, lo que pasó y qué hacía el happy path en ese paso. Cierra con el veredicto del juez. |
| 05 Perfiles | Perfiles contra pasos del happy path: qué parte sigue en el camino y dónde se separa cada uno. Una huella radial por perfil, con la tabla al lado. |
| 06 Propuestas | Un tablero de módulos por nivel de cambio (L0 a L4). Cada uno muestra el antes y el después, el cambio esperado contra el medido y el parche. |

El diseño es privado: quien lo tome debe pedir que se lo compartan.

**De dónde sale cada patrón.** Se investigó el estado del arte en tres frentes:

- **Análisis de recorridos:** Amplitude, Mixpanel, Contentsquare, FullStory, PostHog.
- **Trazas de agentes y usuarios sintéticos:** Playwright Trace Viewer, Browserbase, Browser Use, Maze, UXAgent,
  UXCascade.
- **Mapas de sitio y herramientas de UI con IA:** Screaming Frog, Sitebulb, v0, Stitch, Baymard UX-Ray, Attention
  Insight.

Tres cosas que ninguna herramienta hace, y que el diseño pone al centro:

- Dibujar la ruta **esperada** contra la cual se comparan los recorridos.
- Mostrar, en cada paso, **qué esperaba** el usuario frente a lo que pasó. Lo más cercano es el
  `evaluation_previous_goal` de Browser Use.
- Mostrar el **impacto medido** de un cambio, no uno estimado.

## 3. Qué existe hoy

| Etapa | Estado | Dónde |
|---|---|---|
| 1. Recorrido | No existe | — |
| 2. Inventario | No existe. Lo más cercano es el inventario de antes y después del spike. | `.spikes/2026-11-21-alcance-cambios-wom.py` |
| 3. Happy path con DOM | No existe | — |
| 4. Usuarios de visión | **Existe** | [`agents/app/visitor`](../agents/app/visitor/README.md) |
| 5. Refinador | No existe. En el spike, Claude escribió los parches a mano. | [spike de alcance](../.spikes/2026-11-21-alcance-cambios-wom.md) |

## 4. Alcance de la v0

**La v0 es un visor de solo lectura de las corridas del evaluador.** No gatilla nada ni llama a Claude. Lee
`agents/.runs/<tarea>/<fecha-hora>/` y dibuja las pantallas 01, 03, 04 y 05 del diseño.

### Entra

- **01 Corridas:** la lista de carpetas de `agents/.runs/`. La captura es `start.screenshot` del primer `run.json`.
  El formulario para gatillar se dibuja, pero queda deshabilitado.
- **03 Telaraña:** sale de `route_tree.json`.
  - Nodos: `nodes[]`. El inicio es el nodo con `is_start`. El anillo de cada nodo es su distancia en ramas desde el
    inicio.
  - Ramas: `branches[]`. El grosor es `successes + failures`. El color sale de `endings` del nodo destino y de
    `failures`.
  - **Eje:** mientras no exista el happy path con DOM, se usa `recommended_route`, la ruta de menor costo. Rotularlo
    como "ruta recomendada" y no como "happy path", porque no es lo mismo.
  - Filtro por perfil: con `branches[].profiles`.
- **04 Replay:** sale de `<perfil>/run.json` y de las capturas `step_NN.png`.
  - Cada paso: `screenshot_before`, `screenshot`, `coordinates` (para el punto del clic), `description`,
    `expectation`, `url` y `title`.
  - "Lo que pasó" se arma con el cambio de `url` o `title`, `screen_change` y `signals`.
  - Veredicto: `verdict.outcome` (`unmeasured`: sin ruta de la Guía ni juez), `verdict.source` (`route` o `judge`),
    `verdict.claimed_done` y `verdict.justification`; el criterio, solo si corrió el juez, en `criteria.json`.
  - Con `--runs N`, cada repetición es su carpeta (`desktop`, `desktop-2`…) y `run.json` trae `attempt`.
  - Con `--record-video` hay además `video.webm`, y cada paso trae `seconds_since_start` para saltar al minuto.
- **05 Perfiles:** se agrega desde `run.json` (`profile`, `verdict.outcome`, número de pasos) y desde `route_tree.json`.

### Queda fuera de la v0

- **02 Inventario y 06 Propuestas:** las etapas que las alimentan no existen. Si se quiere mostrarlas en una demo, se
  pueden dibujar con datos fijos sacados de `.spikes/2026-11-21-alcance-cambios-wom/resultados.json` y sus capturas,
  marcados como "datos del spike".
- **Gatillar desde la web.** Hoy se gatilla con `uv run main.py --task ...`.

### Lo que falta en los datos

- **Paso cumplido o no cumplido.** El evaluador guarda la expectativa, pero no la compara con el resultado. En la v0
  se marca "sin efecto" cuando `signals` incluye `no_effect`, "no cumplida" con `went_back` o `visible_error`, y "sin
  evaluar" en el resto. Lo correcto es que el juez evalúe cada paso; queda como tarea del evaluador.
- **Categoría y prioridad de las acciones:** dependen de la etapa 2.
- **Volumen de intentos.** Hoy una tanda corre un intento por perfil: 3 en total. El diseño supone 12, 4 por perfil.
  Con 3 la telaraña igual funciona, pero los grosores dicen poco. Hay dos caminos: juntar varias tandas de la misma
  tarea, o que el evaluador acepte un número de intentos por perfil.

## 5. Decisiones que toma quien lo construya

- **Stack.** El repo no tiene un frontend web. El backend usa `node:http` sin dependencias y la extensión es
  JavaScript plano. Lo más simple es una página estática con un endpoint en Node que liste `agents/.runs/` y sirva sus
  archivos. Lo más importante es que la telaraña se pueda dibujar con SVG o con una librería de grafos.
- **Estética.** El diseño toma como referencia [threejs.org](https://threejs.org/): fondo oscuro, grillas de
  miniaturas, Inter y JetBrains Mono.

### La telaraña y su movimiento: referencia three.js

La telaraña y sus movimientos deben tomar como referencia [threejs.org](https://threejs.org/) y sus ejemplos. El
Claude Design la muestra plana porque es una maqueta estática; la intención es que se vea y se mueva como una escena
3D:

- **Nodos como capturas en el espacio.** Cada página es un plano con su captura como textura. El inicio va al centro
  y los anillos (un paso cada uno) son órbitas alrededor de él.
- **Cámara libre.** Se puede orbitar, acercar y alejar. Al hacer clic en un nodo, la cámara viaja hasta él y abre el
  replay de los intentos que pasaron por ahí.
- **Flujo en las ramas.** Partículas que recorren cada rama de origen a destino: la cantidad indica los intentos y el
  color cómo terminaron. El happy path (o la ruta recomendada) es la rama más visible.
- **Transiciones.** Al filtrar por perfil, las ramas que no aplican se apagan con una animación en vez de
  desaparecer de golpe. Al reproducir un intento, un punto lo recorre paso a paso por la telaraña.
- **Librerías posibles:** [three.js](https://threejs.org/) directo, o
  [3d-force-graph](https://github.com/vasturiano/3d-force-graph), que está construido sobre three.js y ya trae
  nodos con objetos propios, partículas en las ramas y la cámara.

La versión plana en SVG sirve como primer paso si el tiempo no alcanza. En ese caso, la vista 3D queda como siguiente
iteración y los datos de la sección 4 no cambian.
- **Comando.** Agregar uno a `justfile` para levantar el visor.

## 6. Referencias

- [Claude Design del backoffice](https://claude.ai/artifact/6qTPUK8RCgK9tZgXEbwQos)
- [Spike de alcance en wom.cl](../.spikes/2026-11-21-alcance-cambios-wom.md)
- [Visitante](../agents/app/visitor/README.md) y [su documento](../docs/agents/evaluador.md)
- [Niveles de cambio](../docs/agents/niveles-de-cambio.md): el origen de L0 a L4 en las propuestas
- [Formas de datos](../docs/formas-de-datos.md)
