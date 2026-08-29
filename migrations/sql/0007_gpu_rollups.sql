-- Raw GPU observations and five-minute history used by dashboard views.
CREATE TABLE IF NOT EXISTS gpu_snapshots (
    id            serial PRIMARY KEY,
    reported_at   timestamptz NOT NULL DEFAULT now(),
    hostname      text NOT NULL,
    gpu_index     integer NOT NULL,
    gpu_name      text,
    gpu_util      real NOT NULL,
    mem_used_mb   real NOT NULL,
    mem_total_mb  real NOT NULL,
    temperature_c real,
    power_draw_w  real,
    power_limit_w real
);

CREATE INDEX IF NOT EXISTS idx_gpu_snapshots_reported
    ON gpu_snapshots (reported_at DESC, hostname);

CREATE INDEX IF NOT EXISTS idx_gpu_snapshots_host
    ON gpu_snapshots (hostname, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_snapshots_host_gpu_reported
    ON gpu_snapshots (hostname, gpu_index, reported_at DESC);

CREATE TABLE IF NOT EXISTS gpu_history_5m (
    time_bucket  timestamptz NOT NULL,
    hostname     text NOT NULL,
    gpu_name     text NOT NULL,
    mem_pct_sum  double precision NOT NULL,
    gpu_util_sum double precision NOT NULL,
    sample_count bigint NOT NULL,
    PRIMARY KEY (time_bucket, hostname, gpu_name)
);

ALTER TABLE gpu_history_5m
    ADD COLUMN IF NOT EXISTS gpu_util_sum DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gpu_history_5m_time_host
    ON gpu_history_5m (time_bucket DESC, hostname);

-- Freeze reporter writes while rebuilding rollups, but keep dashboard SELECTs
-- available. Reporter transactions write gpu_snapshots before gpu_history_5m,
-- so taking locks in that same order also avoids a lock-order deadlock.
LOCK TABLE gpu_snapshots IN SHARE MODE;
LOCK TABLE gpu_history_5m IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO gpu_history_5m (
    time_bucket, hostname, gpu_name, mem_pct_sum, gpu_util_sum, sample_count
)
SELECT
    date_bin(INTERVAL '5 minutes', reported_at, TIMESTAMPTZ 'epoch'),
    hostname,
    COALESCE(gpu_name, 'Unknown'),
    SUM(
        CASE
            WHEN mem_total_mb > 0 THEN mem_used_mb / mem_total_mb * 100
            ELSE 0
        END
    )::double precision,
    SUM(gpu_util)::double precision,
    COUNT(*)::bigint
FROM gpu_snapshots
GROUP BY 1, hostname, COALESCE(gpu_name, 'Unknown')
ON CONFLICT (time_bucket, hostname, gpu_name) DO UPDATE SET
    mem_pct_sum = EXCLUDED.mem_pct_sum,
    gpu_util_sum = EXCLUDED.gpu_util_sum,
    sample_count = EXCLUDED.sample_count;
