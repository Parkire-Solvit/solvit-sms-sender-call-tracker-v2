import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 009 creates the isolated email schema and constraints in PostgreSQL', async () => {
  const db = new PGlite();
  try {
    const sql = await fs.readFile(new URL('../../migrations/009_email_sla_foundation.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'email_%' ORDER BY tablename",
    );
    assert.deepEqual(tables.rows.map((row) => row.tablename), [
      'email_alerts', 'email_assignment_cursor', 'email_assignment_history', 'email_assignment_rules',
      'email_messages', 'email_sla_settings', 'email_sync_state', 'email_team_members', 'email_threads',
    ]);
    const settings = await db.query<{ response_minutes: number; resolution_minutes: number }>(
      'SELECT response_minutes,resolution_minutes FROM email_sla_settings WHERE id=1',
    );
    assert.deepEqual(settings.rows[0], { response_minutes: 30, resolution_minutes: 120 });
    await assert.rejects(db.query('UPDATE email_sla_settings SET response_warning_minutes=31 WHERE id=1'), /valid_response_warning_order/);
    await db.exec(sql);
    const count = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM email_sla_settings');
    assert.equal(count.rows[0].count, 1);
  } finally { await db.close(); }
});

test('numeric migration sequence survives the two legacy 004 files and repairs SMS template', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE schema_migrations (version integer PRIMARY KEY, name text NOT NULL)');
    const directory = new URL('../../migrations/', import.meta.url);
    const files = (await fs.readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
    for (const file of files) {
      const version = Number(file.split('_')[0]);
      const applied = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=$1', [version]);
      if (applied.rows.length) continue;
      await db.exec(await fs.readFile(new URL(file, directory), 'utf8'));
      await db.query('INSERT INTO schema_migrations (version,name) VALUES ($1,$2)', [version, file]);
    }
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='system_settings' AND column_name='sms_template'",
    );
    assert.equal(columns.rows.length, 1);
    const applied009 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=9');
    assert.equal(applied009.rows.length, 1);
    const applied011 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=11');
    assert.equal(applied011.rows.length, 1);
    const applied012 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=12');
    assert.equal(applied012.rows.length, 1);
    const applied013 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=13');
    assert.equal(applied013.rows.length, 1);
    const applied014 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=14');
    assert.equal(applied014.rows.length, 1);
    const applied015 = await db.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version=15');
    assert.equal(applied015.rows.length, 1);
    const resolutionColumns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='email_threads' AND column_name IN ('resolved_by','resolution_note') ORDER BY column_name",
    );
    assert.deepEqual(resolutionColumns.rows.map((row) => row.column_name), ['resolution_note', 'resolved_by']);
    const holidays = await db.query<{ holiday_dates: string[] }>('SELECT holiday_dates FROM email_sla_settings WHERE id=1');
    assert.deepEqual(holidays.rows[0].holiday_dates, []);
    const snapshotColumn = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='email_threads' AND column_name='sla_settings_snapshot'",
    );
    assert.equal(snapshotColumn.rows.length, 1);
    const notificationTable = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='email_assignment_notifications'",
    );
    assert.equal(notificationTable.rows.length, 1);
    const routingColumns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='email_threads' AND column_name IN ('assignment_reason','outlook_web_link') ORDER BY column_name",
    );
    assert.deepEqual(routingColumns.rows.map((row) => row.column_name), ['assignment_reason', 'outlook_web_link']);
  } finally { await db.close(); }
});

test('migration 014 recalculates old night-time deadlines and preserves the previous values', async () => {
  const db = new PGlite();
  try {
    const directory = new URL('../../migrations/', import.meta.url);
    for (const file of ['009_email_sla_foundation.sql', '011_email_business_calendar.sql',
      '012_email_assignment_notifications.sql', '013_email_resolution_audit.sql']) {
      await db.exec(await fs.readFile(new URL(file, directory), 'utf8'));
    }
    await db.query(`INSERT INTO email_threads (mailbox,root_internet_message_id,customer_email,
      received_at,response_due_at,resolution_due_at,status,response_breached)
      VALUES ('cs-team@solvit.co.ke','old-night','customer@example.com',
      '2026-09-14T17:12:00Z','2026-09-14T17:42:00Z','2026-09-14T19:12:00Z',
      'AWAITING_RESPONSE',true)`);
    await db.query(`INSERT INTO email_threads (mailbox,root_internet_message_id,customer_email,
      received_at,first_response_at,response_due_at,resolution_due_at,status,response_breached,
      sla_settings_snapshot)
      VALUES ('cs-team@solvit.co.ke','old-holiday','customer@example.com',
      '2026-09-18T13:50:00Z','2026-09-18T14:30:00Z',
      '2026-09-18T14:20:00Z','2026-09-18T15:50:00Z','IN_PROGRESS',true,
      '{"responseMinutes":30,"responseWarningMinutes":20,"responseUrgentMinutes":25,
        "resolutionMinutes":120,"resolutionWarningMinutes":90,"resolutionUrgentMinutes":105,
        "holidayDates":["2026-09-21"]}')`);
    await db.query("INSERT INTO email_alerts (email_thread_id,alert_type) VALUES (1,'RESPONSE_BREACH')");
    await db.exec(await fs.readFile(new URL('014_recalculate_email_business_hours.sql', directory), 'utf8'));
    const result = await db.query<{
      response_due_at: string; resolution_due_at: string; response_breached: boolean;
      sla_settings_snapshot: { responseMinutes: number };
    }>('SELECT response_due_at,resolution_due_at,response_breached,sla_settings_snapshot FROM email_threads WHERE id=1');
    assert.equal(new Date(result.rows[0].response_due_at).toISOString(), '2026-09-15T05:30:00.000Z');
    assert.equal(new Date(result.rows[0].resolution_due_at).toISOString(), '2026-09-15T07:00:00.000Z');
    assert.equal(result.rows[0].response_breached, false);
    assert.equal(result.rows[0].sla_settings_snapshot.responseMinutes, 30);
    const holiday = await db.query<{ response_due_at: string; resolution_due_at: string; response_breached: boolean }>(
      'SELECT response_due_at,resolution_due_at,response_breached FROM email_threads WHERE id=2',
    );
    assert.equal(new Date(holiday.rows[0].response_due_at).toISOString(), '2026-09-22T05:20:00.000Z');
    assert.equal(new Date(holiday.rows[0].resolution_due_at).toISOString(), '2026-09-22T06:50:00.000Z');
    assert.equal(holiday.rows[0].response_breached, false);
    const audit = await db.query<{ previous_response_due_at: string; previous_sla_alerts: unknown[] }>(
      'SELECT previous_response_due_at,previous_sla_alerts FROM email_sla_recalculation_audit WHERE email_thread_id=1',
    );
    assert.equal(new Date(audit.rows[0].previous_response_due_at).toISOString(), '2026-09-14T17:42:00.000Z');
    assert.equal(audit.rows[0].previous_sla_alerts.length, 1);
    const alerts = await db.query('SELECT id FROM email_alerts');
    assert.equal(alerts.rows.length, 0);
  } finally { await db.close(); }
});
