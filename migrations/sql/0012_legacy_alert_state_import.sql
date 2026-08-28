-- One imported Full CI baseline anchors the first post-cutover comparison
-- without inventing an analyzer result or notification for a legacy run.
CREATE TABLE IF NOT EXISTS alerting_full_ci_import_baselines (
    singleton              boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    buildkite_build_id      text NOT NULL UNIQUE
        REFERENCES alerting_full_ci_runs(buildkite_build_id) ON DELETE RESTRICT,
    failure_cache           jsonb NOT NULL,
    reported_build_numbers  bigint[] NOT NULL,
    imported_at             timestamptz NOT NULL
);

-- Legacy SQLite contains only enough data to suppress already-delivered Fast
-- CI jobs. Keep those keys separate from complete dashboard event records.
CREATE TABLE IF NOT EXISTS alerting_fast_ci_imported_deduplication_keys (
    buildkite_job_id text PRIMARY KEY,
    finished_at      timestamptz NOT NULL,
    imported_at      timestamptz NOT NULL
);

ALTER TABLE public.alerting_full_ci_import_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_fast_ci_imported_deduplication_keys ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role name;
    protected_tables constant text :=
        'public.alerting_full_ci_import_baselines, '
        'public.alerting_fast_ci_imported_deduplication_keys';
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon'::name, 'authenticated'::name]
    LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',
                protected_tables,
                api_role
            );
        END IF;
    END LOOP;
END;
$$;
