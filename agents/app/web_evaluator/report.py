"""Generación de report.md a partir de los recorridos y el árbol de rutas."""

import statistics

import config

_CLICK_ACTIONS = {"left_click", "double_click", "triple_click"}
_OUTCOME_LABELS = {"success": "éxito", "failed": "fallo", "abandoned": "abandono"}
_SIGNAL_LABELS = {
    "no_effect": "sin efecto",
    "visible_error": "error visible",
    "went_back": "retroceso",
    "security_block": "bloqueo de seguridad",
}
_END_REASON_LABELS = {
    "done": "El usuario declaró que terminó",
    "blocked": "El usuario se detuvo porque el sitio pedía algo que no puede hacer",
    "gave_up": "El usuario se rindió",
    "step_limit": f"Se agotaron las {config.MAX_STEPS} acciones",
    "time_limit": f"Se agotaron los {config.MAX_SECONDS // 60} minutos",
    "refusal": "El modelo se negó a continuar",
    "api_error": "El intento se interrumpió por un error de la API",
    "no_response": "La respuesta del modelo se cortó",
    "internal_error": "El intento se interrumpió por un error interno",
}


def _cell(text) -> str:
    return str(text or "").replace("|", "\\|").replace("\n", " ")


def _outcome_label(outcome: str | None) -> str:
    return _OUTCOME_LABELS.get(outcome or "", outcome or "?")


def _count_signals(steps: list[dict]) -> str:
    counts: dict[str, int] = {}
    for step in steps:
        for signal in step["signals"]:
            counts[signal] = counts.get(signal, 0) + 1
    if not counts:
        return "ninguna"
    return ", ".join(f"{n} {_SIGNAL_LABELS.get(signal, signal)}" for signal, n in counts.items())


def _count_clicks(steps: list[dict]) -> int:
    return sum(1 for step in steps if step["action"] in _CLICK_ACTIONS)


def _action_with_target(step: dict) -> str:
    element = step.get("element") or {}
    if step["action"] in _CLICK_ACTIONS and element.get("text"):
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
        prefix = f"Paso {step['number']} ({_action_with_target(step)}; esperaba: \"{step['expectation']}\")"
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


def _node_label(nodes_by_id: dict, node_id: str) -> str:
    node = nodes_by_id[node_id]
    return f"**{_cell(node['title']) or '(sin título)'}** (`{node['url']}`)"


def generate(meta: dict, criteria: dict, runs: list[dict], tree: dict) -> str:
    nodes_by_id = {node["id"]: node for node in tree["nodes"]}
    engine_label = "Claude Code local" if meta.get("engine") == "claude-code" else "API de Anthropic (computer use)"
    task_label = f" (`{meta['task_id']}`)" if meta.get("task_id") else ""
    lines = [
        "# Reporte del evaluador web",
        "",
        f"- **Sitio:** {meta['url']}",
        f"- **Tarea:** {meta['instruction']}{task_label}",
        f"- **Fecha:** {meta['timestamp']}",
        f"- **Motor:** {engine_label}",
        f"- **Modelos:** usuarios `{meta['user_model']}` (esfuerzo {meta['effort']}); juez `{meta['judge_model']}`",
        f"- **Límites por usuario:** {config.MAX_STEPS} acciones y {config.MAX_SECONDS // 60} minutos",
        "",
        f"**Criterio de éxito:** {criteria.get('criterion', '(no disponible)')}",
        "",
    ]
    for item in criteria.get("evidence", []):
        lines.append(f"- {item}")

    lines += [
        "",
        "## Resumen por perfil",
        "",
        "| Perfil | Viewport | Resultado | Pasos | Clics | Tiempo | Señales de error |",
        "|---|---|---|---|---|---|---|",
    ]
    for run in runs:
        lines.append(
            f"| {run['profile_name']} | {run['viewport']} | {_outcome_label(run['verdict'].get('outcome'))} | "
            f"{len(run['steps'])} | {_count_clicks(run['steps'])} | {run['duration_s']:.0f} s | "
            f"{_count_signals(run['steps'])} |"
        )

    lines += ["", "## Ruta recomendada", ""]
    route = tree.get("recommended_route")
    if not route:
        lines.append("Ningún usuario terminó con éxito, así que no hay una ruta que recomendar.")
    else:
        lines.append(
            f"Probabilidad estimada de completar la ruta sin errores: **{route['estimated_probability']:.0%}** "
            f"(costo {route['total_cost']}; el suavizado la hace conservadora cuando hay pocos usuarios). "
            f"Tiempo mediano sumado: {route['total_median_time_s']:.0f} s."
        )
        lines += ["", f"1. Inicio en {_node_label(nodes_by_id, route['start_node'])}"]
        for step in route["steps"]:
            preceding = ", ".join(step.get("preceding_actions") or [])
            before = f"{_cell(preceding)}, luego " if preceding else ""
            lines.append(
                f"1. {before}{_cell(step['action'])} → {_node_label(nodes_by_id, step['target'])} "
                f"— {step['successes']} éxito(s), {step['failures']} fallo(s), {step['median_time_s']:.0f} s"
            )
        if not route["steps"]:
            lines.append("1. La tarea se resuelve sin salir de la página inicial.")

    lines += ["", "## Detalle por perfil"]
    for run in runs:
        folder = run["profile"]
        verdict = run["verdict"]
        lines += [
            "",
            f"### {run['profile_name']} ({run['viewport']})",
            "",
            f"**Resultado: {_outcome_label(verdict.get('outcome'))}.** {verdict.get('justification', '')}",
            "",
            f"- **Cómo terminó:** {_END_REASON_LABELS.get(run['end_reason'], run['end_reason'])}"
            + (f": \"{run['final_message']}\"" if run["final_message"] else "."),
        ]
        model_verdict = verdict.get("model_verdict")
        if model_verdict:
            lines.append(
                f"- **Juicio del modelo sobre la última captura:** {_outcome_label(model_verdict['outcome'])}. "
                f"{model_verdict['justification']}"
            )
        tokens = run.get("token_usage", {})
        lines += [
            f"- **Pasos:** {len(run['steps'])} · **Clics:** {_count_clicks(run['steps'])} · "
            f"**Tiempo:** {run['duration_s']:.0f} s · **Turnos del modelo:** {run['turns']}",
            f"- **Tokens:** {tokens.get('input_tokens', 0)} de entrada, "
            f"{tokens.get('cache_read_input_tokens', 0)} leídos de caché, {tokens.get('output_tokens', 0)} de salida",
            f"- **Última captura:** [{run['final_screenshot']}]({folder}/{run['final_screenshot']})",
            "",
            "**Dónde dudó o se equivocó**",
            "",
        ]
        points = hesitation_points(run)
        lines += [f"- {point}" for point in points] if points else ["- No se detectaron dudas ni errores."]
        lines += [
            "",
            "<details><summary>Todos los pasos</summary>",
            "",
            "| # | Acción | Esperaba | Quedó en | Señales | Captura |",
            "|---|---|---|---|---|---|",
        ]
        for step in run["steps"]:
            signals = ", ".join(_SIGNAL_LABELS.get(signal, signal) for signal in step["signals"]) or "—"
            lines.append(
                f"| {step['number']} | {_cell(_action_with_target(step))} | {_cell(step['expectation'])} | "
                f"{_cell(step['title'] or step['url'])} | {signals} | [{step['screenshot']}]({folder}/{step['screenshot']}) |"
            )
        lines += ["", "</details>"]

    lines += [
        "",
        "## Árbol de rutas",
        "",
        "| Nodo | Página | URL | Visitas | Perfiles | Terminaron aquí |",
        "|---|---|---|---|---|---|",
    ]
    for node in tree["nodes"]:
        endings = ", ".join(f"{n} {_outcome_label(outcome)}" for outcome, n in node["endings"].items() if n) or "—"
        start_mark = " (inicio)" if node["is_start"] else ""
        lines.append(
            f"| {node['id']}{start_mark} | {_cell(node['title'])} | `{node['url']}` | {node['visits']} | "
            f"{', '.join(node['profiles'])} | {endings} |"
        )
    lines += [
        "",
        "| Origen | Acción | Destino | Éxitos | Fallos | Tiempo mediano | Costo |",
        "|---|---|---|---|---|---|---|",
    ]
    for branch in sorted(tree["branches"], key=lambda b: (b["source"], b["cost"])):
        lines.append(
            f"| {branch['source']} | {_cell(branch['action'])} | {branch['target']} | {branch['successes']} | "
            f"{branch['failures']} | {branch['median_time_s']:.0f} s | {branch['cost']:.3f} |"
        )
    lines.append("")
    return "\n".join(lines)
