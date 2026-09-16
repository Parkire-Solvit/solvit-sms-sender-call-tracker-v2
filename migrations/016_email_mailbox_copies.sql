-- Conversation IDs are scoped to a mailbox, never compared across mailboxes.
CREATE TABLE IF NOT EXISTS email_mailbox_copies (
  source_mailbox TEXT NOT NULL,
  graph_message_id TEXT NOT NULL,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(id),
  graph_conversation_id TEXT,
  PRIMARY KEY (source_mailbox, graph_message_id)
);
CREATE INDEX IF NOT EXISTS idx_email_copies_conversation
  ON email_mailbox_copies(source_mailbox, graph_conversation_id);
INSERT INTO email_mailbox_copies
  SELECT source_mailbox,graph_message_id,email_thread_id,graph_conversation_id
  FROM email_messages WHERE direction='INBOUND' ON CONFLICT DO NOTHING;
