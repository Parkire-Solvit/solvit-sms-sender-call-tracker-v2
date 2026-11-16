import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { initDatabase } from '../../db';
import type { GraphClient, GraphMessage } from './graphClient';
import { reconcileHistoricalReplies, type EmailRuntimeConfig } from './emailSyncService';

test('recovery closes a subject-matched reply without headers or conversation ID and preserves preview', async (t) => {
  const db = new PGlite();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    const directory = new URL('../../migrations/', import.meta.url);
    const versions = new Set<number>();
    for (const file of (await fs.readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
      const version = Number(file.split('_')[0]);
      if (versions.has(version)) continue;
      await db.exec(await fs.readFile(new URL(file, directory), 'utf8'));
      versions.add(version);
    }
    // Exercise the actual repository SQL against PostgreSQL without a server.
    const query = async (sql: string, params?: any[]) => {
      if (sql.includes('MAX(version)')) return { rows: [{ version: 34 }], rowCount: 1 };
      const result = await db.query(sql, params);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    };
    t.mock.method(pg.Pool.prototype, 'query', query);
    t.mock.method(pg.Pool.prototype, 'connect', async () => ({ query, release() {} }));
    process.env.DATABASE_URL = 'postgresql://unused:unused@localhost/test';
    await initDatabase();
    const mailbox = 'cmbugua@solvit.co.ke';
    await db.query('INSERT INTO email_team_members(email,display_name) VALUES ($1,$2)', [mailbox, 'Caroline']);
    const sentAt = new Date(Date.now() - 60_000);
    const receivedAt = new Date(sentAt.getTime() - 60_000);
    await db.query(`INSERT INTO email_threads(mailbox,root_internet_message_id,subject,customer_email,
      received_at,response_due_at,resolution_due_at,status)
      VALUES ($1,'<customer@example.com>','Valuation KDA 001A','customer@example.com',$2,$3,$3,'UNASSIGNED')`,
    [mailbox, receivedAt, new Date(sentAt.getTime() + 60_000)]);
    await db.exec("INSERT INTO email_alerts(email_thread_id,alert_type) VALUES (1,'EMAIL_UNASSIGNED')");
    const reply: GraphMessage = {
      id: 'sent-copy', internetMessageId: '<response@example.com>', subject: 'RE: Valuation KDA 001A',
      from: { emailAddress: { address: mailbox } },
      toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
      sentDateTime: sentAt.toISOString(),
    };
    let messages = [reply];
    const config: EmailRuntimeConfig = {
      mailboxes: [mailbox], groupAddress: 'cs-team@solvit.co.ke', monitoringStart: receivedAt,
      graph: {
        getRecentFolderMessages: async (_mailbox: string, _folder: string, _since: Date, options?: { complete?: boolean }) => {
          assert.equal(options?.complete, true);
          return messages;
        },
        getMessageHeaders: async () => ({ id: reply.id, internetMessageHeaders: [] }),
      } as unknown as GraphClient,
    };
    const preview = await reconcileHistoricalReplies(config, 2, true);
    assert.equal(preview.ticketsClosed, 1);
    assert.equal((await db.query<{ first_response_at: string | null }>('SELECT first_response_at FROM email_threads')).rows[0].first_response_at, null);
    assert.equal((await db.query('SELECT * FROM email_messages')).rows.length, 0);

    // Same subject alone must never close a ticket for a different recipient.
    messages = [{ ...reply, toRecipients: [{ emailAddress: { address: 'someone-else@example.com' } }] }];
    assert.equal((await reconcileHistoricalReplies(config, 2, false)).ticketsClosed, 0);
    messages = [reply];
    const applied = await reconcileHistoricalReplies(config, 2, false);
    assert.equal(applied.ticketsClosed, 1);
    const row = (await db.query<{
      status: string; first_response_at: string; response_breached: boolean;
      responded_by: string; assignment_method: string;
    }>('SELECT * FROM email_threads')).rows[0];
    assert.equal(row.status, 'RESOLVED');
    assert.equal(new Date(row.first_response_at as string).toISOString(), sentAt.toISOString());
    assert.equal(row.response_breached, false);
    assert.equal(row.responded_by, mailbox);
    assert.equal(row.assignment_method, 'RESPONDER');
    assert.ok((await db.query<{ acknowledged_at: string | null }>('SELECT acknowledged_at FROM email_alerts')).rows[0].acknowledged_at);
    assert.equal((await reconcileHistoricalReplies(config, 2, false)).ticketsClosed, 0);
    assert.equal((await db.query('SELECT * FROM email_messages')).rows.length, 1);
  } finally {
    t.mock.restoreAll();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await db.close();
  }
});
