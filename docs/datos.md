# Formas de datos

Este documento es para quien vaya a programar. Propone cómo se escriben, como datos, las cosas que describe
[Qué estamos construyendo](index.md). Los términos están en el [glosario](glosario.md).

**Es una propuesta, no algo construido.** El spike 4 del [plan](../.spikes/2026-11-21-plan.md) la revisa contra
archivos reales, y cualquier spike puede cambiarla.

Los nombres de los campos van en inglés. Los ejemplos usan un sitio inventado, `example.test`; sus valores solo
ilustran la forma.

## 1. Cómo se señala un elemento

```json
{ "role": "button", "name": "Continuar", "css": "#next" }
```

Se busca primero por lo que el elemento es (`role`) y cómo se llama (`name`). Si eso no deja exactamente uno, se
usa `css` para desempatar. Si aun así no queda exactamente uno, el elemento no se encontró: no se adivina.

## 2. Parche

```json
{
  "id": "pat_3f9a1c0b77de",
  "host": "example.test",
  "path_pattern": "/step-2",
  "kind": "optimization",
  "title": "Botón de avance con nombre propio",
  "hypothesis": "Dos botones se llaman igual; la mayoría abandona en el segundo paso.",
  "ops": [
    { "op": "relabel", "target": { "role": "button", "name": "Continuar" }, "value": "Siguiente paso" },
    { "op": "set_style", "target": { "role": "button", "name": "Continuar" }, "props": { "background-color": "#0b5" } }
  ]
}
```

`kind` es `optimization` o `soul`. Un parche no contiene código.

| Cambio | Qué hace | Optimización | Soul | Límite |
|---|---|---|---|---|
| `set_style` | Cambia colores, tipografía o espaciado. | sí | sí | No carga nada de fuera ni oculta, mueve o desactiva elementos. |
| `hide` | Oculta un elemento. | sí | sí | Nunca un elemento protegido ni algo que lo contenga. |
| `relabel` | Cambia el texto de un elemento. | sí | no | Nunca un precio, un número o un texto legal. El texto nuevo no promete ni apura. |

Reglas:

- Un parche de soul solo cambia presentación. Puede aplicarse a un grupo de elementos (todos los enlaces, todos los
  títulos) en vez de a uno.
- El `id` se calcula a partir del contenido. Dos parches con los mismos cambios son el mismo parche.
- Si un cambio de un parche de optimización no encuentra su elemento, no se aplica el parche entero: se midió
  completo.

Otros cambios (resaltar, mover, llevar la vista a un elemento) quedan para después.

## 3. Elementos protegidos y comprobación de seguridad

**Protegidos**, calculados por el programa y nunca declarados por Claude: las opciones de una selección; los botones
de un diálogo; las casillas de términos o de consentimiento; lo que sirve para salir, cancelar o rechazar; los
precios y el texto legal.

**Comprobación.** Después de aplicar los parches, cada elemento protegido y cada elemento del que depende avanzar en
la tarea sigue visible, se puede pulsar y se lee. Si no, los parches no quedan aplicados.

## 4. Variante

```json
{ "id": "var_91be02aa41c3", "host": "example.test", "patches": ["pat_3f9a1c0b77de"] }
```

Contiene solo parches de optimización. El parche de soul se aplica encima y no forma parte de ella: así un resultado
medido vale para cualquier persona, y la soul no viaja con él. El control es la variante sin parches.

## 5. Tarea

```json
{
  "id": "complete-signup",
  "host": "example.test",
  "start_url": "https://example.test/",
  "description": "Completa la inscripción.",
  "success": { "path_regex": "^/done" },
  "stages": [
    { "id": "start",  "when": { "path_regex": "^/$" } },
    { "id": "step-2", "when": { "path_regex": "^/step-2" } }
  ],
  "guardrails": [
    { "id": "cancel", "description": "Cancela la inscripción desde el segundo paso.", "success": { "path_regex": "^/cancelled" } }
  ],
  "max_steps": 20
}
```

Que la tarea se logró, y en qué etapa está un agente, lo decide el programa con estas condiciones. Nunca lo que diga
el agente. Una persona aprueba la tarea antes de lanzar agentes.

## 6. Recorrido

Un archivo de texto con una línea por evento.

```json
{"type":"run_start","id":"run_01","task_id":"complete-signup","variant_id":"var_…","persona_id":"impatient"}
{"type":"step","run_id":"run_01","idx":0,"stage":"start","action":{"type":"click","target":{"role":"link","name":"Inscribirme"}},"thought":"…","ms":2100}
{"type":"run_end","run_id":"run_01","outcome":"success | abandoned | step_limit | error","final_stage":"step-2"}
```

Las acciones posibles son `click`, `type`, `select`, `scroll`, `go_back`, `done` y `give_up`. Los intentos que
terminan en `error` no cuentan en ninguna tasa.

## 7. Grafo de navegación

```json
{
  "task_id": "complete-signup", "variant_id": "var_…", "n_runs": 20,
  "stages": [ { "id": "step-2", "visits": 17, "dropoffs": 11 } ],
  "transitions": [ { "from": "step-2", "to": "step-3", "n": 6 } ],
  "failure_examples": [ { "run_id": "run_07", "stage": "step-2", "thoughts": ["…"] } ]
}
```

Se calcula a partir de los recorridos; no se edita a mano. Sus nodos son etapas, no pantallas ni botones: así se
puede comparar la página original con una modificada aunque un parche cambie los nombres. Puede tener vueltas atrás.

## 8. Experimento

```json
{
  "task_id": "complete-signup", "baseline_id": "var_…", "variant_id": "var_…",
  "result": { "n_baseline": 20, "success_baseline": 0.30, "n_variant": 20, "success_variant": 0.75, "diff_ci95": [0.14, 0.68] },
  "guardrails": [ { "id": "cancel", "success_baseline": 0.90, "success_variant": 0.85, "worse": false } ],
  "noise_check": { "diff_ci95": [-0.25, 0.25], "ok": true },
  "decision": "accepted | rejected | inconclusive"
}
```

- `noise_check` compara la página original consigo misma. Si eso ya da una diferencia, el experimento no sirve.
- **Rechazada** si alguna salvaguarda empeora claramente, o si la variante es claramente peor.
- **Aceptada** si la variante es claramente mejor, ninguna salvaguarda empeora y la comprobación de azar está bien.
- **No concluyente** en cualquier otro caso.

"Claramente" significa que el intervalo de la diferencia (`diff_ci95`) no incluye el cero.

## 9. Soul

```json
{
  "preferences": [
    { "id": "pref_01", "text": "Prefiere colores apagados y texto grande", "scope": "global", "source": "stated" }
  ]
}
```

`scope` es `global` o un sitio. `source` es `stated` si la persona lo dijo e `inferred` si se dedujo de lo que hace.
La persona puede leer, corregir y borrar todo.

La soul y sus parches no salen del equipo. Lo único que se envía, y solo al Claude que la persona configuró, es lo
necesario para generar un parche.

## 10. Dónde se guarda

```
<carpeta del producto>/
  soul/            las preferencias y sus parches
  sites/<host>/    tasks/ · patches/ · variants/ · runs/ · graphs/ · experiments/ · active.json
```

`active.json` dice qué variante aplica la extensión en ese sitio. Lo que está bajo `sites/` se podría exportar; lo que
está bajo `soul/`, nunca.
