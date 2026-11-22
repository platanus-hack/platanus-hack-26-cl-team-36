"""La corrida del conductor en el almacén: `<host>/conductor/<run>/` con `conductor.json`, lo que pasó en cada etapa."""

import argparse
import asyncio
import json

from shared import store

from conductor import config
from conductor.flow import Options, conduct
from conductor.invokers import make_invoker

REPORT = "conductor.json"


def _positive(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        number = 0
    if number < 1:
        raise argparse.ArgumentTypeError("usa un entero mayor que 0")
    return number


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--url", required=True, help="página de la revisión")
    parser.add_argument("--revision", required=True, help="id de la revisión: [a-z0-9]+(-[a-z0-9]+)*, máx. 40")
    parser.add_argument("--goals-max", type=_positive, default=config.GOALS_MAX,
                        help=f"objetivos evaluables que se recorren (por defecto: {config.GOALS_MAX})")
    parser.add_argument("--profiles", default=None, help="perfiles del Visitante (por defecto, los suyos)")
    parser.add_argument("--runs", type=_positive, default=config.RUNS,
                        help=f"intentos por perfil del Visitante (por defecto: {config.RUNS})")
    parser.add_argument("--concurrency", type=_positive, default=config.CONCURRENCY,
                        help=f"objetivos a la vez (por defecto: {config.CONCURRENCY})")


def log(text: str) -> None:
    print(f"[conductor] {text}", flush=True)


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> bool:
    """Corre la revisión; True si su corrida quedó `succeeded`."""
    try:
        store.validate_revision(args.revision)
        prefix = store.conductor(args.url)
    except ValueError as error:
        parser.error(str(error))
    backend = store.open_backend()
    conductor_run = store.start_run(backend, prefix, model=None, revision=args.revision)
    log(f"revisión {args.revision} de {args.url}: {conductor_run.key}")
    report: dict = {"url": args.url, "revision": args.revision, "status": "failed"}
    try:
        options = Options(args.goals_max, args.profiles, args.runs, args.concurrency, config.timeouts())
        invoker = make_invoker(backend, conductor_run.workdir)
        report = asyncio.run(conduct(backend, invoker, args.url, args.revision, options, log))
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        # También ante una interrupción: la corrida no queda `running` para siempre.
        (conductor_run.workdir / REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                                    encoding="utf-8")
        store.finish_run(backend, conductor_run, "succeeded" if report["status"] == "succeeded" else "failed")
    log(f"{report['status']}{' — ' + report['error'] if report.get('error') else ''}: {conductor_run.key.file(REPORT)}")
    return report["status"] == "succeeded"
