# summary

El **resumen de un sitio**: por cada objetivo del catálogo del [Catalogador](../cataloger/README.md), su ruta de la
[Guía](../guide/README.md) y la última tanda del [Visitante](../visitor/README.md), leídos de disco. No llama a
Claude ni pertenece a ningún agente: lee las salidas de los tres.

## Uso

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run main.py --goals ../../.runs/www.wom.cl/goals/goals.json
```

Escribe `summary.md` y `summary.json` junto al catálogo: por objetivo, sus clasificaciones, los pasos mínimos de la
Guía y cuántas rutas exploró, el resultado y los pasos de cada perfil, la eficiencia y quién necesitó menos pasos; y
los totales del sitio. Con una ruta verificada, la prominencia sale de su primer elemento en la página inicial y la
complejidad de sus acciones, sin scrolls. Los objetivos sin tanda aparecen con el motivo.

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada. |
| `summary/site.py` | Lee el catálogo y escribe los dos archivos. |
| `summary/rows.py` | Una fila por objetivo y los totales del sitio. |
| `summary/markdown.py` | `summary.md`. |

## Pruebas

```bash
uv run pytest -q
```
