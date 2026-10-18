-- Data reset support: remember which upload created and which upload closed each record, and flag reverted uploads.
ALTER TABLE callback_jobs ADD COLUMN IF NOT EXISTS created_by_import_id INTEGER;
ALTER TABLE callback_jobs ADD COLUMN IF NOT EXISTS closed_by_import_id INTEGER;
ALTER TABLE callback_imports ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS created_by_import_id INTEGER;
ALTER TABLE pending_submission_jobs ADD COLUMN IF NOT EXISTS closed_by_import_id INTEGER;
ALTER TABLE pending_submission_imports ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;

