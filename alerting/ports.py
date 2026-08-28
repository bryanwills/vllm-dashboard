"""Ports (protocols) between the runtime core and its infrastructure.

Production adapters connect these to Postgres and Slack; tests use the
in-memory adapters in `alerting.memory`. Source-system ports live alongside
their consumers, beginning with the Fast CI Databricks port in `fast_ci`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Protocol

from alerting.commands import Command


class ExecutionStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ClaimOutcome(Enum):
    CLAIMED = "claimed"
    ALREADY_COMPLETED = "already_completed"
    LEASE_HELD = "lease_held"


@dataclass
class ExecutionRecord:
    """State of one command execution, keyed by its idempotency key."""

    idempotency_key: str
    command_type: str
    schema_version: int
    target_time: datetime
    status: ExecutionStatus
    attempts: int
    lease_expires_at: datetime | None = None
    last_error: str | None = None
    completed_at: datetime | None = None


class OutboxStatus(Enum):
    PENDING = "pending"
    RETRYING = "retrying"
    DELIVERED = "delivered"
    DEAD_LETTER = "dead_letter"


class DestinationMode(Enum):
    WEBHOOK = "webhook"
    BOT_TOKEN = "bot_token"


@dataclass(frozen=True)
class OutboxMessage:
    """A rendered notification to enqueue.

    `destination` never contains a secret: it is a channel ID for bot-token
    delivery, or a logical webhook name resolved from the environment at
    delivery time.
    """

    delivery_id: str
    alert_ref: str
    destination_mode: DestinationMode
    destination: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class OutboxRecord:
    """Delivery state of one enqueued notification."""

    delivery_id: str
    alert_ref: str
    destination_mode: DestinationMode
    destination: str
    payload: dict[str, Any]
    status: OutboxStatus
    attempts: int
    next_attempt_at: datetime
    created_at: datetime | None = None
    lease_expires_at: datetime | None = None
    slack_ts: str | None = None
    last_error: str | None = None
    superseded_by: str | None = None


class SlackTransientError(Exception):
    """Delivery failed but may succeed later (network error, 5xx, rate limit)."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class SlackPermanentError(Exception):
    """Delivery can never succeed (invalid payload, bad credentials/config)."""


class Clock(Protocol):
    def now(self) -> datetime: ...


class ExecutionStore(Protocol):
    """Postgres port for the automation-executions table."""

    def claim(
        self, command: Command, *, now: datetime, lease_until: datetime
    ) -> ClaimOutcome: ...

    def complete(self, idempotency_key: str, *, now: datetime) -> None: ...

    def fail(self, idempotency_key: str, error: str, *, now: datetime) -> None: ...

    def get(self, idempotency_key: str) -> ExecutionRecord | None: ...


class OutboxStore(Protocol):
    """Postgres port for the notification-outbox table."""

    def enqueue(
        self,
        message: OutboxMessage,
        *,
        now: datetime,
        next_attempt_at: datetime | None = None,
    ) -> None:
        """Insert the message; an existing `delivery_id` is a silent no-op
        (Postgres: INSERT ... ON CONFLICT (delivery_id) DO NOTHING), so a
        retried handler can safely re-enqueue its deterministic delivery IDs.
        """
        ...

    def lease_due(
        self, *, now: datetime, lease_until: datetime, limit: int
    ) -> list[OutboxRecord]:
        """Lease up to `limit` due pending/retrying records until `lease_until`.

        Leasing MUST increment each record's attempts, and the returned
        records carry the incremented count — the runtime's max-attempts
        dead-letter check depends on it.
        """
        ...

    def mark_delivered(
        self, delivery_id: str, *, slack_ts: str | None, now: datetime
    ) -> None: ...

    def mark_retrying(
        self, delivery_id: str, *, error: str, next_attempt_at: datetime, now: datetime
    ) -> None:
        """MUST NOT regress a record already delivered (Postgres:
        UPDATE ... WHERE status <> 'delivered'), so a dispatcher whose lease
        expired mid-flight cannot cause a duplicate delivery.
        """
        ...

    def mark_dead_letter(self, delivery_id: str, *, error: str, now: datetime) -> None:
        """Same delivered-guard as mark_retrying."""
        ...

    def get_outbox(self, delivery_id: str) -> OutboxRecord | None: ...


class SlackPort(Protocol):
    """Delivers one outbox record; returns the Slack message timestamp if any."""

    def deliver(self, record: OutboxRecord) -> str | None: ...
