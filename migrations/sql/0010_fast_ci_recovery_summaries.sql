-- A stale Fast CI batch remains available for delivery diagnostics, but its
-- replacement recovery summary becomes the only leasable notification.
ALTER TABLE alerting_notification_outbox
    ADD COLUMN IF NOT EXISTS superseded_by text
        REFERENCES alerting_notification_outbox(delivery_id);

CREATE INDEX IF NOT EXISTS alerting_notification_outbox_stale_fast_ci_idx
    ON alerting_notification_outbox (created_at)
    WHERE superseded_by IS NULL AND status IN ('pending', 'retrying');
