"""Retention pruning deletes only rows past the window."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from alerting.retention import RETENTION, prune_fast_failure_events

NOW = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)


class FakeCursor:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class FakeConnection:
    def __init__(self, rowcount: int = 0) -> None:
        self.statements: list[tuple[str, tuple[Any, ...]]] = []
        self.rowcount = rowcount
        self.transaction_depth = 0

    def transaction(self) -> "FakeConnection":
        return self

    def __enter__(self) -> "FakeConnection":
        self.transaction_depth += 1
        return self

    def __exit__(self, *args: Any) -> None:
        self.transaction_depth -= 1

    def execute(self, sql: str, params: tuple[Any, ...]) -> FakeCursor:
        self.statements.append((sql, params))
        return FakeCursor(self.rowcount)


def test_prune_deletes_events_older_than_seven_days_inside_a_transaction() -> None:
    connection = FakeConnection(rowcount=3)

    pruned = prune_fast_failure_events(connection, now=NOW)

    assert pruned == 3
    assert connection.transaction_depth == 0
    sql, params = connection.statements[0]
    assert sql == (
        "DELETE FROM alerting_fast_failure_events WHERE finished_at < %s"
    )
    assert params == (NOW - timedelta(days=7),)


def test_retention_window_is_seven_days() -> None:
    assert RETENTION == timedelta(days=7)
