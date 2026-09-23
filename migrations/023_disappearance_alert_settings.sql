-- 023_disappearance_alert_settings.sql
ALTER TABLE callback_settings ADD COLUMN IF NOT EXISTS disappearance_alert_fixed_count INTEGER NOT NULL DEFAULT 50;
ALTER TABLE callback_settings ADD COLUMN IF NOT EXISTS disappearance_alert_percentage INTEGER NOT NULL DEFAULT 30;
ALTER TABLE callback_imports ADD COLUMN IF NOT EXISTS parsed_end_date DATE;
