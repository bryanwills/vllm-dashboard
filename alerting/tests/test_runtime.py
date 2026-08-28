"""Tests for idempotent command processing through the runtime seam.

Behavior is observed only through the runtime interface and the execution
store's records — never through private helpers.
"""

from datetime import datetime, timezone

import pytest

from alerting.commands import Command
from alerting.memory import (
    FixedClock,
    InMemoryExecutionStore,
    InMemoryOutboxStore,
    RecordingSlackPort,
)
from alerting.ports import ExecutionStatus
from alerting.runtime import AlertingRuntime, ProcessStatus, UnknownCommandTypeError

START = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)


class CountingHandler:
    """Records how many times the runtime invoked it."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[Command] = []
        self.error = error

    def __call__(self, command: Command) -> None:
        self.calls.append(command)
        if self.error is not None:
            raise self.error


def make_runtime(
    handler: CountingHandler,
    clock: FixedClock,
    executions: InMemoryExecutionStore | None = None,
) -> AlertingRuntime:
    return AlertingRuntime(
        executions=executions or InMemoryExecutionStore(),
        outbox=InMemoryOutboxStore(),
        slack=RecordingSlackPort(),
        clock=clock,
        handlers={"full_ci_reconcile": handler},
    )


def test_processing_same_command_twice_runs_handler_once() -> None:
    handler = CountingHandler()
    executions = InMemoryExecutionStore()
    runtime = make_runtime(handler, FixedClock(START), executions)
    command = Command(command_type="full_ci_reconcile", target_time=START)

    first = runtime.process_command(command)
    second = runtime.process_command(command)

    assert first.status is ProcessStatus.COMPLETED
    assert second.status is ProcessStatus.SKIPPED_ALREADY_COMPLETED
    assert len(handler.calls) == 1
    record = executions.get(command.idempotency_key)
    assert record is not None
    assert record.status is ExecutionStatus.COMPLETED
    assert executions.count() == 1


def test_handler_failure_is_recorded_and_retryable() -> None:
    handler = CountingHandler(error=RuntimeError("buildkite unavailable"))
    executions = InMemoryExecutionStore()
    clock = FixedClock(START)
    runtime = make_runtime(handler, clock, executions)
    command = Command(command_type="full_ci_reconcile", target_time=START)

    failed = runtime.process_command(command)
    assert failed.status is ProcessStatus.FAILED
    record = executions.get(command.idempotency_key)
    assert record is not None
    assert record.status is ExecutionStatus.FAILED
    assert "buildkite unavailable" in (record.last_error or "")

    handler.error = None
    retried = runtime.process_command(command)
    assert retried.status is ProcessStatus.COMPLETED
    assert len(handler.calls) == 2
    record = executions.get(command.idempotency_key)
    assert record is not None
    assert record.status is ExecutionStatus.COMPLETED
    assert record.attempts == 2
    assert executions.count() == 1


def test_unexpired_lease_blocks_concurrent_processing() -> None:
    handler = CountingHandler()
    executions = InMemoryExecutionStore()
    clock = FixedClock(START)
    runtime = make_runtime(handler, clock, executions)
    command = Command(command_type="full_ci_reconcile", target_time=START)

    executions.claim(
        command, now=clock.now(), lease_until=clock.advance_preview(minutes=30)
    )
    result = runtime.process_command(command)

    assert result.status is ProcessStatus.SKIPPED_IN_PROGRESS
    assert handler.calls == []


def test_expired_lease_is_reclaimed() -> None:
    handler = CountingHandler()
    executions = InMemoryExecutionStore()
    clock = FixedClock(START)
    runtime = make_runtime(handler, clock, executions)
    command = Command(command_type="full_ci_reconcile", target_time=START)

    executions.claim(
        command, now=clock.now(), lease_until=clock.advance_preview(minutes=30)
    )
    clock.advance(minutes=31)
    result = runtime.process_command(command)

    assert result.status is ProcessStatus.COMPLETED
    assert len(handler.calls) == 1
    record = executions.get(command.idempotency_key)
    assert record is not None
    assert record.attempts == 2


def test_unknown_command_type_is_rejected_without_an_execution_record() -> None:
    handler = CountingHandler()
    executions = InMemoryExecutionStore()
    runtime = make_runtime(handler, FixedClock(START), executions)
    command = Command(command_type="mystery", target_time=START)

    with pytest.raises(UnknownCommandTypeError):
        runtime.process_command(command)
    assert executions.count() == 0
