# Skills del proyecto

Instrucciones empaquetadas para que Claude haga una tarea de diseño o exploración siempre igual. Cada carpeta tiene un
`SKILL.md` (frontmatter `name` + `description` y el cuerpo con el procedimiento) y, si hace falta, un `referencia.md`
para el equipo con el porqué y las fuentes.

| Skill | Qué hace | Quién la usa |
|---|---|---|
| [`disenar-tema`](disenar-tema/SKILL.md) | Escribe el CSS de un tema bajo `html.mi-tema` a partir del mapa de la página, una captura, los gustos y la tarea, sin romper el sitio | `agents/app/web_designer` (prompt de sistema de Haiku) y sesiones del equipo que escriben o revisan temas |
| [`explorar-caminos`](explorar-caminos/SKILL.md) | Hace que un usuario sintético recorra varios caminos hacia una tarea, retroceda y anote hallazgos | Perfiles exploradores de `agents/app/visitor` |

## Cómo se usan

- **Sesiones de Claude Code del equipo:** las descubren solas al abrir el repo (`.claude/skills/`); Claude las carga
  cuando la tarea coincide con su `description`.
- **Agentes de `agents/app/`:** no pueden abrir archivos, así que el código lee el `SKILL.md`, le quita el
  frontmatter y pone el cuerpo en el prompt. Por eso cada `SKILL.md` es autosuficiente: nunca depende de
  `referencia.md` ni de otros archivos.
- Están escritas para **Claude Haiku 5.5**: pasos numerados, límites con números, tablas de decisión, salida fija,
  ejemplos (también uno malo) y una lista de revisión al final.

## Cómo se miden

Una skill se cambia solo si mejora una medición, con las mismas entradas antes y después y varias corridas por
condición:

- **`disenar-tema`:** el diseñador aplica el tema en un navegador a 1280 y 390 px de ancho y mide contraste del texto,
  elementos que el tema oculta, desborde horizontal y si la página sin `mi-tema` queda idéntica (alcance); un juez
  compara capturas por pares. Además, el evaluador puede correr sus usuarios sintéticos con `--css` para ver si la
  tarea sigue saliendo.
- **`explorar-caminos`:** amplitud del recorrido en `route_tree.json` (ramas distintas, factor de ramificación,
  retrocesos, solapamiento entre agentes) además del éxito de la tarea según el juez.
