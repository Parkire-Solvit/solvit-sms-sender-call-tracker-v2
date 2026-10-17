-- Solver notification tracking
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS solver_notification_error TEXT;
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS solver_notification_message TEXT;
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS solver_notification_transaction_id VARCHAR(100);
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS solver_notification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS solver_notification_attempted_at TIMESTAMPTZ;

-- Workflow and notification settings
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS solver_sms_auto_send BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS solver_sms_template TEXT NOT NULL
  DEFAULT 'Hi {solver_name}, inspection for {vehicle_reg} is scheduled for {scheduled_at} at {scheduled_place}.';
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS solver_sms_max_resends INTEGER NOT NULL DEFAULT 3;
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS disappearance_alert_fixed_count INTEGER NOT NULL DEFAULT 50;
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS disappearance_alert_percentage INTEGER NOT NULL DEFAULT 30;
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS max_attempts_grace_minutes INTEGER NOT NULL DEFAULT 30;

-- Generic integration configuration (Part B)
CREATE TABLE IF NOT EXISTS integration_settings (
  integration VARCHAR(50) NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by VARCHAR(100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (integration, setting_key)
);

-- One-time data repair: the first build wrongly closed these outcomes as RED.
-- Under the corrected rules they keep the record open. History is preserved.
WITH reopened AS (
  UPDATE pending_submission_jobs
  SET status = 'AMBER', closed_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE status = 'RED'
    AND latest_outcome IN ('CALL_BACK', 'NOT_READY', 'NOT_PICKING', 'UNREACHABLE', 'WRONG_NUMBER', 'CHANGED_LOCATION', 'NO_DOCUMENTS', 'WRONG_REGISTRATION_SCHEDULE', 'CONTACT_ATTEMPTED', 'CLIENT_POSTPONED')
  RETURNING id
)
INSERT INTO pending_submission_logs (
  pending_submission_job_id, outcome, comment, logged_by, resulting_status, created_at
)
SELECT id, 'REOPENED_BY_SYSTEM', 'Reopened by Fix Pass migration 020: outcome is not a closing outcome under corrected rules.', 'System', 'AMBER', CURRENT_TIMESTAMP
FROM reopened;

