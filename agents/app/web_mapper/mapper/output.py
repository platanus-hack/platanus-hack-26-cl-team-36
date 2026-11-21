"""Escritura de la ruta de referencia: route.json, route.md y una captura por paso."""

import json
from dataclasses import asdict
from pathlib import Path

from route_tree import node_key

from mapper.route import Step, totals


def _step_record(number: int, step: Step) -> dict:
    target = None
    if step.target:
        target = {key: value for key, value in asdict(step.target).items() if key != "locators"}
    return {
        "number": number,
        "label": step.label,
        "action": step.action,
        "value": step.value,
        "target": target,
        "locators": step.target.locators if step.target else [],
        "url_before": step.url_before,
        "title_before": step.title_before,
        "node_before": step.node_before,
        "url_after": step.url_after,
        "title_after": step.title_after,
        "node_after": step.node_after,
        "changes_node": step.changes_node,
        "in_viewport": step.in_viewport,
        "scrolls_needed": step.scrolls_needed,
        "ui_actions": step.ui_actions,
        "screenshot": f"step_{number:02d}.png",
    }


def route_document(meta: dict, status: str, start_url: str, start_title: str, steps: list[Step], details: dict) -> dict:
    """`meta`: tarea, viewport y modelo. `details`: respuesta, cita, exploración y verificación."""
    start_node = node_key(start_url, start_title)
    return {
        **meta,
        "status": status,
        **details,
        "totals": totals(steps, start_node),
        "start": {"url": start_url, "title": start_title, "node": start_node, "screenshot": "step_00.png"},
        "steps": [_step_record(number, step) for number, step in enumerate(steps, 1)],
    }


def route_markdown(document: dict) -> str:
    summary = document["totals"]
    lines = [
        f"# Ruta de referencia: {document['instruction']}",
        "",
        f"- Estado: **{document['status']}** · viewport {document['profile']} ({document['viewport']})",
        f"- Respuesta: {document['answer'] or '—'}",
        f"- Cita: «{document['quote']}» (en la página: {'sí' if document['quote_found'] else 'no'})" if document["quote"] else "- Cita: —",
        f"- Pasos mínimos: {summary['min_steps']} ({summary['actions']} acciones, {summary['estimated_scrolls']} scrolls,"
        f" {summary['distinct_pages']} páginas)",
        f"- Exploración: {document['exploration']['steps']} acciones, {document['exploration']['turns']} turnos,"
        f" US$ {document['exploration']['cost_usd']}",
        "",
        f"0. Inicio en «{document['start']['title']}» {document['start']['url']}",
    ]
    for step in document["steps"]:
        scroll = " (scroll antes)" if step["scrolls_needed"] else ""
        lines.append(f"{step['number']}. {step['label']}{scroll} → «{step['title_after']}» {step['url_after']}")
    return "\n".join(lines) + "\n"


def write_reference(out_dir: Path, document: dict, start_screenshot: bytes, steps: list[Step]) -> None:
    (out_dir / "step_00.png").write_bytes(start_screenshot)
    for number, step in enumerate(steps, 1):
        (out_dir / f"step_{number:02d}.png").write_bytes(step.screenshot)
    (out_dir / "route.json").write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "route.md").write_text(route_markdown(document), encoding="utf-8")
