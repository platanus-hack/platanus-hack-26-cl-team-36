# Glosario

Los términos que usan los documentos, en el orden en que aparecen al leer
[Qué estamos construyendo](index.md).

Los documentos se escriben en español. El código y los datos usan nombres en inglés; la última columna dice cuál
corresponde a cada término. Solo tres palabras se dejan en inglés al escribir: **soul**, **spike** y **PR**.

## La idea

| Término | Qué significa | En el código |
|---|---|---|
| **Página original** | El sitio tal como lo sirve su dueño. No se modifica. | `source page` |
| **Optimización** | Un cambio aceptado con evidencia porque mejora una tarea para cualquiera. | `optimization` |
| **Soul** | El perfil de preferencias de una persona. No sale de su equipo. No es la personalidad de un agente. | `soul` |

## Los cambios

| Término | Qué significa | En el código |
|---|---|---|
| **Parche** | Lista de cambios a una página, escritos como datos y no como código. Puede ser de optimización o de soul. | `patch` |
| **Variante** | Un conjunto ordenado de parches de optimización sobre una página. Es lo que se mide. | `variant` |
| **Control** | La página original, sin parches. Es con lo que se compara. | `control` |
| **Localizador** | La forma de señalar un elemento: qué es (un botón, un enlace) y cómo se llama. | `locator` |
| **Elemento protegido** | Lo que ningún parche puede ocultar, mover ni renombrar: salir, cancelar, rechazar, precios, texto legal. | `protected element` |
| **Comprobación de seguridad** | Verificar, después de aplicar parches, que los elementos protegidos siguen visibles y se pueden pulsar. | `invariant` |

## La evaluación

| Término | Qué significa | En el código |
|---|---|---|
| **Página de prueba** | La página sobre la que se evalúa. La elige quien construye el evaluador. | `target` |
| **Tarea** | Lo que se intenta lograr en una página, con una condición que el programa puede comprobar. | `task` |
| **Etapa** | Un tramo reconocible de una tarea. | `stage` |
| **Salvaguarda** | Una tarea contraria que no debe volverse más difícil, como cancelar o rechazar un extra. | `guardrail` |
| **Perfil de agente** | La conducta que se le pide a un agente: impaciente, lector cuidadoso, etc. | `persona` |
| **Intento** | Un agente tratando de completar una tarea una vez. | `run` |
| **Tanda** | Varios intentos lanzados juntos, con un tope de gasto. | `batch` |
| **Recorrido** | El registro paso a paso de un intento. | `trajectory` |
| **Grafo de navegación** | El resumen de muchos recorridos: etapas, por dónde se sigue y dónde se abandona. | `navigation graph` |
| **Experimento** | La comparación de una variante contra el control para una tarea. Termina en aceptada, rechazada o no concluyente. | `experiment` |

## Las piezas

| Término | Qué significa | En el código |
|---|---|---|
| **Puente** | Programa local que conecta la extensión con el Claude de la persona. | `bridge` |
| **Extensión** | Lo que la persona instala en el navegador. | `extension` |
| **Motor de parches** | Aplica, deshace y comprueba parches. Lo usan la extensión y el evaluador. | `patch engine` |
| **Evaluador** | Lanza agentes que intentan una tarea y registra sus recorridos. | `harness` |
| **Optimizador** | Propone parches a partir del grafo de navegación y decide cuál se acepta. | `optimizer` |
| **Almacén local** | Los archivos donde se guarda lo aprendido de cada sitio. | `local store` |

## El trabajo

| Término | Qué significa |
|---|---|
| **Spike** | Una prueba corta para contestar una pregunta. Deja un script y un informe; no es código que se conserve. |
| **PR** | Un cambio de código que se revisa y se integra por separado. |
