"""Una tanda: criterio de éxito, usuarios en paralelo, veredictos, árbol de rutas y reporte."""

import asyncio
import functools
import hashlib
import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from playwright.async_api import Browser, async_playwright

import config
import proposal
import reference
import report
from browser import BrowserSession, NavegadorConTema, create_context, open_browsers, prohibido_en_tema
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


class TemaInvalido(ValueError):
    pass


def describir_tema(css_path: Path) -> tuple[str, dict]:
    """El CSS de un tema y cómo se registra en la tanda: archivo, sha256 corto y tamaño.

    Lanza TemaInvalido si el CSS trae algo que el filtro de la extensión borraría (`url(`, `@import`, barra
    invertida...): la tanda no mediría el tema que vería una persona.
    """
    contenido = css_path.read_bytes()
    prohibido = prohibido_en_tema(contenido.decode("utf-8"))
    if prohibido:
        raise TemaInvalido(
            f"el tema {css_path.name} trae {', '.join(prohibido)}, que la extensión filtra; quítalo antes de evaluarlo"
        )
    datos = {
        "archivo": css_path.name,
        "sha256": hashlib.sha256(contenido).hexdigest()[:12],
        "bytes": len(contenido),
    }
    return contenido.decode("utf-8"), datos


def models_for(engine: str, user_model: str | None = None) -> tuple[str, str]:
    """Los modelos (usuarios, juez). En AWS (bedrock) solo Sonnet 4.6; en local, Sonnet 5.5 y Opus (ver config.py)."""
    if engine == "bedrock":
        return user_model or config.BEDROCK_USER_MODEL, config.BEDROCK_JUDGE_MODEL
    return user_model or config.USER_MODEL, config.JUDGE_MODEL


async def run_batch(
    url: str,
    instruction: str,
    profile_keys: list[str],
    output_dir: Path,
    engine: str = "claude-code",
    user_model: str | None = None,
    effort: str = config.USER_EFFORT,
    cdp_url: str | None = None,
    task_id: str | None = None,
    browser: str = "local",
    record_video: bool = False,
    tema_css: Path | None = None,
) -> Path:
    """Corre una tanda y devuelve su carpeta, con report.md, route_tree.json y una carpeta por perfil.

    Con `tema_css`, cada página de cada usuario (y la del criterio) se ve con ese tema, como con la extensión. La
    tanda deja una copia en `tema.css` y lo registra en `route_tree.json` (`tema`), para distinguirla de una sin tema.
    """
    css, tema = describir_tema(tema_css) if tema_css else (None, None)
    batch_dir = output_dir / datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    batch_dir.mkdir(parents=True, exist_ok=False)
    if css is not None:
        (batch_dir / "tema.css").write_text(css, encoding="utf-8")
        print(f"[tema] {tema['archivo']} (sha256 {tema['sha256']})", flush=True)

    user_model, judge_model = models_for(engine, user_model)

    # Claude Code corre en una carpeta vacía para no cargar CLAUDE.md ni memoria de ningún proyecto.
    claude_cwd = Path(tempfile.mkdtemp(prefix="web_evaluator-claude-"))
    if engine in ("api", "bedrock"):
        import anthropic

        if engine == "bedrock":
            client = anthropic.AsyncAnthropicBedrock(aws_region=config.AWS_REGION)  # bedrock-runtime; ver config.py
            model_prefix = config.BEDROCK_MODEL_PREFIX
        else:
            client = anthropic.AsyncAnthropic()
            model_prefix = ""
        judge = ApiJudge(client, model=model_prefix + judge_model, fallbacks=engine == "api")
        make_engine = functools.partial(ApiEngine, client, model_prefix + user_model, effort)
    else:
        judge = ClaudeCodeJudge(claude_cwd, model=judge_model)
        make_engine = functools.partial(ClaudeCodeEngine, user_model, effort, claude_cwd)

    try:
        async with async_playwright() as playwright:
            browsers = open_browsers(playwright, browser, cdp_url)
            try:
                # Uno para el criterio y uno por usuario (en local, todos son el mismo Chromium).
                criteria_browser, *user_browsers = await asyncio.gather(
                    *(browsers.open() for _ in range(len(profile_keys) + 1))
                )
                if css is not None:
                    criteria_browser = NavegadorConTema(criteria_browser, css)
                    user_browsers = [NavegadorConTema(user_browser, css) for user_browser in user_browsers]
                criteria_task = asyncio.create_task(_criteria_for(judge, criteria_browser, url, instruction))
                users = [
                    SyntheticUser(
                        make_engine(), user_browser, PROFILES[key], url, instruction, batch_dir / key, record_video
                    )
                    for key, user_browser in zip(profile_keys, user_browsers)
                ]
                attempts = await asyncio.gather(*(user.attempt() for user in users), return_exceptions=True)
                criteria = await criteria_task
            finally:
                await browsers.close()

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
        "browser": browser,
        "user_model": user_model,
        "judge_model": judge_model,
        "effort": effort,
        "tema": tema,
    }
    _write_json(batch_dir / "criteria.json", criteria)
    _write_json(batch_dir / "route_tree.json", {**meta, "criteria": criteria, **tree})
    comparison = reference.compare_batch(output_dir, url, instruction, run_dicts)
    if comparison:
        comparison["proposals"] = proposal.write_proposals(output_dir, batch_dir, run_dicts, comparison)
        _write_json(batch_dir / "reference_comparison.json", comparison)
    (batch_dir / "report.md").write_text(report.generate(meta, criteria, run_dicts, tree, comparison), encoding="utf-8")
    return batch_dir
