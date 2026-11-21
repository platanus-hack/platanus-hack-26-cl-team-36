# Imagen del Visitante en AgentCore Runtime. La CLI de AgentCore (infra/agentcore/) la construye en CodeBuild, en
# arm64, al desplegar; en local no se usa. El contexto es agents/, porque el Visitante depende de agents/shared/ por
# ruta. Hace falta una imagen propia porque el driver de Playwright es un binario de Node que necesita libatomic, y la
# imagen que AgentCore usa para el código en zip no la trae. El navegador es AgentCore Browser, por CDP: no se instala
# Chromium.
FROM public.ecr.aws/docker/library/python:3.12-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Las mismas rutas que en el repo: uv.lock nombra a shared como ../../shared.
WORKDIR /agents/app/visitor
ENV UV_COMPILE_BYTECODE=1 \
    UV_NO_CACHE=1 \
    PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1 \
    PATH="/agents/app/visitor/.venv/bin:$PATH"

RUN useradd -m -u 1000 bedrock_agentcore

COPY shared /agents/shared
COPY app/visitor/pyproject.toml app/visitor/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY --chown=bedrock_agentcore:bedrock_agentcore app/visitor .

USER bedrock_agentcore
EXPOSE 8080
CMD ["opentelemetry-instrument", "python", "-m", "agentcore_app"]
