# Glosario

Los términos del proyecto y cómo se llaman en el código. Los agentes y sus datos usan nombres en inglés; la extensión,
el backend y el backoffice, en español.

## El producto

| Término | Qué significa | En el código |
|---|---|---|
| **Tema** | Lo que la extensión aplica sobre una página: una hoja CSS con todas sus reglas bajo `html.mi-tema` y, opcionalmente, la lista de features que se activan. | `tema.css`, `tema.json` |
| **Feature** | Un comportamiento JS de la extensión que un tema activa y configura con datos. Los temas de la API solo traen `vista`. | `extension/src/features/` |
| **Componente** | La pieza de interfaz con que una vista se dibuja en la página: `atajo`, `lanzador` o `buscador`. | `extension/src/componentes/` |
| **Revisión** | El trabajo completo de los agentes sobre una página: catálogo, Guía y Visitante por objetivo, y el tema. Es lo que la extensión consulta. | `revision`; tabla `chameleon-revisiones` |
| **Opinión** | Lo que la persona dice de una página desde el popup (mejor, peor o un comentario). Se guarda solo en su navegador. | `extension/src/popup/` |

## Lo que miden los agentes

| Término | Qué significa | En el código |
|---|---|---|
| **Objetivo** | Algo que un sitio ofrece a un visitante, escrito como tarea cerrada y [clasificado](objetivos-y-metricas.md). | `goal` |
| **Catálogo** | Todos los objetivos que el Catalogador descubre en un sitio. | `goals.json` |
| **Tarea** | Un objetivo escrito a mano, con su propio id. | `agents/tasks/<host>/<id>.json` |
| **Barrera** | Lo que impide intentar un objetivo entero: inicio de sesión, datos personales, un efecto real o un captcha. | `gates` |
| **Ruta de referencia** | El camino más corto que logra un objetivo, entre los que la Guía exploró y verificó repitiéndolo. Con ella se comparan los intentos. | `route.json` |
| **Nodo** | Una página dentro de una ruta o un recorrido: su URL normalizada más su título. | `node` |
| **Perfil** | El usuario sintético que hace un intento. Los dos normales, uno por pantalla (escritorio y móvil), hacen la tarea sin imitar un tipo de usuario. | `profile` |
| **Explorador** | Un perfil que recorre el sitio a propósito por varios caminos y anota hallazgos, con un nivel de conocimiento del tema. No se compara con la ruta y solo corre en local. | `--exploradores` |
| **Intento** | Un perfil tratando de lograr un objetivo una vez. Termina en `success`, `failed` (declaró que terminó sin llegar) o `abandoned`; `unmeasured` si no hay ruta ni juez, e `interrupted` si hubo un error técnico. | `run.json` |
| **Paso** | Una acción dentro de un intento o de una ruta: clic, texto escrito, tecla o desplazamiento. | `step` |
| **Recorrido** | El registro paso a paso de un intento, con la captura de cada paso. | `run.json`, `step_NN.png` |
| **Tanda** | Los intentos de varios perfiles sobre un mismo objetivo, lanzados juntos. | una corrida de `visitor` |
| **Árbol de rutas** | Los recorridos de una tanda unidos por las páginas que comparten: por dónde fue cada uno y dónde se separaron. | `route_tree.json` |
| **Propuesta** | Un intento que logró el objetivo con menos pasos que la ruta de referencia. La Guía lo verifica antes de adoptarlo. | `proposals.json`, `guide adopt` |

## Las piezas

| Término | Qué significa | En el código |
|---|---|---|
| **Extensión** | Lo que la persona instala en Firefox o Chrome. | `extension/` |
| **API** | Responde qué tema corresponde a una página y recibe los pedidos de revisión. | `backend/` |
| **Catalogador** | Lee el DOM de un sitio y cataloga sus objetivos. | `cataloger`; etapa `catalog` |
| **Guía** | Encuentra y verifica la ruta de referencia de un objetivo, leyendo el DOM y capturas. | `guide` |
| **Visitante** | Lanza usuarios sintéticos que intentan un objetivo viendo solo capturas, y guarda sus recorridos. | `visitor` |
| **Diseñador** | Escribe el tema con lo que midieron los demás. El backoffice lo muestra como Diseñador, nunca como `improver`. | `web_designer`; etapa y carpeta `improver` |
| **Conductor** | Corre las etapas de una revisión en orden y espera a cada una. | `conductor`; etapa `revision` |
| **Resumen** | Compara, por objetivo de un sitio, la ruta de la Guía con los intentos del Visitante. | `summary` |
| **Harness** | La parte del Visitante que controla el ciclo de un intento: entrega la captura, recibe la acción y la ejecuta en el navegador. | `visitor/harness.py` |
| **Juez** | Un modelo que decide si un intento logró su objetivo cuando no hay ruta de referencia. Con ruta, lo decide el programa. | `visitor/judge.py`, `--judge` |
| **Runtime** | El único runtime de AgentCore donde corren los agentes en AWS: una imagen con todas las apps. | `chameleon`; `agents/app/runtime/` |
| **Proyectora** | La Lambda que lee lo que los agentes dejan en el almacén y actualiza el estado de cada revisión. | `backend/proyectora.js` |
| **Backoffice** | El visor de solo lectura de las revisiones y las corridas. | `backoffice/` |

## Los datos

| Término | Qué significa | En el código |
|---|---|---|
| **Almacén** | Donde los agentes dejan sus salidas, con el mismo árbol en disco y en S3. | `shared.store`; `agents/.runs/` o el bucket `chameleon-almacen-<cuenta>` |
| **Corrida** | Una ejecución de un agente: una carpeta del almacén que nunca se sobrescribe. | `<run>`, el instante UTC de inicio |
| **Manifiesto** | El archivo que dice qué es una corrida, cómo terminó y de qué otras corridas viene. | `manifest.json` |
| **Etapa** | Cada parte de una revisión: `catalog`, `guide`, `visitor` e `improver`. | `shared.stages` |
| **Viewport** | El tamaño de pantalla de una ruta o un perfil. | `desktop`, `mobile` |
