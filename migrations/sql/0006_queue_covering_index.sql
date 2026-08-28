-- migrate: no-transaction
-- migrate: valid-index idx_snapshots_queue_polled_cover_v2
-- Avoid blocking reads and writes while indexing an existing snapshot table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshots_queue_polled_cover_v2
    ON queue_snapshots (queue, polled_at DESC)
    INCLUDE (
        agents_idle, agents_busy, agents_total,
        jobs_scheduled, jobs_running, jobs_waiting, jobs_total,
        p50_wait_secs, p90_wait_secs, p95_wait_secs, p99_wait_secs
    );
