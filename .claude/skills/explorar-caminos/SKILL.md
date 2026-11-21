---
name: explorar-caminos
description: Procedimiento para que un usuario sintético del evaluador web explore varias ramas distintas hacia una tarea (abrir una rama, volver, abrir otra) y anote con evidencia lo que encuentra relevante para el usuario. Usar en los perfiles exploradores del evaluador (agents/app/web_evaluator, perfiles `explorador*`) o al escribir o ajustar prompts de agentes que deban recorrer un sitio a lo ancho en vez de en línea recta.
---

# Explorar caminos

Tu objetivo no es solo cumplir la tarea: es encontrar **varias formas de llegar** y lo que le sirva al usuario en el
camino. Un recorrido en línea recta es un mal resultado aunque termine bien. Una rama que no sirve también es un
resultado: muestra dónde se pierde una persona.

## Palabras

- **Página**: una pantalla del sitio con su título. Cada página vista tiene un id (`p1`, `p2`...).
- **Rama**: los clics que haces desde una página hasta que vuelves. Una rama de primer nivel sale de la página inicial.
- **Candidata**: un enlace, botón o buscador que podría acercarte a la tarea.
- **Olor** de una candidata: *alto* si su texto tiene palabras de la tarea o sinónimos; *medio* si es una sección que
  podría contenerla ("Ayuda", "Servicios", "Mi cuenta"); *bajo* si es genérica o publicidad.
- **Callejón**: una página sin la tarea y sin candidatas de olor alto o medio (después de 1 scroll).
- **Hallazgo**: algo relevante para el usuario, con evidencia: la respuesta, otra forma de llegar, un obstáculo (login,
  error, texto confuso) o un dato útil.

## Presupuesto

Después de cada acción el sistema te dice cuántas acciones llevas, cuántas te quedan y los segundos que quedan. Úsalo
en vez de contar. Con B = total de acciones (por ejemplo 30):

| Fase | Mientras… | Qué haces |
|---|---|---|
| 1. Inventario | 1.ª página | Elige 3 a 5 candidatas de olor alto o medio. Máximo 1 scroll. |
| 2. Abanico | te quedan más del 40 % de B (con 30: más de 12) | Abre ramas distintas desde la página inicial: **al menos 3**, cada una con **máximo 3 clics** de profundidad. |
| 3. Cierre | te queda entre 40 % y 10 % de B | Si ya viste la respuesta: vuelve a esa página y déjala en pantalla. Si aún no la ves: **sigue abriendo ramas** nuevas. |
| Reserva | te queda 10 % de B (con 30: 3) o menos de 45 s | Termina **ya**. |

Por qué: las ramas distintas son lo que buscamos; el cierre existe porque el juez solo mira tu última pantalla.
**Nunca termines con `give_up` mientras te queden más del 10 % de B**: si no encontraste la respuesta, quedan ramas
por abrir (buscador, pie de página, otra sección del menú, otra pregunta de la misma página).
Máximo **2 scroll seguidos** en una página: si no apareció nada, es un callejón.

## Cómo volver

- Primero usa la acción `volver_a_nodo` con el id de la página (`"nodo": "p1"`): te lleva directo, en 1 acción, a
  cualquier página que ya viste.
- Si no tienes esa acción, usa la tecla `alt+Left` (botón Atrás) y mira la captura para confirmar que volviste.

## Procedimiento

1. Si hay un aviso de cookies o un popup, ciérralo con 1 acción.
2. **Inventario** (fase 1): elige 3 a 5 candidatas en la página inicial, de lugares distintos (menú, buscador, pie de
   página, enlaces del contenido). Empieza por la que indica tu perfil.
3. **Abre una rama**: clic en la mejor candidata que aún no probaste.
4. **Evalúa** cada página nueva con la tabla de decisiones.
5. **Vuelve** (ver "Cómo volver") a la página inicial o a la página con candidatas sin probar más cercana, y abre la
   siguiente rama. Repite 3 a 5 mientras dure la fase 2.
6. **Cierre** (fase 3): vuelve a la página que mejor responde la tarea y quédate ahí.
7. **Termina** con `done` si esa página muestra la respuesta; con `give_up` si ninguna rama la tenía; con `blocked`
   si el sitio exige login, pago o datos personales.

## Tabla de decisiones

| Si… | Haz… |
|---|---|
| Ves la respuesta y estás en fase 2 | Anota el hallazgo y vuelve para abrir otra rama. No termines todavía. |
| Ves la respuesta y estás en fase 3 o en la reserva | Termina aquí con `done`. |
| Llevas 3 clics en la rama sin acercarte | Vuelve a la página con candidatas sin probar. |
| La página es un callejón | Anótalo y vuelve. |
| La pantalla no es lo que esperabas 2 veces seguidas | Vuelve (clic errado o callejón). |
| Un clic no cambió nada | No repitas la misma coordenada: apunta al centro del texto, o prueba otra candidata. |
| Te piden login, pago, formulario final o datos personales | No lo hagas. Hallazgo tipo `obstaculo` y vuelve. |
| Llegas a la misma página por tercera vez | Elige una candidata no probada de otra página. |
| Se acaba la fase 2 y abriste menos de 3 ramas | Abre ya otra rama de primer nivel. |
| No encontraste la respuesta y te queda más del 10 % de B | Abre otra rama desde una página con candidatas sin probar. No te rindas. |
| Estás en la reserva y no ves la respuesta | Vuelve a la mejor página con `volver_a_nodo` y termina, o `give_up`. |

## La expectativa de cada acción

Una sola frase, que empiece con la rama: `[rama 2, «Ayuda»] Espero ver preguntas frecuentes con una sección de bajas.`
Al volver: `[vuelvo a p1] Espero ver otra vez la página inicial.` No expliques tu razonamiento.

## Texto final (en `done`, `give_up` o `blocked`)

```
RESPUESTA: <el dato que responde la tarea, como se ve en pantalla; o "no encontrada">
RAMAS: 1) Inicio > Ayuda > Bajas (sirvió) 2) Inicio > Planes (callejón) 3) Inicio > buscador «baja» (sirvió, más corta)
HALLAZGOS:
- [paso 4] respuesta: «Para dar de baja llama al 600 123 4567» | página Bajas
- [paso 9] obstaculo: «Inicia sesión para continuar» | página Mi cuenta
```

Tipos de hallazgo: `respuesta`, `alternativa`, `obstaculo`, `dato_util`. La cita va entre « », copiada de la pantalla,
máximo 15 palabras. El número de paso es el de "llevas N acciones" justo después de verlo.

## Ejemplos

<ejemplo>
Tarea: "Averiguar cómo dar de baja la fibra". B = 30.
1. p1 Inicio. Candidatas: «Ayuda» (alto, menú), buscador (alto), «Planes Fibra» (medio, contenido), «Mi cuenta» (medio).
2. Rama 1: clic «Ayuda» → p2 Ayuda → clic «Bajas» → p3 Bajas: muestra el teléfono de bajas. Hallazgo `respuesta`.
   Quedan 26 (fase 2): `volver_a_nodo` p1.
3. Rama 2: clic «Planes Fibra» → p4 Planes: solo precios. Callejón. `volver_a_nodo` p1.
4. Rama 3: clic «Mi cuenta» → p5 pide login. Hallazgo `obstaculo`. `volver_a_nodo` p1.
5. Rama 4: buscador, escribo «baja fibra», Enter → p6 Resultados → clic en el primero → p3 Bajas otra vez. Hallazgo
   `alternativa`. Quedan 12: fase 3. Ya estoy en la mejor página: `done`.
</ejemplo>

<ejemplo>
Tarea: "Encontrar el horario de la sucursal de Providencia". B = 30.
1. Rama 1: «Sucursales» → mapa sin lista; 1 scroll, nada. Callejón. `volver_a_nodo` p1.
2. Rama 2: pie de página «Contacto» → solo formulario. Callejón. `volver_a_nodo` p1.
3. Rama 3: buscador «Providencia» → resultado «Sucursal Providencia» → horario visible. Hallazgo `respuesta`.
4. Quedan 14: abro una rama más (menú «Nosotros» → callejón), vuelvo con `volver_a_nodo` a la página del horario y
   termino con `done`.
</ejemplo>

## Antes de terminar, revisa

- [ ] ¿La pantalla actual muestra la respuesta? Si no, vuelve a la página que la mostraba, o usa `give_up`.
- [ ] ¿Abriste al menos 3 ramas de primer nivel, o el sitio no tenía más candidatas?
- [ ] ¿Cada hallazgo tiene paso y cita?
- [ ] ¿Evitaste login, pagos, formularios finales y datos personales?
