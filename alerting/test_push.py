"""Send a sample Fast CI alert to Slack for visual testing.

Runs on the worker host, where load-secrets provides SLACK_BOT_TOKEN. Prints
the rendered message, then delivers it through the same port the runtime
uses, so what lands in the channel is what a real alert looks like.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from alerting.fast_ci import (
    FAST_CI_SLACK_CHANNEL,
    FastFailureEvent,
    FastFailureState,
    _build_message,
)
from alerting.ports import (
    AlertPath,
    DeliveryMode,
    DestinationMode,
    NotificationIntentRecord,
    OutboxStatus,
)
from alerting.slack import SlackDeliveryPort


def sample_events(now: datetime) -> list[FastFailureEvent]:
    """Two fake failures, enough to show the batch message layout."""
    return [
        FastFailureEvent(
            job_id="01990000-0000-7000-8000-000000000001",
            job_name="amd-tests",
            job_url="https://buildkite.com/vllm/ci/builds/12345#job-amd-tests",
            state=FastFailureState.FAILED,
            soft_failed=False,
            duration_seconds=187,
            finished_at=now - timedelta(minutes=4),
            build_url="https://buildkite.com/vllm/ci/builds/12345",
            message="Merge pull request #26801 from test-user/fix-kv-cache",
            commit_sha="1f4c9a2b7d3e5f6a8b9c0d1e2f3a4b5c6d7e8f90",
            branch="main",
            author="test-user",
            pr_number="26801",
            pipeline="ci",
        ),
        FastFailureEvent(
            job_id="01990000-0000-7000-8000-000000000002",
            job_name="lint",
            job_url="https://buildkite.com/vllm/ci/builds/12345#job-lint",
            state=FastFailureState.BROKEN,
            soft_failed=True,
            duration_seconds=42,
            finished_at=now - timedelta(minutes=2),
            build_url="https://buildkite.com/vllm/ci/builds/12345",
            message="Merge pull request #26801 from test-user/fix-kv-cache",
            commit_sha="1f4c9a2b7d3e5f6a8b9c0d1e2f3a4b5c6d7e8f90",
            branch="main",
            author="test-user",
            pr_number="26801",
            pipeline="ci",
        ),
    ]


def main() -> int:
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError(
            "required environment variable is missing: SLACK_BOT_TOKEN"
        )

    now = datetime.now(timezone.utc)
    text = _build_message(sample_events(now), 1, 1)
    print(text)

    delivery_id = f"fast-ci-test-push:{now.isoformat(timespec='seconds')}"
    record = NotificationIntentRecord(
        delivery_id=delivery_id,
        alert_ref=delivery_id,
        alert_path=AlertPath.FAST_CI,
        delivery_mode=DeliveryMode.LIVE,
        destination_mode=DestinationMode.BOT_TOKEN,
        destination=FAST_CI_SLACK_CHANNEL,
        payload={"text": text},
        status=OutboxStatus.PENDING,
        attempts=0,
        next_attempt_at=now,
    )
    slack_ts = SlackDeliveryPort(bot_token=token, webhook_urls={}).deliver(record)
    print(f"delivered to channel {FAST_CI_SLACK_CHANNEL}, slack_ts={slack_ts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
