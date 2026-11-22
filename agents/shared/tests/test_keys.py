import pytest

from shared.store import (
    InvalidKey,
    RunPrefix,
    cataloger,
    conductor,
    guide,
    improver,
    normalize_host,
    parse_key,
    summary,
    visitor,
)

RUN = "2026-11-21T10-44-22Z"


@pytest.mark.parametrize(
    ("url", "host"),
    [
        ("https://www.WOM.cl/baja?utm_source=x", "wom.cl"),
        ("http://example.com:80/", "example.com"),
        ("https://example.com:443", "example.com"),
        ("http://localhost:8080/app", "localhost:8080"),
        ("https://example.com:80", "example.com:80"),
        ("sii.cl", "sii.cl"),
        ("  www.sii.cl  ", "sii.cl"),
        ("https://www.Ñandú.cl/", "xn--and-6ma2c.cl"),
        ("https://wom.cl./baja", "wom.cl"),
    ],
)
def test_normalize_host(url: str, host: str) -> None:
    assert normalize_host(url) == host


@pytest.mark.parametrize(
    "url",
    [
        "",
        "https://",
        "https://[::1]:8000/",
        "https://ex_ample.com",
        "file:///etc/passwd",
        "https://wom.cl:99999",
        "a..b",
    ],
)
def test_normalize_host_rejects(url: str) -> None:
    with pytest.raises(InvalidKey):
        normalize_host(url)


def test_prefixes() -> None:
    assert str(cataloger("https://www.wom.cl")) == "wom.cl/cataloger"
    assert str(guide("wom.cl", "baja-fibra", "mobile")) == "wom.cl/guide/baja-fibra/mobile"
    assert str(visitor("wom.cl", "baja-fibra")) == "wom.cl/visitor/baja-fibra"
    assert str(summary("wom.cl")) == "wom.cl/summary"
    assert str(improver("https://www.wom.cl/baja")) == "wom.cl/improver"
    assert str(conductor("wom.cl")) == "wom.cl/conductor"


def test_files() -> None:
    run = visitor("wom.cl", "baja-fibra").run(RUN)
    assert run.file("report.md") == f"wom.cl/visitor/baja-fibra/{RUN}/report.md"
    assert run.file("step_00.png", "first_time") == f"wom.cl/visitor/baja-fibra/{RUN}/first_time/step_00.png"


@pytest.mark.parametrize(
    "key",
    [
        f"wom.cl/cataloger/{RUN}",
        f"wom.cl/cataloger/{RUN}/goals.json",
        f"wom.cl/summary/{RUN}_02/summary.md",
        f"wom.cl/improver/{RUN}/tema.css",
        f"wom.cl/conductor/{RUN}/manifest.json",
        f"localhost:8080/guide/baja-fibra/desktop/{RUN}/step_00.png",
        f"wom.cl/visitor/baja-fibra/{RUN}/route_tree.json",
        f"wom.cl/visitor/baja-fibra/{RUN}/first_time/video.webm",
    ],
)
def test_parse_round_trip(key: str) -> None:
    assert str(parse_key(key)) == key


def test_parse_parts() -> None:
    parts = parse_key(f"wom.cl/guide/baja-fibra/mobile/{RUN}/route.json")
    assert parts.run.prefix == RunPrefix("wom.cl", "guide", "baja-fibra", "mobile")
    assert (parts.run.run_id, parts.profile, parts.name) == (RUN, None, "route.json")


@pytest.mark.parametrize(
    "key",
    [
        "",
        "wom.cl/cataloger",
        f"wom.cl/optimizer/{RUN}",
        f"WOM.cl/cataloger/{RUN}",
        f"www.wom.cl/cataloger/{RUN}",
        f"../cataloger/{RUN}",
        f"wom.cl/cataloger/{RUN}/../x.json",
        f"wom.cl/cataloger/{RUN}/",
        f"wom.cl//cataloger/{RUN}",
        "wom.cl/cataloger/latest",
        "wom.cl/cataloger/2026-11-21T10-44-22Z_00",
        "wom.cl/cataloger/2026-13-21T10-44-22Z",
        f"wom.cl/cataloger/{RUN}/first_time/step_00.png",
        f"wom.cl/cataloger/{RUN}/goals",
        f"wom.cl/improver/baja-fibra/{RUN}",
        f"wom.cl/conductor/{RUN}/first_time/step_00.png",
        f"wom.cl/visitor/{RUN}/report.md",
        f"wom.cl/visitor/wom.cl-baja/{RUN}",
        f"wom.cl/visitor/Baja_Fibra/{RUN}",
        f"wom.cl/guide/baja-fibra/tablet/{RUN}",
        f"wom.cl/guide/baja-fibra/{RUN}",
        f"wom.cl/visitor/baja-fibra/{RUN}/first.time/step_00.png",
        f"wom.cl/visitor/baja-fibra/{RUN}/a/b/step_00.png",
        f"wom.cl/visitor/baja-fibra/{RUN}/.hidden.png",
        f"wom.cl\n/cataloger/{RUN}",
        f"wom.cl/visitor/baja-fibra\n/{RUN}",
        f"wom.cl/cataloger/{RUN}\n",
        f"wom.cl/cataloger/{RUN}/goals.json\n",
        f"wom.cl/visitor/baja-fibra/{RUN}/first_time\n/step_00.png",
    ],
)
def test_parse_rejects(key: str) -> None:
    with pytest.raises(InvalidKey):
        parse_key(key)


def test_prefix_rejects_wrong_shape() -> None:
    with pytest.raises(InvalidKey):
        RunPrefix("wom.cl", "cataloger", goal="baja-fibra")
    with pytest.raises(InvalidKey):
        RunPrefix("wom.cl", "visitor", goal="baja-fibra", viewport="desktop")
    with pytest.raises(InvalidKey):
        cataloger("wom.cl").run(RUN).file("step_00.png", "first_time")


def test_segments_reject_trailing_newline() -> None:
    run = visitor("wom.cl", "baja-fibra").run(RUN)
    for build in (
        lambda: RunPrefix("wom.cl\n", "cataloger"),
        lambda: RunPrefix("wom.cl", "visitor", goal="baja-fibra\n"),
        lambda: cataloger("wom.cl").run(f"{RUN}\n"),
        lambda: run.file("report.md\n"),
        lambda: run.file("step_00.png", "first_time\n"),
    ):
        with pytest.raises(InvalidKey):
            build()
