ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_archived_at ON agents(archived_at);
