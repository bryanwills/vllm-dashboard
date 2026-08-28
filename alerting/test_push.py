"""Send a sample Fast CI alert to Slack for visual testing.

Runs on the worker host, where load-secrets provides SLACK_BOT_TOKEN. Prints
the rendered message, then delivers it through the same port the runtime
uses, so what lands in the channel is what a real alert looks like.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from alerting.fast_ci import (
    FAST_CI_SLACK_CHANNEL,
    SLACK_BATCH_SIZE,
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


def events_from_database(database_url: str, limit: int) -> list[FastFailureEvent]:
    """Load the most recent real fast failure events from Postgres."""
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        rows = connection.execute(
            """
            SELECT buildkite_job_id, job_name, job_url, state, soft_failed,
                   duration_seconds, finished_at, build_url, message,
                   commit_sha, branch, author, pr_number, pipeline
            FROM alerting_fast_failure_events
            ORDER BY finished_at DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
    return [
        FastFailureEvent(
            job_id=str(row["buildkite_job_id"]),
            job_name=str(row["job_name"]),
            job_url=str(row["job_url"]),
            state=FastFailureState(str(row["state"])),
            soft_failed=bool(row["soft_failed"]),
            duration_seconds=int(row["duration_seconds"]),
            finished_at=row["finished_at"],
            build_url=str(row["build_url"]),
            message=str(row["message"]),
            commit_sha=str(row["commit_sha"]),
            branch=str(row["branch"]),
            author=str(row["author"]),
            pr_number=row["pr_number"],
            pipeline=str(row["pipeline"]),
        )
        for row in rows
    ]


def main(arguments: list[str] | None = None) -> int:
    args = arguments if arguments is not None else sys.argv[1:]
    from_database = "--from-db" in args

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError(
            "required environment variable is missing: SLACK_BOT_TOKEN"
        )

    now = datetime.now(timezone.utc)
    if from_database:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "required environment variable is missing: DATABASE_URL"
            )
        events = events_from_database(database_url, SLACK_BATCH_SIZE)
        if not events:
            print("no fast failure events in Postgres to send")
            return 1
    else:
        events = sample_events(now)

    text = _build_message(events, 1, 1)
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
