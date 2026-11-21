# Glosario

**Qué es este documento.** Los términos que usan [la propuesta](index.md), [el plan](plan.md) y
[formas de datos](formas-de-datos.md), para consultar cuando alguno no quede claro.

Los documentos van en español. El código y los datos usan nombres en inglés; la última columna dice cuál corresponde
a cada término. En el texto solo se dejan en inglés *soul*, *spike*, *PR* y *script*.

Dos palabras se usan siempre con un solo sentido:

- **Persona** es quien usa el producto. Nunca un agente.
- **Equipo** somos nosotros, el equipo 36. La máquina de la persona es su **computador**.

## La idea

| Término | Qué significa | En el código |
|---|---|---|
| **Página original** | El sitio tal como lo sirve su dueño. No se modifica. | `source page` |
| **Optimización** | Un parche aceptado tras un experimento, porque mejora una tarea para cualquiera. | `optimization` |
| **Soul** | Las preferencias de una persona. No salen de su computador. No es la personalidad de un agente. | `soul` |
| **Preferencia** | Una frase de la soul: "prefiere texto grande". | `preference` |

## Los parches

| Término | Qué significa | En el código |
|---|---|---|
| **Parche** | Lista de cambios a una página, escritos como datos y no como código. Es de optimización o de soul. | `patch` |
| **Cambio** | Una operación dentro de un parche: cambiar un estilo, ocultar o renombrar. | `change` |
| **Localizador** | La forma de señalar un elemento: qué es (un botón, un enlace) y cómo se llama. | `element` |
| **Elemento protegido** | Lo que ningún parche puede ocultar, mover ni renombrar: salir, cancelar, rechazar, precios, texto legal. | `protected element` |
| **Comprobación de seguridad** | Verificar, después de aplicar parches, que los elementos protegidos siguen visibles y se pueden pulsar. | `safety check` |
| **Variante** | Un conjunto ordenado de parches de optimización sobre una página. Es lo que se mide. | `variant` |
| **Control** | La página original, sin parches. Es con lo que se compara una variante. | `control` |

## La evaluación

| Término | Qué significa | En el código |
|---|---|---|
| **Agente** | Un Claude que intenta una tarea en una página, paso a paso. | `agent` |
| **Perfil de agente** | La conducta que se le pide a un agente: impaciente, lector cuidadoso, etc. | `agent_profile` |
| **Página de prueba** | La página sobre la que se evalúa. La elige quien la construye; el plan dice qué debe cumplir. | `test page` |
| **Tarea** | Lo que se intenta lograr en una página, con una condición que el programa puede comprobar. La PR #6 la llama "misión". | `task` |
| **Etapa** | Un tramo reconocible de una tarea. | `stage` |
| **Salvaguarda** | Una tarea contraria que no debe volverse más difícil, como cancelar o rechazar un extra. | `guardrail` |
| **Intento** | Un agente tratando de completar una tarea una vez. | `run` |
| **Paso** | Una acción de un agente dentro de un intento. | `step` |
| **Recorrido** | El registro paso a paso de un intento. Solo de agentes. | archivo en `runs/` (se propone `agents/.runs/`) |
| **Objetivo** | Algo que un sitio ofrece a un visitante, escrito como tarea cerrada y clasificado según [niveles de tarea](agents/niveles-de-tarea.md). Un objetivo se promueve a tarea copiándolo. | `goal` |
| **Catálogo de objetivos** | Todos los objetivos que el Catalogador descubre en un sitio. | `goals.json` |
| **Ruta de referencia** | El camino más corto que cumple una tarea entre los que la Guía exploró y verificó. Con ella se comparan los recorridos. | `reference route` |
| **Tanda** | Varios intentos lanzados juntos, con un tope de gasto. | `batch` |
| **Grafo de navegación** | El resumen de muchos recorridos: etapas, por dónde se sigue y dónde se abandona. | `navigation graph` |
| **Experimento** | La comparación de una variante contra el control para una tarea. Termina en aceptada, rechazada o no concluyente. | `experiment` |
| **Comprobación de azar** | Comparar el control consigo mismo, para saber cuánta diferencia aparece sin haber cambiado nada. | `noise_check` |

## Las piezas

| Término | Qué significa | En el código |
|---|---|---|
| **Puente** | Programa local que conecta la extensión con Claude Code. | `bridge` |
| **Extensión** | Lo que la persona instala en el navegador. | `extension` |
| **Motor de parches** | Aplica, deshace y comprueba parches. Lo usan la extensión y el Visitante. | `patch engine` |
| **Catalogador** | Lee el DOM de un sitio y cataloga sus objetivos, clasificados. | `cataloger` |
| **Guía** | Encuentra y verifica la ruta de referencia de un objetivo, leyendo el DOM y capturas. | `guide` |
| **Visitante** | Lanza usuarios sintéticos que intentan un objetivo viendo solo capturas, y guarda sus recorridos. Su diseño está en [evaluador](agents/evaluador.md). | `visitor` |
| **Resumen del sitio** | Compara, por objetivo, la ruta de la Guía con los intentos del Visitante. | `summary` |
| **Optimizador** | Propone parches a partir de lo que deja el Visitante y decide cuál se acepta. | `optimizer` (se propone `web_optimizer`) |
| **Harness** | El programa que controla el ciclo de un agente: le entrega la captura, recibe su acción y la hace ejecutar. Es parte del Visitante. | `harness` |
| **Ejecutor** | La parte del harness que realiza en el navegador la acción que pidió el agente y toma la captura siguiente. | `executor` |
| **Juez** | La parte del Visitante que decide, con las condiciones de la tarea, si un intento se logró y en qué etapa va. Es lo único que lee la URL y el DOM. | `judge` |
| **Almacén local** | Los archivos donde se guarda lo aprendido de cada sitio. | `local store` |

## El trabajo

| Término | Qué significa |
|---|---|
| **Prototipo** | La primera extensión de Firefox y su puente, de la carpeta `prototipo/`. Se retiró en la PR #13; la extensión actual está en `extension/`. |
| **Spike** | Una prueba corta para contestar una pregunta. Deja un script y un informe; no es código que se conserve. |
| **Script** | Un programa de un solo archivo. |
| **PR** | Un cambio de código que se revisa y se integra por separado. |
