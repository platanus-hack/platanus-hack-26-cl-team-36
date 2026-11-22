# disenar-tema · referencia para el equipo

Este archivo es para personas y sesiones de Claude Code del equipo. **`SKILL.md` no depende de él**: el diseñador
(`agents/app/web_designer`) solo pone el cuerpo de `SKILL.md` en el prompt de sistema de Haiku, sin herramientas, así
que todo lo que el modelo necesita tiene que estar ahí.

## Por qué la skill es así

- **Escrita para Haiku 5.5.** Pasos numerados, límites con números, tablas de decisión, salida JSON fija, un ejemplo
  bueno y uno malo, y una lista de revisión al final. Lo que basta para Opus no basta para Haiku (guía de autoría de
  skills de Anthropic). No se le pide escribir su razonamiento: en Haiku 5.5 eso puede terminar en una negativa
  `reasoning_extraction`; `decisiones` son frases cortas, no razonamiento.
- **Paletas con contraste ya medido.** Haiku no calcula contraste de forma fiable; por eso la skill le da cinco paletas
  en hex con contraste WCAG medido (texto ≥ 11:1, texto-2 ≥ 6,3:1, acento ≥ 4,9:1 sobre los tres fondos de su
  paleta) y acentos intercambiables que mantienen ≥ 4,5:1. Si se cambia un color, volver a medirlo (fórmula WCAG 2.x).
  `--mt-borde` es decorativo (< 3:1); los bordes de controles usan `--mt-texto-2`.
- **`!important` siempre.** La extensión (`scripting.insertCSS` sin `origin`) y el evaluador (`<style id="mt-tema-css">`)
  inyectan como hoja del autor, después de las del sitio: sin `!important` el tema pierde contra la especificidad del
  sitio. Si algún día se inyecta con `origin: "USER"`, `!important` sigue siendo necesario (en origen de usuario una
  declaración normal pierde contra cualquier regla del sitio) y además gana al `!important` del sitio.
- **`px` y no `rem`.** Varios sitios ponen `html { font-size: 62.5% }`; `1.125rem` saldría en 11 px. El zoom de página
  del navegador escala `px` igual; se pierde solo el ajuste "solo texto".
- **Variables del sitio primero.** Es la palanca más barata y robusta (el tema de YouTube lo hace con `--yt-spec-*`;
  Catppuccin lo exige en sus revisiones).
- **Modo oscuro como Dark Reader** (`src/inject/dynamic-theme/modify-colors.ts`): fondos a luminosidad baja, textos
  altos, neutros teñidos con el tono del tema, azules aclarados, fotos sin tocar. La "regla de pareja" de la receta
  evita el fallo típico: texto aclarado sobre un contenedor que siguió blanco.
- **Acento de marca con `oklch`.** Conservar el tono de la marca del sitio con luminosidad fija (0,76 en oscuro, 0,45 en
  claro) da contraste ≥ 5:1 contra los fondos de las paletas y con su `acento-texto` (medido para los 8 tonos de la tabla, con recorte a sRGB) sin que Haiku tenga que calcular nada. Firefox soporta `oklch()` desde
  la versión 113.
- **No mover nodos.** `display`, `position`, `order` y anchos sobre nodos de un framework (React, Vue) pueden romper la
  página o deshacerse en el siguiente render. El énfasis de la tarea
  se hace con color, peso, tamaño y relleno, sin cambiar el lugar.
- **No ocultar alternativas.** Los menús adaptativos que escondían opciones fracasaron (Office 2000); la tarea se
  facilita resaltando la acción y el camino (olor de información), atenuando lo secundario.

## Cómo se mide

El diseñador aplica el CSS en Playwright a 1280×800 y 390×844 y mide, entre otras cosas: % de textos con contraste
≥ 4,5:1 (muestra de nodos de texto), elementos visibles que el tema oculta, desborde horizontal, y si la página sin
la clase `mi-tema` queda idéntica a la original (alcance). Un juez (Sonnet) compara capturas por pares con rúbrica.
La lista "Antes de responder" de `SKILL.md` está alineada con esas métricas. Los umbrales viven en
`agents/app/web_designer/disenador/config.py`.

Para cambiar la skill: medir antes y después con las mismas páginas y gustos, varias corridas por condición, y leer
las salidas de Haiku donde falla. Cambiar una cosa a la vez.

## Tensiones entre fuentes y cómo se resolvieron

| Tensión | Decisión |
|---|---|
| `frontend-design` de Anthropic pide fuentes con personalidad y evitar las del sistema | Manda el sanitizador (sin `url(` ni `@import`): pilas del sistema; la personalidad sale de peso, tamaño y medida. |
| Investigación: cuerpo ≥ 16 px; encargo: mínimo 14 px | Cuerpo ≥ 16 px por defecto; 14–15 px solo con el gusto "compacto"; nada < 12 px. |
| Investigación recomienda `rem` (regla S) | `px`, por los sitios con tamaño raíz reducido (ver arriba). |
| Esqueleto de R2 sugiere variables en `:root` | Todo bajo `html.mi-tema`, o el tema no se apaga con el botón. |
| Guía de Haiku: 100–150 líneas; encargo: ≤ 300 | ~260 líneas: el modelo no puede abrir archivos, así que paletas, recetas y ejemplos van dentro. |
| Investigación propone `oklch()` para toda la paleta | Paletas en hex (contraste medido); `oklch` solo para el acento de marca. |
| Receta genérica de texto (`span`, `p`…) vs botones con texto propio | Los botones se repintan en la receta oscura y la acción principal fuerza `color: inherit` en sus hijos. |

## Fuentes

- Anthropic, buenas prácticas de skills: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Anthropic, prompting de Haiku 5.5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5
- Anthropic `frontend-design`: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Vercel Web Interface Guidelines: https://github.com/vercel-labs/web-interface-guidelines
- Catppuccin userstyles (contribución): https://github.com/catppuccin/userstyles
- Dark Reader: https://github.com/darkreader/darkreader/blob/main/src/inject/dynamic-theme/modify-colors.ts
- Impeccable: https://github.com/pbakaus/impeccable · ui-ux-pro-max: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ · pilas de fuentes: https://modernfontstacks.com
- MDN cascada: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction
- MLLM as a UI Judge: https://arxiv.org/abs/2510.08783 · UICrit: https://arxiv.org/abs/2407.08850

## Resultados de la iteración con Haiku (2026-11-21)

Diseñador `agents/app/web_designer` con Haiku 5.5 (esfuerzo medium) y juez Sonnet 5.5, sobre
`agents/app/web_designer/casos/iteracion.json`: cinco sitios y gustos distintos, todos con tarea (Wikipedia oscuro +
letra grande; Hacker News claro suave + más aire; Metro alto contraste + letra grande, tarea horario y tarifa del
sábado; SERNAC menos ruido, tarea retracto; MDN editorial y colorido). Tres generaciones por caso y versión (15 por
fila). Las corridas quedan en `agents/.runs/diseno/iteracion/` (no versionadas).

| Versión | Juez 1–5 (± desvío) | E/A/L/J/I | Veredicto «mejor» | Par prefiere el tema | Contraste AA falla, escritorio / móvil | Interactivos perdidos | Violaciones | Sin mi-tema idéntica |
|---|---|---|---|---|---|---|---|---|
| sin skill | 3,24 ± 0,55 | 3,1/3,9/3,5/2,8/3,0 | 60 % | 100 % | 22,3 % / 22,2 % | 19 | 0 | 73 % |
| v1 | 2,84 ± 0,64 | 2,9/2,7/3,0/2,4/3,2 | 40 % | 93 % | 13,2 % / 18,6 % | 6 | 0 | 60 % |
| v2 | 3,19 ± 0,76 (3,56 sin los 4 temas vacíos) | 2,9/2,9/3,5/2,7/3,9 | 47 % | 73 % | 3,7 % / 4,0 % | 6 | 0 | 60 % |
| v3 | 3,37 ± 0,51 | 3,2/3,5/3,9/2,8/3,5 | 80 % | 93 % | 1,5 % / 1,7 % | 11 | 0 | 60 % |
| v4 | 3,40 ± 0,63 | 3,3/3,7/3,7/2,8/3,5 | 73 % | 93 % | 1,7 % / 1,9 % | 6 | 0 | 73 % |
| v5 | 3,36 ± 0,51 | 3,2/3,3/3,7/2,9/3,7 | 60 % | 100 % | 1,7 % / 1,9 % | 6 | 0 | 67 % |
| v6 (final; solo Metro y Wikipedia, 6 generaciones) | 3,07 en esos dos casos (v5: 3,03) | — | 33 % | 100 % | 4,4 % / 4,9 % | 1 | 0 | 50 % |

E/A/L/J/I: estética, ajuste a gustos, legibilidad, jerarquía y foco en la tarea, integridad. Contraste de la página
original: 18,3 % de textos bajo AA (Hacker News trae gris sobre crema). «Sin mi-tema idéntica» sale baja por ruido
de medición, no por el tema: Metro tiene un video de portada que cambia entre capturas y SERNAC carga widgets tarde
(las violaciones de ámbito fueron 0 en todas las versiones). Una diferencia de juez menor que ~0,15 entre versiones
es ruido (desvío ~0,5 con n = 15). Entre la ronda 0 y v2 cambiaron dos cosas del diseñador: el mapa ahora prioriza
las variables CSS de fondo (en Wikipedia las 40 primeras eran solo de texto) y la prueba "sin mi-tema" compara
también con la página sin el `<style>` en ese momento (widgets que cargan tarde); la línea base no se volvió a correr.

**Qué cambió y por qué**

- **v1 → v2.** v1 quedó *bajo* la línea base: era tímida (ajuste a gustos 2,7 contra 3,9) y su modo oscuro dejaba
  paneles blancos con texto claro (Wikipedia en móvil: 44 % de textos bajo AA; la versión móvil tiene otro HTML que el
  mapa de escritorio no muestra). v2: tabla de gustos con **intensidad mínima** (letra grande = 20 px, menos ruido =
  2–5 ocultos, claro suave = cabecera suavizada); receta **Repintar** que vacía los fondos de todos los contenedores
  genéricos con `:where()` (especificidad baja) y luego pinta pocas superficies; receta de tarea con tres casos
  (acción, camino desde la portada, sección del artículo); lista de qué se puede ocultar; nada de `word-break`.
  Resultado: contraste 13 % → 4 %, Wikipedia completa en oscuro. Pero 4 de 15 temas salieron **vacíos**: Haiku copió
  el ejemplo, que mostraba el CSS como string JSON con `\n`, y escribió la barra invertida literal; el filtro borró
  todas las declaraciones.
- **v2 → v3.** Ejemplo como CSS crudo y regla explícita "ninguna barra invertida, tampoco un `\n` escrito" (0 temas
  vacíos desde entonces). Repintar solo cuando el fondo cambia de claro a oscuro (o al revés); receta **Reforzar** para
  alto contraste sobre un sitio claro (en Metro, Repintar con paleta clara dejó un hueco blanco sobre el video). El
  primer elemento del camino de la tarea lleva el estilo de acción principal. "Colorido" admite tres acentos.
- **v3 → v4.** El camino de la tarea se marca sin mover nada (`box-shadow: inset 0 -3px 0`, peso y color): en SERNAC
  el relleno nuevo hizo saltar de línea el menú de la cabecera fija y tapó la página. En la cabecera, la navegación y
  lo `fixed`/`sticky`, solo color y peso. Un enlace que se repite en cada ítem de una lista ("comentarios") va solo con
  color: con fondo y barra llenaba Hacker News de ruido (HN 4,0 → 4,47).
- **v4 → v5.** Fondos nuevos solo en contenedores del mapa de ≤ 600×400 px, nunca en columnas, rejillas ni el
  contenedor de una foto (Metro: hero partido). Enlaces sobre barras o botones de color conservan su color (SERNAC:
  "Contacto" azul sobre azul). Nunca achicar textos; `font-size` de `body` solo con "letra grande"; no agrandar letra
  en botones de ancho fijo ni widgets flotantes ("Centro de Ayu" cortado). SERNAC 2,6 → 3,07.
- **v5 → v6.** "Letra grande" también sobre `p, li, td, th, dd, dt, label, figcaption, blockquote`: en Metro el
  `font-size` de `body` no llegaba a ningún texto porque Bootstrap fija la letra en cada elemento.
- **Meseta.** Desde v3 el promedio del juez se mueve dentro del ruido (3,36–3,40); lo que sí siguió mejorando fueron
  los fallos concretos que se ven en las capturas. Lo que la skill no logra: hacer visible la tarea cuando la
  respuesta no está en la página (Metro, SERNAC: el juez siempre pide más) y ocultar widgets que cargan después del
  mapa (SERNAC "Evalúa", "Centro de Ayuda").

**Sitios reservados** (no usados al iterar; `casos/reservados.json`, 2 generaciones cada uno):

| Corrida | Juez | Veredicto «mejor» | Par prefiere el tema | Contraste AA falla, escritorio / móvil | Interactivos perdidos | Elementos ocultados |
|---|---|---|---|---|---|---|
| biobiochile.cl, sin skill | 3,70 | 2/2 | 2/2 | 10,0 % / 10,5 % | 192 | 599 |
| biobiochile.cl, v6 | 3,40 | 1/2 | 1/2 (1 cambia con el orden) | 12,0 % / 8,0 % | 8 | 87 |
| docs.python.org, sin skill | 3,70 | 2/2 | 2/2 | 6,9 % / 6,5 % | 0 | 33 |
| docs.python.org, v6 | 3,90 | 2/2 | 2/2 | 0 % / 0 % | 0 | 13 |

En total: juez 3,65 con la skill contra 3,70 sin ella (empate), con menos contraste fallido (6,0 % / 4,0 % contra
8,4 % / 8,5 %) y casi sin pérdida de contenido (4 interactivos perdidos contra 96: sin skill, Haiku oculta columnas
enteras de BioBio). Fallo que queda: en BioBio la letra mediana siguió en 16 px (casi todo son titulares enlazados) y
un titular quedó más chico que el original, porque el mapa no trae su tamaño.

**Tarea con usuarios sintéticos.** El mejor tema de Metro de v6 (`r5-v6-letra/metro/rep-03/tema.css`) en el
evaluador, `metro-tarifa-sabado`, perfiles `first_time` y `hurried`, Haiku medium: sin tema 2/2 éxitos en 3 pasos y
2 clics cada uno; con tema, lo mismo (2/2, 3 pasos, 2 clics). n = 2 por condición y la tarea es fácil (el menú
"MetroServicio → Horarios y Tarifas" es directo), así que no distingue: solo muestra que el tema no estorba.
