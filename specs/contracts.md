# Contracts

| | |
|---|---|
| **Status** | Draft |
| **Updated** | 2026-11-21 |
| **Normativo hasta** | FND-1. Desde entonces mandan los esquemas y sus pruebas; este documento pasa a ser su explicación. |

Lo único rígido del proyecto. Términos en [glossary.md](glossary.md). Identificadores en inglés y `snake_case`; todo
objeto guardado lleva `schema_version`.

**Los ejemplos fijan nombres de campo y formas. Sus valores son ilustrativos y no describen ningún sitio**: usan el
host reservado `example.test`.

**Abierto a propósito.** Estas listas y umbrales los fija, con pruebas, el PR que los implementa, y quedan escritos
en el esquema: propiedades de estilo permitidas, tolerancias de los invariants, umbral de `highlight` asimétrico,
opt-out lexicon completo y número de cargas fallidas que vuelve `stale` una variant.

## 1. Composition rules

- **C1.** El orden de aplicación MUST ser: source page → patches de la variant → soul patch.
- **C2.** Un soul patch MUST cambiar solo presentación: estilo, y ocultar elementos no protegidos. Un optimization
  patch MAY además cambiar estructura y etiquetas con las operaciones de §3.
- **C3.** Los invariants (§4) MUST evaluarse sobre el resultado completo, con el soul patch aplicado si lo hay.
- **C4.** Todo experiment MUST referirse a una variant concreta. Un resultado obtenido sin soul MUST NOT presentarse
  como obtenido con soul.
- **C5.** Si una operación no resuelve su target, queda `unresolved`. El patch engine MUST NOT aplicar resolución
  aproximada. Un optimization patch con una operación `unresolved` MUST retirarse entero, porque se midió entero. Un
  soul patch se aplica operación a operación.
- **C6.** El patch engine MUST producir el mismo resultado en la extensión y en el harness.
- **C7.** Cuando una operación de soul y una de optimization fijan la misma propiedad del mismo elemento, prevalece
  la de soul y el patch engine MUST informarlo en `overridden_by_soul`. Lo mismo aplica si el soul patch oculta un
  elemento que un optimization patch modifica.

## 2. Locator

```json
{ "role": "button", "name": "Acción clara", "css": "#primary-action", "nth": 0 }
```

- Resolución: primero `role` + `name`. Si hay varios candidatos, `css` desempata entre ellos; si no hay ninguno, se
  busca por `css`. Si no queda exactamente uno, no resuelve.
- `nth` es informativo y MUST NOT usarse para desempatar.
- Si un patch cambia el nombre de un elemento, la resolución MUST seguir usando el nombre original.
- Hay una sola implementación de calcular y resolver locators, en el patch engine. La misma entrega la lista de
  elementos interactivos visibles que usan la observation del agente y la generación de patches.

## 3. Patch

```json
{
  "schema_version": 1,
  "id": "pat_3f9a1c0b77de",
  "host": "example.test",
  "path_pattern": "/step-2",
  "kind": "optimization",
  "author": "optimizer | manual | soul",
  "title": "Acción principal inequívoca",
  "hypothesis": "Dos botones comparten nombre; la mayoría abandona en step-2.",
  "target_stage": "step-2",
  "ops": [
    { "op": "relabel", "target": { "role": "button", "name": "Acción ambigua" }, "value": "Acción clara" },
    { "op": "set_style", "target": { "role": "button", "name": "Acción ambigua" }, "props": { "background-color": "#0b5" } }
  ]
}
```

| Operación | `optimization` | `soul` | Regla |
|---|---|---|---|
| `set_style` | sí | sí | Solo propiedades de presentación de una lista permitida. MUST NOT cargar recursos externos ni usar propiedades que oculten, desplacen o desactiven elementos. |
| `hide` | sí | sí | MUST NOT aplicarse a protected ni stage elements, ni a un contenedor que los incluya. |
| `highlight` | sí | no | MUST NOT ser asimétrico entre opciones protegidas. |
| `move_before` | sí | no | MUST NOT mover protected elements. |
| `relabel` | sí | no | MUST NOT aplicarse si el nombre original contiene moneda, número o un término legal o del opt-out lexicon. El valor nuevo MUST NOT contener moneda, número, urgencia ni promesas. |
| `scroll_into_view` | sí | no | Solo desplazamiento y foco. MUST NOT hacer clic. |

- Un patch MUST NOT contener código ejecutable.
- En un soul patch, el `target` de `set_style` MAY ser un grupo en vez de un locator:
  `{ "group": "links | paragraphs | headings | inputs | buttons", "within": <locator o null> }`. El grupo excluye
  siempre a los protected elements. `hide` no admite grupos. `hypothesis` y `target_stage` son nulos.
- El `id` es `pat_` más un resumen de `host`, `path_pattern`, `kind` y `ops`. Dos patches con las mismas operaciones
  son el mismo patch, aunque cambie su `title` o su `hypothesis`.

## 4. Protected elements e invariants

**Protected elements** (calculados por código, nunca declarados por un modelo): opciones de un grupo de selección;
botones hermanos de un diálogo; casillas de términos o consentimiento; elementos cuyo nombre pertenece al opt-out
lexicon; precios y texto legal, sean o no interactivos.

**Stage elements**: los locators nombrados en los predicates de la task y las acciones que, en el navigation graph
del control, llevan de un stage al siguiente.

**Invariants.** Tras aplicar todo, cada protected o stage element MUST seguir visible, clicable, con contraste de
texto no menor que el menor entre 4,5:1 y el que tenía en la source page, y con área no menor que la original.

- Si un invariant falla por la variant, la variant MUST NOT quedar aplicada.
- Si falla por el soul patch, se retira el soul patch y la variant queda.

## 5. Variant y apply report

```json
{ "schema_version": 1, "id": "var_91be02aa41c3", "host": "example.test",
  "patches": ["pat_3f9a1c0b77de"], "source_hash": "…", "status": "current | stale" }
```

- Contiene solo optimization patches. Así un experiment vale para cualquier usuario y la soul nunca viaja con ella.
- El `id` es `var_` más un resumen del host y de la lista ordenada de patches. El control es la variant con
  `patches: []`; su `id` se deriva igual. `status` es el único campo mutable.
- Una variant vale para todo el host; el patch engine aplica en cada ruta los patches cuyo `path_pattern` coincide.
- `source_hash` lo calcula el patch engine. Si cambia, solo MUST avisar. Una operación `unresolved` o un invariant
  fallido, repetido en cargas sucesivas, vuelve la variant `stale` y deja de aplicarse.

Apply report, igual en la extensión y en el harness:

```json
{ "variant_id": "var_…", "soul_patch_id": "pat_… | null",
  "applied": [ { "patch_id": "pat_…", "op_index": 0 } ], "unresolved": [], "overridden_by_soul": [],
  "retired_patches": [],
  "invariants": { "pass": true, "failures": [ { "locator": {}, "check": "visible | clickable | contrast | area", "caused_by": "variant | soul" } ] },
  "source_hash_matches": true }
```

- `applied`, `unresolved` y `overridden_by_soul` listan operaciones como `{ patch_id, op_index }`.
  `retired_patches` lista los optimization patches retirados enteros por C5.
- Quien invoca al patch engine le entrega los stage elements de la task como lista de locators.
- Si la variant no queda aplicada, el soul patch MAY aplicarse sobre la source page, sujeto a los mismos invariants.

## 6. Task

```json
{
  "schema_version": 1, "id": "complete-primary-task", "host": "example.test",
  "start_url": "https://example.test/",
  "description": "Completa la tarea principal y llega al estado final.",
  "success_criteria": { "path_regex": "^/done" },
  "stages": [ { "id": "start", "order": 0, "predicate": { "path_regex": "^/$" } },
              { "id": "step-2", "order": 2, "predicate": { "path_regex": "^/step-2" } } ],
  "guardrails": [ { "id": "decline-optional-extra", "description": "Completa la tarea sin el extra opcional.",
                    "success_criteria": { "locator_visible": { "role": "status", "name": "Sin extra" } } } ],
  "max_steps": 20, "side_effects": "none | reversible | real", "approved_at": "2026-11-21T12:00:00Z"
}
```

- Un predicate combina `path_regex`, `locator_visible` y `text_regex`; MUST NOT estar vacío.
- El éxito y los stages MUST evaluarse por código, nunca por lo que declare el agente. Si ningún predicate se cumple,
  el stage es `_off_path`.
- Con `side_effects: "real"`, el paso irreversible MUST NOT ejecutarse: el success criteria se corta antes.
- Sin `approved_at`, fijado por un usuario, MUST NOT lanzarse un batch.

## 7. Trajectory y persona

JSONL: una cabecera, N steps y un cierre por run.

```json
{"type":"run_start","id":"run_…","batch_id":"bat_…","task_id":"complete-primary-task","guardrail_id":null,"variant_id":"var_…","soul_patch_id":null,"persona_id":"impatient","replicate":3,"actor":"agent|human","model_id":"…","observation":"som|a11y_only"}
{"type":"step","run_id":"run_…","idx":0,"stage":"start","action":{"type":"click|type|select|scroll|go_back|done|give_up","locator":{}},"thought":"…","screenshot":"…","ms":2100}
{"type":"run_end","run_id":"run_…","outcome":"success|abandoned|step_limit|error","failure_cause":"agent|ui|null","n_steps":9,"final_stage":"step-2"}
```

- La observation `som` MUST numerar solo elementos visibles y no tapados.
- `step_limit` cuenta como abandono en el stage donde ocurrió. `error` MUST NOT contar en las tasas.
- `failure_cause` es `null` cuando `outcome` es `success` o `error`.
- Una trajectory con `actor: "human"` MUST NOT guardar lo que el usuario escribe ni llevar capturas.

```json
{ "id": "impatient", "description": "Abandona si no ve progreso en tres steps.", "split": "train | holdout | soul", "params": {} }
```

Las personas del split `holdout` MUST NOT usarse para proponer patches; solo para validar.

**Batch**

```json
{ "schema_version": 1, "id": "bat_…", "task_id": "…", "variant_id": "var_…", "persona_ids": ["impatient"],
  "replicates": 5, "budget": { "max_runs": 60, "max_model_calls": 1200 }, "status": "running | done | stopped_budget | failed" }
```

Un batch sin `budget` MUST NOT lanzarse, y MUST detenerse al alcanzarlo.

## 8. Navigation graph

```json
{ "schema_version": 1, "task_id": "…", "variant_id": "var_…", "actor": "agent | human", "n_runs": 40,
  "stages": [ { "id": "step-2", "visits": 31, "dropoffs": 17, "ui_dropoffs": 14, "median_steps": 4 } ],
  "transitions": [ { "from": "step-2", "to": "step-3", "action_locator": {}, "n": 14, "n_success": 12 } ],
  "elements_by_stage": { "step-2": [ { "role": "button", "name": "Acción ambigua" } ] },
  "failure_examples": [ { "run_id": "run_…", "stage": "step-2", "thoughts": ["…"], "screenshot": "…" } ] }
```

- Se calcula desde las trajectories y MUST NOT editarse a mano.
- Los nodos son stages, para que el control y cualquier variant sean comparables aunque un patch cambie etiquetas.
  Admite ciclos y transiciones de un stage a sí mismo. Hay una transición por cada terna distinta de `from`, `to` y
  acción.
- Los runs de agentes y los humanos van en grafos separados; MUST NOT sumarse.

## 9. Experiment

```json
{ "schema_version": 1, "id": "exp_…", "task_id": "…", "baseline_id": "var_…", "variant_id": "var_…",
  "batch_ids": ["bat_…"], "splits": ["train"], "provenance": "local | imported",
  "with_soul": false, "soul_patch_id": null,
  "primary_metric": { "n_baseline": 40, "success_rate_baseline": 0.30, "n_variant": 24, "success_rate_variant": 0.75, "diff_ci95": [0.20, 0.66] },
  "guardrails": [ { "id": "decline-optional-extra", "n": 12, "success_rate_baseline": 0.83, "success_rate_variant": 0.75, "diff_ci95": [-0.39, 0.24], "violated": false } ],
  "aa_test": { "diff_ci95": [-0.22, 0.26], "valid": true },
  "placebo": { "diff_ci95": [-0.20, 0.25], "valid": true },
  "decision": "accepted | rejected | inconclusive" }
```

- `baseline_id` es por defecto el control. MAY ser otra variant, para medir la mejora marginal de un patch.
- `with_soul: true` exige `soul_patch_id`: el soul patch se aplica solo al brazo `variant_id`. Para comparar una
  optimization con soul contra la misma sin soul, `baseline_id` y `variant_id` son la misma variant. Ese experiment
  es personal y MUST NOT exportarse.
- `aa_test`: el baseline partido en dos mitades y comparado consigo mismo. Es válido si su intervalo contiene 0.
  `placebo` es opcional: un patch sin efecto esperado, válido si su intervalo contiene 0.
- Un guardrail queda `violated` si el límite superior de su `diff_ci95` es menor que 0.
- `decision` se evalúa en este orden:
  1. `rejected` si algún guardrail está `violated`, o si el límite superior de `diff_ci95` de `primary_metric` es
     menor que 0.
  2. `inconclusive` si `aa_test` no es válido, o si hay `placebo` y no es válido.
  3. `accepted` si el límite inferior de `diff_ci95` de `primary_metric` es mayor que 0.
  4. `inconclusive` en cualquier otro caso.
- Toda cifra mostrada a un usuario MUST ir con su N y su intervalo. Un experiment `accepted` es evidencia sobre
  agentes y MUST presentarse así.

## 10. Soul

```json
{ "schema_version": 1,
  "preferences": [ { "id": "pref_01", "text": "Prefiere fondos oscuros y texto grande", "scope": "global | site", "host": null, "source": "stated | inferred" } ],
  "tokens": { "color_scheme": "dark", "density": "comfortable", "font_size": "large", "motion": "reduced" },
  "persona_prompt": "Lee poco; abandona si hay más de dos steps sin progreso visible." }
```

- La soul, los soul patches, las trajectories humanas y las capturas MUST NOT salir del equipo del usuario. Única
  excepción: lo necesario para generar un soul patch o para correr la soul persona MAY enviarse al proveedor de IA
  que el usuario configuró, y eso MUST informársele antes del primer envío.
- El usuario MUST poder ver, corregir y borrar su soul. `tokens` y `persona_prompt` se derivan de las preferencias y
  el usuario puede corregirlos.
- Un soul patch guardado caduca cuando cambia la soul.
- La soul persona MUST aplicar los `tokens` por código en el navegador del agente, no solo como texto en el prompt.

## 11. Local store

```
<root>/
  soul/          la soul, sus soul patches por host, sus registros
  sites/<host>/  tasks/ · patches/ · variants/ · batches/ · runs/ · graphs/ · experiments/ · active.json
```

```json
{ "schema_version": 1, "variant_id": "var_…", "previous_variant_id": "var_… | null", "forced": false,
  "approved_by": "…", "approved_at": "…", "soul_patch_id": "pat_… | null", "soul_enabled": true }
```

- Patches y variants son inmutables. `active.json` dice qué variant aplica la extensión y qué soul patch va encima.
- Los soul patches viven bajo `soul/`, nunca bajo `sites/`. Lo que está bajo `sites/` se puede exportar, salvo
  trajectories humanas, capturas y experiments con soul.
- Una variant MUST pasar a activa solo con un experiment `accepted` y la aprobación de un usuario, salvo que se
  fuerce; forzarla MUST quedar marcado en `forced`. `previous_variant_id` permite volver atrás.
- Un `soul_patch_id` caducado se trata como `null`.
- Las capturas se guardan junto a las trajectories, bajo `runs/`. El target profile se guarda junto a la task.
- Lo importado de otro usuario MUST guardarse con `provenance: "imported"` y presentarse como no medido en este
  equipo.
- La extensión MUST NOT leer el disco: pide al bridge y guarda una copia.
- Una sola biblioteca escribe en el local store; todos los stacks guardan y leen por ella.

## 12. Bridge

- Es un solo proceso. MUST escuchar solo en el equipo del usuario y exigir un pairing token.
- MUST NOT aceptar peticiones que no vengan de la extensión emparejada; en particular, las originadas por una página
  web.
- Lo que llega de una página (estructura, nombres, texto) MUST tratarse como datos, nunca como instrucciones.
- Una petición entre la extensión y el bridge MUST NOT quedar abierta más de 20 s; el trabajo largo se consulta.
- Cada stack añade sus rutas a ese proceso; ninguno levanta un segundo servicio.
