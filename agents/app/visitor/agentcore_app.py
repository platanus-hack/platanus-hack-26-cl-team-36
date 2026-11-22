"""Entrada del Visitante en AgentCore Runtime (la CLI de AgentCore la despliega; ver infra/agentcore/).

Recibe una tarea y responde en stream (SSE): un aviso cada 20 s mientras corre la tanda y, al final, el
resultado de cada perfil y el reporte. Así `agentcore invoke` muestra el avance y la conexión no queda
callada durante los minutos que dura una tanda.

    {"url": "https://...", "instruction": "...", "task_id": "baja-fibra",
     "profiles": ["first_time", "mobile"], "effort": "medium"}

Solo `url` e `instruction` son obligatorios; `task_id` es el objetivo y, sin él, es el objetivo libre de la
instrucción. En AWS usa Claude en Bedrock, solo Sonnet 4.6 (usuarios y juez, ver config.BEDROCK_*_MODEL), y AgentCore
Browser; VISITOR_ENGINE y VISITOR_BROWSER los cambian (por ejemplo, para `agentcore dev` sin AWS). La corrida queda
en AGENTS_STORE o, sin él, en una carpeta temporal que se borra al responder.
"""

import asyncio
import os
import shutil
import tempfile
import time
from pathlib import Path

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from shared import store
from shared.catalog.goal import instruction_goal_id

from visitor import config
from visitor.batch import run_batch
from visitor.profiles import PERFILES_POR_DEFECTO, PROFILES

ENGINE = os.environ.get("VISITOR_ENGINE", "bedrock")
BROWSER = os.environ.get("VISITOR_BROWSER", "agentcore")
EFFORTS = ("low", "medium", "high", "max")  # los de config.BEDROCK_USER_MODEL (Sonnet 4.6 no tiene xhigh)
PROGRESS_SECONDS = 20

app = BedrockAgentCoreApp()


class InvalidRequest(ValueError):
    pass


def parse_request(payload) -> dict:
    """Valida el pedido y completa los valores por defecto. Lanza InvalidRequest si algo no cuadra."""
    if not isinstance(payload, dict):
        raise InvalidRequest("el pedido debe ser un objeto JSON")
    url, instruction = payload.get("url"), payload.get("instruction")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise InvalidRequest("falta `url`, con http:// o https://")
    if not isinstance(instruction, str) or not instruction.strip():
        raise InvalidRequest("falta `instruction`")
    profiles = payload.get("profiles") or list(PERFILES_POR_DEFECTO)
    if not isinstance(profiles, list):
        raise InvalidRequest("`profiles` debe ser una lista")
    # Los perfiles con skill (los exploradores) leen .claude/skills/, que no se despliega: en AWS no corren.
    disponibles = [key for key, profile in PROFILES.items() if not profile.skill]
    unknown = [key for key in profiles if key not in disponibles]
    if unknown:
        raise InvalidRequest(
            f"perfiles desconocidos o solo locales: {', '.join(map(str, unknown))}; disponibles: {', '.join(disponibles)}"
        )
    effort = payload.get("effort") or config.USER_EFFORT
    if effort not in EFFORTS:
        raise InvalidRequest(f"`effort` debe ser uno de: {', '.join(EFFORTS)}")
    task_id = payload.get("task_id")
    goal = task_id if isinstance(task_id, str) and task_id else instruction_goal_id(instruction)
    try:
        store.visitor(url, goal)
    except store.InvalidKey as error:
        raise InvalidRequest(f"`url` o `task_id` inválidos: {error}")
    return {
        "url": url,
        "instruction": instruction.strip(),
        "goal": goal,
        "profiles": profiles,
        "effort": effort,
    }


def outcomes(backend: store.Backend, run: store.RunKey) -> dict:
    """El resultado de cada perfil, leído de sus run.json."""
    result = {}
    for profile in backend.list_profiles(run):
        data = backend.read_json(run.file("run.json", profile))
        result[data.get("profile", profile)] = (data.get("verdict") or {}).get("outcome", data.get("end_reason"))
    return result


async def _stream(backend: store.Backend, request: dict):
    """Los avisos de la tanda y, al final, su resultado o el error."""
    started = time.monotonic()
    batch = asyncio.create_task(run_batch(
        backend,
        store.visitor(request["url"], request["goal"]),
        request["url"],
        request["instruction"],
        request["profiles"],
        references={},
        engine=ENGINE,
        effort=request["effort"],
        browser=BROWSER,
    ))
    yield {"status": "running", "engine": ENGINE, "browser": BROWSER, "profiles": request["profiles"]}
    while not batch.done():
        await asyncio.wait({batch}, timeout=PROGRESS_SECONDS)
        if not batch.done():
            yield {"status": "running", "seconds": int(time.monotonic() - started)}
    try:
        run = batch.result()
    except Exception as error:
        yield {"status": "error", "error": f"{type(error).__name__}: {error}"[:2000]}
        return
    yield {
        "status": "done",
        "seconds": int(time.monotonic() - started),
        "outcomes": outcomes(backend, run),
        "report": backend.read_text(run.file("report.md")),
    }


@app.entrypoint
async def invoke(payload, context):
    try:
        request = parse_request(payload)
    except InvalidRequest as error:
        yield {"error": str(error)}
        return
    configured = os.environ.get(store.ENV_VAR)
    temporary = None if configured else Path(tempfile.mkdtemp(prefix="visitor-"))
    try:
        async for event in _stream(store.open_backend(configured or temporary.as_uri()), request):
            yield event
    finally:
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)


if __name__ == "__main__":
    app.run()
