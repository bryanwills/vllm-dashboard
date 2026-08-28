"""Sample alert push renders the real batch message layout."""

from __future__ import annotations

from datetime import datetime, timezone

from alerting.fast_ci import _build_message
from alerting.test_push import sample_events

NOW = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)


def test_sample_events_render_a_batch_message_with_both_jobs() -> None:
    text = _build_message(sample_events(NOW), 1, 1)

    assert "Fast CI job failure alert" in text
    assert "2 jobs failed" in text
    assert "amd-tests" in text
    assert "lint" in text
