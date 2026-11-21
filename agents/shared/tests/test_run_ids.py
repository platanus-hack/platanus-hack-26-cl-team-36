from datetime import UTC, datetime, timedelta, timezone

import pytest

from shared.store import format_run_id, parse_run_id, sort_run_ids
from shared.store.run_ids import MAX_SEQUENCE, candidate_run_ids

MOMENT = datetime(2026, 11, 21, 10, 44, 22, 999_000, tzinfo=UTC)


def test_format_is_utc_to_the_second() -> None:
    chile = MOMENT.astimezone(timezone(timedelta(hours=-3)))
    assert format_run_id(chile) == "2026-11-21T10-44-22Z"
    assert format_run_id(MOMENT, 7) == "2026-11-21T10-44-22Z_07"


def test_format_rejects_naive_and_out_of_range() -> None:
    with pytest.raises(ValueError):
        format_run_id(datetime(2026, 11, 21))
    with pytest.raises(ValueError):
        format_run_id(MOMENT, MAX_SEQUENCE + 1)


def test_parse_round_trip() -> None:
    assert parse_run_id("2026-11-21T10-44-22Z_07") == (MOMENT.replace(microsecond=0), 7)
    assert format_run_id(*parse_run_id("2026-11-21T10-44-22Z_07")) == "2026-11-21T10-44-22Z_07"


def test_candidates_start_without_suffix() -> None:
    candidates = list(candidate_run_ids(MOMENT))
    assert candidates[:3] == ["2026-11-21T10-44-22Z", "2026-11-21T10-44-22Z_01", "2026-11-21T10-44-22Z_02"]
    assert len(candidates) == MAX_SEQUENCE + 1


def test_lexicographic_order_is_chronological() -> None:
    ids = [
        format_run_id(MOMENT + timedelta(seconds=1)),
        format_run_id(MOMENT, 10),
        format_run_id(MOMENT, 2),
        format_run_id(MOMENT),
        format_run_id(MOMENT - timedelta(days=400)),
    ]
    assert sort_run_ids(ids) == sorted(ids)
    assert sorted(f"{i}/" for i in ids) == [f"{i}/" for i in sorted(ids)]
    assert sort_run_ids(ids)[-1] == "2026-11-21T10-44-23Z"


def test_sort_drops_foreign_names() -> None:
    assert sort_run_ids(["latest", "first_time", "2026-11-21T10-44-22Z"]) == ["2026-11-21T10-44-22Z"]
