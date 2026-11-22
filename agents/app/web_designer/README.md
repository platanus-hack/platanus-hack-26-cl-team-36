# web_designer

El **diseñador** mide un skill de diseño de temas con corridas reales. Dada una URL y los gustos de un usuario (y, si
la hay, su tarea en el sitio), le pide a Claude Haiku un tema de Chameleon guiado por un `SKILL.md`: una hoja CSS con
todas sus reglas bajo `html.mi-tema`, como las que aplica la [extensión](../../../extension/CLAUDE.md). Después la
sanea como lo haría la extensión, la aplica sobre la página real en escritorio y en móvil, mide qué cambió y le pide
a un juez que la evalúe. Sirve para iterar el skill: dos versiones se comparan con los mismos casos.

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

Usa el navegador, `claude -p` y la comparación de capturas de [`shared`](../../shared/README.md). Llama a tu Claude
Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan: cada generación es una llamada al modelo y tres al juez.

## Uso

```bash
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro, letra más grande, menos distracciones"
uv run main.py --url https://www.wom.cl/ --gustos "Letra grande" --tarea "Dar de baja la fibra" --repeticiones 3
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro" --skill none   # línea base
uv run main.py --casos casos.json --repeticiones 2
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro" --solo-evaluar tema.css
uv run main.py --comparar <corrida_a>/resumen.json <corrida_b>/resumen.json
uv run main.py --url https://www.wom.cl/ --revision <rev>   # etapa de mejora de una revisión
```

| Opción | Qué hace |
|---|---|
| `--url`, `--gustos`, `--tarea` | La página, los gustos del usuario en texto libre y, opcional, su tarea en el sitio. |
| `--casos <casos.json>` | Varios casos en vez de `--url`: una lista de `{id, url, gustos, tarea?}` (sin `id`, el host). |
| `--skill <SKILL.md>` | El skill que guía al modelo (por defecto `WEB_DESIGNER_SKILL` o [`.claude/skills/disenar-tema/SKILL.md`](../../../.claude/skills/disenar-tema/SKILL.md)). `none`: línea base, solo el contrato de salida. |
| `--model`, `--effort` | Quién diseña (por defecto `claude-haiku-5-5`, `medium`; en `low` Haiku corta antes y se salta revisiones). |
| `--repeticiones N` | N generaciones independientes por caso, con la misma entrada, para ver la varianza. |
| `--juez-model`, `--juez-effort` | El juez (por defecto `claude-sonnet-5-5`, `medium`). |
| `--solo-evaluar <tema.css>` | No genera: sanea, aplica, mide y juzga ese CSS. |
| `--comparar A B` | Imprime la diferencia B − A entre dos `resumen.json` y termina. |
| `--output` | La carpeta de la corrida (por defecto `agents/.runs/diseno/<id o host>/<fecha-hora>/`; con `--casos`, el nombre del archivo en vez del host). |
| `--concurrencia` | Generaciones simultáneas (por defecto 3). |
| `--cdp-url` | Un navegador remoto vía CDP. |
| `--revision <rev>` | Etapa de mejora (con `--url`, sin `--gustos`): con lo que midieron en esa revisión el Catalogador, la Guía y el Visitante, genera un kit en el viewport del Visitante (tarea: el objetivo que peor resultó; gustos: `GUSTOS_MEJORA`) y escribe en `<host>/improver/<run>/` (`AGENTS_STORE`) `tema.css` saneado, `tema.json` (componentes `atajo`, `lanzador` y `buscador`, validados; el buscador no pasa por el modelo), `atajos.json`, `diagnostico.json`, `informe.json` (dirección, semilla, recetas, tokens, contraste y avisos), `vistas/{escritorio,movil}-{antes,despues}.png` (el primer pantallazo sin y con el kit completo, montado con `shared.browser.theme.describir_kit` y `extension/src/`) y `mejora.json` (con `vistas`, el contrato de `backoffice/lib/propuestas.js`). Si las capturas fallan, la corrida sigue sin `vistas` y el motivo queda en `informe.json`. Sale con 0 solo si la corrida queda `succeeded`. |
| `--tema motor\|libre` | Con `--revision`: `motor` (por defecto, o `WEB_DESIGNER_TEMA`) el modelo elige dirección de arte, semilla y ajustes y el código compone el CSS; si falla, cae al CSS libre y lo anota. `libre`: el modelo escribe el CSS. |

Para probar un tema con usuarios sintéticos, pásale su `tema.css` al [Visitante](../visitor/README.md):
`uv run main.py --task wom.cl/baja-fibra --css <ruta>/tema.css` desde `../visitor`.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: opciones, la corrida y el resumen. |
| `disenador/corrida.py` | Casos, la preparación de cada caso y el flujo de cada generación. |
| `disenador/mapa.py` | El mapa de la página que recibe el modelo. |
| `disenador/modelo.py` | El skill, el prompt, el contrato de salida y la llamada a `claude -p`. |
| `disenador/css.py` | Lectura, saneamiento, ámbito `html.mi-tema` y riesgos del CSS. |
| `disenador/pagina.py` | Abrir la página, aplicar y apagar el tema, capturar. |
| `disenador/metricas.py` | Métricas deterministas antes y después. |
| `disenador/juez.py`, `rubrica_juez.md`, `rubrica_par.md` | El juez y sus rúbricas (se afinan editando los `.md`). |
| `disenador/resumen.py` | `resumen.json`, `reporte.md` y `--comparar`. |
| `disenador/config.py` | Modelos, viewports, rutas y umbrales. |
| `disenador/mejora.py` | La etapa de mejora de una revisión (`--revision`): resumen de lo medido y corrida en el almacén. |
| `disenador/atajos.py` | El atajo (rutas verificadas que terminan en un deep link), el lanzador (objetivos del catálogo) y el buscador (hasta 40 objetivos con enlace del sitio), sin modelo. |
| `disenador/tema_json.py` | Arma el `tema.json` con la microcopia del modelo y lo valida contra su esquema. |
| `disenador/motor/` | Motor de direcciones de arte: `componer(rasgos_del_sitio(host, mapa), direccion, semilla, ajustes)` da `tema.css` (elegancia + tokens + kit + estructura del sitio + recetas, saneado) con la paleta verificada AA; direcciones, recetas y sitios conocidos son archivos de datos. |

`disenador/motor/sitios/metro/` (`sitio.json`, `estructura.css` y sus variantes) es CSS y selectores **escritos a
mano**, de ejemplo de lo que el diagnóstico deberá medir (zonas, categorías, variantes); no sale de ninguna medición.
Un sitio nuevo, sin carpeta, recibe solo elegancia, kit, tokens (con la marca del mapa) y las recetas que no piden zonas.

Por cada caso:

1. **Mapa.** Abre la página en Chromium a 1280x800 y arma el mapa: landmarks, encabezados, contenedores grandes
   (etiqueta, id, clases estables, rol, caja), colores y letra calculados de los nodos clave, botones con fondo propio
   y colores de los enlaces (el color de marca), hasta 40 variables CSS del sitio declaradas en `:root`/`html`/`body`,
   conteos y esquema de color. Los ids y clases que parecen generados, o que necesitarían escaparse, no van. Saca
   también la captura. Mapa y captura son los mismos para todas las repeticiones.
2. **Generación.** `claude -p` sin herramientas, sin MCP, sin skills ni configuración del usuario, en una carpeta
   vacía, con salida estructurada `{css, resumen, decisiones}`. El prompt de sistema es el cuerpo del `SKILL.md` (sin
   el frontmatter) más el contrato de salida de `modelo.py`; el mensaje lleva gustos, tarea, URL, mapa y captura.
3. **Saneamiento**, sobre el texto ya decodificado del JSON. Las cadenas se leen como en CSS: un salto de línea
   (o CR o FF) sin escapar la termina rota, así que las reglas se cortan donde las cortaría el navegador. Se revisa
   cada texto que se vuelve a escribir (selectores, declaraciones y preludios de at-reglas) y se descarta el que tenga
   `url(`, `src(`, `image(`/`image-set(`, `expression(`, `javascript:`, `behavior:`, `-moz-binding`, `@import`, una
   barra invertida, una cadena rota o de más de 200 caracteres (el texto de `content:`), una llave o un comentario
   fuera de una cadena, o paréntesis o corchetes desbalanceados: una declaración sola, una regla entera si es el
   selector. Solo pasan las at-reglas `@media`, `@supports`, `@container` y `@keyframes` con nombre `mt-*`;
   `@layer`, `@font-face`, `@import`, `@namespace`, `@page`, `@property`, `@scope` y las demás se descartan
   (`@layer` y los nombres de `@keyframes` son globales: seguirían actuando con el tema apagado). Un selector que no empieza por
   `html.mi-tema` se corrige anteponiéndolo (`body` → `html.mi-tema body`, `:root`/`html` → `html.mi-tema`) y cuenta
   como violación; una regla anidada debe empezar por `&` o no usarlo (`:not(&) b` saldría del ámbito y se descarta).
   Nada más se reescribe: `!important` se conserva, porque el tema se inyecta como hoja de autor, igual que hoy en la
   extensión, y lo necesita para ganarle al sitio. `tema.css` es el CSS saneado.

   Después, **el navegador tiene la última palabra**: Chromium lee el CSS saneado en un documento inerte (sin red) y
   se recorren sus reglas, entrando en las agrupadoras y anidadas. Si alguna es de un tipo no permitido, tiene un
   selector de primer nivel que no empieza por `html.mi-tema` (o uno anidado que no empieza por `&`) o carga recursos,
   el tema **no se aplica**: la generación queda con error `TemaRechazado`, `metricas.json` lleva las
   `violaciones` que vio el navegador y el CSS queda en `tema-rechazado.css`, nunca en `tema.css`.
4. **Aplicación y métricas**, en escritorio (1280x800) y en móvil (390x844): carga la página, la captura y la mide,
   espera lo mismo que esperará con el tema y la mide otra vez sin tocarla (el ruido: lo que la página pierde sola),
   agrega la clase `mi-tema` y un `<style>` con el tema (con la CSP desactivada, como `scripting.insertCSS` de la
   extensión), espera, captura y mide otra vez en la misma página. Luego quita la clase y compara la captura con la
   original (la del inicio o la de la página sin el `<style>` en ese momento, la más parecida: así un widget que el
   sitio carga tarde no cuenta como efecto del tema).
5. **Juez**, con `--juez-model`: una llamada puntúa de 1 a 5, con una razón, `estetica`, `ajuste_a_gustos`,
   `legibilidad`, `jerarquia_y_foco_en_tarea` e `integridad` viendo antes y después en escritorio y después en
   móvil, y da `veredicto` (`mejor`, `igual`, `peor`) y `principal_problema`. Otras dos llamadas comparan de a pares
   antes y después en escritorio sin decir cuál es el tema, una vez con la original como A y otra como B: los jueces
   visuales son más confiables comparando que puntuando, pero tienen sesgo de posición, así que se informa qué eligió
   cada orden y si coinciden (`consistente`). Estética, legibilidad y jerarquía son las dimensiones más confiables;
   `ajuste_a_gustos` e `integridad` quedan marcadas con confianza baja. Cada llamada se reintenta una vez.

### Métricas (`metricas.json`)

Por viewport, antes, ruido y después: enlaces, botones y campos visibles; **perdidos** (interactivos visibles antes
que después no lo están, con su texto: salieron del DOM sin un reemplazo igual, dejaron de ser visibles, su texto
quedó transparente, o su centro, si está en el viewport, quedó bajo otro elemento que antes no lo tapaba);
**ocultos** (de los primeros 4000 elementos visibles, cuántos dejan de estarlo o quedan con su texto transparente).
Lo que se pierde ya en la medida de ruido (carruseles, re-renders, banners) no se le cuenta al tema y se informa
aparte (`perdidos_ruido`, `ocultos_ruido`);
**contraste** (proporción de textos bajo WCAG AA, inciertos y los seis peores); letra mínima y mediana; desborde
horizontal; elementos `fixed`/`sticky`; y **sin mi-tema**: diferencia de píxeles entre la página con la clase quitada
y la original, comparada con lo que la página cambia sola entre dos capturas (`identica` si no pasa de ese ruido más
0,5 %). Del CSS: bytes, reglas, selectores, declaraciones, `!important`, `filter`, `backdrop-filter`, selectores
universales, transiciones de propiedades de layout (o de `all`), `position: fixed`, reglas que ocultan, las
violaciones de ámbito y los rechazos del saneamiento.

Aproximaciones del contraste: muestrea hasta 600 elementos con texto propio visibles en toda la página. El fondo se
calcula subiendo por los ancestros y componiendo sus `background-color` con alfa hasta uno opaco (o el lienzo
blanco). Los colores pasan a sRGB con un canvas, así que sirve `oklch()`. Se aplican `invert`, `brightness` y
`contrast` de los ancestros; una muestra queda **incierta** si un ancestro tiene imagen de fondo o degradado, u otro
filtro. No se considera la `opacity` de los ancestros ni las sombras de texto. "Visible" es caja de más de 1x1 px,
`checkVisibility` con opacidad y visibilidad, opacidad efectiva (con la de los ancestros) mayor que 0,05, sin un
`clip-path` (`inset`, `circle`, `ellipse`) o un `clip` que lo recorte entero, y no estar fuera del documento: un
elemento recortado por un ancestro con `overflow: hidden` cuenta como visible. La prueba de "tapado" usa
`elementFromPoint` en el centro, así que solo vale para lo que está en el viewport.

## Salida

```
agents/.runs/diseno/<id o host>/<fecha-hora>/
├── rep-01/             con --casos: <caso>/rep-01/
│   ├── antes.png, despues.png, antes-movil.png, despues-movil.png
│   ├── sin-mi-tema.png / sin-mi-tema-movil.png   solo si al quitar la clase la página no vuelve a ser la original
│   ├── mapa.json       lo que recibió el modelo
│   ├── respuesta.json  la respuesta tal cual (css sin sanear, resumen, decisiones), tokens, costo y segundos
│   ├── tema.css        el CSS saneado, el que se aplicó (tema-rechazado.css si el navegador lo rechazó)
│   ├── metricas.json   por viewport, del CSS y la fila para el resumen
│   ├── juicio.json     puntajes, veredicto, problema y la comparación de a pares
│   └── claude_code.log
├── resumen.json        configuración (skill con sha256, modelos), una fila por generación y promedios global y por caso
└── reporte.md          las mismas tablas, con enlaces a las capturas
```

Una generación que falla queda en el resumen con `error` y no detiene las demás; si falla solo el juez, con
`error_juez`. Una llamada a `claude` que no responde en `TIMEOUT_MODELO_S` (240 s, en `disenador/config.py`) se
mata y cuenta como error (el juez la reintenta una vez). Un tema que el navegador rechaza queda con
`error: TemaRechazado ...`, sin capturas, con sus `violaciones` en `metricas.json` y el CSS en `tema-rechazado.css`. El backoffice no lee estas
carpetas: no tienen `route_tree.json`.

## Iterar un skill

1. Arma un `casos.json` con 3 a 6 sitios distintos y gustos variados (oscuro, letra grande, menos ruido, alto
   contraste), con tarea en algunos.
2. Corre la línea base y el skill con las mismas repeticiones (3 alcanza para ver la varianza):
   `--skill none --repeticiones 3` y `--repeticiones 3`.
3. `uv run main.py --comparar <base>/resumen.json <skill>/resumen.json`. Mira primero lo determinista (perdidos,
   contraste después, violaciones, rechazos, sin mi-tema idéntica) y luego el juez: estética, legibilidad, jerarquía
   y la preferencia de a pares consistente. Una diferencia en el promedio del juez menor que su desvío entre
   repeticiones (`desvio_promedio_juez`) es ruido.
4. Abre `despues.png` de las peores generaciones y lee `principal_problema` en `reporte.md`: ahí sale qué regla
   agregar o corregir en el skill. Cambia el skill y vuelve al paso 2 contra la corrida anterior.

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude ni salen a internet: saneamiento y ámbito, riesgos, el mapa y las métricas sobre una página local,
y una corrida completa con un modelo y un juez guionizados (incluidos `--solo-evaluar`, un caso que no carga, un juez
que falla y `--comparar`).
