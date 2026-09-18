import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import { assembleEmailReport, emailReportWorkbook, reportRowsSql, type OwnedReportEmail } from './emailReportService';
import { emailReportPeriod } from './emailReporting';

const period = emailReportPeriod('weekly','2026-09-16');
const now = new Date('2026-09-16T09:00:00Z');
const owners = [{email:'irene@solvit.co.ke',name:'Irene'},{email:'carol@solvit.co.ke',name:'Caroline'}];
function email(overrides: Partial<OwnedReportEmail> = {}): OwnedReportEmail {
  return {id:1,subject:'=HYPERLINK("evil")',customerEmail:'client@example.com',
    receivedAt:new Date('2026-09-16T05:00Z'),firstResponseAt:new Date('2026-09-16T06:00Z'),resolvedAt:null,
    responseDueAt:new Date('2026-09-16T05:30Z'),resolutionDueAt:new Date('2026-09-16T07:00Z'),holidayDates:[],
    receiptOwner:owners[0].email,responseOwner:owners[0].email,resolutionOwner:owners[1].email,cutoffOwner:owners[1].email,...overrides};
}
test('stage ownership keeps completed performance with original owner and scopes member exports', () => {
  const all=assembleEmailReport([email(),email({id:2,receiptOwner:null,responseOwner:null,resolutionOwner:null,cutoffOwner:null})],owners,period,now);
  assert.equal(all.summary.response.completedLate,2);
  assert.equal(all.owners[0].response.completedLate,1);
  assert.equal(all.owners[1].response.completedLate,0);
  assert.equal(all.unknownOwnership,true);
  const irene=assembleEmailReport([email()],owners,period,now,owners[0].email);
  assert.equal(irene.summary.response.completedLate,1);
  assert.equal(irene.summary.resolution.overdueOpen,0);
  assert.equal(irene.owners.length,1);
  assert.equal(irene.overdue.length,0);
  const carol=assembleEmailReport([email()],owners,period,now,owners[1].email);
  assert.equal(carol.summary.received,0);
  assert.equal(carol.summary.resolution.overdueOpen,1);
  assert.equal(carol.overdue[0].owner,'Caroline');
  const workbook=XLSX.read(emailReportWorkbook(carol),{type:'buffer'});
  assert.deepEqual(workbook.SheetNames,['Summary','Owners','Overdue']);
  assert.equal(workbook.Sheets.Overdue.B2.t,'s');
  assert.equal(workbook.Sheets.Overdue.B2.f,undefined);
  assert.equal(workbook.Sheets.Owners.C2.t,'n');
  assert.equal(workbook.Sheets.Owners.A3,undefined);
});

test('real SQL reconstructs ownership before reply, after reassign, and delayed initial sync', async () => {
  const db=new PGlite();
  try {
    await db.exec(await fs.readFile(new URL('../../migrations/009_email_sla_foundation.sql',import.meta.url),'utf8'));
    await db.exec(await fs.readFile(new URL('../../migrations/017_email_workflow_reliability.sql',import.meta.url),'utf8'));
    await db.query("INSERT INTO email_team_members(email,display_name) VALUES ('irene@solvit.co.ke','Irene'),('carol@solvit.co.ke','Caroline')");
    await db.query(`INSERT INTO email_threads(mailbox,root_internet_message_id,customer_email,received_at,first_response_at,response_due_at,resolution_due_at,assigned_member_id,status)
      VALUES ('irene@solvit.co.ke','test-1','client@example.com','2026-09-16 05:00Z','2026-09-16 06:00Z','2026-09-16 05:30Z','2026-09-16 07:00Z',2,'IN_PROGRESS')`);
    await db.query(`INSERT INTO email_assignment_history(email_thread_id,new_member_id,method,changed_by,changed_at)
      VALUES (1,1,'DIRECT','system','2026-09-16 06:30Z'),(1,2,'MANUAL','admin','2026-09-16 07:30Z')`);
    const result=await db.query<Record<string,unknown>>(reportRowsSql,[period.start,now]);
    assert.equal(result.rows[0].receipt_owner,owners[0].email);
    assert.equal(result.rows[0].response_owner,owners[0].email);
    assert.equal(result.rows[0].resolution_owner,owners[1].email);
    assert.equal(result.rows[0].cutoff_owner,owners[1].email);
    const earlier=await db.query<Record<string,unknown>>(reportRowsSql,[period.start,new Date('2026-09-16T07:00Z')]);
    assert.equal(earlier.rows[0].cutoff_owner,owners[0].email);
  } finally { await db.close(); }
});
