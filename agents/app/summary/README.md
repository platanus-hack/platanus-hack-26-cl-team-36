# summary

El **resumen de un sitio**: por cada objetivo del último catálogo del [Catalogador](../cataloger/README.md), su ruta
vigente de la [Guía](../guide/README.md) y la última tanda del [Visitante](../visitor/README.md), leídos del almacén.
No llama a Claude ni pertenece a ningún agente: lee las salidas de los tres.

## Uso

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run main.py --site https://www.wom.cl/
uv run main.py --site https://www.wom.cl/ --css tema.css
```

Cada resumen es una corrida de `<host>/summary/` con `summary.md`, `summary.json` y, en `inputs`, las corridas que
leyó. Los enlaces a los reportes son relativos a la corrida, iguales en disco y en S3. Por objetivo: sus
clasificaciones, los pasos mínimos de la Guía y cuántas rutas exploró, el resultado y los pasos de cada perfil, la
eficiencia y quién necesitó menos pasos; y los totales del sitio. Con una ruta verificada, la prominencia sale de su primer elemento en la página inicial y la
complejidad de sus acciones, sin scrolls. Los objetivos sin tanda aparecen con el motivo. Los intentos interrumpidos
por un error técnico se muestran y se cuentan aparte: no entran en la tasa de éxito, el SPL ni "menos pasos". Las
corridas que lee son las vigentes de la instrucción del catálogo, de ambos viewports, y todas quedan en `inputs`.

Con `--css`, cuenta solo las tandas que corrieron con ese tema (las del [Visitante](../visitor/README.md) con el mismo
`--css`) y `summary.json` lo registra en `tema` (sha256 corto); sin `--css`, solo las tandas sin tema y `tema` es
`null`. Con y sin tema son corridas de `<host>/summary/`; se distinguen por `tema`.

| Módulo | Qué hace |
|---|---|
| `main.py` | Punto de entrada. |
| `summary/site.py` | Lee el último catálogo y escribe la corrida. |
| `summary/rows.py` | Una fila por objetivo y los totales del sitio. |
| `summary/markdown.py` | `summary.md`. |

## Pruebas

```bash
uv run pytest -q
```
