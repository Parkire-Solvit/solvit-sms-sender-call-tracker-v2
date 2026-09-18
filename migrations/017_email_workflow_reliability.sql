ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS sla_exclusion_reason TEXT;
-- Retain records and timestamps; exclude proven automated replies rather than resolve/delete them.
UPDATE email_threads SET sla_exclusion_reason='Microsoft reaction digest'
 WHERE customer_email='no-reply@outlook.mail.microsoft' AND subject ~* '^Reaction Daily Digest[[:space:]]*-';
UPDATE email_threads SET sla_exclusion_reason='Automatic out-of-office reply'
 WHERE subject ~* '^(automatic reply[[:space:]]*:|out of office\M)' AND sla_exclusion_reason IS NULL;
UPDATE email_alerts a SET acknowledged_at=now() FROM email_threads t
 WHERE t.id=a.email_thread_id AND t.sla_exclusion_reason IS NOT NULL AND a.acknowledged_at IS NULL;
