-- Remembers the last team composition so a rebalance runs only when the team actually changes.
ALTER TABLE pending_submission_settings ADD COLUMN IF NOT EXISTS team_signature TEXT;

