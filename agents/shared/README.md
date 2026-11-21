# shared

Lo que usan dos o más agentes de `agents/app/`. Cada pieza tiene un solo lugar; ningún agente importa la carpeta de
otro.

| Paquete | Qué es | Lo usan |
|---|---|---|
| `shared.store` | Almacén de las salidas: claves, ids de corrida, manifiesto, disco y S3. | todos |
| `shared.browser` | `session`: navegador, contexto aislado con la red de seguridad de formularios y sesión de una pestaña. `viewports`: `desktop` y `mobile`. `keys`: teclas al formato de Playwright. `theme`: el tema CSS (`--css`) en cada documento. `pixels`: cuánto cambió la pantalla entre dos capturas. | cataloger, guide, visitor, summary (`theme`), web_designer |
| `shared.claude` | `process`: el proceso de `claude -p` en stream-json. `caller`: llamadas con salida JSON que suman tokens y costo. `workdir`: carpeta vacía para Claude Code. | cataloger, guide, visitor, web_designer |
| `shared.nodes` | `urls`: URL normalizada, nodo de una página (URL más título) y sitio de una URL. | todos |
| `shared.dom` | `visibility`: el JavaScript que decide qué se puede mostrar. | cataloger, guide |
| `shared.catalog` | `goal`: el objetivo, qué se intenta y su id. `outline`: el esquema del sitio. `tasks`: las tareas escritas a mano. `files`: lectura de un catálogo del almacén. `routes`: la ruta vigente de un objetivo. `prominence`: prominencia y complejidad. `visits`: las tandas del Visitante de un objetivo, por tema. | cataloger, guide, visitor, summary |

## shared.store

Define las claves, los ids de corrida y el manifiesto, y escribe en disco (`agents/.runs/`) o en S3 con el mismo
árbol. Ninguna clave se arma a mano fuera de este paquete.

### Layout

```
<host>/                                  host normalizado: minúsculas, sin "www.", puerto si no es el por defecto
  cataloger/<run>/                       manifest.json outline.json goals.json goals.md claude_code.log
  guide/<goal>/<viewport>/<run>/         manifest.json route.json route.md step_00.png … claude_code.log
  visitor/<goal>/<run>/                  manifest.json criteria.json route_tree.json comparison.json proposals.json report.md
      <profile>/                         run.json step_00.png … video.webm claude_code.log
  summary/<run>/                         manifest.json summary.json summary.md
```

### Reglas

- `<host>` se normaliza igual que `shared.nodes.urls.normalize_url`; un host suelto se toma como https.
- Un host internacional queda en punycode (`ñandú.cl` → `xn--and-6ma2c.cl`); uno con `_` se rechaza: no es un host.
- `<goal>` es kebab-case y no lleva el host (`baja-fibra`); `<viewport>` es `desktop` o `mobile`; `<profile>` es la
  clave de un perfil del visitante.
- `<run>` es el instante UTC de inicio (`2026-11-21T10-44-22Z`). Si ya existe bajo el mismo prefijo, se usa el menor
  sufijo libre `_01`…`_99`. El orden lexicográfico es el cronológico: la última corrida es la última clave.
- No hay punteros `latest`: la última corrida sale de listar el prefijo y leer los manifiestos.
- Una corrida se reserva escribiendo su `manifest.json` solo si no existe: un id nunca se reutiliza y una corrida
  terminada no se vuelve a publicar.
- `status` es `running`, `succeeded` o `failed`; `running` es una corrida en curso o abandonada.
- Todo nombre de archivo lleva extensión y ningún perfil la lleva; cualquier otro segmento se rechaza.
- `manifest.json` dice qué es la carpeta y, en `inputs`, las claves de las corridas que consumió: una corrida de
  guide, la del catálogo de donde vino su objetivo; una de visitor, las de guide con que se comparó y la del catálogo;
  una de guide adoptada, la ruta anterior y la corrida de visitor que la propuso; una de summary, todas las que leyó.
- `comparison.json` existe si alguna ruta de guide sirvió de referencia, y `proposals.json` si un intento la superó.
- Una tarea de `agents/tasks/<host>/<goal>.json` es un objetivo de su host con su propio id; un objetivo libre, que
  solo tiene instrucción, toma su id de las primeras palabras de la instrucción.

### Uso

```python
from shared.store import finish_run, guide, latest_run, open_backend, start_run, visitor

store = open_backend()                                   # AGENTS_STORE o agents/.runs/
route = latest_run(store, guide("https://www.wom.cl", "baja-fibra", "desktop"))   # la última succeeded
if route is None:
    raise SystemExit("falta la ruta de referencia de baja-fibra")
steps = store.read_json(route.file("route.json"))
run = start_run(store, visitor("wom.cl", "baja-fibra"), model="claude-haiku-5-5", inputs=[route])
# Playwright y el agente escriben en run.workdir: report.md, first_time/step_00.png, first_time/video.webm …
(run.workdir / "report.md").write_text(report)
finish_run(store, run, "succeeded")                      # publica la carpeta y cierra el manifiesto
store.list_profiles(run.key)                             # ["first_time"]: las carpetas de perfil de la corrida
```

`with running(store, prefix, model=..., inputs=[...]) as run:` hace lo mismo y cierra la corrida como `failed` si el
bloque lanza una excepción; los consumidores ignoran las corridas que no terminaron bien.

En disco, `run.workdir` es la carpeta de la corrida. En S3 es una carpeta temporal que `finish_run` sube y borra. Los
archivos ocultos (`.DS_Store`) no se publican.

### Local y S3

`AGENTS_STORE` elige el backend:

| Valor | Backend |
|---|---|
| sin definir | `agents/.runs/` |
| `file:///ruta/absoluta` | esa carpeta |
| `s3://bucket/prefijo` | ese bucket bajo ese prefijo; credenciales y región de la cadena estándar de AWS |

La clave `wom.cl/cataloger/2026-11-21T10-44-22Z/goals.json` es `agents/.runs/wom.cl/cataloger/…/goals.json` en disco
y `s3://bucket/prefijo/wom.cl/cataloger/…/goals.json` en S3. Como el árbol es el mismo, copiar de uno a otro es
`aws s3 sync agents/.runs/ s3://bucket/prefijo/`.

## Instalación

Desde un agente en `agents/app/<agente>/`, como dependencia de ruta editable (sin editable no ubica `agents/.runs/`):

```toml
[project]
dependencies = ["shared[browser]"]

[tool.uv.sources]
shared = { path = "../../shared", editable = true }
```

`playwright` solo se instala con el extra `browser`, `pillow` con `pixels` y `boto3` con `s3`. Las pruebas corren sin red:
`uv run pytest -q`.
