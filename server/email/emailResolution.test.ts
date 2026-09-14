import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { resolveEmailThreadSql } from './emailResolution';

test('only the assigned member can resolve an in-progress thread, with an audit record', async () => {
  const db = new PGlite();
  try {
    for (const migration of ['009_email_sla_foundation.sql', '011_email_business_calendar.sql', '012_email_assignment_notifications.sql', '013_email_resolution_audit.sql']) {
      await db.exec(await fs.readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
    }
    await db.query("INSERT INTO email_team_members (email,display_name) VALUES ('irene@solvit.co.ke','Irene'),('mercy@solvit.co.ke','Mercy')");
    await db.query(`INSERT INTO email_threads
      (mailbox,root_internet_message_id,subject,customer_email,assigned_member_id,received_at,response_due_at,resolution_due_at,status)
      VALUES ('irene@solvit.co.ke','msg-1','Customer issue','customer@example.com',1,now(),now()+interval '30 minutes',now()+interval '2 hours','IN_PROGRESS'),
             ('irene@solvit.co.ke','msg-2','Not yet answered','customer@example.com',1,now(),now()+interval '30 minutes',now()+interval '2 hours','AWAITING_RESPONSE')`);
    const resolve = (id: number, owner: string | null, actor: string, note: string | null) =>
      db.query(resolveEmailThreadSql, [id, owner, actor, note]);
    assert.equal((await resolve(1, 'mercy@solvit.co.ke', 'mercy@solvit.co.ke', null)).affectedRows, 0);
    assert.equal((await resolve(2, 'irene@solvit.co.ke', 'irene@solvit.co.ke', null)).affectedRows, 0);
    assert.equal((await resolve(1, 'irene@solvit.co.ke', 'irene@solvit.co.ke', 'Report delivered')).affectedRows, 1);
    assert.equal((await resolve(1, 'irene@solvit.co.ke', 'irene@solvit.co.ke', null)).affectedRows, 0);
    const memberResult = await db.query<{ status: string; resolved_by: string; resolution_note: string; resolved_at: string }>(
      'SELECT status,resolved_by,resolution_note,resolved_at FROM email_threads WHERE id=1',
    );
    assert.equal(memberResult.rows[0].status, 'RESOLVED');
    assert.equal(memberResult.rows[0].resolved_by, 'irene@solvit.co.ke');
    assert.equal(memberResult.rows[0].resolution_note, 'Report delivered');
    assert.ok(memberResult.rows[0].resolved_at);
    assert.equal((await resolve(2, null, 'admin', 'Admin override')).affectedRows, 1);
    const adminResult = await db.query<{ resolved_by: string; resolution_note: string }>(
      'SELECT resolved_by,resolution_note FROM email_threads WHERE id=2',
    );
    assert.deepEqual(adminResult.rows[0], { resolved_by: 'admin', resolution_note: 'Admin override' });
  } finally { await db.close(); }
});
