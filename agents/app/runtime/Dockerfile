# Imagen del runtime chameleon de AgentCore: todas las apps de agents/app/, cada una con su entorno, y la entrada
# agentcore_app.py, que corre el CLI de cada etapa como subproceso. La CLI de AgentCore (infra/agentcore/) la construye
# en CodeBuild, en arm64, con la raíz del repo como contexto: así entra .claude/skills/ (el skill del diseñador) sin
# copiarlo, y extension/src/ (los componentes que el diseñador monta en sus capturas); Dockerfile.dockerignore deja
# pasar solo lo necesario. libatomic1 la pide el driver de Playwright; el navegador es AgentCore Browser y Claude va
# por Bedrock, así que no hay Chromium ni Claude Code.
FROM public.ecr.aws/docker/library/python:3.12-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv \
    && useradd -m -u 1000 bedrock_agentcore

ENV PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON=/usr/local/bin/python3.12 \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_SYNC=1 \
    UV_NO_CACHE=1 \
    AGENTS_ENGINE=bedrock \
    AGENTS_BROWSER=agentcore \
    AGENTS_MODEL=us.anthropic.claude-haiku-5-5 \
    AGENTS_MODEL_FUERTE=us.anthropic.claude-sonnet-5-5 \
    WEB_DESIGNER_SKILL=/chameleon/.claude/skills/disenar-tema/SKILL.md

# Las mismas rutas que en el repo: los uv.lock nombran a shared como ../../shared.
WORKDIR /chameleon
COPY --chown=bedrock_agentcore:bedrock_agentcore . .

# Un solo RUN con una caché propia y enlaces duros: los paquetes que repiten las apps (Playwright, boto3...) ocupan
# disco una vez. Después la caché se borra; los entornos conservan los archivos.
RUN cd agents/app \
    && for app in */; do \
        (cd "$app" && UV_NO_CACHE=false UV_CACHE_DIR=/tmp/uv-cache UV_LINK_MODE=hardlink uv sync --locked --no-dev) \
            || exit 1; \
    done \
    && rm -rf /tmp/uv-cache \
    && chown -R bedrock_agentcore:bedrock_agentcore /chameleon

USER bedrock_agentcore
WORKDIR /chameleon/agents/app/runtime
ENV PATH="/chameleon/agents/app/runtime/.venv/bin:$PATH"
EXPOSE 8080
CMD ["opentelemetry-instrument", "python", "-m", "agentcore_app"]
