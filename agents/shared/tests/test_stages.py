import pytest

from shared import stages, store

URL = "https://www.wom.cl/ayuda"
BASE = {"url": URL, "revision": "rev-1"}


def test_catalog():
    command = stages.command("catalog", BASE)
    assert command.app == "cataloger"
    assert command.argv == ["uv", "run", "--locked", "main.py", "--url", URL, "--revision", "rev-1", "--pages", "1"]
    assert command.prefix == store.cataloger(URL)


def test_guide_runs_the_route_subcommand_in_desktop():
    command = stages.command("guide", {**BASE, "goal": "baja-fibra"})
    assert command.app == "guide"
    assert command.args == ("route", "--url", URL, "--revision", "rev-1", "--goal", "baja-fibra")
    assert str(command.prefix) == "wom.cl/guide/baja-fibra/desktop"


def test_visitor_passes_profiles_and_runs_only_when_given():
    assert stages.command("visitor", {**BASE, "goal": "baja-fibra"}).args == (
        "--url", URL, "--revision", "rev-1", "--goal", "baja-fibra")
    command = stages.command("visitor", {**BASE, "goal": "baja-fibra", "profiles": "first_time, desktop", "runs": 2})
    assert command.args[-4:] == ("--profiles", "first_time,desktop", "--runs", "2")
    assert command.prefix == store.visitor(URL, "baja-fibra")


def test_improver_is_the_web_designer():
    command = stages.command("improver", {**BASE, "goal": "ignorado"})
    assert (command.app, command.args, command.prefix) == (
        "web_designer", ("--url", URL, "--revision", "rev-1"), store.improver(URL))


def test_revision_is_the_conductor():
    command = stages.command("revision", {**BASE, "goals_max": 3, "concurrency": 2, "runs": None})
    assert command.app == "conductor"
    assert command.args == ("--url", URL, "--revision", "rev-1", "--goals-max", "3", "--concurrency", "2")
    assert command.prefix == store.conductor(URL)


@pytest.mark.parametrize("stage, payload", [
    ("deploy", BASE),
    ("catalog", {"url": URL}),
    ("catalog", {"url": "", "revision": "rev-1"}),
    ("catalog", {"url": "--help", "revision": "rev-1"}),
    ("catalog", {"url": URL, "revision": "Rev_1"}),
    ("catalog", {"url": "https://bad_host/", "revision": "rev-1"}),
    ("guide", BASE),
    ("guide", {**BASE, "goal": "Baja Fibra"}),
    ("visitor", {**BASE, "goal": "g", "runs": 0}),
    ("visitor", {**BASE, "goal": "g", "runs": "2"}),
    ("visitor", {**BASE, "goal": "g", "runs": True}),
    ("visitor", {**BASE, "goal": "g", "profiles": "--css"}),
    ("visitor", {**BASE, "goal": "g", "profiles": "desktop,../x"}),
    ("visitor", {**BASE, "goal": "g", "runs": 10**9}),
    ("catalog", {"url": "file:///etc/passwd", "revision": "rev-1"}),
    ("catalog", {"url": "mailto:a@sitio.cl", "revision": "rev-1"}),
    ("catalog", {"url": "sitio.cl", "revision": "rev-1"}),
    ("catalog", {"url": "https://sitio.cl/a b", "revision": "rev-1"}),
    ("catalog", {"url": "https://sitio.cl/" + "a" * 3000, "revision": "rev-1"}),
    ("revision", {**BASE, "goals_max": 11}),
    ("revision", {**BASE, "concurrency": -1}),
])
def test_invalid_payloads(stage, payload):
    with pytest.raises(stages.InvalidPayload):
        stages.command(stage, payload)


def test_every_stage_has_an_app():
    assert set(stages.APPS) == set(stages.STAGES)
