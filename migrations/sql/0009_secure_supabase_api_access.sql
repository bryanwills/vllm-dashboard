-- New alerting data is accessed only by trusted server-side Postgres
-- connections. Leave pre-existing dashboard tables unchanged: their API and
-- RLS posture must be reviewed separately from this alerting deployment.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_fast_failure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_fast_ci_scan_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_fast_failure_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_full_ci_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_full_ci_job_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerting_full_ci_comparisons ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role name;
    protected_tables constant text :=
        'public.schema_migrations, '
        'public.alerting_automation_executions, '
        'public.alerting_notification_outbox, '
        'public.alerting_fast_failure_events, '
        'public.alerting_fast_ci_scan_cursors, '
        'public.alerting_fast_failure_notifications, '
        'public.alerting_full_ci_runs, '
        'public.alerting_full_ci_job_outcomes, '
        'public.alerting_full_ci_comparisons';
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon'::name, 'authenticated'::name]
    LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',
                protected_tables,
                api_role
            );
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON FUNCTION '
                'public.alerting_set_updated_at() FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.alerting_set_updated_at() FROM PUBLIC;
