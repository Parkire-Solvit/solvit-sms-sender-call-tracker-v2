-- Both original 004 files share one numeric migration version. Ensure the SMS
-- template column exists even when the other 004 file was recorded first.
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS sms_template TEXT NOT NULL DEFAULT '';
