import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { lockAssignableEmailSql } from './emailAssignmentAuthorization';

test('CS can reassign only their current open actionable email, not another owner or a resolved item',async () => {
  const db=new PGlite();
  try {
    for(const migration of ['009_email_sla_foundation.sql','017_email_workflow_reliability.sql']) await db.exec(await fs.readFile(new URL(`../../migrations/${migration}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO email_team_members(email,display_name) VALUES ('irene@example.com','Irene'),('carol@example.com','Carol')");
    await db.query(`INSERT INTO email_threads(mailbox,root_internet_message_id,customer_email,received_at,response_due_at,resolution_due_at,assigned_member_id)
      VALUES ('cs@example.com','root','client@example.com',now(),now(),now(),1)`);
    const can=async(owner:string|null) => (await db.query(lockAssignableEmailSql,[1,owner])).rows.length;
    assert.equal(await can('irene@example.com'),1);
    assert.equal(await can('carol@example.com'),0);
    assert.equal(await can(null),1);
    await db.query('UPDATE email_threads SET assigned_member_id=2 WHERE id=1');
    assert.equal(await can('irene@example.com'),0);
    assert.equal(await can('carol@example.com'),1);
    await db.query("UPDATE email_threads SET sla_exclusion_reason='Automated' WHERE id=1");
    assert.equal(await can('carol@example.com'),0);
    await db.query("UPDATE email_threads SET sla_exclusion_reason=NULL,resolved_at=now() WHERE id=1");
    assert.equal(await can(null),0);
  } finally {await db.close();}
});
