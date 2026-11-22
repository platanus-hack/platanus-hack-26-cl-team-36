# cataloger

El **Catalogador** recorre un sitio leyendo el DOM y cataloga los **objetivos** que ofrece a un visitante, clasificados
según [niveles de tarea](../../../docs/agents/niveles-de-tarea.md). Cada objetivo pasa después por la
[Guía](../guide/README.md) y por el [Visitante](../visitor/README.md). Dónde va cada pieza está en
[arquitectura](../../../docs/agents/arquitectura.md).

## Instalación

Con [uv](https://docs.astral.sh/uv/), desde esta carpeta:

```bash
uv sync
uv run playwright install chromium
```

## Uso

```bash
uv run main.py --url https://www.wom.cl/
uv run main.py --url https://www.sii.cl/ --pages 10 --rerun
uv run main.py --url https://www.sii.cl/ayuda/ --revision rev-1
```

| Opción | Qué hace |
|---|---|
| `--url` | Página inicial del sitio. El catálogo es una corrida de `<host>/cataloger/`. |
| `--pages`, `--depth` | Topes del esquema (por defecto 30 páginas y profundidad 2). |
| `--rerun` | Hace un catálogo nuevo. Sin esta opción, si el sitio ya tiene uno que terminó bien, no corre. |
| `--revision` | Cataloga esa página (`--pages` 1 por defecto) en una corrida nueva con esa `revision` en el manifiesto, sin reusar otro catálogo. Sale con 0 si la corrida termina `succeeded`, aunque no haya objetivos evaluables. |
| `--model`, `--effort` | Por defecto `claude-opus-5-5`, `high`. |
| `--cdp-url` | Un navegador remoto vía CDP, en vez del Chromium local. |

Usa tu Claude Code local (`claude` instalado y con sesión iniciada) y consume los límites de tu plan. Escribe en el
almacén de [`shared.store`](../../shared/README.md): `AGENTS_STORE` o, sin él, `agents/.runs/`.

## Cómo funciona

| Módulo | Qué hace |
|---|---|
| `main.py`, `cataloger/command.py` | Punto de entrada y la corrida en el almacén: esquema, catálogo y escritura. |
| `cataloger/crawl.py`, `cataloger/outline.py` | Recorrido del sitio y esquema de cada página. |
| `cataloger/propose.py` | Objetivos propuestos por el modelo a partir del esquema. |
| `cataloger/rules.py` | Barreras de cada página, validación de lo que propuso el modelo y campos sin modelo. |
| `cataloger/output.py` | Escritura de `outline.json`, `goals.json` y `goals.md`. |
| `cataloger/config.py` | Modelo y topes del recorrido. |

El objetivo, el esquema, la prominencia y la lectura de los archivos están en
[`shared.catalog`](../../shared/README.md), porque la Guía, el Visitante y el resumen también los leen.

1. **Esquema, sin modelo.** Recorre en anchura las páginas del mismo sitio, primero los enlaces del encabezado, una
   página a la vez y sin enviar formularios. De cada una guarda título, encabezados, enlaces por zona (navegación,
   contenido, pie), formularios, botones y señales de barrera.
2. **Catálogo, con el modelo.** El modelo lee el esquema y propone objetivos con `description`, `level`, `parent`,
   `intent`, `submits_form`, `evidence` y `entry`, aplicando las reglas de niveles de tarea, más `demand` (`top` para
   las 3 a 6 tareas principales de la página, `common` o `rare`) y `estimated_steps` (clics y campos desde la página
   inicial), que ordenan y estratifican la selección de la revisión (`for_revision`).
3. **Campos sin modelo.** Se valida lo que propuso el modelo; lo que se descarta o corrige queda en `issues`. Con una
   sola página leída, un objetivo sin evidencia del esquema toma esa página como evidencia. Desde la séptima tarea `top`
   quedan `common`.
   `prominence` sale de dónde está `entry` en la página inicial y `gates` de las señales de sus páginas de evidencia
   (solo campos visibles de formularios del contenido, no del encabezado ni del pie).
4. **Para la Guía y el Visitante.** Cada objetivo guarda `instruction`, la tarea que reciben los dos, y `exclusion`,
   por qué el Visitante no lo intenta (nivel o barrera) o `null`. Como la Guía no envía formularios, en un objetivo
   `transact` la instrucción pide llegar hasta el paso anterior al envío.

## Salida

```
<host>/cataloger/<run>/
├── manifest.json
├── outline.json      el esquema del sitio
├── goals.json        los objetivos: cada uno tiene la forma de una tarea y se promueve copiándolo a agents/tasks/<host>/<id>.json
├── goals.md          tabla agrupada por summary
└── claude_code.log
```

Los ids no llevan el host (`baja-fibra`); uno que ya es una tarea del mismo host recibe un sufijo numérico. Si la
página inicial no carga, la corrida termina como `failed` con `outline.json`.

## Pruebas

```bash
uv run pytest -q
```

No llaman a Claude: el recorrido usa un sitio local y el catálogo un modelo guionizado.
