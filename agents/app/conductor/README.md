# conductor

El **conductor** corre una **revisión** de una página: el [Catalogador](../cataloger/README.md), luego por cada
objetivo evaluable la [Guía](../guide/README.md) y, si su ruta quedó verificada, el [Visitante](../visitor/README.md),
y al final la mejora del [diseñador](../web_designer/README.md), que deja `tema.css`. Cada etapa es el CLI de su app
con `--revision`, armado por [`shared.stages`](../../shared/README.md); ninguna app importa a otra.

## Uso

```bash
uv run main.py --url https://www.wom.cl/ --revision rev-1
uv run main.py --url https://www.wom.cl/ --revision rev-1 --goals-max 1 --profiles desktop,mobile --runs 2 --concurrency 1
```

Desde la raíz, `just local revision <url>` hace lo mismo con una revisión nueva y tu Claude Code.

| Opción | Qué hace |
|---|---|
| `--goals-max` | Objetivos evaluables que se recorren (por defecto 3): sin `exclusion`, primero los que no salen del sitio ni tienen barreras, los más prominentes y en el orden del catálogo (`for_revision`, el mismo criterio de la proyectora). |
| `--profiles`, `--runs` | Van al Visitante (por defecto, sus perfiles y 1 intento por perfil). |
| `--concurrency` | Objetivos a la vez (por defecto 2). |

| Variable | Qué hace |
|---|---|
| `CONDUCTOR_INVOKER` | `local` (por defecto): cada etapa es `uv run --locked main.py ...` en `agents/app/<app>/`. `agentcore`: InvokeAgentRuntime con una sesión nueva por etapa y payload `{stage, revision, url, ...}`; espera leyendo el manifiesto de la etapa de esa revisión. |
| `CONDUCTOR_RUNTIME_ARN` | Con `agentcore`, el runtime. |
| `CONDUCTOR_POLL_S` | Con `agentcore`, cada cuánto lee el manifiesto (por defecto 10 s). |
| `CONDUCTOR_TIMEOUT_<ETAPA>_S` | Tiempo máximo de `CATALOG`, `GUIDE`, `VISITOR` e `IMPROVER` (por defecto 900, 1200, 1800 y 900 s). Con `local`, al vencer se mata el proceso y su corrida queda `failed`. |

Las etapas leen `AGENTS_STORE`, `AGENTS_ENGINE`, `AGENTS_BROWSER` y `AGENTS_MODEL` del mismo entorno.

## Salida

`<host>/conductor/<run>/` con `revision` en el manifiesto, `conductor.json` (cómo terminó cada etapa y cada objetivo,
con la clave de su corrida, el error y los segundos) y, con el invocador local, la salida de cada etapa en
`<etapa>[-<goal>].log`. Termina `succeeded` solo si la mejora terminó `succeeded`. Una Guía que falla o no verifica
deja su objetivo sin Visitante, sin hacer fallar la revisión; un catálogo fallido o sin objetivos evaluables, o una
mejora fallida, la dejan `failed`. Sale con 0 solo si la corrida queda `succeeded`.

## Pruebas

```bash
uv run pytest -q
```

El flujo y los invocadores, con un invocador y un cliente de AgentCore falsos; y una revisión de punta a punta con los
CLIs reales, `AGENTS_ENGINE=fake` y un sitio local servido por HTTP (necesita `uv` y Chromium). Sin Claude ni AWS.
