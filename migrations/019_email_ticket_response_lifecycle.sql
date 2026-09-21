-- An actionable inbound email is a ticket. Its first qualifying CS reply closes it.
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS responded_by TEXT;

UPDATE email_threads
SET responded_by=resolved_by
WHERE responded_by IS NULL AND first_response_at IS NOT NULL AND resolved_by IS NOT NULL;

-- Historical rows with a detected response were previously left IN_PROGRESS.
-- Close them at the response timestamp so the queue reflects the actual mailbox activity.
UPDATE email_threads
SET resolved_at=first_response_at,
    responded_by=COALESCE(responded_by,resolved_by),
    status='RESOLVED',
    updated_at=now()
WHERE first_response_at IS NOT NULL AND resolved_at IS NULL;

UPDATE email_alerts a SET acknowledged_at=now()
FROM email_threads t
WHERE a.email_thread_id=t.id AND t.first_response_at IS NOT NULL AND a.acknowledged_at IS NULL;

-- Resolution is no longer a separate operational stage.
UPDATE email_alerts SET acknowledged_at=now()
WHERE alert_type LIKE 'RESOLUTION_%' AND acknowledged_at IS NULL;
