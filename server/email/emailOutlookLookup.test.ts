import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emailOutlookCopySql } from './emailOutlookLookup';

test('Outlook lookup selects exact root in assigned mailbox, and never substitutes another owner’s copy',async () => {
  const db=new PGlite();
  try {
    for (const name of ['009_email_sla_foundation.sql','016_email_mailbox_copies.sql','018_email_copy_message_identity.sql']) await db.exec(await fs.readFile(new URL(`../../migrations/${name}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO email_team_members(email,display_name) VALUES ('irene@example.com','Irene'),('carol@example.com','Carol')");
    await db.query(`INSERT INTO email_threads(mailbox,root_internet_message_id,customer_email,received_at,response_due_at,resolution_due_at,assigned_member_id)
      VALUES ('cs@example.com','<root>','client@example.com',now(),now(),now(),1)`);
    await db.query(`INSERT INTO email_mailbox_copies(source_mailbox,graph_message_id,email_thread_id,graph_conversation_id,internet_message_id)
      VALUES ('irene@example.com','z-root',1,'conv','<root>'),('irene@example.com','a-followup',1,'conv','<followup>'),('carol@example.com','other-root',1,'conv2','<root>')`);
    const lookup=async(owner:string|null) => (await db.query<Record<string,unknown>>(emailOutlookCopySql,[1,owner])).rows;
    assert.equal((await lookup('irene@example.com'))[0].graph_message_id,'z-root');
    assert.equal((await lookup('carol@example.com')).length,0);
    await db.query('UPDATE email_threads SET assigned_member_id=2 WHERE id=1');
    assert.equal((await lookup(null))[0].graph_message_id,'other-root');
    await db.query("DELETE FROM email_mailbox_copies WHERE source_mailbox='carol@example.com'");
    assert.equal((await lookup('carol@example.com'))[0].graph_message_id,null);
  } finally {await db.close();}
});
