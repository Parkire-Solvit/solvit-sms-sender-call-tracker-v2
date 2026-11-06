-- Add a role to dashboard login accounts.
-- 'admin' = full access; 'callback_agent' = Insurance Callbacks (view + log outcomes) only.
-- Defaults to 'admin' so existing accounts (incl. the seeded admin) keep full access;
-- callback-team accounts are set to 'callback_agent' from Team Accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin';
