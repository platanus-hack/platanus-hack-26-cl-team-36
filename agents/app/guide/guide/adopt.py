"""Adopción de una ruta propuesta por el Visitante: si al repetirla verifica y es más corta, pasa a ser la referencia.

Los localizadores salen del texto y el href que el Visitante registró del elemento clicado. La propuesta verifica si
llega a su página final y la cita de la referencia está en ella.
"""

import json
from dataclasses import replace
from pathlib import Path

from playwright.async_api import Browser

from shared import store
from shared.browser.keys import is_back_key
from shared.browser.viewports import SCREENS
from shared.nodes.urls import node_key

from guide.locators import resolve_visible
from guide.operate import Log
from guide.output import route_document, write_reference
from guide.replay import replay_route
from guide.route import Step, Target, totals

_CLICKS = {"left_click", "double_click", "triple_click"}
_IMPLICIT_ROLES = {"a": "link", "button": "button"}
_META_KEYS = ("goal", "instruction", "start_url", "viewport", "viewport_size", "model", "effort")


class Unresolvable(Exception):
    """Un paso de la propuesta no se puede repetir."""


def _target(element: dict) -> Target | None:
    text, href = element.get("text") or "", element.get("href")
    role = element.get("role") or _IMPLICIT_ROLES.get(element.get("tag") or "")
    locators = [{"by": "href", "value": href, "nth": 0}] if href else []
    if text:
        locators += [{"by": "role", "role": role, "value": text, "nth": 0}] if role else []
        locators.append({"by": "text", "value": text, "nth": 0})
    return Target(element.get("tag") or "", role, text, text, href, locators) if locators else None


def derive_steps(proposal: dict) -> list[Step]:
    """Los pasos de la Guía equivalentes a los del intento; el scroll se omite porque actuar sobre un elemento lo hace."""
    steps: list[Step] = []
    for raw in proposal["steps"]:
        action, value = raw["action"], (raw.get("action_input") or {}).get("text")
        where = (raw["url_before"], raw["title_before"], raw["url"], raw["title"])
        if action in _CLICKS:
            target = _target(raw.get("element") or {})
            if target is None:
                raise Unresolvable(f"paso {raw['number']}: el registro no tiene texto ni href del elemento")
            steps.append(Step("click", None, target, *where, None))
        elif action == "type" and steps and steps[-1].action == "click":
            steps[-1] = replace(steps[-1], action="fill", value=value, url_after=raw["url"], title_after=raw["title"])
        elif action == "key" and value:
            back = is_back_key(value)
            steps.append(Step("back" if back else "press", None if back else value, None, *where, None))
        elif action != "scroll":
            raise Unresolvable(f"paso {raw['number']}: «{raw['description']}» no tiene equivalente")
    return steps


async def adopt(browser: Browser, backend: store.Backend, route_run: store.RunKey, proposal: dict,
                visitor_run: store.RunKey, log: Log) -> str:
    """Verifica la propuesta contra la ruta de `route_run` y deja el resultado en una corrida nueva de guide.

    Si la propuesta es más corta, la corrida termina `succeeded` con la ruta adoptada; si no, termina `failed` con
    solo adoption.json. Sus `inputs` son la ruta y la corrida del Visitante, así la propuesta no se revisa dos veces.
    Devuelve `promoted`, `not_shorter`, `unverified` o `stale`.
    """
    route = backend.read_json(route_run.file("route.json"))

    def close(status: str, reason: str) -> str:
        run = store.start_run(backend, route_run.prefix, model=route.get("model"), inputs=(route_run, visitor_run))
        _write_outcome(run.workdir, status, reason, proposal)
        store.finish_run(backend, run, "failed")
        log(f"{route_run}: {status} — {reason}")
        return status

    if (proposal["start_url"], proposal["instruction"]) != (route["start_url"], route["instruction"]):
        return close("stale", "la referencia es de otra tarea")
    try:
        steps = derive_steps(proposal)
    except Unresolvable as error:
        return close("unverified", str(error))
    replay = await replay_route(browser, SCREENS[route["viewport"]], route["start_url"], steps, route["quote"],
                                resolve_visible)
    failure = replay.failure(proposal["final_node"])
    if failure:
        return close("unverified", failure)
    quote_scrolls = int(not replay.quote_on_screen)
    new_steps = totals(replay.steps, node_key(replay.start_url, replay.start_title), quote_scrolls)["min_steps"]
    previous = route["totals"]["min_steps"]
    if new_steps >= previous:
        return close("not_shorter", f"{new_steps} pasos mínimos; la referencia tiene {previous}")
    details = {
        **{key: route.get(key) for key in ("answer", "quote", "exploration", "search")},
        "quote_found": True,
        "verification": {"replays": 1, "removed_steps": 0, "error": None},
        "adopted_from": {"run": str(visitor_run), "profile": proposal["profile"], "previous_min_steps": previous},
    }
    document = route_document({key: route.get(key) for key in _META_KEYS}, "verified",
                              (replay.start_url, replay.start_title, replay.start_screenshot), replay.steps,
                              quote_scrolls, details)
    reason = f"{new_steps} pasos mínimos; la referencia tenía {previous}"
    with store.running(backend, route_run.prefix, model=route.get("model"), inputs=(route_run, visitor_run)) as run:
        write_reference(run.workdir, document, replay.start_screenshot, replay.steps)
        _write_outcome(run.workdir, "promoted", reason, proposal)
    log(f"{route_run}: promoted — {reason} — {run.key}")
    return "promoted"


def _write_outcome(workdir: Path, status: str, reason: str, proposal: dict) -> None:
    outcome = {"status": status, "reason": reason, "profile": proposal["profile"], "steps_count": proposal["steps_count"]}
    (workdir / "adoption.json").write_text(json.dumps(outcome, ensure_ascii=False, indent=2), encoding="utf-8")
