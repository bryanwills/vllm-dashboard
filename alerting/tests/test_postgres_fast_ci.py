"""Postgres Fast CI transaction behavior through the runtime seam."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Literal

from alerting.commands import ScheduledCommand
from alerting.fast_ci import FastCIScanHandler, FastFailureEvent, FastFailureState
from alerting.memory import FixedClock, RecordingSlackPort
from alerting.postgres import PostgresAlertStore
from alerting.runtime import AlertingRuntime, ProcessStatus

START = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)


class Result:
    def __init__(
        self,
        row: tuple[Any, ...] | None = None,
        rowcount: int = 0,
        rows: list[tuple[Any, ...]] | None = None,
    ) -> None:
        self._row = row
        self.rowcount = rowcount
        self._rows = rows or []

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._row

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class Transaction:
    def __init__(self, connection: FakePostgresConnection) -> None:
        self.connection = connection
        self.snapshot: dict[str, Any] = {}

    def __enter__(self) -> None:
        self.snapshot = copy.deepcopy(self.connection.state)
        self.connection.transaction_depth += 1

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        self.connection.transaction_depth -= 1
        if exc_type is not None:
            self.connection.state = self.snapshot
        return False


class FakePostgresConnection:
    """Small transaction-capable DB fake for the production adapter contract."""

    def __init__(self) -> None:
        self.state: dict[str, Any] = {
            "executions": {},
            "events": {},
            "outbox": {},
            "notifications": [],
            "cursor": None,
            "stale_rows": [],
            "superseded": {},
            "imported_job_ids": set(),
        }
        self.transaction_depth = 0
        self.fail_on_cursor = False

    def __enter__(self) -> FakePostgresConnection:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        return False

    def transaction(self) -> Transaction:
        return Transaction(self)

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> Result:
        statement = " ".join(sql.split())
        executions: dict[str, dict[str, Any]] = self.state["executions"]
        if statement.startswith("INSERT INTO alerting_automation_executions"):
            key = params[0]
            if key in executions:
                return Result()
            executions[key] = {"status": "running", "lease": params[4], "attempts": 1}
            return Result((key,))
        if statement.startswith("SELECT status, lease_expires_at"):
            record = executions[params[0]]
            return Result((record["status"], record["lease"]))
        if statement.startswith("SELECT scanned_through"):
            cursor = self.state["cursor"]
            return Result((cursor,) if cursor is not None else None)
        if "SET status = 'running', attempts = attempts + 1" in statement:
            record = executions[params[1]]
            record.update(
                status="running", lease=params[0], attempts=record["attempts"] + 1
            )
            return Result(rowcount=1)
        if statement.startswith("INSERT INTO alerting_fast_failure_events"):
            assert self.transaction_depth == 1
            job_id = params[0]
            events: dict[str, tuple[Any, ...]] = self.state["events"]
            if job_id in events:
                return Result()
            events[job_id] = params
            return Result((job_id,))
        if statement.startswith(
            "SELECT buildkite_job_id FROM alerting_fast_ci_imported_deduplication_keys"
        ):
            return Result(
                rows=[
                    (job_id,)
                    for job_id in params[0]
                    if job_id in self.state["imported_job_ids"]
                ]
            )
        if statement.startswith("INSERT INTO alerting_notification_outbox"):
            assert self.transaction_depth == 1
            self.state["outbox"][params[0]] = params
            return Result(rowcount=1)
        if statement.startswith("WITH stale_fast_ci_outbox AS"):
            assert self.transaction_depth == 1
            return Result(rows=self.state["stale_rows"])
        if "SET superseded_by =" in statement:
            assert self.transaction_depth == 1
            for delivery_id in params[2]:
                self.state["superseded"][delivery_id] = params[0]
            return Result(rowcount=len(params[2]))
        if statement.startswith("INSERT INTO alerting_fast_ci_scan_cursors"):
            assert self.transaction_depth == 1
            if self.fail_on_cursor:
                self.fail_on_cursor = False
                raise RuntimeError("database connection lost")
            current = self.state["cursor"]
            self.state["cursor"] = (
                params[0] if current is None else max(current, params[0])
            )
            return Result(rowcount=1)
        if "SET status = 'completed'" in statement:
            assert self.transaction_depth == 1
            executions[params[1]].update(status="completed", lease=None)
            return Result(rowcount=1)
        if "SET status = 'failed'" in statement:
            executions[params[1]].update(status="failed", lease=None)
            return Result(rowcount=1)
        raise AssertionError(f"unexpected SQL: {statement}")

    def executemany(self, sql: str, params: list[tuple[Any, ...]]) -> Result:
        assert self.transaction_depth == 1
        assert "INSERT INTO alerting_fast_failure_notifications" in sql
        self.state["notifications"].extend(params)
        return Result(rowcount=len(params))


class FixtureSource:
    def fetch_failures(
        self, *, start_time: datetime, end_time: datetime
    ) -> list[FastFailureEvent]:
        return [
            FastFailureEvent(
                job_id="job-1",
                job_name="fast test",
                job_url="https://buildkite.com/vllm/ci/builds/123#job-1",
                state=FastFailureState.FAILED,
                soft_failed=False,
                duration_seconds=10,
                finished_at=end_time,
                build_url="https://buildkite.com/vllm/ci/builds/123",
                message="failed",
                commit_sha="abcdef",
                branch="main",
                author="tester",
                pr_number=None,
                pipeline="CI",
            )
        ]


def test_postgres_failure_rolls_back_events_outbox_and_cursor_before_retry() -> None:
    connection = FakePostgresConnection()
    store = PostgresAlertStore(lambda: connection)
    clock = FixedClock(START)
    runtime = AlertingRuntime(
        executions=store,
        outbox=store,
        slack=RecordingSlackPort(),
        clock=clock,
        handlers={
            "fast_ci_scan": FastCIScanHandler(
                source=FixtureSource(), store=store, clock=clock
            )
        },
    )
    command = ScheduledCommand(command_type="fast_ci_scan", target_time=START)
    connection.fail_on_cursor = True

    assert runtime.process_command(command).status is ProcessStatus.FAILED
    assert connection.state["events"] == {}
    assert connection.state["outbox"] == {}
    assert connection.state["notifications"] == []
    assert connection.state["cursor"] is None

    assert runtime.process_command(command).status is ProcessStatus.COMPLETED
    assert list(connection.state["events"]) == ["job-1"]
    assert len(connection.state["outbox"]) == 1
    assert len(connection.state["notifications"]) == 1
    assert connection.state["cursor"] == START
    assert (
        connection.state["executions"][command.idempotency_key]["status"] == "completed"
    )


def test_postgres_scan_does_not_repost_imported_legacy_job_id() -> None:
    connection = FakePostgresConnection()
    connection.state["imported_job_ids"].add("job-1")
    store = PostgresAlertStore(lambda: connection)
    clock = FixedClock(START)
    runtime = AlertingRuntime(
        executions=store,
        outbox=store,
        slack=RecordingSlackPort(),
        clock=clock,
        handlers={
            "fast_ci_scan": FastCIScanHandler(
                source=FixtureSource(), store=store, clock=clock
            )
        },
    )

    result = runtime.process_command(
        ScheduledCommand(command_type="fast_ci_scan", target_time=START)
    )

    assert result.status is ProcessStatus.COMPLETED
    assert connection.state["events"] == {}
    assert connection.state["outbox"] == {}
    assert connection.state["notifications"] == []


def test_postgres_consolidates_stale_fast_ci_batches_and_links_every_event() -> None:
    connection = FakePostgresConnection()
    connection.state["stale_rows"] = [
        (
            f"fast-ci:batch-{index // 8 + 1}",
            f"job-{index}",
            f"fast test {index}",
            f"https://buildkite.com/vllm/ci/builds/123#job-{index}",
            "failed",
            False,
            10,
            START,
            "https://buildkite.com/vllm/ci/builds/123",
            "Full CI run torch nightly",
            "abcdef0123456789",
            "main",
            "tester",
            None,
            "CI",
        )
        for index in range(10)
    ]
    store = PostgresAlertStore(lambda: connection)

    store.consolidate_stale_notifications(now=START)

    assert len(connection.state["outbox"]) == 1
    summary_id, summary = next(iter(connection.state["outbox"].items()))
    assert summary_id.startswith("fast-ci-recovery:")
    assert summary[2:4] == ("fast_ci", "live")
    payload = json.loads(summary[6])
    assert "Fast CI recovery summary" in payload["text"]
    assert payload["text"].count(":red_circle:") == 10
    assert len(connection.state["notifications"]) == 10
    assert {job_id for job_id, _ in connection.state["notifications"]} == {
        f"job-{index}" for index in range(10)
    }
    assert connection.state["superseded"] == {
        "fast-ci:batch-1": summary_id,
        "fast-ci:batch-2": summary_id,
    }
