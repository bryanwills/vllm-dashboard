-- A Main CI alert can also be resolved by hand from the dashboard, without an
-- observed pass. Manual resolution reuses the existing resolution columns so
-- the episode invariants below stay intact; the resolution job fields simply
-- point at the alert's own last failure, and resolution_kind records that no
-- passing job was observed.
ALTER TABLE alerting_main_ci_job_alerts
    ADD COLUMN IF NOT EXISTS resolution_kind text;

ALTER TABLE alerting_main_ci_job_alerts
    DROP CONSTRAINT IF EXISTS alerting_main_ci_job_alerts_resolution_kind_check;
ALTER TABLE alerting_main_ci_job_alerts
    ADD CONSTRAINT alerting_main_ci_job_alerts_resolution_kind_check
    CHECK (
        (status = 'open' AND resolution_kind IS NULL)
        OR (status = 'resolved' AND resolution_kind IN ('pass', 'manual'))
    );

-- Existing resolved rows were all closed by a positively observed pass.
UPDATE alerting_main_ci_job_alerts
SET resolution_kind = 'pass'
WHERE status = 'resolved' AND resolution_kind IS NULL;
