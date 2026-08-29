"""ScheduledCommand model for the alerting runtime.

A command is a reconciliation wake-up produced by a scheduler tick. It carries
no credentials, CI logs, model output, or Slack payload; Postgres, not the
scheduler, determines which source observations remain unprocessed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ScheduledCommand:
    """A scheduled unit of work identified by its type and target time."""

    command_type: str
    target_time: datetime
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.target_time.tzinfo is None:
            raise ValueError("target_time must be timezone-aware")

    @property
    def idempotency_key(self) -> str:
        """Deterministic key: equal instants yield equal keys in any zone.

        Full microsecond precision, so distinct instants never collide.
        """
        utc = self.target_time.astimezone(timezone.utc)
        return f"{self.command_type}:{utc.isoformat(timespec='microseconds')}"
