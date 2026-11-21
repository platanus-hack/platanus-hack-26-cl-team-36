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
  página o deshacerse en el siguiente render (`docs/agents/niveles-de-cambio.md`, niveles 0–2). El énfasis de la tarea
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
