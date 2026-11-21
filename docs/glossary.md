# Glossary

Única fuente de términos. Un nombre por concepto, sin sinónimos. La prosa va en español; los nombres
técnicos (conceptos, campos, valores, operaciones) van en inglés y se escriben tal cual.

| Term | Definición | Precedente |
|---|---|---|
| **source page** | La página tal como la sirve su dueño. No se modifica. | — |
| **target** | El sitio o página sobre el que se evalúa. Lo elige y documenta quien construye el harness; la documentación no asume ninguno. | Evaluation target |
| **target profile** | Documento que demuestra que un target es válido para evaluar. | — |
| **host** | Host de la página, con puerto si no es el estándar. | URL |
| **path pattern** | Primer segmento de la ruta más `/*` si hay más; `*` es todo el host. | — |
| **locator** | Identificador estable de un elemento: `role`, `name` accesible y un `css` de respaldo. | Locators por rol y nombre en automatización de navegador |
| **patch** | Lista declarativa de operaciones sobre un host. Inmutable. `kind`: `optimization` o `soul`. | JSON Patch; candidatos de OPRO/GEPA |
| **variant** | Lista ordenada de optimization patches sobre una source page. Inmutable. | Experimentación: control / variant |
| **control** | La variant vacía. | Experimentación |
| **soul** | Perfil de preferencias del usuario (user preference profile). Legible y editable; no sale de su equipo. No es la personalidad de un agente. | Término del proyecto |
| **soul patch** | Patch generado desde la soul para un host. Se aplica encima de la variant; no forma parte de ella. | — |
| **task** | Lo que se intenta en un target: descripción, success criteria, stages y guardrails. | WebArena, Mind2Web |
| **stage** | Etapa de una task, definida por un predicate evaluable por código. | Funnel stage |
| **guardrail** | Task contraria que no debe empeorar (salir, rechazar, quitar un extra). | Guardrail metric |
| **protected element** | Elemento que ningún patch puede ocultar, mover, debilitar ni reetiquetar. Se calcula por código. | Investigación de deceptive design |
| **stage element** | Elemento del que depende avanzar de un stage al siguiente. | — |
| **invariant** | Post-condición que debe cumplirse tras aplicar patches: protected y stage elements siguen visibles, clicables, legibles y del mismo tamaño. | Invariantes / post-condiciones |
| **opt-out lexicon** | Términos que marcan una salida o un rechazo ("cancelar", "no, gracias"…). | Investigación de deceptive design |
| **patch engine** | Módulo único que aplica, revierte y valida patches. Lo usan la extensión y el harness. | — |
| **apply report** | Resultado que el patch engine devuelve en cada carga. | — |
| **persona** | Perfil de conducta de un agente evaluador. El humano se llama siempre "usuario". | UX, simulación de usuarios |
| **soul persona** | Persona que navega como el usuario, a partir de su soul. | — |
| **split** | Grupo de personas: `train` propone patches, `holdout` valida, `soul` es la soul persona. | ML: train / holdout |
| **run** | Un intento de una task por una persona sobre una variant. | Evals |
| **batch** | Conjunto de runs lanzados juntos, con un presupuesto. | — |
| **step** | Una acción dentro de un run. | Web agents |
| **trajectory** | Registro paso a paso de un run. | Web agents |
| **observation** | Lo que ve el agente en cada step. `som`: captura con elementos visibles numerados más su lista. `a11y_only`: solo la lista. | Set-of-Marks |
| **navigation graph** | Agregado de trajectories: stages como nodos, transiciones y conteos. Es un directly-follows graph. | Process mining |
| **experiment** | Comparación de una variant contra un baseline para una task. | A/B testing |
| **baseline** | Con qué se compara una variant. Por defecto, el control. | A/B testing |
| **A/A test** | El baseline comparado consigo mismo, para medir el ruido. | A/B testing |
| **harness** | Lo que lanza runs de agentes sobre un target y recoge trajectories. | Eval harness |
| **bridge** | Proceso local que une la extensión, el local store y la IA del usuario. | El prototipo ya lo llama puente |
| **pairing token** | Secreto que autoriza a la extensión ante el bridge. | — |
| **local store** | Archivos locales donde vive todo lo anterior. | Local-first software |
| **site bundle** | Archivo exportable con task, optimization patches, variant y experiments de un host. | — |
| **spike** | Prueba de usar y tirar para resolver una incógnita técnica. | XP |
| **fixture** | Dato de prueba versionado en el repositorio. | Testing |

## Palabras clave

`MUST`, `MUST NOT`, `SHOULD` y `MAY` se usan con el sentido de BCP 14 (RFC 2119 y RFC 8174), solo en mayúsculas.

Los requisitos se escriben en EARS, con las palabras clave en inglés y el resto en español:

- `WHEN <evento> THE SYSTEM MUST <respuesta>`
- `IF <condición> THEN THE SYSTEM MUST <respuesta>`

## Nota sobre "soul"

En otras herramientas de agentes, un archivo llamado `SOUL.md` describe la personalidad del agente. Aquí significa lo
contrario: las preferencias del usuario. Por eso ningún archivo del proyecto se llama `SOUL.md`, y la primera mención
en cualquier documento externo va acompañada de "user preference profile".
