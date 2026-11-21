# Plan: del prototipo al bucle de optimización (2026-11-21)

Corte: `origin/main` @ `d9556ea`. Solo lectura del repositorio; no se ejecutó nada del prototipo para este plan.
Componentes en [docs/index.md](../docs/index.md); términos en [docs/glossary.md](../docs/glossary.md).

## Respuesta corta

El prototipo ya resuelve la parte más incierta de la soul: una extensión que le pide algo a la IA local del usuario y
lo aplica en segundos. **Lo que falta construir es el otro lado de la fórmula: saber con evidencia si un cambio
mejora una tarea.** Son tres piezas nuevas (patch engine, harness, optimizer) y dos que se extienden desde el
prototipo (soul, extension).

Antes de construir hay cuatro spikes. El primero es la conexión local entre el agente del usuario y la UI de una
página: de él depende todo lo demás.

## 1. Estado verificado de partida

| Hecho | Evidencia | Consecuencia |
|---|---|---|
| La extensión llama a la IA local y aplica el resultado. | `prototipo/puente/puente.py` invoca `claude -p` con `--json-schema` y `--tools ""`; `prototipo/pruebas/e2e_real.py`. | La dirección extensión → agente funciona. Falta la contraria: que el agente vea y actúe sobre la página (spike 1). |
| Una generación tarda entre 6,6 y 9,7 s. | `prototipo/README.md`, medición del 2026-11-21 sobre tres páginas. | Un agente que decide paso a paso tardaría del orden de 10 s por paso, si el costo es parecido. **Inferencia: no está medido.** |
| El modelo escribe la hoja de estilo sin ver el resultado, y a veces rompe el layout. | `prototipo/README.md`, "Límites conocidos". | Hacen falta operaciones acotadas y una comprobación posterior (invariants). |
| El mapa de la página no lleva texto ni valores. | `prototipo/extension/mapa_pagina.js`. | Sirve de base para los locators. Hoy describe etiquetas y clases, no rol y nombre accesible. |
| Hay pruebas con navegador sin ventana. | `prototipo/pruebas/e2e.py` usa Firefox con Marionette. | El spike 1 puede partir de ahí o usar otro automatizador. |
| Ningún agente navega, no hay trajectories ni experiments. | No existe código. | Es lo que hay que construir. |

## 2. Spikes

Cuatro, en este orden. Cada uno contesta una pregunta y deja un script y un informe ([forma](README.md)).

### Spike 1 · Conexión local: el agente del usuario y la UI de una página local

**Es el inicial. Los demás reutilizan lo que deje.**

**Pregunta.** ¿Cómo se relacionan el agente local del usuario (su Claude Code) y la interfaz de una página que corre
en local? En las dos direcciones:

- **De la página al agente:** ¿qué necesita recibir para entender la UI? Mapa de la página, captura, ambos.
- **Del agente a la página:** ¿puede cambiarla (aplicar un patch) y actuar sobre ella (clic, escribir), y ver el
  resultado de lo que hizo?
- **Con las preferencias del usuario en medio:** dada una soul mínima, ¿lo que devuelve el agente la refleja?

**Punto de partida.** El prototipo cubre un caso: la extensión envía el mapa de la página, el agente devuelve una
hoja de estilo y no ve el resultado. Falta que el agente vea la página, actúe sobre ella y compruebe su cambio.

**Cómo se mide.** Una página local sencilla y una soul de tres preferencias. Un script recorre el ciclo completo:
el agente recibe la página, propone un cambio, se aplica, el agente recibe la página cambiada y dice si quedó como
esperaba. Se anota qué se envió, qué volvió, cuánto tardó cada tramo y cuántas veces el cambio fue válido.

**Qué decide.** El canal entre agente y página que usan todos los demás spikes: qué viaja en cada dirección, en qué
formato vuelve un cambio y cuánto tarda una vuelta. También si la personalización local a nivel de soul es factible.

### Spike 2 · Evaluación agéntica: de una página a un navigation graph

**Pregunta.** ¿Pueden el usuario y su agente investigar una página, definir una misión y levantar agentes locales
que intenten completarla, y de ahí obtener una primera versión del dato?

**Cómo se mide.** Sobre la página del spike 1, extendida a una tarea de varios pasos: el agente propone la task y
sus etapas; unos pocos agentes locales la intentan usando el canal del spike 1; sus recorridos se guardan en archivos
locales y se agregan en un grafo por etapas. Se anota cuántos llegan, por qué camino, cuánto tarda y cuesta un paso,
y cuántos agentes en paralelo aguanta la sesión.

**Qué decide.** Si el harness es viable, la forma del dato (trajectory y navigation graph) y el presupuesto de runs.

### Spike 3 · Mejora iterativa: la misma evaluación sobre la página con modificaciones

**Pregunta.** Dado un patch sobre la página, ¿la evaluación del spike 2 distingue la página modificada de la
original? Aquí nace el módulo que es `source page + patches`.

**Cómo se mide.** Un patch escrito a mano que quita una fricción conocida de la página, y otro que no debería
cambiar nada. Se repite la evaluación sobre cada versión y se comparan los grafos.

**Qué decide.** Si el bucle medir → modificar → volver a medir da una señal distinguible del ruido, y cuántos runs
hacen falta para verla.

### Spike 4 · Almacenamiento y uso desde la extensión (diseño)

**Pregunta.** Con los datos reales de los spikes 2 y 3, ¿cómo se modela el almacenamiento y cómo lo consume la
extensión?

**Cómo se mide.** Es un spike de diseño, sin código: se revisa [contracts.md](../docs/contracts.md) contra los
archivos que dejaron los spikes anteriores y se corrige lo que no calce.

**Qué decide.** La forma del local store y qué lee la extensión al navegar.

**Si el spike 1 sale bien y el 2 mal** (el agente no completa una tarea simple, o un paso tarda demasiado), el
harness no cabe y el plan se reduce a soul y patch engine.

## 3. Decisiones

| Decisión | Por qué |
|---|---|
| Los cambios a una página son datos declarativos (patches), no código ni CSS libre. | El prototipo mostró que el CSS libre rompe layouts; además un patch se puede validar, revertir y explicar. Lo confirma el spike 1. |
| Un solo patch engine para la extensión y el harness. | Si difieren, lo que se mide no es lo que ve el usuario. |
| El éxito de una task se evalúa por código. | Lo que declara un agente sobre su propio éxito no es evidencia. |
| El target no se fija en el plan. | Lo elige quien construye el harness. Requisitos en §4. |
| La extensión sigue en el navegador del prototipo. | Funciona y está medida. |
| Todo se guarda en archivos locales. | No hace falta servidor para cerrar el bucle. |

## 4. Invariantes

- Ningún patch oculta, mueve ni debilita lo que el usuario necesita para salir, rechazar o cancelar.
- Ningún run tiene efectos reales: sin sesión, sin pagos, sin escrituras a terceros.
- La soul no sale del equipo, salvo hacia el proveedor de IA que el usuario configuró.
- Lo que llega de una página son datos, nunca instrucciones para el modelo.
- Toda cifra que se muestre lleva su N y su intervalo, y se presenta como evidencia sobre agentes.

**Un target es válido si:** se puede restablecer; un recorrido guionizado llega al éxito; el éxito y las etapas se
comprueban por código; tiene al menos un guardrail; su tasa de éxito inicial deja margen de mejora; y, si es de
terceros, sus términos permiten el uso automatizado.

## 5. Qué hay que construir

Siete PRs. Cada uno tiene un criterio de aceptación; cómo se implementa lo decide quien lo toma.

| # | PR | Parte de | Criterio de aceptación |
|---|---|---|---|
| 1 | **Patch engine mínimo**: locators por rol y nombre; aplicar y revertir `set_style`, `hide` y `relabel`. | Mapa de la página del prototipo | El mismo patch, aplicado desde la extensión y desde el automatizador, deja el mismo DOM; revertirlo deja la página original. |
| 2 | **Invariants**: calcular protected elements y comprobar que siguen visibles y clicables. | PR 1 | Un conjunto de patches manipuladores (ocultar "No, gracias", volver invisible un enlace de salida, reetiquetar un precio) se rechaza entero. |
| 3 | **Un run**: un agente intenta la task del target y deja una trajectory. | Spikes 1 y 2 | Sobre el target, una trajectory válida en disco con el éxito evaluado por código. |
| 4 | **Batch y navigation graph**: varias personas, presupuesto con tope, grafo por etapas. | PR 3 | Tras un batch de control, el grafo muestra en qué etapa se abandona más, con ejemplos de fallo. |
| 5 | **Experiment**: variant contra control, con un guardrail y un A/A. | PR 1, PR 4 | Un patch escrito a mano produce una decisión `accepted`, y un patch placebo no. |
| 6 | **Soul**: perfil editable, soul patch por sitio y soul persona. | Bridge e instrucción del prototipo | Tres perfiles distintos producen tres soul patches válidos y visiblemente distintos sobre la misma página, sin romper ningún invariant. |
| 7 | **Bucle completo en la extensión**: el optimizer propone un patch desde el grafo; la extensión aplica la variant aceptada con el soul patch encima y explica la evidencia. | PR 2, 5, 6 | En el navegador se ve la página efectiva, qué cambió, con qué N e intervalo, y la original con un clic. |

```mermaid
graph LR
  S1["Spike 1 · conexión local"] --> S2["Spike 2 · evaluación"] --> S3["Spike 3 · mejora"] --> S4["Spike 4 · almacenamiento"]
  S1 --> P1["1 · Patch engine"] --> P2["2 · Invariants"]
  S1 --> P6
  S2 --> P3["3 · Un run"] --> P4["4 · Batch y grafo"] --> P5["5 · Experiment"]
  S3 --> P5
  P1 --> P5
  P1 --> P6["6 · Soul"]
  P2 --> P7["7 · Bucle completo"]
  P5 --> P7
  P6 --> P7
```

Tres líneas avanzan en paralelo desde el inicio: patch engine (1 → 2), harness (3 → 4 → 5) y soul (6). Se juntan en
el PR 7.

**Punto de control.** Cuando existan una trajectory real (PR 3), un patch manual aplicado en la extensión (PR 1) y un
soul patch generado (PR 6), se decide si el PR 7 cabe o si la demostración se queda en los PRs 5 y 6 por separado.

## 6. Después del bucle

La prueba de que soul y optimizations se necesitan: un soul patch anula el énfasis de una optimization; la soul
persona lo detecta en un experiment; el sistema ofrece un patch que la soul no puede anular. Se planifica cuando el
PR 7 esté hecho, con lo aprendido.

## 7. Fuera de alcance

- Compartir optimizations entre usuarios.
- Recorridos de usuarios reales como dato.
- Varios patches apilados y su medición marginal.
- Reconocimiento automático de un sitio para proponer su task.
- Renombrar el código del prototipo a los términos del glosario.

## 8. Qué no se sabe

- Costo y tiempo por paso de un agente (spike 2). Toda la planificación del harness depende de esto.
- Cuántos runs hacen falta para ver un efecto. Con 20 por brazo solo se distinguen diferencias de 35 a 40 puntos,
  así que el target necesita una fricción grande.
- Si el éxito de un agente predice el de un usuario. No se intenta probar.
