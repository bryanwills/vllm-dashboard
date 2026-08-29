-- Scheduled Full CI observations. Buildkite's globally unique build ID is the
-- durable identity; build number remains queryable for operator-facing views.
CREATE TABLE IF NOT EXISTS alerting_full_ci_runs (
    buildkite_build_id text PRIMARY KEY,
    build_number        bigint NOT NULL UNIQUE,
    scheduled_at       timestamptz NOT NULL,
    commit_sha          text NOT NULL,
    message             text NOT NULL,
    state               text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerting_full_ci_runs_schedule_idx
    ON alerting_full_ci_runs (scheduled_at, build_number);

-- Cross-run identity intentionally remains the current job name. One row per
-- name records the latest Buildkite attempt returned for that scheduled run.
CREATE TABLE IF NOT EXISTS alerting_full_ci_job_outcomes (
    buildkite_build_id text NOT NULL
        REFERENCES alerting_full_ci_runs(buildkite_build_id) ON DELETE CASCADE,
    job_name           text NOT NULL,
    state              text NOT NULL,
    soft_failed        boolean NOT NULL,
    PRIMARY KEY (buildkite_build_id, job_name)
);

-- Every run after the initial baseline points to its immediate chronological
-- predecessor. Current-run identity makes reconciliation retries idempotent.
CREATE TABLE IF NOT EXISTS alerting_full_ci_comparisons (
    current_build_id text PRIMARY KEY
        REFERENCES alerting_full_ci_runs(buildkite_build_id) ON DELETE CASCADE,
    previous_build_id text NOT NULL
        REFERENCES alerting_full_ci_runs(buildkite_build_id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (current_build_id <> previous_build_id)
);
