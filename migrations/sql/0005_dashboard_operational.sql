-- Queue observations and queue-alert delivery state used by dashboard routes.
CREATE TABLE IF NOT EXISTS queue_snapshots (
    id             serial PRIMARY KEY,
    polled_at      timestamptz NOT NULL DEFAULT now(),
    queue          text NOT NULL,
    agents_idle    integer NOT NULL DEFAULT 0,
    agents_busy    integer NOT NULL DEFAULT 0,
    agents_total   integer NOT NULL DEFAULT 0,
    jobs_scheduled integer NOT NULL DEFAULT 0,
    jobs_running   integer NOT NULL DEFAULT 0,
    jobs_waiting   integer NOT NULL DEFAULT 0,
    jobs_total     integer NOT NULL DEFAULT 0,
    p50_wait_secs  real,
    p90_wait_secs  real,
    p95_wait_secs  real,
    p99_wait_secs  real
);

CREATE INDEX IF NOT EXISTS idx_snapshots_polled_queue
    ON queue_snapshots (polled_at DESC, queue);

CREATE INDEX IF NOT EXISTS idx_snapshots_queue_polled
    ON queue_snapshots (queue, polled_at DESC);

-- Preserve upgrades from schemas created before percentile columns existed.
ALTER TABLE queue_snapshots ADD COLUMN IF NOT EXISTS p50_wait_secs REAL;
ALTER TABLE queue_snapshots ADD COLUMN IF NOT EXISTS p90_wait_secs REAL;
ALTER TABLE queue_snapshots ADD COLUMN IF NOT EXISTS p95_wait_secs REAL;
ALTER TABLE queue_snapshots ADD COLUMN IF NOT EXISTS p99_wait_secs REAL;

CREATE TABLE IF NOT EXISTS alert_threads (
    queue      text PRIMARY KEY,
    thread_ts  text NOT NULL,
    status     text NOT NULL DEFAULT 'active',
    history    text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_threads
    ADD COLUMN IF NOT EXISTS history TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS alert_summary (
    id         text PRIMARY KEY,
    message_ts text NOT NULL,
    queues     jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
