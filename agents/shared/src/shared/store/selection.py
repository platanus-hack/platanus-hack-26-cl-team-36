"""Elección del backend con una URL: `file:///ruta` o `s3://bucket/prefijo`."""

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from shared.store.backend import Backend
from shared.store.local import LocalBackend
from shared.store.s3 import S3Backend

ENV_VAR = "AGENTS_STORE"


def default_root() -> Path:
    """`agents/.runs/`, que solo se ubica si el paquete está instalado editable dentro de `agents/`."""
    agents = Path(__file__).resolve().parents[4]
    if not (agents / "shared" / "pyproject.toml").is_file():
        raise RuntimeError(f"define {ENV_VAR}: el paquete no está instalado editable dentro de agents/")
    return agents / ".runs"


def open_backend(url: str | None = None) -> Backend:
    """Backend de `url`, o de la variable AGENTS_STORE, o `agents/.runs/` si no hay ninguna."""
    url = url or os.environ.get(ENV_VAR)
    if not url:
        return LocalBackend(default_root())
    parts = urlsplit(url)
    if parts.scheme == "file" and parts.netloc in ("", "localhost") and parts.path:
        return LocalBackend(Path(unquote(parts.path)))
    if parts.scheme == "s3" and parts.netloc:
        return S3Backend(parts.netloc, parts.path)
    raise ValueError(f"{ENV_VAR} debe ser file:///ruta o s3://bucket/prefijo: {url!r}")
