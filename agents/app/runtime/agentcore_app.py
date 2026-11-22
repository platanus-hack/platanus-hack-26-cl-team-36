"""Entrada del runtime chameleon en AgentCore (la CLI de AgentCore la despliega; ver infra/agentcore/).

Recibe `{"stage": ..., "revision": ..., "url": ..., ...}`, responde al instante y corre el CLI de la etapa en
segundo plano (modo async de AgentCore: mientras hay una tarea, el ping dice HealthyBusy y la sesión sigue viva).
"""

import logging
import signal
import threading

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from dispatcher import InvalidRequest, children, parse_request, run_stage

app = BedrockAgentCoreApp()
log = logging.getLogger("chameleon.runtime")


def _work(task_id: int, request) -> None:
    try:
        run_stage(request)
    except Exception:
        log.exception("la etapa %s de la revisión %s falló", request.stage, request.revision)
    finally:
        app.complete_async_task(task_id)


@app.entrypoint
def invoke(payload):
    try:
        request = parse_request(payload)
    except InvalidRequest as error:
        return {"error": str(error)}
    task_id = app.add_async_task(request.stage, {"revision": request.revision})
    # No daemon: al apagarse, Python espera a que el hilo deje la corrida `failed`.
    threading.Thread(target=_work, args=(task_id, request), name=f"stage-{request.stage}", daemon=False).start()
    return {"status": "accepted", "stage": request.stage, "revision": request.revision}


if __name__ == "__main__":
    # uvicorn atrapa SIGTERM y, tras cerrar el servidor, lo vuelve a lanzar contra este manejador.
    signal.signal(signal.SIGTERM, lambda *_: children.stop())
    app.run()
