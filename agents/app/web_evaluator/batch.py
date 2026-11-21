"""Una tanda: criterio de éxito, usuarios en paralelo, veredictos, árbol de rutas y reporte."""

import asyncio
import functools
import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from playwright.async_api import Browser, async_playwright

import config
import report
from browser import BrowserSession, connect_browser, create_context
from engines import ApiEngine, ClaudeCodeEngine
from harness import SyntheticUser
from judge import ApiJudge, ClaudeCodeJudge, judge_run, propose_criteria
from profiles import PROFILES, Profile
from recording import Run
from route_tree import build_route_tree

_CRITERIA_PROFILE = Profile("criteria", "Criterio", 1024, 768, False, "")
_INTERRUPTED_REASONS = {"refusal", "api_error", "no_response", "internal_error"}
_EXHAUSTED_REASONS = {
    "step_limit": "Se agotaron las acciones disponibles",
    "time_limit": "Se agotó el tiempo disponible",
}


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


async def _criteria_for(judge, browser: Browser, url: str, instruction: str) -> dict:
    fallback = {"criterion": f"La pantalla final muestra que se cumplió la tarea: {instruction}", "evidence": []}
    context = await create_context(browser, _CRITERIA_PROFILE)
    try:
        session = BrowserSession(context, _CRITERIA_PROFILE)
        await session.open(url)
        start_screenshot = await session.screenshot()
    except Exception as error:  # si la página inicial no carga, la tanda sigue con el criterio de la tarea
        print(f"[criterio] no se pudo abrir la página inicial ({error}); se usa la tarea como criterio", flush=True)
        criteria = fallback
    else:
        try:
            criteria = await propose_criteria(judge, instruction, start_screenshot)
        except Exception as error:  # sin criterio igual se puede juzgar con la tarea
            print(f"[criterio] no se pudo generar ({error}); se usa la tarea como criterio", flush=True)
            criteria = fallback
    finally:
        await context.close()
    print(f"[criterio] {criteria['criterion']}", flush=True)
    return criteria


async def _record_verdict(judge, instruction: str, criteria: dict, run: Run, run_dir: Path) -> None:
    if run.end_reason in _INTERRUPTED_REASONS:
        # Un error técnico no es un abandono del usuario: se reporta aparte y no cuenta en el árbol.
        run.verdict = {
            "outcome": "interrupted",
            "justification": f"El intento se interrumpió por un error técnico ({run.end_reason}): {run.final_message}",
        }
    else:
        final_screenshot = (run_dir / run.final_screenshot).read_bytes()
        try:
            verdict = await judge_run(judge, instruction, criteria, final_screenshot, run.end_reason, run.final_message)
        except Exception as error:
            verdict = {"outcome": "abandoned", "justification": f"No se pudo obtener el veredicto: {error}"}
        if run.end_reason in _EXHAUSTED_REASONS:
            run.verdict = {
                "outcome": "abandoned",
                "justification": f"{_EXHAUSTED_REASONS[run.end_reason]}.",
                "model_verdict": verdict,
            }
        else:
            run.verdict = verdict
    run.save(run_dir)
    print(f"[{run.profile}] veredicto: {run.verdict['outcome']} — {run.verdict['justification']}", flush=True)


async def run_batch(
    url: str,
    instruction: str,
    profile_keys: list[str],
    output_dir: Path,
    engine: str = "claude-code",
    user_model: str = config.USER_MODEL,
    effort: str = config.USER_EFFORT,
    cdp_url: str | None = None,
    task_id: str | None = None,
) -> Path:
    """Corre una tanda y devuelve su carpeta, con report.md, route_tree.json y una carpeta por perfil."""
    batch_dir = output_dir / datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    batch_dir.mkdir(parents=True, exist_ok=False)

    # Claude Code corre en una carpeta vacía para no cargar CLAUDE.md ni memoria de ningún proyecto.
    claude_cwd = Path(tempfile.mkdtemp(prefix="web_evaluator-claude-"))
    if engine == "api":
        import anthropic

        client = anthropic.AsyncAnthropic()
        judge = ApiJudge(client)
        make_engine = functools.partial(ApiEngine, client, user_model, effort)
    else:
        judge = ClaudeCodeJudge(claude_cwd)
        make_engine = functools.partial(ClaudeCodeEngine, user_model, effort, claude_cwd)

    try:
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright, cdp_url)
            try:
                criteria_task = asyncio.create_task(_criteria_for(judge, browser, url, instruction))
                users = [
                    SyntheticUser(make_engine(), browser, PROFILES[key], url, instruction, batch_dir / key)
                    for key in profile_keys
                ]
                attempts = await asyncio.gather(*(user.attempt() for user in users), return_exceptions=True)
                criteria = await criteria_task
            finally:
                await browser.close()

        runs: list[Run] = []
        for user, attempt in zip(users, attempts):
            run = user.run
            if isinstance(attempt, BaseException):
                run.end_reason = "internal_error"
                run.final_message = f"{type(attempt).__name__}: {attempt}"[:300]
                print(f"[{run.profile}] error interno: {run.final_message}", flush=True)
            if not run.start:
                run.save(user.run_dir)
                continue  # ni siquiera cargó la página: no aporta al árbol
            runs.append(run)

        await asyncio.gather(*(
            _record_verdict(judge, instruction, criteria, run, batch_dir / run.profile) for run in runs
        ))
    finally:
        shutil.rmtree(claude_cwd, ignore_errors=True)

    run_dicts = [run.to_dict() for run in runs]
    # El árbol y la ruta recomendada solo usan intentos reales; los interrumpidos quedan en el reporte.
    tree = build_route_tree([r for r in run_dicts if r["verdict"].get("outcome") != "interrupted"])
    meta = {
        "url": url,
        "instruction": instruction,
        "task_id": task_id,
        "timestamp": batch_dir.name,
        "engine": engine,
        "user_model": user_model,
        "judge_model": config.JUDGE_MODEL,
        "effort": effort,
    }
    _write_json(batch_dir / "criteria.json", criteria)
    _write_json(batch_dir / "route_tree.json", {**meta, "criteria": criteria, **tree})
    (batch_dir / "report.md").write_text(report.generate(meta, criteria, run_dicts, tree), encoding="utf-8")
    return batch_dir
