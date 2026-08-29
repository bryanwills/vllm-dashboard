"""Tests for the command model and its deterministic idempotency key."""

from datetime import datetime, timedelta, timezone

import pytest

from alerting.commands import ScheduledCommand

PACIFIC = timezone(timedelta(hours=-7))


def test_naive_target_time_is_rejected() -> None:
    with pytest.raises(ValueError):
        naive = datetime(2026, 8, 27, 19, 0)  # noqa: DTZ001 — naive on purpose
        ScheduledCommand(command_type="full_ci_reconcile", target_time=naive)


def test_idempotency_key_is_deterministic() -> None:
    target = datetime(2026, 8, 27, 19, 0, tzinfo=PACIFIC)
    a = ScheduledCommand(command_type="full_ci_reconcile", target_time=target)
    b = ScheduledCommand(command_type="full_ci_reconcile", target_time=target)
    assert a.idempotency_key == b.idempotency_key


def test_idempotency_key_normalizes_equivalent_instants_across_zones() -> None:
    pacific = ScheduledCommand(
        command_type="fast_ci_scan",
        target_time=datetime(2026, 8, 27, 19, 0, tzinfo=PACIFIC),
    )
    utc = ScheduledCommand(
        command_type="fast_ci_scan",
        target_time=datetime(2026, 8, 28, 2, 0, tzinfo=timezone.utc),
    )
    assert pacific.idempotency_key == utc.idempotency_key


def test_idempotency_key_distinguishes_type_and_target() -> None:
    target = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)
    full = ScheduledCommand(command_type="full_ci_reconcile", target_time=target)
    fast = ScheduledCommand(command_type="fast_ci_scan", target_time=target)
    later = ScheduledCommand(
        command_type="full_ci_reconcile", target_time=target + timedelta(minutes=15)
    )
    assert len({full.idempotency_key, fast.idempotency_key, later.idempotency_key}) == 3


def test_subsecond_instants_do_not_collide() -> None:
    base = datetime(2026, 8, 27, 19, 0, 0, tzinfo=timezone.utc)
    a = ScheduledCommand(command_type="fast_ci_scan", target_time=base)
    b = ScheduledCommand(
        command_type="fast_ci_scan", target_time=base + timedelta(microseconds=500_000)
    )
    assert a.idempotency_key != b.idempotency_key
