import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { replyConversationCandidatesSql } from './replyFallback';

test('conversation fallback is mailbox-scoped, recipient-checked, chronological and ambiguity-safe', async () => {
  const db = new PGlite();
  try {
    for (const name of ['009_email_sla_foundation.sql', '016_email_mailbox_copies.sql']) {
      await db.exec(await fs.readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.query(`INSERT INTO email_threads (mailbox,root_internet_message_id,customer_email,received_at,response_due_at,resolution_due_at)
      VALUES ('cs@example.com','<root>','customer@example.com','2026-09-15T19:42:00Z','2026-09-16T05:30:00Z','2026-09-16T07:00:00Z')`);
    await db.query("INSERT INTO email_mailbox_copies VALUES ('carol@example.com','copy',1,'conversation')");
    const candidates = async (mailbox = 'carol@example.com', recipients = ['customer@example.com'], at = '2026-09-16T07:57:00Z', id = '<reply>') =>
      (await db.query(replyConversationCandidatesSql, [mailbox, 'conversation', at, recipients, id])).rows;
    assert.equal((await candidates()).length, 1);
    assert.equal((await candidates('irene@example.com')).length, 0);
    assert.equal((await candidates(undefined, ['other@example.com'])).length, 0);
    assert.equal((await candidates(undefined, undefined, '2026-09-15T18:00:00Z')).length, 0);
    assert.equal((await candidates(undefined, undefined, undefined, '<root>')).length, 0);
    await db.query(`INSERT INTO email_threads (mailbox,root_internet_message_id,customer_email,received_at,response_due_at,resolution_due_at)
      SELECT mailbox,'<other-root>',customer_email,received_at,response_due_at,resolution_due_at FROM email_threads WHERE id=1`);
    await db.query("INSERT INTO email_mailbox_copies VALUES ('carol@example.com','other-copy',2,'conversation')");
    assert.equal((await candidates()).length, 2); // Production requires exactly one.
  } finally { await db.close(); }
});
