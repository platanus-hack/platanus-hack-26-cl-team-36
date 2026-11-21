from datetime import UTC, datetime, timedelta

from shared import store
from shared.catalog.routes import current_route, current_visit, verified_route

URL = "https://www.sitio.cl/"
MOMENT = datetime(2026, 11, 21, tzinfo=UTC)


def _publish(backend, prefix, name, data, minutes, status="succeeded"):
    run = store.start_run(backend, prefix, model=None, clock=lambda: MOMENT + timedelta(minutes=minutes))
    backend.write_json(run.key.file(name), data)
    store.finish_run(backend, run, status)
    return run.key


def test_a_newer_route_for_another_instruction_does_not_hide_the_goal_route(tmp_path):
    backend = store.LocalBackend(tmp_path)
    prefix = store.guide(URL, "baja", "desktop")
    mine = _publish(backend, prefix, "route.json", {"status": "verified", "start_url": URL, "instruction": "Mía."}, 0)
    _publish(backend, prefix, "route.json", {"status": "verified", "start_url": URL, "instruction": "Otra."}, 1)
    _publish(backend, prefix, "route.json", {"status": "verified", "start_url": URL, "instruction": "Mía."}, 2, "failed")
    assert verified_route(backend, URL, "baja", "desktop", "Mía.")[0] == mine
    assert current_route(backend, URL, "baja", "desktop", "Ninguna.") is None


def test_the_current_visit_is_the_newest_succeeded_one_for_the_instruction(tmp_path):
    backend = store.LocalBackend(tmp_path)
    prefix = store.visitor(URL, "baja")
    mine = _publish(backend, prefix, "route_tree.json", {"url": URL, "instruction": "Mía."}, 0)
    _publish(backend, prefix, "route_tree.json", {"url": URL, "instruction": "Otra."}, 1)
    assert current_visit(backend, URL, "baja", "Mía.")[0] == mine
