-- Immutable Fast CI observations. Buildkite job identity makes overlapping
-- cursor windows and duplicate reconciliation commands safe.
CREATE TABLE IF NOT EXISTS alerting_fast_failure_events (
    buildkite_job_id text PRIMARY KEY,
    job_name          text NOT NULL,
    job_url           text NOT NULL,
    state             text NOT NULL
                      CHECK (state IN ('failed', 'failing', 'broken', 'timed_out')),
    soft_failed       boolean NOT NULL,
    duration_seconds  integer NOT NULL CHECK (duration_seconds BETWEEN 0 AND 30),
    finished_at       timestamptz NOT NULL,
    build_url         text NOT NULL,
    message           text NOT NULL,
    commit_sha        text NOT NULL,
    branch            text NOT NULL,
    author             text NOT NULL,
    pr_number         text,
    pipeline          text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerting_fast_failure_events_finished_at_idx
    ON alerting_fast_failure_events (finished_at DESC);

-- Singleton durable cursor for Fast CI scans.
CREATE TABLE IF NOT EXISTS alerting_fast_ci_scan_cursors (
    cursor_name     text PRIMARY KEY CHECK (cursor_name = 'fast_ci'),
    scanned_through timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER alerting_fast_ci_scan_cursors_updated_at
    BEFORE UPDATE ON alerting_fast_ci_scan_cursors
    FOR EACH ROW EXECUTE FUNCTION alerting_set_updated_at();

-- One rendered Slack batch can cover up to eight events. This join keeps each
-- event's delivery state queryable without adding a resolution lifecycle.
CREATE TABLE IF NOT EXISTS alerting_fast_failure_notifications (
    buildkite_job_id text NOT NULL
        REFERENCES alerting_fast_failure_events(buildkite_job_id) ON DELETE CASCADE,
    delivery_id text NOT NULL
        REFERENCES alerting_notification_outbox(delivery_id) ON DELETE CASCADE,
    PRIMARY KEY (buildkite_job_id, delivery_id)
);
