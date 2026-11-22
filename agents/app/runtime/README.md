# runtime

La entrada del runtime `chameleon` de AgentCore: una imagen con todas las apps de `agents/app/` que corre, por cada
invocación, la etapa que pide el payload. La despliega la CLI de AgentCore (ver [infra](../../../infra/README.md#carpetas)).

```json
{"stage": "catalog", "revision": "m3x9k2-a1b2c3", "url": "https://www.wom.cl/planes"}
```

`stage` es `revision` (el conductor), `catalog`, `guide`, `visitor` o `improver`, con los campos que pide cada una
(`shared.stages`, que arma la línea de comando). `agentcore_app.py` valida el pedido, responde
`{"status": "accepted", ...}` (o `{"error": ...}`) y corre el CLI de la etapa como subproceso en segundo plano, con el
modo async de AgentCore: mientras corre, `/ping` dice `HealthyBusy` y la sesión sigue viva. Si el CLI sale con error y
no dejó una corrida de esa revisión en su prefijo (o la dejó en `running`), `dispatcher.py` la deja `failed`, para que
el conductor no espere en vano; igual si AgentCore apaga el contenedor (SIGTERM termina los CLI en curso). Para
`revision`, el conductor corre con `CONDUCTOR_INVOKER=agentcore` y el ARN de este mismo runtime (`CONDUCTOR_RUNTIME_ARN`, o el `cloud.resource_id` que AgentCore pone en `OTEL_RESOURCE_ATTRIBUTES`).

La imagen (`Dockerfile`, contexto: la raíz del repo) trae cada app con su entorno (`uv sync --locked`) y el skill
`disenar-tema` de `.claude/skills/`, sin Chromium ni Claude Code: en AWS van `AGENTS_ENGINE=bedrock` (Haiku 5.5 en
`AGENTS_MODEL` y Sonnet 5.5 en `AGENTS_MODEL_FUERTE`) y `AGENTS_BROWSER=agentcore`. Para revisarla en local, desde la raíz del repo:

```bash
docker build --platform linux/arm64 -f agents/app/runtime/Dockerfile -t chameleon .
docker run --rm --entrypoint sh chameleon -c 'cd ../visitor && uv run --locked main.py --help'
uv run --locked pytest   # desde esta carpeta, sin AWS
```
