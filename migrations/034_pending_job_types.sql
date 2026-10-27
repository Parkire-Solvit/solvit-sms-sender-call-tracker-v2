-- Pending Submissions now has two job types: INSPECTION (the solver has not seen the car) and SUBMISSION (inspected, data not submitted).
-- type_changed_at is the moment a job moved from one type to the other. Attempt counting restarts from it.
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) NOT NULL DEFAULT 'INSPECTION';
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS type_changed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_psj_job_type ON pending_submission_jobs(job_type);
