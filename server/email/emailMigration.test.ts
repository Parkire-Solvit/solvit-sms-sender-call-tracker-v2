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
  } finally { await db.close(); }
});
