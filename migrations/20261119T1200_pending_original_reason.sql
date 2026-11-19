-- The pending reason a job carried in the upload that first created it. Unlike latest_pending_reason, later uploads
-- never overwrite it. Jobs created before this migration keep NULL ("Not recorded"): their first reason was already
-- overwritten, so it is not guessed from the current value.
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS original_pending_reason VARCHAR(255);
