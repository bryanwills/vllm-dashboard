-- Automation executions: one row per scheduled reconciliation command, keyed
-- by its deterministic idempotency key. The primary key plus the lease make
-- processing idempotent under duplicate, overlapping, or restarted ticks.
CREATE TABLE IF NOT EXISTS alerting_automation_executions (
    idempotency_key  text PRIMARY KEY,
    command_type     text NOT NULL,
    schema_version   integer NOT NULL,
    target_time      timestamptz NOT NULL,
    status           text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    attempts         integer NOT NULL DEFAULT 1,
    lease_expires_at timestamptz,
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    completed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS alerting_automation_executions_type_target_idx
    ON alerting_automation_executions (command_type, target_time DESC);

-- Keeps updated_at truthful on every UPDATE; shared by all alerting tables.
CREATE OR REPLACE FUNCTION alerting_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER alerting_automation_executions_updated_at
    BEFORE UPDATE ON alerting_automation_executions
    FOR EACH ROW EXECUTE FUNCTION alerting_set_updated_at();
