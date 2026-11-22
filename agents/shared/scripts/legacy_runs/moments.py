"""Instantes de una corrida antigua en UTC."""

from collections.abc import Iterable
from datetime import UTC, datetime, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo

# La carpeta de una tanda es la hora local sin zona del computador que la corrió. La zona sale del `started_at` de
# algún run.json, que sí la lleva; sin ninguno, se asume la del equipo.
FALLBACK_ZONE = ZoneInfo("America/Santiago")
_BATCH_FORMAT = "%Y-%m-%d_%H-%M-%S"


def is_batch_name(name: str) -> bool:
    try:
        datetime.strptime(name, _BATCH_FORMAT)
    except ValueError:
        return False
    return True


def _zone(runs: Iterable[dict]) -> tzinfo:
    for run in runs:
        try:
            zone = datetime.fromisoformat(run.get("started_at") or "").tzinfo
        except (TypeError, ValueError):
            continue
        if zone is not None:
            return zone
    return FALLBACK_ZONE


def batch_moment(name: str, runs: Iterable[dict]) -> datetime:
    """El inicio de la tanda `name` (`YYYY-MM-DD_HH-MM-SS` local) en UTC."""
    return datetime.strptime(name, _BATCH_FORMAT).replace(tzinfo=_zone(runs)).astimezone(UTC)


def modified(paths: Iterable[Path]) -> datetime:
    """La última modificación de `paths` en UTC."""
    return datetime.fromtimestamp(max(path.stat().st_mtime for path in paths), UTC)
