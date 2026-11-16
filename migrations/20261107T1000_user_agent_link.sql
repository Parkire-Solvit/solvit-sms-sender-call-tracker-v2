-- Link a login account to the agent it belongs to.
-- Access to the Callbacks and Pending sections is derived live from that agent's tag; an agent with no matching tag
-- lands on Call Activity. One login per agent. Deleting an agent unlinks the login instead of deleting it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_agent_id ON users(agent_id) WHERE agent_id IS NOT NULL;
-- The role is now 'admin' or 'agent'. (The earlier draft called the restricted role 'callback_agent'.)
UPDATE users SET role = 'agent' WHERE role = 'callback_agent';
