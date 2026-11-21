# Spike: ¿8 exploradores con dos niveles de conocimiento encuentran más caminos que los 4 de siempre? (2026-11-21)

Rama `feat/exploradores-con-conocimiento` (commit `40b33f0`, evaluador con `--exploradores`), en un Mac M2 con Claude
Code 2.1.326 (motor `claude-code`, usuarios `claude-haiku-5-5` en esfuerzo `medium`, juez `claude-opus-5-5`),
Chromium de Playwright con `--record-video`. Las tandas corrieron una a la vez, entre las 15:46 y las 16:51.

- **A** = `--exploradores base`: los 4 exploradores de siempre, uno por lugar de partida (menú, buscador, pie,
  contenido), sin nivel de conocimiento.
- **B** = `--exploradores conocimiento`: 8 = esos 4 lugares × 2 niveles (`sin_contexto`: palabras de todos los días,
  no puede escribir términos oficiales que no haya visto en el sitio; `conoce_tema`: conoce los nombres oficiales y
  cómo funciona el trámite). Ningún nivel recibe pistas de dónde está la respuesta. Ver
  [el README del evaluador](../agents/app/web_evaluator/README.md#exploradores-con-nivel-de-conocimiento).
- **A×2** = la unión de las dos tandas de A de cada tarea: 8 exploradores sin nivel. Es el control para separar el
  efecto de los niveles del de tener el doble de exploradores.

Script: [2026-11-21-exploradores-conocimiento.py](2026-11-21-exploradores-conocimiento.py) (definiciones de página,
página de respuesta y camino al principio del archivo). Las tandas quedan fuera de git, en `agents/.runs/` (B) y
`agents/.runs/archivo/2026-11-21-medicion-4-exploradores/` (A).

**La regla para decidir se escribió antes de medir:** quedarse con 8 si B encuentra ≥ 25 % más páginas distintas y
más caminos distintos a la respuesta en al menos la mitad de las tareas, con una tasa de éxito ≥ la de A − 10 puntos
y segundos por acción ≤ 1,5 × A; ir a 6 si la ganancia se concentra (algunos pares lugar × nivel no aportan casi
nada propio); volver a 4 en otro caso.

## Respuesta corta

**Según la regla, B pasa: quedarse con 8.** En 7 tareas × 2 tandas por grupo, B ve 39 % más páginas distintas que
A (107 contra 77, suma por tarea de la media por tanda), más caminos a la respuesta en 5 de 7 tareas (19 contra
14,5), su éxito es 82 % contra 91 % (−9 puntos, dentro del margen) y los segundos por acción no cambian (mediana 4 s
en ambos: las 8 sesiones en paralelo no hicieron más lento cada paso).

**Pero casi toda la ganancia viene de tener el doble de exploradores, no de los niveles.** Contra A×2 (8 sin nivel),
B ve 107 páginas contra 99 (+8 %) y 19 caminos contra 17 (+12 %); B ve 30 páginas que A×2 no vio y A×2 ve 22 que B
no vio. Es una ganancia chica y con n = 2 por tarea puede ser ruido (la misma configuración B varía 0 a 3 páginas
entre sus dos tandas).

**Lo que sí distinguen los niveles es dónde se pierde una persona sin vocabulario:** `sin_contexto` logra la tarea en
40 de 56 intentos (71 %) y `conoce_tema` en 52 de 56 (93 %), igual que A (51 de 56). Los fallos de `sin_contexto` son
hallazgos con sentido: en dt.gob.cl termina en «Ingreso de denuncia laboral» o en «Inspecciones y oficinas» en vez
del reclamo por despido; en sii.cl, en «Preguntas Frecuentes» sin la fecha; en wom.cl, en el centro de ayuda general.
Ninguno de los 4 exploradores de A muestra eso. `sin_contexto` también es el que más páginas propias abre (por
explorador, 4 a 7,5 páginas que nadie más de su tanda vio, contra 2,5 a 5 de `conoce_tema`).

**Lo que no quedó demostrado.** Que la ganancia en páginas y caminos sobre A×2 sea real (n = 2). Nada sobre
sernac.cl: el sitio cortó todas las conexiones desde este computador después de la tanda piloto de B y siguió así
más de una hora (ver Evidencia), así que no tiene tanda de A.

## Evidencia

Comandos (desde `agents/app/web_evaluator/`), una tanda a la vez; la repetición 1 corrió A y después B en cada tarea,
la 2, B y después A:

```bash
uv run --python 3.12 main.py --task <id> --exploradores base --model claude-haiku-5-5 --effort medium --record-video
uv run --python 3.12 main.py --task <id> --exploradores conocimiento --model claude-haiku-5-5 --effort medium --record-video
python3 .spikes/2026-11-21-exploradores-conocimiento.py --reps 2   # desde la raíz del repo
```

Cada tanda de A tardó ~1,5 a 3 minutos y cada una de B ~2 a 4,5 (con el juez). Costo equivalente de los usuarios
(lo que informa `claude -p`, sin el juez): 0,06 USD por tanda de A y 0,12 por tanda de B. Sin cortes por límite ni
errores de la herramienta en las 28 tandas que cuentan.

**sernac.cl bloqueó el computador.** La tanda piloto de B en sernac (15:46, sin video) terminó con varias páginas en
blanco; la tanda de A de las 15:51 y la de B que siguió no pudieron abrir la página inicial
(`net::ERR_CONNECTION_CLOSED` en los 12 navegadores), y `curl` siguió recibiendo la conexión cortada hasta las 16:52.
Es una suposición que fue por los 8 navegadores en paralelo (no se probó desde otra red). Las dos tandas vacías
quedaron en `agents/.runs/archivo/2026-11-21-fallidas-sitio-bloqueado/`; la piloto de B queda como la tanda de 8 de
sernac.

**Términos rechazados.** El harness rechazó 3 escrituras de `sin_contexto` en 56 intentos («credencial» en bn,
«exención» en sii, «dar de baja» en wom); después escribieron con sus palabras. En sii.cl `sin_contexto` sí pudo
escribir «contribuciones» desde el primer paso porque la portada lo muestra («Pagar contribuciones», banner de la
exención): la regla permite lo que el sitio ya mostró.

Tablas tal como las imprime el script (7 tareas, 2 tandas de A y 2 de B por tarea; 56 intentos de A, 112 de B):

### Por tarea (páginas y caminos: media por tanda)

| Tarea | Tandas A/B | Éxitos A | Éxitos B | B sin contexto | B conoce tema | Páginas A | Páginas B | Páginas A×2 | B no en A×2 | A×2 no en B | Caminos A | Caminos B | Caminos A×2 | B no en A×2 | s/acción A | s/acción B | Rechazos B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bn-socio-prestamo-domicilio | 2/2 | 8/8 | 15/16 | 7/8 | 8/8 | 7.5 | 14.5 | 8 | 6.5 | 0 | 2 | 1.5 | 2 | 0 | 3 | 4 | 1 |
| dt-reclamo-despido | 2/2 | 7/8 | 13/16 | 5/8 | 8/8 | 16.5 | 20 | 20 | 5.5 | 5.5 | 2.5 | 4 | 4 | 2.5 | 3 | 3 | 0 |
| ine-fecha-ipc-noviembre | 2/2 | 8/8 | 15/16 | 7/8 | 8/8 | 9 | 10 | 12 | 0 | 2 | 1.5 | 2 | 2 | 0 | 3 | 4 | 0 |
| metro-tarifa-sabado | 2/2 | 8/8 | 14/16 | 6/8 | 8/8 | 8 | 9 | 10 | 1 | 2 | 2.5 | 4 | 3 | 1 | 6 | 7 | 0 |
| sii-exencion-contribuciones | 2/2 | 7/8 | 10/16 | 4/8 | 6/8 | 15 | 25.5 | 22 | 8 | 4.5 | 1 | 1 | 1 | 0 | 3 | 4 | 1 |
| uchile-arancel-medicina | 2/2 | 6/8 | 12/16 | 6/8 | 6/8 | 11.5 | 15 | 15 | 4.5 | 4.5 | 3 | 4 | 3 | 1.5 | 4 | 4 | 0 |
| wom-baja-fibra | 2/2 | 7/8 | 13/16 | 5/8 | 8/8 | 9.5 | 13 | 12 | 4.5 | 3.5 | 2 | 2.5 | 2 | 1.5 | 5 | 5 | 1 |

### Total

| | A (4 exploradores) | B (8 exploradores con nivel) | A×2 (8 sin nivel: dos tandas de A) |
|---|---|---|---|
| Tareas · tandas | 7 · 14 | 7 · 14 | |
| Éxitos | 51/56 | 92/112 | |
| Páginas distintas (suma por tarea, media por tanda) | 77 | 107 | 99 |
| Páginas que el otro grupo no vio (vs A×2) | | 30 | 22 |
| Caminos distintos a la respuesta (suma, media por tanda) | 14.5 | 19 | 17 |
| Caminos que el otro grupo no hizo (vs A×2) | | 6.5 | 4.5 |
| Pasos por explorador (mediana) | 20 | 20 | |
| Segundos por explorador (mediana) | 80 | 85 | |
| Segundos por acción (mediana) | 4 | 4 | |
| Cortes por límite | 0 | 0 | |
| Errores (interrumpidos) | 0 | 0 | |
| Escrituras rechazadas (sin contexto) | | 3 | |
| Costo equivalente de los usuarios, por tanda (USD, media) | 0.062 | 0.123 | |

### Éxitos por lugar de partida y nivel (todas las tandas)

| Lugar | A | B sin contexto | B conoce tema |
|---|---|---|---|
| menu | 13/14 | 10/14 | 13/14 |
| buscador | 12/14 | 9/14 | 14/14 |
| pie | 13/14 | 11/14 | 13/14 |
| contenido | 13/14 | 10/14 | 12/14 |
| total | 51/56 | 40/56 | 52/56 |

### Dentro de B: qué aporta cada nivel (media por tanda)

| Tarea | Páginas B por tanda | Páginas solo sin contexto | Páginas solo conoce tema | Caminos solo sin contexto | Caminos solo conoce tema |
|---|---|---|---|---|---|
| bn-socio-prestamo-domicilio | 13 / 16 | 3.5 | 3.5 | 0 | 0.5 |
| dt-reclamo-despido | 19 / 21 | 6.5 | 5 | 1.5 | 2.5 |
| ine-fecha-ipc-noviembre | 9 / 11 | 2 | 0 | 0 | 0.5 |
| metro-tarifa-sabado | 9 / 9 | 1.5 | 1 | 0.5 | 1 |
| sii-exencion-contribuciones | 25 / 26 | 8.5 | 3 | 0 | 0 |
| uchile-arancel-medicina | 14 / 16 | 4 | 1 | 2 | 0.5 |
| wom-baja-fibra | 14 / 12 | 3.5 | 2.5 | 0 | 1.5 |

### Dentro de B: lo que solo encontró cada explorador (suma de las tareas, media por tanda)

| Explorador | Páginas únicas | Caminos únicos | Éxitos |
|---|---|---|---|
| explorador_buscador_conoce_tema | 5 | 1 | 14/14 |
| explorador_buscador_sin_contexto | 7.5 | 1 | 9/14 |
| explorador_contenido_conoce_tema | 3 | 1 | 12/14 |
| explorador_contenido_sin_contexto | 4 | 0.5 | 10/14 |
| explorador_menu_conoce_tema | 2.5 | 0.5 | 13/14 |
| explorador_menu_sin_contexto | 5.5 | 1.5 | 10/14 |
| explorador_pie_conoce_tema | 2.5 | 2 | 13/14 |
| explorador_pie_sin_contexto | 6.5 | 0.5 | 11/14 |

## Qué decidimos

- **Quedarse con 8** (`conocimiento`) como el conjunto de exploradores que se muestra en el backoffice: cumple la
  regla, cuesta el doble en tokens (0,12 USD por tanda) pero no en tiempo, y el nivel `sin_contexto` deja ver dónde
  se pierde alguien sin vocabulario, que los 4 de siempre no muestran.
- No se pasó a 6: ningún par lugar × nivel quedó en cero; los que menos aportan propio son
  `explorador_menu_conoce_tema` (2,5 páginas y 0,5 caminos únicos, sumando las tareas) y
  `explorador_contenido_conoce_tema` (3 y 1). Si hay que bajar costo o carga sobre los sitios, esos dos son los
  primeros candidatos a sacar (un conjunto de 6).
- `config.CONJUNTO_EXPLORADORES` sigue en `base` (la opción por defecto de `--exploradores` sin nombre); el cambio de
  lo que se muestra se hizo archivando las tandas viejas, no cambiando el código.
- Sin resolver: si la ventaja sobre A×2 es real (hace falta más repeticiones); cuánto aguantan los sitios 8 navegadores
  en paralelo (sernac.cl no los aguantó); repetir sernac cuando vuelva a responder.
