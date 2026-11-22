# web_designer

El **Diseñador** escribe el tema de una página al final de su
[revisión](../../../docs/arquitectura.md#el-ciclo-de-una-revisión). Con lo que midieron en esa revisión el
[Catalogador](../cataloger/README.md), la [Guía](../guide/README.md) y el [Visitante](../visitor/README.md), deja un
`tema.css` y un `tema.json` que la [extensión](../../../extension/README.md) aplica. El modelo no escribe CSS: elige
una dirección de arte y escribe los textos de los componentes. El código deriva los componentes de lo medido, compone
el CSS con recetas, verifica el contraste AA y lo sanea como lo haría la extensión.

**Nombres.** Es una sola pieza: la carpeta `web_designer`, el paquete `disenador`, la etapa `improver` (y su carpeta
en el almacén; en el código, la «mejora»: `mejora.py`, `mejora.json`) y **Diseñador** en los documentos y el
backoffice ([glosario](../../../docs/glosario.md)).

La app trae además el [banco del skill](#banco-del-skill): el modelo escribe CSS libre y un juez lo puntúa. Sirve
para afinar el skill y las rúbricas; no corre en una revisión.

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

Usa el navegador, el motor de Claude y la comparación de capturas de [`shared`](../../shared/README.md). Por defecto
llama a tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan: una revisión
es una llamada al modelo (dos si el motor falla y se pide el CSS libre); en el banco, cada generación es una llamada al
modelo y tres al juez. Con `AGENTS_ENGINE=bedrock` va por Bedrock, como en AWS.

## En una revisión

### Uso

```bash
just local revision https://www.wom.cl/                      # desde la raíz: la revisión completa, con el conductor
uv run main.py --url https://www.wom.cl/ --revision <rev>    # solo esta etapa, con las corridas de <rev> ya en el almacén
just aws improve https://www.wom.cl/                         # desde la raíz: de nuevo solo esta etapa, en AgentCore
```

El [conductor](../conductor/README.md) corre esta etapa como `uv run --locked main.py --url <url> --revision <rev>`
(lo arma `shared.stages`), localmente o en el runtime. `just local revision` deja además una copia del `tema.css` en
`local/.state/local/<rev>/`. `just aws improve` vuelve a correr solo esta etapa sobre revisiones ya `done`
([infra](../../../infra/README.md)).

| Opción | Qué hace |
|---|---|
| `--url`, `--revision <rev>` | La página y la revisión cuyas corridas se leen. No va con `--gustos`, `--casos` ni `--solo-evaluar`. |
| `--tema motor\|libre` | `motor` (por defecto, o `WEB_DESIGNER_TEMA`): el modelo elige dirección de arte, semilla y ajustes y el código compone el CSS; si la composición falla, cae al CSS libre y lo anota. `libre`: el modelo escribe el CSS. |
| `--skill`, `--model`, `--effort`, `--cdp-url` | Como en el [banco](#banco-del-skill). Con `AGENTS_ENGINE=bedrock` diseña el modelo fuerte (`AGENTS_MODEL_FUERTE`, Sonnet 5.5 en el runtime), salvo que `--model` ya sea un modelo de Bedrock. |

Termina `succeeded` con un `tema.css` no vacío; si no, `failed`. Sale con 0 solo si la corrida queda `succeeded`.

### Qué hace

1. **Lee la revisión.** Del almacén, solo las corridas de esa `revision` que ya terminaron (el conductor la puede
   lanzar con objetivos en curso): el catálogo (`goals.json`), la ruta de escritorio de cada objetivo (`route.json`)
   y la tanda del Visitante (`comparison.json` y `<perfil>/run.json`). Resume cada objetivo: la ruta y lo que la Guía
   tuvo que sacar del camino (un modal, las cookies), y por intento si llegó, dónde se desvió o se detuvo y qué dijo.
   La tarea es el objetivo que peor resultó (la menor tasa de llegada); los gustos son fijos (`GUSTOS_MEJORA`).
2. **Mide la página.** La abre en el escritorio de la Guía y el Visitante (1024x768) y saca el mapa y una captura
   (como en el banco), las zonas, rasgos e identidad del sitio (`zonas.medir`), los `<select>` y la voz del sitio:
   títulos de sección, menú, botones y etiquetas.
3. **Deriva los componentes, sin modelo** (`atajos.py`). Todos los enlaces son rutas relativas del mismo sitio.
   - `atajo`: una ruta verificada de la Guía que solo elige opciones y termina en una URL con consulta (el deep link)
     se vuelve un formulario corto, con las opciones copiadas de los `<select>` de la página.
   - `lanzador`: hasta 8 objetivos del catálogo con su enlace, primero los de ruta verificada y los que menos
     lograron los Visitantes, sin lo que la página ya enlaza en su primer pantallazo.
   - `buscador`: hasta 40 objetivos con enlace, en una paleta para saltar a cualquier tarea del sitio.
4. **Pide al modelo, una vez.** Prompt de sistema: el cuerpo del
   [`SKILL.md`](../../../.claude/skills/disenar-tema/SKILL.md) más el contrato del motor y el del kit (`modelo.py`).
   Mensaje: URL, gustos, tarea, mapa, captura, el resumen y el diagnóstico (`diagnostico.json`). Responde `direccion`,
   `semilla`, `ajustes` y `motivo` y, por componente, los textos en español e inglés, las etiquetas de los campos, los
   títulos de las tareas y el ancla (`contenedor`).
5. **Revisa textos y lugar.** `voz.verificar` devuelve al texto del sitio, o al título derivado del objetivo, lo que
   es un cliché («Accesos rápidos», preguntas a la persona) o no comparte palabras con la página ni con el catálogo.
   El ancla es la primera que existe y no deja el componente sobre la cabecera: la del modelo, la derivada o una de
   respaldo (`main` y otras). Por cada atajo busca el bloque original que reemplaza, para ocultarlo.
6. **Compone el CSS** con el [motor](#el-motor). Si la composición falla (un pedido imposible, un par de colores que
   no llega a AA), pide al modelo el CSS libre y lo anota en `informe.json` (`respaldo`).
7. **Verifica y escribe.** Sanea el CSS (`css.py`) y Chromium lo vuelve a leer: si ve una regla no permitida, la
   corrida falla (`TemaRechazado`). Arma `tema.json` con las vistas que validan (`tema_json.py`). Captura el primer
   pantallazo sin y con el kit completo, en escritorio y móvil, montado con `shared.browser.theme.describir_kit` y
   `extension/src/`; si las capturas fallan o pasan de 120 s, la corrida sigue sin ellas y el motivo queda en
   `informe.json`.

### El motor

`motor.componer(sitio, direccion, semilla, ajustes, vistas, ocultar)` da el `tema.css`: `base/elegancia.css` (capa
base) + los tokens `--mt-*` + `base/kit.css` (atajo y lanzador) + la estructura del sitio y sus variantes + las
recetas + las reglas que ocultan los bloques reemplazados, saneado con `css.sanear`. Direcciones, recetas y sitios son
archivos de datos.

**Direcciones** (`motor/direcciones/<id>.json`): rangos de neutros, tinta, acento, tipo, forma y densidad; recetas
fijas y opcionales con su probabilidad; y la afinidad con los rasgos del sitio.

| Dirección | Modo | Idea |
|---|---|---|
| `A` Señalética viva | oscuro | Fondo noche, letreros condensados y las categorías como sistema. |
| `B` Expresivo / bento | claro | La marca como superficie, formas grandes y las categorías en baldosas de color suave. |
| `C` Nocturno / vidrio | oscuro | El video como atmósfera, vidrio y un hilo con la luz de las categorías. |
| `D` Nativa | claro, u oscuro si el sitio lo es | El mismo sitio refinado: parte de su paleta, su letra y su radio medidos. |

El contrato le pide al modelo `auto`, salvo una razón fuerte: sale Nativa con probabilidad `fidelidad` (0,8 por
omisión) y si no, A, B o C según los rasgos del sitio. La semilla del modelo se mezcla con la de la página (revisión
y URL): el tema es reproducible y distinto por página. La semilla elige un punto en cada rango; un ajuste numérico
del modelo fija un valor, recortado al rango de la dirección. La paleta se arma en OKLCH y se verifica AA: si un par
no llega, se mueve L hasta que cumpla.

**Recetas** (`motor/recetas/*.css`, con sus reglas en `recetas.json`): bloques que solo leen tokens, como `vidrio`,
`bento-lanzador` o `cabecera-editorial`. Las de un mismo grupo (`atajo`, `lanzador`) se excluyen; algunas piden un
modo, una familia de letra, categorías o zonas del sitio. La que no calza queda fuera con un aviso en `informe.json`.
Nativa prohíbe las que le quitarían la identidad al sitio.

**El sitio** (`motor/sitio.py`):

- **Con carpeta** (`motor/sitios/<id>/`, con el id del host: `www.metro.cl` → `metro`): `sitio.json` (rasgos, marca,
  categorías, zonas, ids de vista y variantes), `estructura.css` y las variantes `hero-*`, `disposicion-*` y `orden-*`
  que el modelo elige con `ajustes`. Está **escrita a mano**, no sale de ninguna medición, y tiene prioridad: de la
  página solo se toma la identidad. Hoy la única es `metro/`.
- **Sin carpeta**: lo que mide `zonas.medir` en la página. Zonas (`cabecera`, `nav`, `nav_enlace`,
  `titulos_seccion`, `tarjetas`, `pie`, `logo`) con selectores estables verificados en la página; lo dudoso se
  descarta y queda en `descartes`. Rasgos (`institucional`, `comercio`, `categorias_color`, `video_hero`,
  `tarea_formulario`) por señales simples: dominio y palabras de institución, precios y carro, video o imagen grande
  arriba, campos de un formulario, colores repetidos entre hermanos. Además el color de marca, las categorías (o tonos
  derivados de la marca) y la identidad (fondo, tinta, letras y radio). Recibe la estructura genérica
  (`base/estructura-generica.css`, un bloque por zona medida, y en una dirección oscura `base/oscuro-generico.css`).
  Sin medida, solo el mapa: la marca y si hay formulario.

### Qué escribe

`<host>/improver/<run>/` en el almacén (`AGENTS_STORE`, por [`shared.store`](../../shared/README.md#sharedstore)),
con `revision` en el manifiesto:

| Archivo | Qué es |
|---|---|
| `manifest.json` | Estado, modelo, `revision` y, en `inputs`, las corridas que leyó. |
| `tema.css` | El CSS saneado: lo que la API entrega a la extensión. |
| `tema.json` | Las vistas `atajo`, `lanzador` y `buscador` en `features.vista`, validadas con las mismas reglas que `extension/src/background/tema-remoto.js`. |
| `atajos.json` | Los componentes derivados sin modelo y los objetivos sin atajo, con su razón. |
| `diagnostico.json` | Lo que recibió el modelo además del mapa y la captura: mensajes del Visitante, obstáculos, componentes con la voz del sitio, las tareas que debe titular y lo medido del sitio (rasgos, zonas y probabilidades de `auto`). |
| `informe.json` | La composición: modo, dirección, semilla, recetas, parámetros, tokens, contraste y avisos; la medida completa de `zonas.medir`, los bloques ocultos y los textos reemplazados (`voz`) o sin traducir. Si pasó, el respaldo al CSS libre o por qué no hay capturas. |
| `mejora.json` | El resumen usado, la tarea, lo que eligió el modelo (`pedido`, `resumen_tema`), modelo, costo, las vistas del kit y sus descartes, y `vistas` si salieron las capturas: el contrato de `backoffice/lib/propuestas.js`. Con `error` si falló. |
| `vistas/{escritorio,movil}-{antes,despues}.png` | El primer pantallazo sin y con el kit completo. |
| `claude_code.log` | La llamada al modelo. |

Para probar el tema con usuarios sintéticos, pásale la corrida al [Visitante](../visitor/README.md) desde
`../visitor`: `uv run main.py --task wom.cl/baja-fibra --tema <corrida>/tema.json` monta el kit como la extensión;
`--css <corrida>/tema.css`, solo el CSS.

## Módulos

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada: opciones; con `--revision`, la etapa; si no, el banco. |
| `disenador/mejora.py` | La etapa `improver`: lee la revisión, arma el diagnóstico, llama al modelo, compone y escribe la corrida en el almacén. |
| `disenador/atajos.py` | El atajo (rutas verificadas que terminan en un deep link), el lanzador (objetivos del catálogo) y el buscador (hasta 40 objetivos con enlace del sitio), sin modelo. |
| `disenador/voz.py` | La voz del sitio en el kit: los textos de la página para cada componente, clichés prohibidos y anclaje léxico; lo reemplazado queda en `informe.json` (`voz`). |
| `disenador/zonas.py` | Mide en la página lo que el motor necesita de un sitio sin carpeta: zonas, rasgos, marca, categorías e identidad. |
| `disenador/motor/` | El motor: `componer.py` compone y verifica, `sitio.py` arma el sitio (carpeta o medida), `paleta.py` y `color.py` la paleta y el contraste AA en OKLCH, `azar.py` el azar reproducible por semilla; `direcciones/`, `recetas/`, `base/` y `sitios/` son datos. |
| `disenador/tema_json.py` | Arma el `tema.json` con la microcopia del modelo y lo valida contra su esquema. |
| `disenador/mapa.py` | El mapa de la página que recibe el modelo. |
| `disenador/modelo.py` | El skill, el prompt, los contratos de salida (CSS libre, kit y motor) y la llamada al modelo. |
| `disenador/css.py` | Lectura, saneamiento, ámbito `html.mi-tema` y riesgos del CSS. |
| `disenador/pagina.py` | Abrir la página, aplicar y apagar el tema, capturar y verificar el CSS en Chromium. |
| `disenador/config.py` | Modelos, viewports, rutas, umbrales y el modo del tema. |
| `disenador/corrida.py` | Banco: casos, la preparación de cada caso y el flujo de cada generación. |
| `disenador/metricas.py` | Banco: métricas deterministas antes y después. |
| `disenador/juez.py`, `rubrica_juez.md`, `rubrica_par.md` | Banco: el juez y sus rúbricas (se afinan editando los `.md`). |
| `disenador/resumen.py` | Banco: `resumen.json`, `reporte.md` y `--comparar`. |

## Banco del skill

**No es lo que corre en una revisión.** Es la herramienta para iterar el
[`SKILL.md`](../../../.claude/skills/disenar-tema/SKILL.md) y las rúbricas del juez con corridas reales. Dada una URL y
los gustos de un usuario (y, si la hay, su tarea en el sitio), le pide al modelo un tema guiado por el skill: una hoja
CSS libre con todas sus reglas bajo `html.mi-tema`. Después la sanea como lo haría la extensión, la aplica sobre la
página real en escritorio y en móvil, mide qué cambió y le pide a un juez que la evalúe. Dos versiones del skill se
comparan con los mismos casos.

### Uso

```bash
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro, letra más grande, menos distracciones"
uv run main.py --url https://www.wom.cl/ --gustos "Letra grande" --tarea "Dar de baja la fibra" --repeticiones 3
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro" --skill none   # línea base
uv run main.py --casos casos.json --repeticiones 2
uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro" --solo-evaluar tema.css
uv run main.py --comparar <corrida_a>/resumen.json <corrida_b>/resumen.json
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

### Cómo funciona

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

   El saneamiento y la verificación del navegador son los mismos que usa la etapa de una revisión.
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

### Salida

El banco no escribe en el almacén: arma su propia carpeta (`config.RUNS_DIR`), sin `shared.store` ni manifiesto.

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

Para probar un `tema.css` del banco con usuarios sintéticos: `uv run main.py --task wom.cl/baja-fibra --css <ruta>/tema.css`
desde `../visitor`.

### Iterar un skill

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

No llaman a Claude ni salen a internet. De la etapa: el resumen de una revisión y la corrida de improver en el
almacén, el kit derivado con datos reales de metro.cl y una corrida `--revision` con el modelo guionizado, la voz del
sitio, el motor (semillas, sitio sin carpeta, ajustes, recetas incompatibles), las zonas medidas sobre HTML local y el
contrato del `tema.json` con `sanearTema` de la extensión (con `node`; sin él, se salta). Del banco: saneamiento y
ámbito, riesgos, el mapa y las métricas sobre una página local, y una corrida completa con un modelo y un juez
guionizados (incluidos `--solo-evaluar`, un caso que no carga, un juez que falla y `--comparar`). Las dos: el CSS
saneado leído por Chromium.
