"""Carpeta vacía para Claude Code: así no carga CLAUDE.md ni memoria de ningún proyecto."""

import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def claude_workdir(prefix: str) -> Iterator[Path]:
    path = Path(tempfile.mkdtemp(prefix=f"{prefix}-claude-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
