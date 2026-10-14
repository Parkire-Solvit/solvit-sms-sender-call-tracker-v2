ALTER TABLE email_threads DROP CONSTRAINT IF EXISTS email_threads_assignment_method_check;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_assignment_method_check
  CHECK (assignment_method IN ('DIRECT','NAME_MATCH','RULE','DEFAULT','ROUND_ROBIN','MANUAL','RESPONDER'));

ALTER TABLE email_assignment_history DROP CONSTRAINT IF EXISTS email_assignment_history_method_check;
ALTER TABLE email_assignment_history ADD CONSTRAINT email_assignment_history_method_check
  CHECK (method IN ('DIRECT','NAME_MATCH','RULE','DEFAULT','ROUND_ROBIN','MANUAL','RESPONDER'));

-- Repair historical duplicates created when a later customer reply received a
-- new Microsoft message ID. Keep the first outreach as the single ticket and,
-- when any duplicate has a detected response, preserve that response on it.
WITH keyed AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY lower(customer_email),
      lower(trim(regexp_replace(regexp_replace(subject,
        '^(\s*((re|fw|fwd)\s*:\s*|\[external\]\s*))+', '', 'i'), '\s+', ' ', 'g')))
      ORDER BY received_at,id) AS canonical_id,
    first_value(id) OVER (PARTITION BY lower(customer_email),
      lower(trim(regexp_replace(regexp_replace(subject,
        '^(\s*((re|fw|fwd)\s*:\s*|\[external\]\s*))+', '', 'i'), '\s+', ' ', 'g')))
      ORDER BY (first_response_at IS NULL),first_response_at,id) AS response_source_id
  FROM email_threads
  WHERE coalesce(trim(customer_email),'') <> '' AND coalesce(trim(subject),'') <> ''
    AND sla_exclusion_reason IS NULL
), responses AS (
  SELECT DISTINCT k.canonical_id,k.response_source_id FROM keyed k
), copied AS (
  UPDATE email_threads canonical SET
    first_response_at=source.first_response_at,
    response_breached=source.response_breached,
    resolved_at=source.resolved_at,
    responded_by=source.responded_by,
    assigned_member_id=source.assigned_member_id,
    assignment_method=CASE WHEN source.responded_by IS NULL THEN canonical.assignment_method ELSE 'RESPONDER' END,
    assignment_reason=CASE WHEN source.responded_by IS NULL THEN canonical.assignment_reason ELSE 'Recovered from duplicate subject ticket' END,
    status=CASE WHEN source.first_response_at IS NULL THEN canonical.status ELSE 'RESOLVED' END,
    updated_at=now()
  FROM responses r JOIN email_threads source ON source.id=r.response_source_id
  WHERE canonical.id=r.canonical_id AND canonical.first_response_at IS NULL
    AND source.first_response_at IS NOT NULL
  RETURNING canonical.id
), duplicates AS (
  UPDATE email_threads duplicate SET
    sla_exclusion_reason='Duplicate customer subject ticket',
    resolved_at=coalesce(duplicate.resolved_at,now()),
    resolved_by=coalesce(duplicate.resolved_by,'system'),
    resolution_note=coalesce(duplicate.resolution_note,'Merged into the original customer subject ticket'),
    status='RESOLVED',updated_at=now()
  FROM keyed k
  WHERE duplicate.id=k.id AND k.id<>k.canonical_id
  RETURNING duplicate.id
)
UPDATE email_alerts SET acknowledged_at=coalesce(acknowledged_at,now())
WHERE email_thread_id IN (SELECT id FROM duplicates);
