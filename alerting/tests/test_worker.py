"""Worker entry-point behavior."""

from datetime import datetime, timezone

import pytest

from alerting import worker
from alerting.commands import Command
from alerting.runtime import DispatchResult, ProcessResult, ProcessStatus


class RecordingRuntime:
    def __init__(self) -> None:
        self.commands: list[Command] = []
        self.dispatches = 0

    def process_command(self, command: Command) -> ProcessResult:
        self.commands.append(command)
        return ProcessResult(command.idempotency_key, ProcessStatus.COMPLETED)

    def dispatch_due_notifications(self) -> DispatchResult:
        self.dispatches += 1
        return DispatchResult(delivered=1)


def test_timer_worker_dispatches_notifications_after_reconciliation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = RecordingRuntime()
    monkeypatch.setattr(worker, "_runtime", lambda consumer, clock: runtime)
    monkeypatch.setattr(
        worker.SystemClock,
        "now",
        lambda self: datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc),
    )

    assert worker.main(["fast-ci"]) == 0
    assert [command.command_type for command in runtime.commands] == ["fast_ci_scan"]
    assert runtime.dispatches == 1
