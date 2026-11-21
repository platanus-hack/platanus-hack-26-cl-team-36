# Formas de datos

**Qué es este documento.** Una propuesta del formato de cada dato del sistema: parches, tareas, recorridos,
experimentos y soul. Es para quien vaya a programar. Antes conviene leer [la propuesta](index.md); los términos
están en el [glosario](glosario.md).

**Nada de esto está construido.** Los spikes del [plan](plan.md) lo ponen a prueba y pueden cambiarlo.

Los nombres de los campos van en inglés. Los ejemplos usan un sitio inventado, `example.test`; sus valores solo
ilustran la forma.

## 1. Localizador

Señala un elemento de la página.

```json
{ "role": "button", "name": "Continuar", "css": "#next" }
```

Se busca primero por lo que el elemento es (`role`) y cómo se llama (`name`). Si eso encuentra más de uno, `css`
desempata entre ellos. Si al final no queda exactamente uno, el elemento no se encontró: no se adivina.

## 2. Parche

```json
{
  "id": "pat_3f9a1c0b77de",
  "host": "example.test",
  "path_pattern": "/step-2",
  "kind": "optimization",
  "title": "Botón de avance con nombre propio",
  "hypothesis": "Dos botones se llaman igual; la mayoría abandona en la segunda etapa.",
  "changes": [
    { "op": "relabel",   "element": { "role": "button", "name": "Continuar", "css": "#next" }, "value": "Siguiente paso" },
    { "op": "set_style", "element": { "role": "button", "name": "Continuar", "css": "#next" }, "props": { "background-color": "#0b5" } }
  ]
}
```

En el ejemplo hay dos botones "Continuar", así que el localizador necesita `css` para señalar el que avanza.

`kind` es `optimization` o `soul`. Un parche no contiene código.

| Cambio | Qué hace | En optimización | En soul | Límite |
|---|---|---|---|---|
| `set_style` | Cambia colores, tipografía o espaciado. | sí | sí | No carga nada de fuera ni oculta, mueve o desactiva elementos. |
| `hide` | Oculta un elemento. | sí | sí | Nunca un elemento protegido ni algo que lo contenga. |
| `relabel` | Cambia el texto de un elemento. | sí | no | Nunca un precio, un número o un texto legal. El texto nuevo no hace promesas ni mete prisa. |

Reglas:

- **Primero se localiza todo, después se aplica.** Todos los elementos de un parche se buscan en la página antes de
  cambiar nada. Así, renombrar un botón no impide que el cambio siguiente lo encuentre.
- **Un parche de optimización se aplica entero o no se aplica.** Si uno de sus cambios no encuentra su elemento, se
  descarta todo, porque se midió completo.
- **Un parche de soul solo cambia la presentación.** Puede aplicar `set_style` a un grupo (todos los enlaces, todos
  los títulos) en vez de a un elemento; el grupo nunca incluye elementos protegidos.
- **El `id` se calcula a partir del sitio, la ruta, el tipo y los cambios.** Dos parches con los mismos cambios son
  el mismo parche, aunque cambie su título.

Otros cambios (resaltar, mover, llevar la vista a un elemento) quedan para después.

## 3. Elementos protegidos y comprobación de seguridad

**Elementos protegidos.** Los calcula el programa; Claude nunca los declara. Son: las opciones de una selección; los
botones de un diálogo; las casillas de términos o de consentimiento; lo que sirve para salir, cancelar o rechazar;
los precios y el texto legal.

Reconocer bien un precio o un texto legal en cualquier página es un problema abierto. En la página de prueba se
marcan a mano.

**Comprobación de seguridad.** Después de aplicar los parches, cada elemento protegido y cada elemento del que
depende avanzar en la tarea sigue visible y se puede pulsar, y su texto conserva el contraste. Si no, los parches no
quedan aplicados.

## 4. Variante

```json
{ "id": "var_91be02aa41c3", "host": "example.test", "patches": ["pat_3f9a1c0b77de"] }
```

Contiene solo parches de optimización. El parche de soul se aplica encima y no forma parte de ella: así un resultado
medido vale para cualquier persona, y la soul no viaja con él.

El **control** es la página original: la variante sin parches.

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
    { "id": "step-2", "when": { "element_visible": { "role": "heading", "name": "Tus datos" } } }
  ],
  "guardrails": [
    { "id": "cancel", "description": "Cancela la inscripción desde la segunda etapa.", "success": { "path_regex": "^/cancelled" } }
  ],
  "max_steps": 15
}
```

Una condición (`success`, `when`) puede mirar la dirección de la página o si un elemento está visible. Lo segundo
hace falta cuando toda la tarea ocurre en una misma dirección.

El programa decide con estas condiciones si la tarea se logró y en qué etapa va el agente. Lo que diga el agente no
cuenta. Una persona aprueba la tarea antes de lanzar agentes.

## 6. Recorrido

El registro de un intento: un archivo de texto con una línea por evento.

```json
{"type":"run_start","id":"run_01","task_id":"complete-signup","variant_id":"var_…","agent_profile":"impatient"}
{"type":"step","run_id":"run_01","idx":0,"stage":"start","action":{"type":"click","element":{"role":"link","name":"Inscribirme"}},"thought":"…","ms":2100}
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
puede comparar la página original con una variante aunque un parche cambie los nombres. Puede tener vueltas atrás.

## 8. Experimento

```json
{
  "task_id": "complete-signup", "control_id": "var_…", "variant_id": "var_…",
  "result": { "n_control": 20, "success_control": 0.30, "n_variant": 20, "success_variant": 0.75, "diff_ci95": [0.14, 0.66] },
  "guardrails": [ { "id": "cancel", "success_control": 0.90, "success_variant": 0.85, "max_drop": 0.20, "worse": false } ],
  "noise_check": { "success_half_a": 0.30, "success_half_b": 0.30, "diff_ci95": [-0.36, 0.36], "ok": true },
  "decision": "accepted | rejected | inconclusive"
}
```

- **`diff_ci95`** es el intervalo de confianza del 95 % de la diferencia entre las dos tasas de éxito, calculado con
  el método de Newcombe. En el ejemplo, 6 de 20 contra 15 de 20 da de 0,14 a 0,66: como no incluye el cero, la
  variante es claramente mejor.
- **Comprobación de azar (`noise_check`).** Los intentos del control se parten en dos mitades y se comparan entre
  sí. Si esa diferencia ya es grande, el experimento no sirve. Con pocos intentos esta comprobación detecta poco:
  entre dos mitades de diez, el intervalo ya mide ±0,36.
- **Salvaguarda.** Empeora si su tasa baja más que `max_drop`, un margen que se fija antes de medir.

La decisión:

- **Rechazada** si alguna salvaguarda empeora, o si la variante es claramente peor.
- **Aceptada** si la variante es claramente mejor, ninguna salvaguarda empeora y la comprobación de azar está bien.
- **No concluyente** en cualquier otro caso.

Con veinte intentos por lado solo se aceptan mejoras grandes. Por ejemplo, 6 de 20 contra 12 de 20 da de −0,01 a
0,54 y queda no concluyente.

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

La soul y sus parches no salen del computador. Lo único que se envía, y solo al Claude de la persona, es lo necesario
para generar un parche.

## 10. Almacén local

```
<carpeta del producto>/
  soul/            las preferencias y sus parches
  sites/<host>/    tasks/ · patches/ · variants/ · runs/ · graphs/ · experiments/ · active.json
```

`active.json` dice qué variante aplica la extensión en ese sitio. Lo que está bajo `sites/` se podría exportar; lo que
está bajo `soul/`, nunca.

La extensión no puede leer estos archivos directamente: se los pide al puente.
