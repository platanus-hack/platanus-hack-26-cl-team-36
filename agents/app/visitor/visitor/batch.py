"""Una tanda: usuarios en paralelo (`runs` intentos por perfil), su resultado, árbol de rutas y reporte.

El resultado de cada intento lo decide la ruta de la Guía (outcome.py); el juez, solo con `judge` y sin ruta.
"""

import asyncio
import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from playwright.async_api import Browser, async_playwright

from shared import store
from shared.browser.session import BrowserSession, create_context
from shared.browser.theme import NavegadorConTema, describir_tema
from shared.browser.viewports import SCREENS
from shared.claude.workdir import claude_workdir

from visitor import config, outcome, report
from visitor.api_engine import ApiEngine
from visitor.browsers import open_browsers
from visitor.claude_code_engine import ClaudeCodeEngine
from visitor.comparison import References, compare_batch, reference_for
from visitor.conocimiento import SIN_CONTEXTO, ConocimientoDeTarea
from visitor.harness import SyntheticUser
from visitor.judge import ApiJudge, ClaudeCodeJudge, judge_run, propose_criteria
from visitor.profiles import PROFILES
from visitor.proposal import proposals
from visitor.recording import Run
from visitor.route_tree import build_route_tree
from visitor.scripted_engine import NAME as SCRIPTED, RouteEngine

_CRITERIA_SCREEN = SCREENS["desktop"]
LiveTraces = Callable[[str, str], store.LiveTrace]
"""El trace.json de un intento: recibe su carpeta y su perfil."""

_EXHAUSTED_REASONS = {
    "step_limit": "Se agotaron las acciones disponibles",
    "time_limit": "Se agotó el tiempo disponible",
}


def attempt_folder(profile: str, attempt: int) -> str:
    """La carpeta de un intento: la del perfil para el primero, `<perfil>-<n>` para los siguientes."""
    return profile if attempt == 1 else f"{profile}-{attempt}"


def attempt_slots(profile_keys: list[str], runs: int) -> list[tuple[str, int]]:
    """(perfil, n.º de intento) de cada usuario de la tanda."""
    if runs < 1:
        raise ValueError("`runs` debe ser al menos 1")
    return [(key, attempt) for key in profile_keys for attempt in range(1, runs + 1)]


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


async def _criteria_for(judge, browser: Browser, url: str, instruction: str) -> dict:
    fallback = {"criterion": f"La pantalla final muestra que se cumplió la tarea: {instruction}", "evidence": []}
    context = await create_context(browser, _CRITERIA_SCREEN)
    try:
        session = BrowserSession(context, _CRITERIA_SCREEN)
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


async def _judge_verdict(judge, instruction: str, criteria: dict, run: Run, run_dir: Path) -> dict:
    final_screenshot = (run_dir / run.final_screenshot).read_bytes()
    try:
        verdict = await judge_run(judge, instruction, criteria, final_screenshot, run.end_reason, run.final_message)
    except Exception as error:
        verdict = {"outcome": "abandoned", "justification": f"No se pudo obtener el veredicto: {error}"}
    if run.end_reason in _EXHAUSTED_REASONS:
        verdict = {
            "outcome": "abandoned",
            "justification": f"{_EXHAUSTED_REASONS[run.end_reason]}.",
            "model_verdict": verdict,
        }
    return outcome.from_judge(run.to_dict(), verdict)


async def _record_verdict(run: Run, run_dir: Path, references: References, judge, instruction: str,
                          criteria: dict | None) -> None:
    data = run.to_dict()
    reference = reference_for(references, run.profile)
    if run.end_reason in outcome.INTERRUPTED_REASONS:
        # Un error técnico no es un abandono del usuario: se reporta aparte y no cuenta en el árbol.
        run.verdict = outcome.interrupted(data)
    elif reference:
        run.verdict = outcome.by_route(data, reference[1])
    elif judge is not None:
        run.verdict = await _judge_verdict(judge, instruction, criteria, run, run_dir)
    else:
        run.verdict = outcome.unmeasured(data)
    run.save(run_dir)
    print(f"[{run.folder}] resultado: {run.verdict['outcome']} — {run.verdict['justification']}", flush=True)


def models_for(engine: str, user_model: str | None = None) -> tuple[str, str]:
    """Los modelos (usuarios, juez). En AWS (bedrock), config.bedrock_model(); en local, Sonnet y Opus (config.py)."""
    if engine == SCRIPTED:
        return SCRIPTED, SCRIPTED
    if engine == "bedrock":
        return user_model or config.bedrock_model(), config.bedrock_model()
    return user_model or config.USER_MODEL, config.JUDGE_MODEL


def _client(engine: str):
    import anthropic

    if engine == "bedrock":
        return anthropic.AsyncAnthropicBedrock(aws_region=config.AWS_REGION)  # bedrock-runtime; ver config.py
    return anthropic.AsyncAnthropic()


def _engines(engine: str, client, user_model: str, effort: str, claude_cwd: Path, references: References):
    """La fábrica de motores de los usuarios para `engine`: recibe el perfil del usuario."""
    if engine == SCRIPTED:
        return lambda key: RouteEngine(found[1] if (found := reference_for(references, key)) else None)
    if client is not None:
        return lambda key: ApiEngine(client, user_model, effort)
    return lambda key: ClaudeCodeEngine(user_model, effort, claude_cwd)


def _judge(engine: str, client, judge_model: str, claude_cwd: Path):
    if client is not None:
        # Bedrock no tiene el parámetro `fallbacks`: ahí una negativa del modelo queda como error del juez.
        return ApiJudge(client, model=judge_model, fallbacks=engine == "api")
    return ClaudeCodeJudge(claude_cwd, model=judge_model)


async def _attempts(judge, make_engine, slots: list[tuple[str, int]], references: References, url: str,
                    instruction: str, batch_dir: Path, browser: str, cdp_url: str | None, record_video: bool,
                    css: str | None, conocimiento: ConocimientoDeTarea | None,
                    live: LiveTraces | None = None) -> tuple[list[Run], dict | None]:
    """Los intentos que cargaron la página, con su resultado, y el criterio del juez (None sin juez).

    Con `css`, todos con ese tema. Con `conocimiento`, los exploradores con nivel leen la tarea de su nivel; el criterio
    y el juez usan `instruction`.
    """
    async with async_playwright() as playwright:
        browsers = open_browsers(playwright, browser, cdp_url)
        try:
            # Uno por usuario y, con juez, uno para el criterio (en local, todos son el mismo Chromium).
            opened = await asyncio.gather(*(browsers.open() for _ in range(len(slots) + (judge is not None))))
            if css is not None:
                opened = [NavegadorConTema(item, css) for item in opened]
            criteria_task = (
                asyncio.create_task(_criteria_for(judge, opened[-1], url, instruction)) if judge is not None else None
            )
            users = [
                SyntheticUser(
                    make_engine(key), user_browser, PROFILES[key], url, instruction,
                    batch_dir / attempt_folder(key, attempt), record_video, conocimiento=conocimiento, attempt=attempt,
                    trace=live(attempt_folder(key, attempt), key) if live else None,
                )
                for (key, attempt), user_browser in zip(slots, opened)
            ]
            attempts = await asyncio.gather(*(user.attempt() for user in users), return_exceptions=True)
            criteria = await criteria_task if criteria_task else None
        finally:
            await browsers.close()

    runs: list[Run] = []
    for user, attempt in zip(users, attempts):
        run = user.run
        if isinstance(attempt, BaseException):
            run.end_reason = "internal_error"
            run.final_message = f"{type(attempt).__name__}: {attempt}"[:300]
            print(f"[{run.folder}] error interno: {run.final_message}", flush=True)
        if not run.start:
            run.save(user.run_dir)
            continue  # ni siquiera cargó la página: no aporta al árbol
        runs.append(run)

    await asyncio.gather(*(
        _record_verdict(run, batch_dir / run.folder, references, judge, instruction, criteria) for run in runs
    ))
    for user in users:
        if user.trace is not None and user.run.start:
            interrupted = user.run.end_reason in outcome.INTERRUPTED_REASONS
            user.trace.write("failed" if interrupted else "succeeded", user.run.start, user.run.to_dict()["steps"])
    return runs, criteria


async def _write_batch(batch_dir: Path, goal: str, url: str, instruction: str, profile_keys: list[str], runs: int,
                       references: References, judge: bool, engine: str, user_model: str, judge_model: str,
                       effort: str, cdp_url: str | None, browser: str, record_video: bool, tema_css: Path | None,
                       conocimiento: ConocimientoDeTarea | None, conjunto_exploradores: str | None,
                       live: LiveTraces | None = None) -> int:
    """Escribe la tanda en `batch_dir` y devuelve cuántos intentos no se interrumpieron."""
    css, tema = describir_tema(tema_css) if tema_css else (None, None)
    if css is not None:
        (batch_dir / "tema.css").write_text(css, encoding="utf-8")
        print(f"[tema] {tema['archivo']} (sha256 {tema['sha256']})", flush=True)
    # El juez solo se llama si algún perfil queda sin ruta: con ruta, decide el programa. El motor guionizado no tiene.
    judged = judge and engine != SCRIPTED and any(reference_for(references, key) is None for key in profile_keys)
    with claude_workdir("visitor") as claude_cwd:
        client = _client(engine) if engine in ("api", "bedrock") else None
        make_engine = _engines(engine, client, user_model, effort, claude_cwd, references)
        judge_agent = _judge(engine, client, judge_model, claude_cwd) if judged else None
        attempts, criteria = await _attempts(judge_agent, make_engine, attempt_slots(profile_keys, runs), references,
                                             url, instruction, batch_dir, browser, cdp_url, record_video, css,
                                             conocimiento, live)

    run_dicts = [run.to_dict() for run in attempts]
    # El árbol y la ruta recomendada solo usan intentos reales; los interrumpidos quedan en el reporte.
    tree = build_route_tree([r for r in run_dicts if r["verdict"].get("outcome") != "interrupted"])
    meta = {
        "url": url,
        "instruction": instruction,
        "task_id": goal,
        "timestamp": datetime.now().strftime("%Y-%m-%d_%H-%M-%S"),
        "engine": engine,
        "browser": browser,
        "user_model": user_model,
        "judge_model": judge_model if judged else None,
        "effort": effort if engine == "claude-code" or config.accepts_effort(user_model) else None,
        "runs": runs,
        "tema": tema,
        "conjunto_exploradores": conjunto_exploradores,
    }
    if any(PROFILES[key].conocimiento == SIN_CONTEXTO for key in profile_keys):
        meta["tarea_sin_contexto"] = (conocimiento or ConocimientoDeTarea()).description_sin_contexto
    if criteria is not None:
        _write_json(batch_dir / "criteria.json", criteria)
    _write_json(batch_dir / "route_tree.json", {**meta, "criteria": criteria, **tree})
    comparison = compare_batch(references, run_dicts)
    if comparison:
        found = proposals(run_dicts, comparison, references)
        comparison["proposals"] = [item["route"] for item in found]
        _write_json(batch_dir / "comparison.json", comparison)
        if found:
            _write_json(batch_dir / "proposals.json", found)
    (batch_dir / "report.md").write_text(report.generate(meta, criteria, run_dicts, tree, comparison), encoding="utf-8")
    return sum(run["verdict"].get("outcome") != "interrupted" for run in run_dicts)


class BatchInterrupted(Exception):
    """Ningún intento terminó: todos se interrumpieron por un error técnico o no cargaron la página."""

    def __init__(self, run: store.RunKey):
        super().__init__(f"todos los intentos se interrumpieron; la corrida {run} termina failed")
        self.run = run


async def run_batch(
    backend: store.Backend,
    prefix: store.RunPrefix,
    url: str,
    instruction: str,
    profile_keys: list[str],
    references: References,
    inputs: tuple[store.RunKey, ...] = (),
    runs: int = 1,
    judge: bool = False,
    revision: str | None = None,
    engine: str = "claude-code",
    user_model: str | None = None,
    effort: str = config.USER_EFFORT,
    cdp_url: str | None = None,
    browser: str = "local",
    record_video: bool = False,
    tema_css: Path | None = None,
    conocimiento: ConocimientoDeTarea | None = None,
    conjunto_exploradores: str | None = None,
) -> store.RunKey:
    """Una corrida de visitor: report.md, route_tree.json, comparison.json y una carpeta por intento.

    `runs` intentos por perfil (carpetas `<perfil>`, `<perfil>-2`...). Cada intento se mide contra la ruta de
    `references`; sin ella, con `judge` lo dictamina el juez y, sin juez, queda sin medir. `inputs`, las corridas de
    guide de `references` y `revision` quedan en el manifiesto. Si ningún intento terminó, la corrida termina `failed`
    (con su reporte) y lanza `BatchInterrupted`. Con `tema_css`, cada página de cada usuario (y la del criterio) se ve
    con ese tema, como con la extensión; la corrida deja una copia en `tema.css` y lo registra en `route_tree.json`.

    Con `conocimiento` (lo que la tarea dice de su tema), los exploradores con nivel leen la tarea de su nivel; el
    criterio y el juez usan siempre `instruction`. `conjunto_exploradores` se registra en `route_tree.json`:
    agrupa tandas y elige la vigente de cada conjunto.
    """
    slots = attempt_slots(profile_keys, runs)  # valida `runs` antes de abrir la corrida
    user_model, judge_model = models_for(engine, user_model)
    print(f"[tanda] {len(slots)} intento(s): {', '.join(attempt_folder(*slot) for slot in slots)}", flush=True)
    with store.running(backend, prefix, model=user_model, revision=revision,
                       inputs=(*inputs, *(key for key, _ in references.values()))) as run:
        finished = await _write_batch(run.workdir, prefix.goal, url, instruction, profile_keys, runs, references,
                                      judge, engine, user_model, judge_model, effort, cdp_url, browser, record_video,
                                      tema_css, conocimiento, conjunto_exploradores,
                                      lambda folder, profile: store.LiveTrace(backend, run, "visitor", profile, folder))
        if not finished:
            raise BatchInterrupted(run.key)
    return run.key
