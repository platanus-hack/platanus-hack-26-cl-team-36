# Runtime `chameleon`: notas para agentes de código

El detalle está en [README.md](README.md). Antes de tocar esta carpeta:

- La entrada es `agentcore_app.py`, no `main.py`: la fija `[tool.agentcore] entrypoint` en `pyproject.toml`, y la CLI
  de AgentCore la copia a [`infra/agentcore/agentcore.json`](../../../infra/agentcore/agentcore.json).
- El runtime se construye como contenedor (`build: Container`): el `Dockerfile` de esta carpeta, con la raíz del repo
  como contexto, trae todas las apps de `agents/app/`.
- `agentcore_app.py` solo valida el pedido y `dispatcher.py` corre el CLI de la etapa como subproceso, con la línea de
  comando que arma `shared.stages`. La lógica de cada etapa vive en su app, no acá.
- El motor, los modelos y el navegador se fijan en el `Dockerfile` con `AGENTS_ENGINE`, `AGENTS_MODEL`,
  `AGENTS_MODEL_FUERTE`, `AGENTS_MODEL_GUIA` y `AGENTS_BROWSER`.
- Pruebas: `uv run --locked pytest` desde esta carpeta, sin AWS.
- Cómo se despliega: [infra/README.md](../../../infra/README.md).
