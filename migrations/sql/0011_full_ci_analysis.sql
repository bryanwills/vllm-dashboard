-- One analyzer result per Full CI comparison. Written only after the
-- analyzer's outputs validate and its new checkpoint object exists in S3;
-- until then the previous comparison's analysis remains the authoritative
-- baseline.
CREATE TABLE IF NOT EXISTS alerting_full_ci_analyses (
    current_build_id  text PRIMARY KEY
        REFERENCES alerting_full_ci_comparisons(current_build_id) ON DELETE CASCADE,
    previous_build_id text NOT NULL
        REFERENCES alerting_full_ci_runs(buildkite_build_id) ON DELETE RESTRICT,
    report_text       text NOT NULL,
    failure_cache     jsonb NOT NULL,
    suspicious_prs    jsonb NOT NULL,
    analyzed_at       timestamptz NOT NULL
);

-- Immutable, versioned analyzer-memory objects. Postgres only ever references
-- objects that were successfully uploaded; an object left behind by a crash
-- before this row commits is unreferenced and harmless. current_build_id is
-- NULL only for the initial checkpoint imported before cutover.
CREATE TABLE IF NOT EXISTS alerting_analyzer_checkpoints (
    checkpoint_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    current_build_id text
        REFERENCES alerting_full_ci_comparisons(current_build_id) ON DELETE CASCADE,
    s3_uri           text NOT NULL,
    sha256           text NOT NULL,
    schema_version   integer NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alerting_analyzer_checkpoints_build_idx
    ON alerting_analyzer_checkpoints (current_build_id)
    WHERE current_build_id IS NOT NULL;

-- One classified job per comparison. A fixed lifecycle is recorded only for
-- positively observed passing outcomes, and fixing-PR attribution only for a
-- verified merged fixing PR — never an invented one.
CREATE TABLE IF NOT EXISTS alerting_full_ci_failure_conditions (
    current_build_id  text NOT NULL
        REFERENCES alerting_full_ci_analyses(current_build_id) ON DELETE CASCADE,
    job_name          text NOT NULL,
    lifecycle         text NOT NULL
        CHECK (lifecycle IN ('new', 'recurring', 'fixed')),
    cause             text NOT NULL
        CHECK (cause IN ('infrastructure', 'flaky_test', 'test', 'code', 'unknown')),
    summary           text NOT NULL DEFAULT '',
    culprit_pr_number integer,
    culprit_pr_url    text,
    culprit_pr_title  text,
    fixing_pr_number  integer,
    fixing_pr_url     text,
    fixing_pr_title   text,
    PRIMARY KEY (current_build_id, job_name),
    CHECK (fixing_pr_number IS NULL OR cause = 'code')
);

CREATE INDEX IF NOT EXISTS alerting_full_ci_failure_conditions_name_idx
    ON alerting_full_ci_failure_conditions (job_name);

-- Same posture as 0009: trusted server-side Postgres connections only.
ALTER TABLE public.alerting_full_ci_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_analyzer_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_full_ci_failure_conditions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role name;
    protected_tables constant text :=
        'public.alerting_full_ci_analyses, '
        'public.alerting_analyzer_checkpoints, '
        'public.alerting_full_ci_failure_conditions';
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
