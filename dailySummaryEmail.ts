import nodemailer from 'nodemailer';
import type { DbAdapter } from './db';
import { getSystemSettings } from './settingsManager';

export function getNairobiDate(offsetDays = 0): string {
  const date = new Date(Date.now() + (3 * 60 * 60 * 1000) + (offsetDays * 24 * 60 * 60 * 1000));
  return date.toISOString().slice(0, 10);
}

export async function generateAndSendDailySummary(
  db: DbAdapter,
  options: { targetDate?: string; recipientsOverride?: string[] } = {}
): Promise<{ success: true; recipients: string[]; targetDate: string }> {
  const settings = await getSystemSettings(db);
  const recipients = options.recipientsOverride?.length
    ? options.recipientsOverride
    : settings.daily_summary_recipients;
  if (!recipients.length) throw new Error('No daily summary recipients are configured.');

  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be configured on Render.');

  const targetDate = options.targetDate || getNairobiDate(-1);
  const start = `${targetDate}T00:00:00+03:00`;
  const endDate = new Date(`${targetDate}T00:00:00+03:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = endDate.toISOString();

  const [events, openCallbacks, completedCallbacks] = await Promise.all([
    db.queryOne<any>(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'CALL' AND UPPER(COALESCE(status, '')) = 'INCOMING')::int AS incoming_calls,
         COUNT(*) FILTER (WHERE type = 'CALL' AND UPPER(COALESCE(status, '')) = 'OUTGOING')::int AS outgoing_calls,
         COUNT(*) FILTER (WHERE type = 'SMS')::int AS sms_sent
       FROM events WHERE timestamp >= ? AND timestamp < ?`,
      [start, end]
    ),
    db.queryOne<{ count: number }>(`SELECT COUNT(*)::int AS count FROM callback_jobs WHERE status = 'AMBER'`),
    db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM callback_jobs WHERE closed_at >= ? AND closed_at < ?`,
      [start, end]
    ),
  ]);

  const subject = `Daily Communication Summary - ${targetDate}`;
  const lines = [
    `Communication activity for ${targetDate}:`,
    `Incoming calls: ${Number(events?.incoming_calls || 0)}`,
    `Outgoing calls: ${Number(events?.outgoing_calls || 0)}`,
    `SMS sent: ${Number(events?.sms_sent || 0)}`,
    `Callback records completed: ${Number(completedCallbacks?.count || 0)}`,
    `Callback records currently pending: ${Number(openCallbacks?.count || 0)}`,
  ];

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({
    from: `"Solvit Communication Portal" <${user}>`,
    to: recipients.join(', '),
    subject,
    text: lines.join('\n'),
    html: `<h2>${subject}</h2><ul>${lines.slice(1).map((line) => `<li>${line}</li>`).join('')}</ul><p>Generated automatically at 8:00 AM Nairobi time.</p>`,
  });
  return { success: true, recipients, targetDate };
}
