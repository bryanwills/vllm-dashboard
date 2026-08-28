"""Postgres Full CI transaction behavior through the runtime seam."""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from types import TracebackType
from typing import Any, Literal

from alerting.commands import Command
from alerting.full_ci import FullCIJobOutcome, FullCIReconciliationHandler, FullCIRun
from alerting.memory import FixedClock, RecordingSlackPort
from alerting.postgres import PostgresAlertStore
from alerting.runtime import AlertingRuntime, ProcessStatus

START = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)


class Result:
    def __init__(
        self,
        row: tuple[Any, ...] | None = None,
        rows: list[tuple[Any, ...]] | None = None,
        rowcount: int = 0,
    ) -> None:
        self._row = row
        self._rows = rows or []
        self.rowcount = rowcount

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
    def __init__(self) -> None:
        self.state: dict[str, Any] = {
            "executions": {},
            "runs": {},
            "jobs": {},
            "comparisons": {},
        }
        self.transaction_depth = 0
        self.fail_on_build_id: str | None = None

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
        if "SET status = 'running', attempts = attempts + 1" in statement:
            record = executions[params[1]]
            record.update(
                status="running", lease=params[0], attempts=record["attempts"] + 1
            )
            return Result(rowcount=1)
        if statement.startswith(
            "SELECT buildkite_build_id, scheduled_at FROM alerting_full_ci_runs"
        ):
            return Result(
                rows=[(row[0], row[2]) for row in self.state["runs"].values()]
            )
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            assert self.transaction_depth == 1
            return Result((None,))
        if statement.startswith("SELECT buildkite_build_id FROM alerting_full_ci_runs"):
            runs: dict[str, tuple[Any, ...]] = self.state["runs"]
            run_order = (params[0], params[1])
            if "ORDER BY scheduled_at DESC" in statement:
                match = max(
                    (row for row in runs.values() if (row[2], row[1]) < run_order),
                    key=lambda row: (row[2], row[1]),
                    default=None,
                )
            else:
                match = min(
                    (row for row in runs.values() if (row[2], row[1]) > run_order),
                    key=lambda row: (row[2], row[1]),
                    default=None,
                )
            return Result((match[0],) if match is not None else None)
        if statement.startswith("INSERT INTO alerting_full_ci_runs"):
            assert self.transaction_depth == 1
            build_id = params[0]
            if build_id == self.fail_on_build_id:
                self.fail_on_build_id = None
                raise RuntimeError("database connection lost")
            runs = self.state["runs"]
            if build_id in runs:
                return Result()
            runs[build_id] = params
            return Result((build_id,))
        if statement.startswith("INSERT INTO alerting_full_ci_comparisons"):
            assert self.transaction_depth == 1
            self.state["comparisons"][params[0]] = params[1]
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
        assert "INSERT INTO alerting_full_ci_job_outcomes" in sql
        for row in params:
            self.state["jobs"][(row[0], row[1])] = row[2:]
        return Result(rowcount=len(params))


class FixtureSource:
    def __init__(self, runs: list[FullCIRun]) -> None:
        self.runs = runs

    def fetch_runs(
        self,
        *,
        start_time: datetime | None,
        processed_build_ids: frozenset[str],
        up_to: datetime,
    ) -> list[FullCIRun]:
        return [run for run in self.runs if run.build_id not in processed_build_ids]


def make_full_ci_run(build_number: int, scheduled_at: datetime) -> FullCIRun:
    return FullCIRun(
        build_id=f"build-{build_number}",
        build_number=build_number,
        scheduled_at=scheduled_at,
        commit_sha=f"commit-{build_number}",
        message="Full CI run - nightly",
        state="passed",
        jobs=(FullCIJobOutcome("GPU correctness", "passed", False),),
    )


def test_postgres_failure_rolls_back_full_ci_results_before_retry() -> None:
    first = make_full_ci_run(100, START - timedelta(hours=12))
    second = make_full_ci_run(101, START - timedelta(hours=1))
    connection = FakePostgresConnection()
    store = PostgresAlertStore(lambda: connection)
    clock = FixedClock(START)
    runtime = AlertingRuntime(
        executions=store,
        outbox=store,
        slack=RecordingSlackPort(),
        clock=clock,
        handlers={
            "full_ci_reconcile": FullCIReconciliationHandler(
                source=FixtureSource([second, first]), store=store, clock=clock
            )
        },
    )
    command = Command(command_type="full_ci_reconcile", target_time=START)
    connection.fail_on_build_id = second.build_id

    assert runtime.process_command(command).status is ProcessStatus.FAILED
    assert connection.state["runs"] == {}
    assert connection.state["jobs"] == {}
    assert connection.state["comparisons"] == {}

    assert runtime.process_command(command).status is ProcessStatus.COMPLETED
    assert list(connection.state["runs"]) == ["build-100", "build-101"]
    assert list(connection.state["jobs"]) == [
        ("build-100", "GPU correctness"),
        ("build-101", "GPU correctness"),
    ]
    assert connection.state["comparisons"] == {"build-101": "build-100"}
    assert (
        connection.state["executions"][command.idempotency_key]["status"] == "completed"
    )
