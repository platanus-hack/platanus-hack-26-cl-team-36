# shared.store

Almacén de las salidas de los agentes. Define las claves, los ids de corrida y el manifiesto, y escribe en disco
(`agents/.runs/`) o en S3 con el mismo árbol. Ninguna clave se arma a mano fuera de este paquete.

## Layout

```
<host>/                                  host normalizado: minúsculas, sin "www.", puerto si no es el por defecto
  cataloger/<run>/                       manifest.json outline.json goals.json goals.md
  guide/<goal>/<viewport>/<run>/         manifest.json route.json route.md step_00.png …
  visitor/<goal>/<run>/                  manifest.json criteria.json route_tree.json comparison.json report.md
      <profile>/                         run.json step_00.png … video.webm
  summary/<run>/                         manifest.json summary.json summary.md
```

## Reglas

- `<host>` se normaliza igual que `normalize_url` del evaluador; un host suelto se toma como https.
- `<goal>` es kebab-case y no lleva el host (`baja-fibra`); `<viewport>` es `desktop` o `mobile`; `<profile>` es la
  clave de un perfil del visitante.
- `<run>` es el instante UTC de inicio (`2026-11-21T10-44-22Z`). Si ya existe bajo el mismo prefijo, se usa el menor
  sufijo libre `_01`…`_99`. El orden lexicográfico es el cronológico: la última corrida es la última clave.
- No hay punteros `latest`: la última corrida sale de listar el prefijo.
- Una corrida se reserva escribiendo su `manifest.json` solo si no existe; nunca se sobrescribe ni se borra otra.
- Todo nombre de archivo lleva extensión y ningún perfil la lleva; cualquier otro segmento se rechaza.
- `manifest.json` dice qué es la carpeta y, en `inputs`, las claves de las corridas que consumió.

## Uso

```python
from shared.store import guide, open_backend, parse_key, start_run, finish_run, visitor

store = open_backend()                                   # AGENTS_STORE o agents/.runs/
route = store.latest_run(guide("https://www.wom.cl", "baja-fibra", "desktop"))
if route is None:
    raise SystemExit("falta la ruta de referencia de baja-fibra")
run = start_run(store, visitor("wom.cl", "baja-fibra"), model="claude-haiku-5-5", inputs=[route])
# Playwright y el agente escriben en run.workdir: report.md, first_time/step_00.png, first_time/video.webm …
(run.workdir / "report.md").write_text(report)
finish_run(store, run, "succeeded")                      # publica la carpeta y cierra el manifiesto
steps = store.read_json(route.file("route.json"))
```

En disco, `run.workdir` es la carpeta de la corrida. En S3 es una carpeta temporal que `finish_run` sube y borra.

## Local y S3

`AGENTS_STORE` elige el backend:

| Valor | Backend |
|---|---|
| sin definir | `agents/.runs/` |
| `file:///ruta/absoluta` | esa carpeta |
| `s3://bucket/prefijo` | ese bucket bajo ese prefijo; credenciales y región de la cadena estándar de AWS |

La clave `wom.cl/cataloger/2026-11-21T10-44-22Z/goals.json` es `agents/.runs/wom.cl/cataloger/…/goals.json` en disco
y `s3://bucket/prefijo/wom.cl/cataloger/…/goals.json` en S3. Como el árbol es el mismo, copiar de uno a otro es
`aws s3 sync agents/.runs/ s3://bucket/prefijo/`; el paquete no trae su propia copia.

## Instalación

Desde un agente en `agents/app/<agente>/`, como dependencia de ruta editable (sin editable no ubica `agents/.runs/`):

```toml
[project]
dependencies = ["shared[s3]"]

[tool.uv.sources]
shared = { path = "../../shared", editable = true }
```

`boto3` solo se instala con el extra `s3`. Las pruebas corren sin red: `uv run pytest -q`.
