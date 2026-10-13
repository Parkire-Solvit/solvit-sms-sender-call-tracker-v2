ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS daily_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS daily_summary_recipients TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS daily_summary_last_sent_date TEXT;
