-- Shadow outputs remain durable for comparison but can never be leased for
-- Slack delivery. Alert paths are explicit so Fast CI and Full CI can cut over
-- and roll back independently.
ALTER TABLE alerting_notification_outbox
    ADD COLUMN IF NOT EXISTS alert_path text;

ALTER TABLE alerting_notification_outbox
    ADD COLUMN IF NOT EXISTS delivery_mode text;

UPDATE alerting_notification_outbox
SET alert_path = CASE
        WHEN delivery_id LIKE 'full-ci:%' THEN 'full_ci'
        ELSE 'fast_ci'
    END
WHERE alert_path IS NULL;

-- Existing records predate an explicit cutover decision. Keep their rendered
-- payloads, but fence them from delivery.
UPDATE alerting_notification_outbox
SET delivery_mode = 'shadow'
WHERE delivery_mode IS NULL;

ALTER TABLE alerting_notification_outbox
    ALTER COLUMN alert_path SET NOT NULL,
    ALTER COLUMN delivery_mode SET DEFAULT 'shadow',
    ALTER COLUMN delivery_mode SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'alerting_notification_outbox_path_check'
    ) THEN
        ALTER TABLE alerting_notification_outbox
            ADD CONSTRAINT alerting_notification_outbox_path_check
            CHECK (alert_path IN ('fast_ci', 'full_ci'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'alerting_notification_outbox_delivery_mode_check'
    ) THEN
        ALTER TABLE alerting_notification_outbox
            ADD CONSTRAINT alerting_notification_outbox_delivery_mode_check
            CHECK (delivery_mode IN ('live', 'shadow'));
    END IF;
END;
$$;

DROP INDEX IF EXISTS alerting_notification_outbox_due_idx;
CREATE INDEX alerting_notification_outbox_due_idx
    ON alerting_notification_outbox (alert_path, next_attempt_at)
    WHERE delivery_mode = 'live'
      AND status IN ('pending', 'retrying');
