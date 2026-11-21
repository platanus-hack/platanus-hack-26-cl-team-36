"""Ids de corrida: el instante UTC de inicio, que ordena lexicográficamente."""

import re
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, datetime

Clock = Callable[[], datetime]

MAX_SEQUENCE = 99
_FORMAT = "%Y-%m-%dT%H-%M-%SZ"
_RUN_ID = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:_(0[1-9]|[1-9]\d))?$")


def utc_now() -> datetime:
    return datetime.now(UTC)


def format_run_id(moment: datetime, sequence: int = 0) -> str:
    if moment.tzinfo is None:
        raise ValueError("el reloj debe entregar una hora con zona horaria")
    if not 0 <= sequence <= MAX_SEQUENCE:
        raise ValueError(f"secuencia fuera de 0..{MAX_SEQUENCE}: {sequence}")
    base = moment.astimezone(UTC).strftime(_FORMAT)
    return base if sequence == 0 else f"{base}_{sequence:02d}"


def candidate_run_ids(moment: datetime) -> Iterator[str]:
    """Sin sufijo y luego `_01`…`_99`: queda el primero libre bajo el prefijo, y `_` ordena después de `Z` y de `/`."""
    for sequence in range(MAX_SEQUENCE + 1):
        yield format_run_id(moment, sequence)


def parse_run_id(run_id: str) -> tuple[datetime, int]:
    match = _RUN_ID.match(run_id)
    if match is None:
        raise ValueError(f"id de corrida inválido: {run_id!r}")
    moment = datetime.strptime(match[1], _FORMAT).replace(tzinfo=UTC)
    return moment, int(match[2] or 0)


def is_run_id(text: str) -> bool:
    try:
        parse_run_id(text)
    except ValueError:
        return False
    return True


def sort_run_ids(names: Iterable[str]) -> list[str]:
    """Los ids válidos de `names`, del más antiguo al más reciente; descarta el resto."""
    return sorted((name for name in names if is_run_id(name)), key=parse_run_id)
