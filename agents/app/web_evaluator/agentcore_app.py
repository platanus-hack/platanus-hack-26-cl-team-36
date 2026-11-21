"""Entrada del evaluador web en AgentCore Runtime (la CLI de AgentCore la despliega; ver infra/agentcore/).

Recibe una tarea y responde en stream (SSE): un aviso cada 20 s mientras corre la tanda y, al final, el
resultado de cada perfil y el reporte. Así `agentcore invoke` muestra el avance y la conexión no queda
callada durante los minutos que dura una tanda.

    {"url": "https://...", "instruction": "...", "task_id": "wom-baja-fibra",
     "profiles": ["first_time", "mobile"], "effort": "medium"}

Solo `url` e `instruction` son obligatorios. En AWS usa Claude en Bedrock, solo Sonnet 4.6 (usuarios y juez, ver
config.BEDROCK_*_MODEL), y AgentCore Browser;
EVALUATOR_ENGINE y EVALUATOR_BROWSER los cambian (por ejemplo, para `agentcore dev` sin AWS).
"""

import asyncio
import json
import os
import tempfile
import time
from pathlib import Path

from bedrock_agentcore.runtime import BedrockAgentCoreApp

import config
from batch import run_batch
from profiles import PROFILES

ENGINE = os.environ.get("EVALUATOR_ENGINE", "bedrock")
BROWSER = os.environ.get("EVALUATOR_BROWSER", "agentcore")
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
    profiles = payload.get("profiles") or list(PROFILES)
    if not isinstance(profiles, list):
        raise InvalidRequest("`profiles` debe ser una lista")
    unknown = [key for key in profiles if key not in PROFILES]
    if unknown:
        raise InvalidRequest(f"perfiles desconocidos: {', '.join(map(str, unknown))}; disponibles: {', '.join(PROFILES)}")
    effort = payload.get("effort") or config.USER_EFFORT
    if effort not in EFFORTS:
        raise InvalidRequest(f"`effort` debe ser uno de: {', '.join(EFFORTS)}")
    task_id = payload.get("task_id")
    return {
        "url": url,
        "instruction": instruction.strip(),
        "task_id": task_id if isinstance(task_id, str) else None,
        "profiles": profiles,
        "effort": effort,
    }


def outcomes(batch_dir: Path) -> dict:
    """El resultado de cada perfil, leído de sus run.json."""
    result = {}
    for run_file in sorted(batch_dir.glob("*/run.json")):
        run = json.loads(run_file.read_text(encoding="utf-8"))
        result[run.get("profile", run_file.parent.name)] = (run.get("verdict") or {}).get("outcome", run.get("end_reason"))
    return result


@app.entrypoint
async def invoke(payload, context):
    try:
        request = parse_request(payload)
    except InvalidRequest as error:
        yield {"error": str(error)}
        return
    started = time.monotonic()
    batch = asyncio.create_task(run_batch(
        url=request["url"],
        instruction=request["instruction"],
        profile_keys=request["profiles"],
        output_dir=Path(tempfile.mkdtemp(prefix="web_evaluator-")),
        engine=ENGINE,
        effort=request["effort"],
        task_id=request["task_id"],
        browser=BROWSER,
    ))
    yield {"status": "running", "engine": ENGINE, "browser": BROWSER, "profiles": request["profiles"]}
    while not batch.done():
        await asyncio.wait({batch}, timeout=PROGRESS_SECONDS)
        if not batch.done():
            yield {"status": "running", "seconds": int(time.monotonic() - started)}
    try:
        batch_dir = batch.result()
    except Exception as error:
        yield {"status": "error", "error": f"{type(error).__name__}: {error}"[:2000]}
        return
    yield {
        "status": "done",
        "seconds": int(time.monotonic() - started),
        "outcomes": outcomes(batch_dir),
        "report": (batch_dir / "report.md").read_text(encoding="utf-8"),
    }


if __name__ == "__main__":
    app.run()
