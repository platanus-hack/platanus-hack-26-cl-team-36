# shared

Lo que usan dos o más agentes de `agents/app/`. Cada pieza tiene un solo lugar; ningún agente importa la carpeta de
otro.

| Paquete | Qué es | Lo usan |
|---|---|---|
| `shared.store` | Almacén de las salidas: claves, ids de corrida, manifiesto, disco y S3. | todos |
| `shared.browser` | `session`: navegador (`AGENTS_BROWSER`: `local` por defecto o `agentcore`), contexto aislado con la red de seguridad de formularios y sesión de una pestaña. `agentcore`: sesiones de AgentCore Browser por CDP firmado. `viewports`: `desktop` y `mobile`. `keys`: teclas al formato de Playwright. `theme`: el tema CSS (`--css`) en cada documento. `pixels`: cuánto cambió la pantalla entre dos capturas. | cataloger, guide, visitor, summary (`theme`), web_designer |
| `shared.claude` | `engines`: `make_caller` según `AGENTS_ENGINE`: `claude-code` (por defecto), `bedrock` (rol rápido `AGENTS_MODEL`, por defecto Haiku 5.5; fuerte `AGENTS_MODEL_FUERTE`, por defecto Sonnet 5.5, y el de la Guía `AGENTS_MODEL_GUIA`, por defecto Opus 5.5; reintenta ante throttling) o `fake` (respuestas guionizadas). `caller`: la interfaz común, llamadas con salida JSON que suman tokens y costo. `process`: el proceso de `claude -p` en stream-json. `workdir`: carpeta vacía para Claude Code. | cataloger, guide, visitor, web_designer |
| `shared.nodes` | `urls`: URL normalizada, nodo de una página (URL más título) y sitio de una URL. | todos |
| `shared.dom` | `visibility`: el JavaScript que decide qué se puede mostrar. | cataloger, guide |
| `shared.catalog` | `goal`: el objetivo, qué se intenta y su id. `outline`: el esquema del sitio. `tasks`: las tareas escritas a mano. `files`: lectura de un catálogo del almacén. `routes`: la ruta vigente de un objetivo y su última corrida del Visitante con o sin tema. `prominence`: prominencia y complejidad. | cataloger, guide, visitor, summary |
| `shared.stages` | Única definición de cada etapa de una revisión: `command(stage, payload)` da su app, los argumentos de su CLI (`argv`) y el prefijo de su corrida. | conductor |

## shared.store

Define las claves, los ids de corrida y el manifiesto, y escribe en disco (`agents/.runs/`) o en S3 con el mismo
árbol. Ninguna clave se arma a mano fuera de este paquete.

### Layout

```
<host>/                                  host normalizado: minúsculas, sin "www.", puerto si no es el por defecto
  cataloger/<run>/                       manifest.json outline.json goals.json goals.md claude_code.log
  guide/<goal>/<viewport>/<run>/         manifest.json route.json route.md step_00.png … claude_code.log
  visitor/<goal>/<run>/                  manifest.json criteria.json route_tree.json comparison.json proposals.json report.md
                                         tema.css
      <profile>/                         run.json step_00.png … video.webm claude_code.log
  summary/<run>/                         manifest.json summary.json summary.md
  improver/<run>/                        manifest.json tema.css tema.json atajos.json diagnostico.json informe.json mejora.json vistas/
  conductor/<run>/                       manifest.json conductor.json <etapa>[-<goal>].log
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
- Una corrida de guide con `adoption.json` es la revisión de una propuesta: `succeeded` si la adoptó, `failed` si no.
- Una corrida de visitor cuyos intentos se interrumpieron todos termina `failed`.
- Un tema no es un segmento de la clave: una corrida de visitor con `--css` va al mismo prefijo, guarda el CSS en
  `tema.css` y su `route_tree.json` lo registra en `tema` (`archivo`, `sha256` corto, `bytes`); sin tema, `tema` es
  `null`. Una de summary con `--css` registra el sha256 en `tema` de `summary.json`. La vigente se elige por tema como
  por instrucción: una corrida con tema nunca es la vigente sin tema, ni al revés.
- Una corrida de visitor con `--exploradores` registra el conjunto en `conjunto_exploradores` de `route_tree.json`
  (sin él, `null` o ausente). La vigente se elige también por conjunto: la de un conjunto nunca es la vigente sin
  conjunto ni la de otro.
- Una tarea de `agents/tasks/<host>/<goal>.json` es un objetivo de su host con su propio id. Un objetivo libre, que
  solo tiene instrucción, se llama `libre-<primeras palabras>-<8 hex del sha256 de la instrucción>`; el catálogo y las
  tareas no aceptan ese prefijo.
- Un mismo `<goal>` puede tener corridas de instrucciones distintas: la vigente para una instrucción es la más nueva que
  terminó bien y es de esa instrucción (`shared.catalog.routes`). `runs_with_status` las recorre de la más nueva a la
  más vieja y salta las de manifiesto ilegible.
- `start_run(..., revision=...)` agrupa las corridas de las etapas de una revisión (`[a-z0-9]+(-[a-z0-9]+)*`, máx.
  40, `validate_revision`); sin ella el manifiesto no lleva el campo. `revision_run(store, prefix, revision)` es la más
  nueva de esa revisión, con cualquier estado: las etapas encuentran así sus entradas y el conductor sabe si una
  terminó. Con `since=` no lee las corridas anteriores a ese instante; quien sondea debe pasarlo.

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
store.list_profiles(run.key)                             # ["desktop"]: las carpetas de perfil de la corrida
```

`with running(store, prefix, model=..., inputs=[...]) as run:` hace lo mismo y cierra la corrida como `failed` si el
bloque lanza una excepción; los consumidores ignoran las corridas que no terminaron bien.

En disco, `run.workdir` es la carpeta de la corrida. En S3 es una carpeta temporal que `finish_run` sube y borra. Los
archivos ocultos (`.DS_Store`) no se publican.

`store.publish_file(run.key, run.workdir, name, profile)` sube al momento un archivo de una corrida en curso (si ya no
está, quita el publicado); en disco no hace nada porque ya está ahí. Un fallo queda como aviso en el log. `LiveTrace`
lo usa para el `trace.json` de la Guía y del Visitante: `schema_version`, `agent`, `goal`, `revision`, `profile`,
`status` (running → succeeded|failed), `updated_at`, `start` y `steps`, publicado tras cada paso con su captura.

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

En S3 cada video (`video/*`) se sube con la etiqueta `tipo=video`, que la regla de ciclo de vida del bucket usa
para expirarlo: S3 no filtra por extensión. Escribirla pide `s3:PutObjectTagging` además de `s3:PutObject`.

### Corridas sin manifiesto

`scripts/migrate_runs.py` copia a un almacén las corridas de `agents/.runs/` escritas sin `shared.store` (tandas
`<tarea>/<fecha-hora>/`, rutas `reference/<viewport>/`, catálogos `<host>/goals/`) como corridas `succeeded` con sus
instantes en UTC, o `failed` si todos los intentos se interrumpieron. No toca la fuente, omite con su motivo lo que no
sabe ubicar y repetirla no copia nada nuevo. Sin `--write` solo muestra el plan:
`just local migrate-runs file:///ruta [--write]`, o desde `agents/shared`,
`uv run scripts/migrate_runs.py --to <almacén> [--from <carpeta>] [--write]`.

## Instalación

Desde un agente en `agents/app/<agente>/`, como dependencia de ruta editable (sin editable no ubica `agents/.runs/`):

```toml
[project]
dependencies = ["shared[browser]"]

[tool.uv.sources]
shared = { path = "../../shared", editable = true }
```

`playwright` solo se instala con el extra `browser`, `pillow` con `pixels` y `boto3` con `s3`; sin `boto3`, un
almacén `s3://` falla con un mensaje que lo nombra. Las pruebas corren sin red:
`uv run pytest -q`.
