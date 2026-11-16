-- No-reply mail cannot be answered and must not count as a response obligation.
-- Keep the original thread for audit purposes while removing it from queues, alerts and reports.
UPDATE email_threads
SET sla_exclusion_reason = 'No-reply sender',
    updated_at = now()
WHERE sla_exclusion_reason IS NULL
  AND lower(split_part(customer_email, '@', 1)) ~ '^(no[-._]?reply|do[-._]?not[-._]?reply)$';

UPDATE email_alerts a
SET acknowledged_at = COALESCE(a.acknowledged_at, now())
FROM email_threads t
WHERE t.id = a.email_thread_id
  AND t.sla_exclusion_reason = 'No-reply sender'
  AND a.acknowledged_at IS NULL;
