-- Correct pilot Email SLA records created before or during the business-hours rollout.
-- Keep the original values and cleared SLA alerts for audit/recovery.
CREATE TABLE IF NOT EXISTS email_sla_recalculation_audit (
  email_thread_id BIGINT PRIMARY KEY REFERENCES email_threads(id) ON DELETE RESTRICT,
  recalculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_response_due_at TIMESTAMPTZ NOT NULL,
  previous_resolution_due_at TIMESTAMPTZ NOT NULL,
  previous_response_breached BOOLEAN NOT NULL,
  previous_resolution_breached BOOLEAN NOT NULL,
  previous_settings_snapshot JSONB,
  previous_sla_alerts JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE OR REPLACE FUNCTION email_sla_business_due_014(
  received_at TIMESTAMPTZ, duration_minutes INTEGER, holidays JSONB
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE
  work_day DATE := (received_at AT TIME ZONE 'Africa/Nairobi')::date;
  remaining NUMERIC := duration_minutes;
  opens_at TIMESTAMPTZ;
  closes_at TIMESTAMPTZ;
  cursor_at TIMESTAMPTZ;
  available NUMERIC;
  day_count INTEGER;
BEGIN
  IF duration_minutes < 0 OR holidays IS NULL OR jsonb_typeof(holidays) <> 'array' THEN
    RAISE EXCEPTION 'Invalid Email SLA duration or holiday calendar';
  END IF;
  FOR day_count IN 1..3660 LOOP
    IF EXTRACT(ISODOW FROM work_day) <= 5 AND NOT (holidays ? work_day::text) THEN
      opens_at := (work_day + time '08:00') AT TIME ZONE 'Africa/Nairobi';
      closes_at := (work_day + time '17:00') AT TIME ZONE 'Africa/Nairobi';
      cursor_at := GREATEST(received_at, opens_at);
      IF cursor_at < closes_at THEN
        available := EXTRACT(EPOCH FROM closes_at - cursor_at) / 60;
        IF remaining <= available THEN
          RETURN cursor_at + remaining * interval '1 minute';
        END IF;
        remaining := remaining - available;
      END IF;
    END IF;
    work_day := work_day + 1;
  END LOOP;
  RAISE EXCEPTION 'Email SLA duration exceeds ten years of working days';
END;
$$;

INSERT INTO email_sla_recalculation_audit (
  email_thread_id,previous_response_due_at,previous_resolution_due_at,
  previous_response_breached,previous_resolution_breached,previous_settings_snapshot,previous_sla_alerts
)
SELECT t.id,t.response_due_at,t.resolution_due_at,t.response_breached,t.resolution_breached,
       t.sla_settings_snapshot,
       COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM email_alerts a
                 WHERE a.email_thread_id=t.id AND a.alert_type <> 'EMAIL_UNASSIGNED'), '[]'::jsonb)
FROM email_threads t
ON CONFLICT (email_thread_id) DO NOTHING;

WITH recalculated AS (
  SELECT t.id,
    email_sla_business_due_014(t.received_at,
      COALESCE((t.sla_settings_snapshot->>'responseMinutes')::int,s.response_minutes),
      COALESCE(t.sla_settings_snapshot->'holidayDates',s.holiday_dates)) AS response_due,
    email_sla_business_due_014(t.received_at,
      COALESCE((t.sla_settings_snapshot->>'resolutionMinutes')::int,s.resolution_minutes),
      COALESCE(t.sla_settings_snapshot->'holidayDates',s.holiday_dates)) AS resolution_due,
    COALESCE(t.sla_settings_snapshot,jsonb_build_object(
      'responseMinutes',s.response_minutes,
      'responseWarningMinutes',s.response_warning_minutes,
      'responseUrgentMinutes',s.response_urgent_minutes,
      'resolutionMinutes',s.resolution_minutes,
      'resolutionWarningMinutes',s.resolution_warning_minutes,
      'resolutionUrgentMinutes',s.resolution_urgent_minutes,
      'holidayDates',s.holiday_dates)) AS settings_snapshot
  FROM email_threads t CROSS JOIN email_sla_settings s WHERE s.id=1
)
UPDATE email_threads t SET
  response_due_at=r.response_due,
  resolution_due_at=r.resolution_due,
  response_breached=(t.first_response_at IS NOT NULL AND t.first_response_at > r.response_due),
  resolution_breached=(t.resolved_at IS NOT NULL AND t.resolved_at > r.resolution_due),
  sla_settings_snapshot=r.settings_snapshot,
  updated_at=now()
FROM recalculated r WHERE t.id=r.id;

-- Discard stale SLA alerts; the sync loop will emit only alerts due under the new dates.
-- Their original rows are preserved in email_sla_recalculation_audit.
DELETE FROM email_alerts WHERE alert_type <> 'EMAIL_UNASSIGNED';
DROP FUNCTION email_sla_business_due_014(TIMESTAMPTZ,INTEGER,JSONB);
