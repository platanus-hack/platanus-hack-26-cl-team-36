"""Generación de report.md a partir de los recorridos y el árbol de rutas."""

import statistics

from visitor import config
from visitor.actions import CLICK_ACTIONS
from visitor.comparison import report_section
from visitor.hesitation import action_with_target, hesitation_points
from visitor.profiles import profile_of

_OUTCOME_LABELS = {
    "success": "éxito",
    "failed": "fallo",
    "abandoned": "abandono",
    "unmeasured": "sin medir",
    "interrupted": "interrumpido",
}
_CLAIMED_WITHOUT_REACHING = "declaró que terminó sin llegar"
_SIGNAL_LABELS = {
    "no_effect": "sin efecto",
    "visible_error": "error visible",
    "went_back": "retroceso",
    "revisit": "revisita",
    "security_block": "bloqueo de seguridad",
}
_NIVEL_LABELS = {"sin_contexto": "sin contexto", "conoce_tema": "conoce el tema"}
_END_REASON_LABELS = {
    "done": "El usuario declaró que terminó",
    "blocked": "El usuario se detuvo porque el sitio pedía algo que no puede hacer",
    "gave_up": "El usuario se rindió",
    "step_limit": "Se agotaron las {acciones} acciones",
    "time_limit": "Se agotaron los {tiempo}",
    "refusal": "El modelo se negó a continuar",
    "api_error": "El intento se interrumpió por un error de la API",
    "no_response": "La respuesta del modelo se cortó",
    "internal_error": "El intento se interrumpió por un error interno",
    "site_blocked": "El sitio bloqueó al navegador (HTTP 403 o 429 seguidos)",
}


def _limites(run: dict) -> tuple[int, int]:
    """(acciones, segundos) del perfil del intento; los generales de config.py si el perfil no existe (o ya no)."""
    profile = profile_of(run.get("profile", ""))
    if profile is None:
        return config.MAX_STEPS, config.MAX_SECONDS
    return profile.limite_acciones, profile.limite_segundos


def _duracion(segundos: int) -> str:
    if segundos % 60:
        return f"{segundos} segundos"
    return "1 minuto" if segundos == 60 else f"{segundos // 60} minutos"


def _texto_limites(limites: tuple[int, int]) -> str:
    return f"{limites[0]} acciones y {_duracion(limites[1])}"


def _limites_de_la_tanda(runs: list[dict]) -> str:
    """Una sola frase si todos los perfiles tienen los mismos límites; si no, los de cada perfil."""
    por_perfil = {run["profile_name"]: _limites(run) for run in runs}
    distintos = set(por_perfil.values())
    if not distintos:
        return _texto_limites((config.MAX_STEPS, config.MAX_SECONDS))
    if len(distintos) == 1:
        return _texto_limites(distintos.pop())
    return "; ".join(f"{nombre}: {_texto_limites(limites)}" for nombre, limites in por_perfil.items())


def _como_termino(run: dict) -> str:
    acciones, segundos = _limites(run)
    etiqueta = _END_REASON_LABELS.get(run["end_reason"], run["end_reason"])
    return etiqueta.format(acciones=acciones, tiempo=_duracion(segundos))


def _cell(text) -> str:
    return str(text or "").replace("|", "\\|").replace("\n", " ")


def _tema_label(tema: dict | None) -> str:
    if not tema:
        return "ninguno (el sitio tal cual)"
    kit = ", kit con sus componentes y [tema.json](tema.json)" if tema.get("kit") else ""
    return f"`{tema['archivo']}` (sha256 `{tema['sha256']}`, {tema['bytes']} bytes; copia en [tema.css](tema.css){kit})"


def _outcome_label(outcome: str | None) -> str:
    return _OUTCOME_LABELS.get(outcome or "", outcome or "?")


def _verdict_label(verdict: dict) -> str:
    """Con ruta, un fallo es haber declarado que terminó sin llegar: se dice así para no confundirlo con un abandono."""
    if verdict.get("outcome") == "failed" and verdict.get("source") == "route":
        return _CLAIMED_WITHOUT_REACHING
    return _outcome_label(verdict.get("outcome"))


def _folder(run: dict) -> str:
    return run.get("folder") or run["profile"]


def _run_name(run: dict) -> str:
    attempt = run.get("attempt", 1)
    return run["profile_name"] if attempt == 1 else f"{run['profile_name']} (intento {attempt})"


def _success_rule(criteria: dict | None, runs: list[dict]) -> list[str]:
    """Cómo se decidió el éxito de los intentos de la tanda."""
    lines = []
    if any(run["verdict"].get("source") == "route" for run in runs):
        lines += ["**Éxito:** llegar a la página final de la ruta de la Guía. Lo decide el programa; lo que declara el "
                  "usuario queda como dato.", ""]
    if criteria is not None:
        lines += [f"**Criterio de éxito del juez** (intentos sin ruta): {criteria.get('criterion', '(no disponible)')}",
                  "", *(f"- {item}" for item in criteria.get("evidence", [])), ""]
    unmeasured = sum(run["verdict"].get("outcome") == "unmeasured" for run in runs)
    if unmeasured:
        lines += [f"**Sin medir:** {unmeasured} intento(s) sin ruta de referencia ni juez (--judge).", ""]
    return lines


def _count_signals(steps: list[dict]) -> str:
    counts: dict[str, int] = {}
    for step in steps:
        for signal in step["signals"]:
            counts[signal] = counts.get(signal, 0) + 1
    if not counts:
        return "ninguna"
    return ", ".join(f"{n} {_SIGNAL_LABELS.get(signal, signal)}" for signal, n in counts.items())


def _video_time(seconds: float) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def _clock(iso: str | None) -> str:
    """HH:MM:SS de una hora ISO 8601; la fecha y la zona quedan en run.json."""
    return iso[11:19] if iso else "—"


def _count_clicks(steps: list[dict]) -> int:
    return sum(1 for step in steps if step["action"] in CLICK_ACTIONS)


def _nivel_label(run: dict) -> str:
    nivel = run.get("conocimiento")
    return _NIVEL_LABELS.get(nivel, nivel) if nivel else "—"


def _seccion_por_nivel(meta: dict, runs: list[dict]) -> list[str]:
    """Resultados agrupados por nivel de conocimiento del tema; vacía si ningún intento tiene nivel."""
    niveles = [nivel for nivel in _NIVEL_LABELS if any(run.get("conocimiento") == nivel for run in runs)]
    if not niveles:
        return []
    lines = ["", "## Resultado por nivel de conocimiento", ""]
    if "tarea_sin_contexto" in meta:
        if meta["tarea_sin_contexto"]:
            lines.append(f"Tarea que leyó el nivel «sin contexto»: {meta['tarea_sin_contexto']}")
        else:
            lines.append("La tarea no trae versión con palabras de todos los días: «sin contexto» leyó la original.")
        lines.append("")
    lines += [
        "| Nivel | Intentos | Éxitos | Pasos (mediana) | Tiempo (mediana) | Escrituras rechazadas |",
        "|---|---|---|---|---|---|",
    ]
    for nivel in niveles:
        del_nivel = [run for run in runs if run.get("conocimiento") == nivel]
        exitos = sum(run["verdict"].get("outcome") == "success" for run in del_nivel)
        pasos = statistics.median(len(run["steps"]) for run in del_nivel)
        tiempo = statistics.median(run["duration_s"] for run in del_nivel)
        rechazos = sum(len(run.get("terminos_rechazados") or []) for run in del_nivel)
        lines.append(
            f"| {_NIVEL_LABELS[nivel]} | {len(del_nivel)} | {exitos} | {pasos:.0f} | {tiempo:.0f} s | {rechazos} |"
        )
    return lines


def _node_label(nodes_by_id: dict, node_id: str) -> str:
    node = nodes_by_id[node_id]
    return f"**{_cell(node['title']) or '(sin título)'}** (`{node['url']}`)"


def _models_label(meta: dict) -> str:
    effort = f" (esfuerzo {meta['effort']})" if meta.get("effort") else ""
    judge = f"; juez `{meta['judge_model']}`" if meta.get("judge_model") else "; sin juez"
    return f"usuarios `{meta['user_model']}`{effort}{judge}"


def generate(
    meta: dict, criteria: dict | None, runs: list[dict], tree: dict, comparison: dict | None = None
) -> str:
    nodes_by_id = {node["id"]: node for node in tree["nodes"]}
    engine_label = {"claude-code": "Claude Code local", "fake": "usuario guionizado (sin Claude)"}.get(
        meta.get("engine"), "API de Anthropic (computer use)")
    task_label = f" (`{meta['task_id']}`)" if meta.get("task_id") else ""
    lines = [
        "# Reporte del Visitante",
        "",
        f"- **Sitio:** {meta['url']}",
        f"- **Tarea:** {meta['instruction']}{task_label}",
        f"- **Fecha:** {meta['timestamp']}",
        f"- **Motor:** {engine_label}",
        f"- **Modelos:** {_models_label(meta)}",
        f"- **Límites por usuario:** {_limites_de_la_tanda(runs)}",
        f"- **Tema:** {_tema_label(meta.get('tema'))}",
        "",
        *_success_rule(criteria, runs),
    ]

    con_nivel = any(run.get("conocimiento") for run in runs)
    lines += [
        "",
        "## Resumen por perfil",
        "",
        "| Perfil | Viewport |" + (" Conocimiento |" if con_nivel else "")
        + " Resultado | Pasos | Clics | Tiempo | Señales de error |",
        "|---|---|---|---|---|---|---|" + ("---|" if con_nivel else ""),
    ]
    for run in runs:
        acciones, segundos = _limites(run)
        lines.append(
            f"| {_run_name(run)} | {run['viewport']} |" + (f" {_nivel_label(run)} |" if con_nivel else "")
            + f" {_verdict_label(run['verdict'])} | "
            f"{len(run['steps'])} de {acciones} | {_count_clicks(run['steps'])} | "
            f"{run['duration_s']:.0f} s de {segundos} s | {_count_signals(run['steps'])} |"
        )

    lines += _seccion_por_nivel(meta, runs)

    if comparison:
        lines += report_section(comparison, {_folder(run): _run_name(run) for run in runs})

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
        folder = _folder(run)
        verdict = run["verdict"]
        lines += [
            "",
            f"### {_run_name(run)} ({run['viewport']})",
            "",
            f"**Resultado: {_verdict_label(verdict)}.** {verdict.get('justification', '')}",
            "",
            f"- **Cómo terminó:** {_como_termino(run)}"
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
            *([f"- **Inicio del intento:** {run['started_at'][:10]} {run['started_at'][11:23]} ({run['started_at'][23:]})"]
              if run.get("started_at") else []),
            f"- **Pasos:** {len(run['steps'])} · **Clics:** {_count_clicks(run['steps'])} · "
            f"**Tiempo:** {run['duration_s']:.0f} s · **Turnos del modelo:** {run['turns']}",
            f"- **Tokens:** {tokens.get('input_tokens', 0)} de entrada, "
            f"{tokens.get('cache_read_input_tokens', 0)} leídos de caché, {tokens.get('output_tokens', 0)} de salida",
            f"- **Última captura:** [{run['final_screenshot']}]({folder}/{run['final_screenshot']})",
        ]
        videos = run.get("videos") or []
        has_main_video = "video.webm" in videos  # los minutos de los pasos son de la primera pestaña
        if videos:
            links = ", ".join(f"[{video}]({folder}/{video})" for video in videos)
            note = " (uno por pestaña; los minutos de los pasos son del primero)" if len(videos) > 1 else ""
            lines.append(f"- **Video:** {links}{note}")
        lines += [
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
            "| # | Hora | Acción | Esperaba | Quedó en | Señales | Captura |" + (" Video |" if has_main_video else ""),
            "|---|---|---|---|---|---|---|" + ("---|" if has_main_video else ""),
        ]
        offset = run.get("video_offset_s", 0.0)
        for step in run["steps"]:
            signals = ", ".join(_SIGNAL_LABELS.get(signal, signal) for signal in step["signals"]) or "—"
            video_cell = ""
            if has_main_video:
                if step.get("executed_at"):  # el segundo exacto de la acción
                    video_cell = f" {_video_time(offset + step['executed_s'])} |"
                else:  # corridas anteriores: solo se sabe el tramo en que ocurrió
                    start = offset + step["seconds_since_start"] - step["duration_s"]
                    video_cell = f" {_video_time(start)}–{_video_time(offset + step['seconds_since_start'])} |"
            lines.append(
                f"| {step['number']} | {_clock(step.get('executed_at'))} | {_cell(action_with_target(step))} | {_cell(step['expectation'])} | "
                f"{_cell(step['title'] or step['url'])} | {signals} | [{step['screenshot']}]({folder}/{step['screenshot']}) |"
                + video_cell
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
