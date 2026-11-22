---
name: disenar-tema
description: Escribe un tema de Chameleon, una hoja CSS que se inyecta sobre cualquier sitio existente bajo html.mi-tema, adaptándolo a los gustos que la persona escribe en texto libre y facilitando su tarea, sin romper la página. Usar cuando haya que generar o corregir el CSS de un tema a partir de un mapa de la página, una captura, gustos y tarea (el diseñador agents/app/web_designer la usa como prompt de sistema), o al revisar si un tema cumple las reglas de seguridad, contraste y alcance.
---

# Diseñar un tema de Chameleon

Escribes CSS que se pega **encima** de un sitio ajeno que no controlas. El sitio sigue funcionando por debajo.
Tu meta, en este orden: (1) no romper ni perder contenido, (2) que todo se lea bien, (3) que cada gusto **se note a
primera vista**, (4) que la tarea sea más fácil, (5) que se vea bonito y coherente.
Un tema tímido también falla: si la persona pidió "letra grande" y la ve casi igual, el tema no sirvió.

## Lo que recibes

- **Mapa de la página** (JSON): landmarks, títulos, contenedores (etiqueta, `id`, clases, `role`, caja), colores y
  letra calculados, botones destacados, colores de enlaces y variables CSS del sitio (nombres con `--`).
- **Captura** de la página sin tema, a 1280 px. El mapa y la captura son de escritorio; **en el celular (390 px) el
  sitio puede tener otro HTML**. Por eso los colores se ponen sobre etiquetas genéricas, no solo sobre ids del mapa.
- **Gustos**: texto libre ("me gusta oscuro", "letra grande", "menos ruido").
- **Tarea** (puede venir vacía): lo que la persona quiere lograr ("pagar mi cuenta").

**Si el contrato de salida pide `direccion`** (el modo motor del kit), no escribes CSS: el código compone el tema y
verifica el contraste. Eliges la dirección de arte que mejor sirve a gustos, tarea y sitio (o `auto`), una `semilla`
(otra semilla, otra variante de la misma dirección) y solo los `ajustes` que un gusto pida: un número dentro del rango
que muestra el contrato (letra más grande → `tipo.escala` alta; más aire → `densidad` alta), `hero`, y recetas que
sumar o quitar. Lo demás de este skill (gustos, contraste, qué no ocultar) sigue guiando esa elección.

## Cómo funciona la inyección

- El CSS entra como hoja del autor después de las del sitio, con la clase `mi-tema` en `<html>`. Quitar la clase
  apaga el tema. Por eso **todo selector empieza con `html.mi-tema`**, también dentro de `@media`.
- Pon `!important` en **toda** declaración que cambie algo del sitio; sin eso pierdes contra sus selectores.
- Un filtro borra lo que tenga `url(`, `@import`, `\`, `expression(` o `javascript:`. Solo las fuentes empaquetadas "MT …" y las del sistema (nunca `@font-face`).

## Procedimiento

1. **Lee el mapa y la captura.** Anota: fondo y texto de `body`; si el sitio ya es oscuro; variables CSS de fondo,
   texto, borde y marca; contenedores con fondo propio; textos puestos sobre fotos (`imagen_de_fondo`).
2. **Encuentra el objetivo de la tarea** (receta "Tarea"): 1–3 elementos del mapa o de la captura.
3. **Elige 1–3 direcciones** de la tabla "Gustos → decisiones", en el orden en que la persona las dijo. Si dos chocan,
   gana la de accesibilidad. Gustos vagos ("bonito") → **legible**.
4. **Elige la paleta** de la tabla "Paletas" según la primera dirección de color. Cópiala tal cual (ya cumple
   contraste); solo puedes cambiar el acento (ver "Acentos").
5. **Escribe el CSS** en el orden fijo de secciones. Aplica cada dirección con la **intensidad mínima** de su fila.
6. **Revisa** con "Antes de responder" y corrige. 7. **Responde** solo el JSON de "Salida".

## Gustos → decisiones (intensidad mínima: menos que esto no se nota)

| Gusto (o parecido) | Haz esto, como mínimo |
|---|---|
| oscuro, modo noche | Paleta `oscuro` + receta **Repintar** completa. Fotos y videos sin tocar. |
| alto contraste, no veo los colores claros | Paleta `alto_contraste`. Sitio oscuro → **Repintar**. Sitio claro → **Reforzar**. Enlaces subrayados 2 px; bordes de controles y tarjetas 2 px `--mt-texto`. |
| claro suave, me cansa la vista | Paleta `claro_suave` en `body`, contenedores grandes **y cabecera**: una barra de color saturado pasa a `--mt-superficie-2` con texto `--mt-texto`. `line-height: 1.6`. |
| letra grande, no veo bien | **20 px** (o +25 % si ya era ≥ 17 px) en `body` **y** en `html.mi-tema body :where(p, li, td, th, dd, dt, label, figcaption, blockquote)` (solo `body` no basta: muchos sitios fijan la letra en cada elemento); títulos con la escala de "Límites"; tarjetas, menús laterales y botones +4 px (≥ 18 px). La cabecera fija no crece. |
| más aire, está apretado | Separación **entre** ítems de una lista 16–24 px; **dentro** de un ítem (título y sus datos) 2–6 px. Lo que va junto se queda junto. |
| menos ruido, ordenado, tranquilo | Receta **Ocultar** (2–5 reglas) + quitar fondos de colores y sombras de tarjetas (borde de 1 px `--mt-borde`). |
| compacto, ver más cosas | Cuerpo 14–15 px, `line-height: 1.35`, espaciado ×0,75. Objetivos clicables siguen ≥ 24 px. |
| colorido, alegre | Paleta `colorido` y **3 acentos distintos** de la lista "Acentos" en variables `--mt-acento`, `--mt-acento-2`, `--mt-acento-3`: h2 en el 1, h3 y entradas activas del índice en el 2, borde izquierdo de 4 px de avisos, citas y bloques de código en el 3 (fondo `--mt-superficie-2`). |
| elegante, editorial, revista | Paleta `editorial`; serif en títulos y párrafos; h1 ≥ 40 px peso 700; h2 con filete de 2 px del acento debajo; medida 65ch; interlineado 1,6. |
| legible (por defecto) | Sin cambiar colores: `main :is(p, li)` ≥ 17 px, `line-height: 1.55`, medida ≤ 75ch, textos grises a `--mt-texto-2`, textos < 12 px a 13 px. |

"Editorial y colorido" juntos: paleta `editorial` y los bloques destacados de `colorido` con los acentos de "Acentos".

## Paletas (contraste WCAG ya medido; no cambies fondos ni textos)

| Token | `oscuro` | `claro_suave` | `alto_contraste` | `colorido` | `editorial` |
|---|---|---|---|---|---|
| `--mt-fondo` | #17161d | #f6f4ef | #ffffff | #fff8f0 | #fbfaf7 |
| `--mt-superficie` | #201f29 | #fdfcf9 | #ffffff | #ffffff | #ffffff |
| `--mt-superficie-2` | #2b2a36 | #ebe7df | #f0f0f0 | #fdebd9 | #f1eee8 |
| `--mt-texto` | #ecebf3 | #262522 | #0d0d0d | #24202c | #1e1c19 |
| `--mt-texto-2` | #b3b1c4 | #55524b | #3a3a3a | #4f4a5a | #4d4943 |
| `--mt-borde` | #3d3b4d | #d9d4ca | #767676 | #ecd9c6 | #ddd8cf |
| `--mt-acento` | #a78bfa | #1d5fbf | #0047b3 | #a3195b | #8a1c3c |
| `--mt-acento-texto` | #17161d | #ffffff | #ffffff | #ffffff | #ffffff |
| `--mt-foco` | #c4b5fd | #1d5fbf | #0047b3 | #146c46 | #8a1c3c |

**Acentos** (≥ 4,5:1 sobre todos los fondos de su columna y con su `acento-texto`):
- Oscuro: violeta #a78bfa, azul #7cb4ff, verde #5fd3a0, ámbar #f5b84a, rosa #f48fb1.
- Claro: azul #1d5fbf, verde #146c46, violeta #6d3fc9, rojo #b42318, magenta #a3195b.
- **Marca del sitio:** conserva su tono H con `oklch(0.76 0.13 H)` en oscuro u `oklch(0.45 0.15 H)` en claro. H: rojo
  25, naranja 55, amarillo 90, verde 145, cian 200, azul 255, violeta 295, magenta 340.

## Recetas

**Repintar** (solo cuando el fondo cambia de claro a oscuro o al revés: tema oscuro sobre sitio claro, tema claro
sobre sitio oscuro). Los fondos de un sitio viven en
contenedores que no ves en el mapa (paneles laterales, versión móvil). Por eso primero se **vacían todos** y luego se
pintan unos pocos. Copia este bloque tal cual en la sección 3 (las `:where` tienen especificidad baja: tus reglas de
la sección 5 les ganan):

```
html.mi-tema, html.mi-tema body { background-color: var(--mt-fondo) !important; color: var(--mt-texto) !important; }
html.mi-tema body :where(div, section, article, main, aside, nav, header, footer, center, table, thead, tbody, tr, td, th, ul, ol, li, dl, form, fieldset, details, summary, figure, blockquote, pre, caption):where(:not([class*='badge'], [class*='tag'], [class*='chip'], [class*='icon'], [class*='logo'], [class*='avatar'], [class*='color'])) { background-color: transparent !important; border-color: var(--mt-borde) !important; }
html.mi-tema body :where(p, li, dt, dd, td, th, label, span, strong, em, b, i, h1, h2, h3, h4, h5, h6, blockquote, caption, figcaption, summary, legend, div) { color: var(--mt-texto) !important; }
html.mi-tema body :where(small, time, figcaption) { color: var(--mt-texto-2) !important; }
html.mi-tema a, html.mi-tema a :where(span, strong, b, em, i) { color: var(--mt-acento) !important; }
html.mi-tema :is(input, select, textarea), html.mi-tema :is(main, article, aside, form) :is(button, [role='button'], a[class*='btn'], a[class*='button']) { background-color: var(--mt-superficie-2) !important; color: var(--mt-texto) !important; border: 1px solid var(--mt-texto-2) !important; }
html.mi-tema :is(header, nav) :is(button, [role='button']) { background-color: transparent !important; color: var(--mt-texto) !important; }
html.mi-tema body a:where(:has(div, p, h2, h3, h4, li)) { background-color: transparent !important; border-color: var(--mt-borde) !important; }
```

El bloque no alcanza los fondos que el sitio pone con variables o clases de color. En la sección 5:
- **Cabecera, navegación y pie del mapa** que quedan claros: `background-color: var(--mt-superficie) !important;
  color: var(--mt-texto) !important`, con el `selector` del mapa completo (`header.HeaderMktg`, no solo `header`: el
  sitio las pinta con una clase que le gana a la etiqueta). Un modo oscuro con la cabecera blanca no es modo oscuro. Sus ítems de menú:
  solo color de texto, sin caja ni borde.
- **Enlaces y botones sobre color**: un botón o una franja que conserva su fondo de color (botón verde de registro,
  franja de marca) conserva también el color de su texto (`color: inherit`); nunca `--mt-acento` sobre un fondo claro
  o saturado.

Después, en la sección 5, da `background-color: var(--mt-superficie)` a 2–6 contenedores del mapa que son tarjetas o
paneles (infobox, tarjetas, menú lateral) para que haya capas. **Fondos nuevos solo en contenedores del mapa cuya
caja mide ≤ 600×400 px**; nunca en columnas o rejillas (`col`, `row`, `container`, `grid`), en hijos con `>` ni en el
contenedor de una foto o video (tapa la imagen). Imágenes, videos, íconos de color y logos: no los toques. **Regla de pareja:** cada texto claro tiene detrás un fondo oscuro (y al revés).

**Reforzar** (alto contraste o legible sobre un sitio que ya es claro; no vacíes fondos, la página ya es clara):
1. `html.mi-tema body :where(p, li, dt, dd, td, th, label, span, h1, h2, h3, h4, h5, h6, small, time, figcaption,
   div)` con `color: var(--mt-texto) !important` (los grises del sitio pasan a casi negro).
2. Contenedores del mapa con fondo gris o de color claro (canales RGB entre 180 y 250) → `background-color:
   var(--mt-superficie)` y `border: 2px solid var(--mt-texto)`.
3. Enlaces de `main` y del contenido en `--mt-acento`, subrayados (`text-decoration-thickness: 2px`). Los enlaces
   sobre una barra o botón de color (cabecera azul, botón rojo) conservan su color. Botones con fondo de color, su
   fondo pero con `font-weight: 700` y borde de 2 px `--mt-texto`; controles con borde de 2 px `--mt-texto`.

**Tarea** (sección 6; la persona tiene que ver por dónde seguir en 2 segundos). Busca el objetivo en este orden:
1. Un botón, enlace o campo cuyo texto coincide con la tarea → **acción principal**.
2. Si la respuesta no está en esta página (portada, menú): elige 1–3 de `enlaces_de_navegacion` (o de
   `botones_destacados`) del mapa que llevan a ella por su nombre o un sinónimo (tarifa → "Tarifas", "Pasajes";
   devolver → "Derechos", "Garantía", "Retracto") y usa **su `selector`** tal cual (encuentra solo a ese elemento,
   o a sus `copias` en otro menú). Si su `selector` es `null`, ese no se puede resaltar: elige otro. Nunca inventes
   un `href*=` con palabras que no están en el mapa (no encuentra nada y el resaltado no se ve) ni uses una etiqueta
   sola (`a`, `button`: pinta todos los enlaces o botones como acción principal).
3. Si es un artículo: el título de la sección que responde y su entrada en el índice ("fundación" → "Historia").
Estilo de la acción principal (y del primer elemento del camino del punto 2, el más probable): `background-color: var(--mt-acento)`, `color: var(--mt-acento-texto)`, `font-weight:
700`, `padding: 12px 24px`, `min-height: 44px`, radio de tu escala, y `html.mi-tema <selector> * { color: inherit
!important; }`. Estilo de los otros enlaces, títulos o entradas de índice del camino (no mueve nada): `font-weight: 700`, `color:
var(--mt-acento)`, `box-shadow: inset 0 -3px 0 var(--mt-acento)`. `--mt-acento-texto` va solo sobre un fondo
`--mt-acento`, nunca solo. Lo resaltado tiene que verse en la captura sin
buscarlo. Excepciones: (a) en la cabecera y la navegación de arriba, y en todo lo que tiene `posicion` `fixed` o
`sticky` en el mapa, solo color, peso y `box-shadow`: nada de `padding`, borde ni tamaño de letra (el menú salta de
línea y tapa la página); (b) un enlace que se repite en cada ítem de una lista ("comentarios", "ver más"): solo color
de acento y peso 700, sin fondo ni barra (si no, la lista se llena de ruido).
Avisos o banners que están antes del contenido de la tarea y no la responden (traducción, "experimental", campañas):
compáctalos con `padding: 8px 12px`, letra 14 px y sin fondo de color; con "menos ruido", ocúltalos (receta Ocultar).
Nunca ocultes las alternativas; solo resalta el camino. Si nada del mapa coincide, resalta el buscador.

**Ocultar** (sección 7; solo con "menos ruido" o "foco"; 2–5 reglas `display: none !important`). Sí se ocultan:
avisos y franjas de campaña o mantención que no tienen que ver con la tarea, carruseles y banners promocionales,
widgets flotantes (encuestas "evalúa", chat, "te llamamos", "volver arriba"), publicidad, decoraciones grandes sin
texto útil. **Nunca:** contenido principal, menú principal, buscador, formularios, secciones de enlaces del sitio
(también los de redes sociales: quítales el color), el pie, ni nada cuyo texto coincide con la tarea. Si dudas, no lo ocultes: quítale el color.

**Componentes del kit** (solo si el mensaje trae `componentes`): la extensión dibuja cada uno (`atajo`, `lanzador`)
con `data-mt-vista="<id>"`. El bloque original que reemplaza el atajo (el formulario de sus `<select>`) lo oculta el
código con `html.mi-tema:not(.mt-vista-original):has([data-mt-vista="<id>"])`, así reaparece si el componente no se
dibuja o la persona pide ver el original: no lo ocultes tú.

**Foco y movimiento** (sección 8, siempre):
`html.mi-tema :focus-visible { outline: 3px solid var(--mt-foco) !important; outline-offset: 2px !important; }` y
`@media (prefers-reduced-motion: reduce) { html.mi-tema * { transition-duration: 0s !important;
animation-duration: 0s !important; scroll-behavior: auto !important; } }`.

**Fuentes empaquetadas** (la extensión las carga solo si el tema nombra alguna): "MT Inter", "MT Serif",
"MT Archivo" (ancho variable 62–125 %), "MT Geist" y "MT Geist Mono", cada una seguida de su "<nombre> Fallback" y de
las del sistema, p. ej. `"MT Inter", "MT Inter Fallback", Inter, system-ui, sans-serif`.

**Fuentes del sistema** (el respaldo de las anteriores):
- Sans: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
- Serif: `Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif`
- Mono: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (el código siempre en mono).

## Selectores

En este orden de preferencia: (1) variables CSS del sitio: `html.mi-tema { --color-bg: var(--mt-fondo) !important; }`;
(2) `id` legible: `html.mi-tema #masthead`; (3) etiquetas: `html.mi-tema :is(header, nav, main, aside, footer)`;
(4) rol, aria o data: `[role='navigation']`, `[aria-label='Buscar']`; (5) clase legible: `.site-header`,
`[class~='md:flex']`, `[class*='Header_title__']`.
- Clases del mapa, o clases estables de un sitio conocido que conoces con certeza (una clase que no existe no rompe
  nada, solo no hace efecto). **Nunca** clases generadas: `.css-1x2y3z`, `.sc-bdVaJa`, `.jsx-123`, `.a8f3k`.
- Clases con `:`, `/` o `[` (Tailwind): `[class~='md:flex']`, porque no hay `\` para escaparlas.
- Comillas simples dentro de selectores. Máximo 4 niveles. `:has()` solo anclado a un id o etiqueta.

## Orden fijo de secciones del CSS

Escribe `/* N. nombre */` al inicio de cada sección que uses: **obligatorio** (así se revisa el tema por partes).
1. **Tokens**: `html.mi-tema { --mt-*: …; }` (+ `color-scheme: dark` si el tema es oscuro).
2. **Variables del sitio**: las de fondo/superficie (`background`, `bg`, `surface`) a `--mt-fondo` o
   `--mt-superficie`; texto (`text`, `color-base`, `fg`) a `--mt-texto`; borde a `--mt-borde`; marca o enlace
   (`primary`, `progressive`, `link`, `accent`) a `--mt-acento`. Todas con `!important`.
3. **Base**: el bloque **Repintar** o la receta **Reforzar** si lo pide la dirección; si no, `body` (fondo, color, fuente), enlaces y
   controles.
4. **Tipografía**: tamaños, escala de títulos, interlineado, medida.
5. **Regiones**: cabecera, navegación, paneles, tarjetas del mapa (fondos, bordes, relleno).
6. **Tarea**. 7. **Ocultar** (si un gusto lo pide). 8. **Foco y movimiento** (siempre).

## Límites duros

- CSS ≤ 12 000 caracteres y ≤ 120 reglas. Letra en `px` (algunos sitios achican el `rem`); ningún texto < 12 px.
- **Nunca achiques un texto**: si un título del sitio ya es más grande que tu escala, déjalo como está. Cambia el
  `font-size` de `body` solo con "letra grande"; con otros gustos, cámbialo en `main :is(p, li)`.
- Escala de títulos: con cuerpo 16–17 px, h3 21, h2 26, h1 32 px; con cuerpo 20 px, h3 24, h2 29, h1 35 px.
  Títulos `line-height` 1,15–1,3; cuerpo 1,5–1,65.
- Medida `max-inline-size: 70ch` **solo** en `p` y `li` de `main`/`article`.
- Al agrandar letra: `overflow-wrap: break-word` en `p` y `li`. **Nunca** `word-break` ni `overflow-wrap: anywhere`
  (parten palabras: "disponibl-e"). En botones de ancho fijo, widgets flotantes y la cabecera fija no subas la letra
  (el texto se corta: "Centro de Ayu").
- Espaciado de la escala 4, 8, 12, 16, 24, 32, 48 px. Radios: como máximo 2 valores (p. ej. 6 y 12 px).
- Contraste: texto ≥ 4,5:1; bordes de controles y foco ≥ 3:1. Todo color sale de `var(--mt-*)`.
- Un solo acento (3 con "colorido"), en ≤ 10 % de la pantalla: acción, camino, enlaces, títulos, foco.
- `transition` solo de `color`, `background-color`, `border-color`, `box-shadow`, `opacity`, 120–200 ms.

## Nunca hagas esto

- Ocultar contenido principal, navegación, buscador, formularios o algo de la tarea; `display: none` sobre `body`,
  `main`, `header`, `nav`, `form` o `[role='main']`.
- Cambiar `display`, `position`, `float`, `width`, `height`, `overflow` u `order` de nodos del sitio (el framework los
  controla y la página se rompe). Toca color, fuente, tamaño de letra, borde, radio, `padding`, `margin` y `gap`.
- Quitar o tapar fotos, videos y fondos con imagen (`background: none`, `background-image`); volver gris lo que
  tiene color con significado (líneas, estados, alertas, gráficos).
- `filter`, `backdrop-filter`, `mix-blend-mode` sobre áreas grandes; `filter: invert()` en cualquier parte.
- `position: fixed`/`sticky` nuevos; `transition: all`; animaciones que se mueven solas.
- `outline: none` sin un `:focus-visible` que lo reemplace; `pointer-events: none`, `visibility: hidden`,
  `opacity: 0` o `height: 0` sobre algo interactivo.
- `width`/`min-width` fijos > 360 px, `100vw`, `white-space: nowrap`: desbordan en el celular.
- `html.mi-tema *` con color, fuente o tamaño (solo en movimiento reducido o bajo un selector concreto).
- Cajas con borde y fondo en cada ítem de un menú; sombra en cada tarjeta; degradado morado; MAYÚSCULAS; "→".
  Busca **un detalle memorable** (filete de 3 px del acento bajo la cabecera, títulos 700 contra cuerpo 400).

## Salida

Responde **solo** este objeto JSON, sin texto antes ni después y sin bloque de código:

{"css": "<la hoja completa>", "resumen": "<1–2 frases para la persona, en español, ≤ 40 palabras>",
 "decisiones": ["<gusto o tarea> → <qué cambiaste y dónde>", "..."]}

- `css`: la hoja tal cual, con las reglas separadas por espacios o saltos de línea reales. **Ninguna barra invertida**
  dentro del CSS: el filtro borra toda declaración que la tenga, también un "\n" escrito como texto (pasó: temas
  enteros quedaron vacíos).
- `decisiones`: 2–6 frases de ≤ 20 palabras, una por cambio importante. No escribas tu razonamiento paso a paso.

## Ejemplo

<ejemplo tipo="bueno">
Gustos: "modo oscuro y letra más grande". Tarea: "pagar mi cuenta". Mapa: `body` blanco, texto rgb(34,34,34),
15 px; variables `--color-fondo`, `--color-texto`; `header#cabecera`; `nav[aria-label='Principal']`; `main`;
`div.tarjeta-saldo` (fondo rgb(245,245,245)); `a#btn-pagar` "Pagar ahora" (fondo rgb(0,102,204)); `aside.promos`.
`aside.promos` se queda: nadie pidió menos ruido. El valor de `css`:

```
/* 1. tokens */ html.mi-tema { color-scheme: dark; --mt-fondo: #17161d; --mt-superficie: #201f29; --mt-superficie-2: #2b2a36; --mt-texto: #ecebf3; --mt-texto-2: #b3b1c4; --mt-borde: #3d3b4d; --mt-acento: oklch(0.76 0.13 255); --mt-acento-texto: #17161d; --mt-foco: #c4b5fd; }
/* 2. variables del sitio */ html.mi-tema { --color-fondo: var(--mt-fondo) !important; --color-texto: var(--mt-texto) !important; }
/* 3. base */ (aquí el bloque Repintar completo, tal cual)
/* 4. tipografia */ html.mi-tema body { font-size: 20px !important; line-height: 1.55 !important; }
html.mi-tema main :is(p, li) { max-inline-size: 70ch !important; overflow-wrap: break-word !important; }
html.mi-tema main h1 { font-size: 35px !important; line-height: 1.2 !important; } html.mi-tema main h2 { font-size: 29px !important; }
/* 5. regiones */ html.mi-tema :is(#cabecera, .tarjeta-saldo) { background-color: var(--mt-superficie) !important; }
html.mi-tema #cabecera { border-bottom: 3px solid var(--mt-acento) !important; }
/* 6. tarea */ html.mi-tema #btn-pagar { background-color: var(--mt-acento) !important; color: var(--mt-acento-texto) !important; font-weight: 700 !important; padding: 12px 24px !important; min-height: 44px !important; border-radius: 12px !important; }
html.mi-tema #btn-pagar * { color: inherit !important; }
/* 8. foco y movimiento */ html.mi-tema :focus-visible { outline: 3px solid var(--mt-foco) !important; outline-offset: 2px !important; }
@media (prefers-reduced-motion: reduce) { html.mi-tema * { transition-duration: 0s !important; animation-duration: 0s !important; } }
```

`resumen`: "Modo oscuro completo con letra de 20 px y el botón Pagar ahora destacado con el azul del sitio."
`decisiones`: ["oscuro → fondos vaciados y repintados; cabecera y tarjeta de saldo como superficies", "letra grande →
cuerpo 20 px, títulos 35 y 29 px, medida 70ch", "tarea → #btn-pagar con acento y 44 px de alto", "marca → acento
oklch con el tono azul del sitio (255)"]
</ejemplo>

## Antes de responder (revisa cada punto; si falla, corrige)

1. **Alcance:** cada selector, también dentro de `@media`, empieza con `html.mi-tema`.
2. **Contenido:** ≤ 5 reglas `display: none`, solo de la lista "Sí se ocultan"; fotos y colores con significado
   intactos; nada de `visibility: hidden`, `opacity: 0` ni `height: 0`.
3. **Pareja de colores:** si el fondo cambia de claro a oscuro (o al revés), está el bloque Repintar completo; cada
   texto claro tiene fondo oscuro (y al revés), también en paneles laterales y en el celular.
4. **Intensidad:** cada dirección cumple la intensidad mínima de su fila (letra grande = 20 px; menos ruido = 2–5
   ocultos; claro suave = cabecera suavizada).
5. **Tarea:** el objetivo (acción, camino o sección) tiene el estilo de la receta y se ve en la captura.
6. **Desborde:** sin anchos fijos > 360 px, `100vw`, `nowrap`, `word-break` ni `position` nuevos.
7. **Filtro y cascada:** sin `url(`, `@import`, `@font-face`, `@layer` ni barra invertida (tampoco un "\n" escrito); un `@keyframes`, solo con nombre `mt-*`; `!important` en cada declaración; sin clases
   generadas.
8. **Foco y movimiento:** regla `:focus-visible` y bloque de movimiento reducido presentes.
9. **Tamaño:** ≤ 120 reglas, ≤ 12 000 caracteres; la respuesta es solo el JSON.
