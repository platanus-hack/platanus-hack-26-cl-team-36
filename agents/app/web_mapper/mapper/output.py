"""Escritura de la ruta de referencia: route.json, route.md y una captura por paso."""

import json
from dataclasses import asdict
from pathlib import Path

from route_tree import node_key

from mapper.route import Step, route_nodes, totals


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
        "screenshot": f"step_{number:02d}.png" if step.screenshot else None,
    }


def route_document(
    meta: dict, status: str, start: tuple[str, str, bytes], steps: list[Step], quote_scrolls: int, details: dict
) -> dict:
    """`meta`: tarea, viewport y modelo. `start`: URL, título y captura. `details`: respuesta, cita, exploración y verificación."""
    start_url, start_title, start_screenshot = start
    start_node = node_key(start_url, start_title)
    return {
        **meta,
        "status": status,
        **details,
        "totals": totals(steps, start_node, quote_scrolls),
        "nodes": route_nodes(steps, start_node),
        "final_node": steps[-1].node_after if steps else start_node,
        "start": {"url": start_url, "title": start_title, "node": start_node,
                  "screenshot": "step_00.png" if start_screenshot else None},
        "steps": [_step_record(number, step) for number, step in enumerate(steps, 1)],
    }


def route_markdown(document: dict) -> str:
    summary, search = document["totals"], document["search"]
    tried = ", ".join(str(route["min_steps"] if route["min_steps"] is not None else route["status"])
                      for route in search["routes"])
    lines = [
        f"# Ruta de referencia: {document['instruction']}",
        "",
        f"- Estado: **{document['status']}** · viewport {document['viewport']} ({document['viewport_size']})",
        f"- Respuesta: {document['answer'] or '—'}",
        f"- Cita: «{document['quote']}» (en la página: {'sí' if document['quote_found'] else 'no'})" if document["quote"] else "- Cita: —",
        f"- Pasos mínimos: {summary['min_steps']} ({summary['actions']} acciones,"
        f" {summary['estimated_scrolls'] + summary['quote_scrolls']} scrolls,"
        f" {summary['distinct_pages']} páginas)",
        f"- Exploración: {document['exploration']['steps']} acciones, {document['exploration']['turns']} turnos,"
        f" US$ {document['exploration']['cost_usd']}",
        f"- Rutas exploradas: {search['tried']} (pasos mínimos: {tried}; se eligió la {search['chosen']})",
        "",
        f"0. Inicio en «{document['start']['title']}» {document['start']['url']}",
    ]
    for step in document["steps"]:
        scroll = " (scroll antes)" if step["scrolls_needed"] else ""
        lines.append(f"{step['number']}. {step['label']}{scroll} → «{step['title_after']}» {step['url_after']}")
    return "\n".join(lines) + "\n"


def write_reference(out_dir: Path, document: dict, start_screenshot: bytes, steps: list[Step]) -> None:
    screenshots = {"step_00.png": start_screenshot}
    screenshots.update({f"step_{number:02d}.png": step.screenshot for number, step in enumerate(steps, 1)})
    for name, png in screenshots.items():
        if png:
            (out_dir / name).write_bytes(png)
    (out_dir / "route.json").write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "route.md").write_text(route_markdown(document), encoding="utf-8")
