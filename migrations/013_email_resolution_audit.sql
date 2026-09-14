-- Resolution is an explicit human action; the original received/due times stay intact.
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS resolution_note TEXT;
