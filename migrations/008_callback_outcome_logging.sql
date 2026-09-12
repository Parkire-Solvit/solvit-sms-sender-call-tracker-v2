-- Migration 008: Callback Outcome Logging, System Auto-Close, and Disappearance Tracking
-- Adds callback_job_logs table, latest_outcome to callback_jobs, and auto_closed_absent_count to callback_imports.

ALTER TABLE callback_jobs ADD COLUMN IF NOT EXISTS latest_outcome VARCHAR(50);

ALTER TABLE callback_imports ADD COLUMN IF NOT EXISTS auto_closed_absent_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS callback_job_logs (
  id BIGSERIAL PRIMARY KEY,
  callback_job_id BIGINT NOT NULL REFERENCES callback_jobs(id) ON DELETE CASCADE,
  outcome VARCHAR(50) NOT NULL,
  comment TEXT NOT NULL,
  logged_by VARCHAR(255) NOT NULL,
  resulting_status VARCHAR(10) NOT NULL CHECK (resulting_status IN ('GREEN','AMBER','RED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_callback_job_logs_job ON callback_job_logs(callback_job_id);
CREATE INDEX IF NOT EXISTS idx_callback_job_logs_outcome ON callback_job_logs(outcome);
