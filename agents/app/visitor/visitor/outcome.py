"""Resultado de cada intento (`verdict` de run.json).

Lo decide el programa: hay éxito si el intento pasó por la página final de la ruta de la Guía. Lo que declara el usuario
(`end_reason` y su mensaje) queda como dato en `claimed_done`. Sin ruta, decide el juez (--judge) o queda sin medir.

`outcome`: success | failed (declaró que terminó sin llegar) | abandoned (se detuvo sin llegar) | unmeasured |
interrupted (error técnico: no cuenta en el árbol). `source`: route | judge | None.
"""

from visitor.comparison import reached

INTERRUPTED_REASONS = {"refusal", "api_error", "no_response", "internal_error"}


def _claimed(run: dict) -> bool:
    return run["end_reason"] == "done"


def interrupted(run: dict) -> dict:
    return {
        "outcome": "interrupted",
        "source": None,
        "claimed_done": False,
        "justification": f"El intento se interrumpió por un error técnico ({run['end_reason']}): {run['final_message']}",
    }


def by_route(run: dict, route: dict) -> dict:
    claimed = _claimed(run)
    # Si la ruta termina en la página inicial, llegar no prueba nada: cuenta solo si además declaró que terminó.
    trivial = route["final_node"] == route.get("start", {}).get("node")
    if reached(route["final_node"], run) and (claimed or not trivial):
        outcome = "success"
        justification = "Llegó a la página final de la ruta de la Guía."
        if not claimed:
            justification += " No declaró que había terminado."
    elif claimed:
        outcome, justification = "failed", "Declaró que terminó, pero no llegó a la página final de la ruta de la Guía."
    elif trivial:
        outcome, justification = "abandoned", "Se detuvo sin declarar que terminó; la ruta termina en la página inicial."
    else:
        outcome, justification = "abandoned", "Se detuvo sin llegar a la página final de la ruta de la Guía."
    return {"outcome": outcome, "source": "route", "claimed_done": claimed, "justification": justification}


def unmeasured(run: dict) -> dict:
    return {
        "outcome": "unmeasured",
        "source": None,
        "claimed_done": _claimed(run),
        "justification": "Sin ruta de referencia ni juez: el resultado no se mide.",
    }


def from_judge(run: dict, verdict: dict) -> dict:
    return {**verdict, "source": "judge", "claimed_done": _claimed(run)}
