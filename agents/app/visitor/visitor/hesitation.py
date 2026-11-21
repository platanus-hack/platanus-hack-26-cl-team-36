"""Dónde dudó o se equivocó un usuario, según las señales que registra cada paso."""

import statistics

from visitor.actions import CLICK_ACTIONS


def action_with_target(step: dict) -> str:
    element = step.get("element") or {}
    if step["action"] in CLICK_ACTIONS and element.get("text"):
        return f"{step['description']} sobre «{element['text']}»"
    return step["description"]


def hesitation_points(run: dict) -> list[str]:
    """Pasos donde el usuario dudó o se equivocó, según las señales del registro."""
    steps = run["steps"]
    points: list[str] = []
    durations = [step["duration_s"] for step in steps]
    long_pause_s = max(20.0, 2 * statistics.median(durations)) if durations else 20.0

    scroll_streak: list[dict] = []
    for step in steps + [None]:
        if step and step["action"] == "scroll" and (not scroll_streak or scroll_streak[-1]["url"] == step["url_before"]):
            scroll_streak.append(step)
            continue
        if len(scroll_streak) >= 2:
            first, last = scroll_streak[0], scroll_streak[-1]
            points.append(
                f"Pasos {first['number']}–{last['number']}: {len(scroll_streak)} scroll seguidos en "
                f"«{first['title_before'] or first['url_before']}» buscando por dónde seguir."
            )
        scroll_streak = [step] if step and step["action"] == "scroll" else []

    for step in steps:
        prefix = f"Paso {step['number']} ({action_with_target(step)}; esperaba: \"{step['expectation']}\")"
        signals = step["signals"]
        if "no_effect" in signals and step["action"] != "scroll":
            points.append(f"{prefix}: no tuvo efecto visible.")
        if "visible_error" in signals:
            points.append(f"{prefix}: apareció un error: {step['error_detail']}.")
        if "went_back" in signals:
            points.append(f"{prefix}: volvió a una página anterior («{step['title'] or step['url']}»).")
        if "security_block" in signals:
            points.append(f"{prefix}: intentó enviar un formulario y se bloqueó por seguridad.")
        if step["duration_s"] > long_pause_s:
            points.append(f"Paso {step['number']}: pausa larga ({step['duration_s']:.0f} s) antes de actuar.")
    for incident in run.get("incidents", []):
        points.append(f"Incidencia: {incident}.")
    if run.get("screenshots_requested"):
        points.append(f"Pidió {run['screenshots_requested']} captura(s) extra para volver a mirar la pantalla.")
    return points
