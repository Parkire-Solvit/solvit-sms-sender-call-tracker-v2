-- Holiday dates are local Africa/Nairobi calendar dates. Existing thread
-- deadlines remain unchanged; the business calendar applies to new threads.
ALTER TABLE email_sla_settings
  ADD COLUMN IF NOT EXISTS holiday_dates JSONB NOT NULL DEFAULT '[]'::jsonb;

-- NULL identifies pre-change rows, retaining their original wall-clock SLA.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS sla_settings_snapshot JSONB;
