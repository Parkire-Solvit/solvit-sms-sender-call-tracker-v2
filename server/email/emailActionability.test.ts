import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emailExclusionReason } from './emailActionability';

test('exclude automated replies and Microsoft digests, not actionable insurer noreply assignments', () => {
  assert.ok(emailExclusionReason({id:'1',subject:'Reaction Daily Digest - Friday',from:{emailAddress:{address:'no-reply@outlook.mail.microsoft'}}}));
  assert.ok(emailExclusionReason({id:'2',subject:'Out of office Re: Valuation request'}));
  assert.ok(emailExclusionReason({id:'3',internetMessageHeaders:[{name:'Auto-Submitted',value:'auto-replied'}]}));
  assert.equal(emailExclusionReason({id:'4',subject:'Vehicle Valuation Assignment',from:{emailAddress:{address:'noreply@transactional.britam.com'}}}),null);
  assert.equal(emailExclusionReason({id:'5',subject:'Automatic system error please assist'}),null);
});

test('automated-mail migration retains records, annotates exclusions, and closes their alerts',async () => {
  const db=new PGlite();
  try {
    await db.exec(await fs.readFile(new URL('../../migrations/009_email_sla_foundation.sql',import.meta.url),'utf8'));
    await db.query(`INSERT INTO email_threads(mailbox,root_internet_message_id,subject,customer_email,received_at,response_due_at,resolution_due_at)
      VALUES ('cs@example.com','digest','Reaction Daily Digest - Friday','no-reply@outlook.mail.microsoft',now(),now(),now()),
      ('cs@example.com','ooo','OUT OF OFFICE Re: request','client@example.com',now(),now(),now()),
      ('cs@example.com','assignment','Vehicle Valuation Assignment','noreply@transactional.britam.com',now(),now(),now())`);
    await db.query("INSERT INTO email_alerts(email_thread_id,alert_type) VALUES (1,'RESPONSE_BREACH'),(3,'RESPONSE_BREACH')");
    const sql=await fs.readFile(new URL('../../migrations/017_email_workflow_reliability.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    const rows=await db.query<{sla_exclusion_reason:string|null;resolved_at:unknown}>('SELECT sla_exclusion_reason,resolved_at FROM email_threads ORDER BY id');
    assert.equal(rows.rows.length,3);
    assert.ok(rows.rows[0].sla_exclusion_reason); assert.ok(rows.rows[1].sla_exclusion_reason);
    assert.equal(rows.rows[2].sla_exclusion_reason,null);
    assert.equal(rows.rows[0].resolved_at,null);
    assert.equal((await db.query('SELECT 1 FROM email_alerts WHERE acknowledged_at IS NULL')).rows.length,1);
  } finally {await db.close();}
});
