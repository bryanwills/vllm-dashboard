-- Slack notification outbox: alert records and their delivery intents are
-- written in the same transaction; a dispatcher leases due rows and delivers
-- independently, so a Slack outage never hides an alert from the dashboard.
--
-- destination never stores a webhook URL or any other secret: it is a channel
-- ID for bot-token delivery, or a logical webhook name resolved from the
-- environment at delivery time.
CREATE TABLE IF NOT EXISTS alerting_notification_outbox (
    delivery_id      text PRIMARY KEY,
    alert_ref        text NOT NULL,
    destination_mode text NOT NULL CHECK (destination_mode IN ('webhook', 'bot_token')),
    destination      text NOT NULL,
    payload          jsonb NOT NULL,
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'retrying', 'delivered', 'dead_letter')),
    attempts         integer NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    slack_ts         text,
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerting_notification_outbox_due_idx
    ON alerting_notification_outbox (next_attempt_at)
    WHERE status IN ('pending', 'retrying');

CREATE OR REPLACE TRIGGER alerting_notification_outbox_updated_at
    BEFORE UPDATE ON alerting_notification_outbox
    FOR EACH ROW EXECUTE FUNCTION alerting_set_updated_at();
