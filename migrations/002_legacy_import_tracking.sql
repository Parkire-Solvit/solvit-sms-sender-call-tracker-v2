ALTER TABLE events ADD COLUMN IF NOT EXISTS source_system VARCHAR(50);
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_event_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_source_identity
  ON events(source_system, source_event_id)
  WHERE source_system IS NOT NULL AND source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_system VARCHAR(50) PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_event_count BIGINT NOT NULL,
  imported_event_count BIGINT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
