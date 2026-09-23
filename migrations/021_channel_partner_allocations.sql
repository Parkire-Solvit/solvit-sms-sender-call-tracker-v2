-- 021_channel_partner_allocations.sql
CREATE TABLE IF NOT EXISTS channel_partner_allocations (
  channel_partner VARCHAR(255) PRIMARY KEY,
  assigned_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
