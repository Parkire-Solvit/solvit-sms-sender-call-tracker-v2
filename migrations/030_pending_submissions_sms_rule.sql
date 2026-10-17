-- Pending Submissions now closes on calls AND SMS, the same rule as Insurance Job Callbacks.
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS max_sms_attempts INTEGER NOT NULL DEFAULT 4;

