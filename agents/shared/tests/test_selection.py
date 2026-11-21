from pathlib import Path

import pytest

from shared.store import ENV_VAR, LocalBackend, S3Backend, open_backend


def test_default_is_agents_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_VAR, raising=False)
    backend = open_backend()
    assert isinstance(backend, LocalBackend)
    assert backend.root == Path(__file__).resolve().parents[2] / ".runs"


def test_file_url(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(ENV_VAR, tmp_path.as_uri())
    backend = open_backend()
    assert isinstance(backend, LocalBackend)
    assert backend.root == tmp_path


def test_s3_url() -> None:
    backend = open_backend("s3://chameleon-runs/dev/")
    assert isinstance(backend, S3Backend)
    assert (backend.bucket, backend.prefix) == ("chameleon-runs", "dev/")
    bare = open_backend("s3://chameleon-runs")
    assert isinstance(bare, S3Backend)
    assert bare.prefix == ""


@pytest.mark.parametrize("url", ["/tmp/runs", "file://host/runs", "s3://", "gs://bucket/x"])
def test_rejects_other_urls(url: str) -> None:
    with pytest.raises(ValueError):
        open_backend(url)
