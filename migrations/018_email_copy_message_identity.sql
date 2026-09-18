ALTER TABLE email_mailbox_copies ADD COLUMN IF NOT EXISTS internet_message_id TEXT;
UPDATE email_mailbox_copies c SET internet_message_id=m.internet_message_id
 FROM email_messages m WHERE c.source_mailbox=m.source_mailbox AND c.graph_message_id=m.graph_message_id
 AND c.internet_message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_copies_rfc ON email_mailbox_copies(source_mailbox,internet_message_id);
