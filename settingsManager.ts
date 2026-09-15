import { DbAdapter } from './db';
import {
  SystemSettings,
  SettingsChangeLog,
  DEFAULT_SETTINGS,
  DEFAULT_WORKING_HOURS,
  WorkingHoursSchedule,
} from './src/types/compliance';

export async function getSystemSettings(db: DbAdapter): Promise<SystemSettings> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM system_settings WHERE id = 1');
    if (!row) {
      // Insert default settings
      const defaultSched = JSON.stringify(DEFAULT_SETTINGS.working_hours_schedule);
      const defaultRecipients = JSON.stringify(DEFAULT_SETTINGS.daily_summary_recipients);
      await db.execute(
        `INSERT INTO system_settings 
         (id, callback_window_minutes, reconnection_window_minutes, sms_followup_enabled, sms_deadline_minutes, working_hours_schedule, clock_mode, min_connection_duration, daily_summary_enabled, daily_summary_recipients, daily_summary_last_sent_date)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [
          DEFAULT_SETTINGS.callback_window_minutes,
          DEFAULT_SETTINGS.reconnection_window_minutes,
          DEFAULT_SETTINGS.sms_followup_enabled ? true : false,
          DEFAULT_SETTINGS.sms_deadline_minutes,
          defaultSched,
          DEFAULT_SETTINGS.clock_mode,
          DEFAULT_SETTINGS.min_connection_duration,
          DEFAULT_SETTINGS.daily_summary_enabled ? 1 : 0,
          defaultRecipients,
          DEFAULT_SETTINGS.daily_summary_last_sent_date,
        ]
      );
      return DEFAULT_SETTINGS;
    }

    let parsedSchedule: WorkingHoursSchedule = DEFAULT_WORKING_HOURS;
    try {
      if (typeof row.working_hours_schedule === 'string') {
        parsedSchedule = JSON.parse(row.working_hours_schedule);
      } else if (typeof row.working_hours_schedule === 'object' && row.working_hours_schedule !== null) {
        parsedSchedule = row.working_hours_schedule;
      }
    } catch (e) {
      console.warn('Failed to parse working hours schedule, using default:', e);
    }

    let parsedRecipients: string[] = [];
    if (row.daily_summary_recipients) {
      try {
        if (typeof row.daily_summary_recipients === 'string') {
          if (row.daily_summary_recipients.startsWith('[')) {
            parsedRecipients = JSON.parse(row.daily_summary_recipients);
          } else {
            parsedRecipients = row.daily_summary_recipients
              .split(/[\n,;]+/)
              .map((s: string) => s.trim())
              .filter(Boolean);
          }
        } else if (Array.isArray(row.daily_summary_recipients)) {
          parsedRecipients = row.daily_summary_recipients;
        }
      } catch (e) {
        console.warn('Failed to parse daily summary recipients:', e);
      }
    }

    return {
      callback_window_minutes: Number(row.callback_window_minutes ?? DEFAULT_SETTINGS.callback_window_minutes),
      reconnection_window_minutes: Number(row.reconnection_window_minutes ?? DEFAULT_SETTINGS.reconnection_window_minutes),
      sms_followup_enabled: row.sms_followup_enabled === 1 || row.sms_followup_enabled === true || row.sms_followup_enabled === '1',
      sms_deadline_minutes: Number(row.sms_deadline_minutes ?? DEFAULT_SETTINGS.sms_deadline_minutes),
      working_hours_schedule: parsedSchedule,
      clock_mode: row.clock_mode === 'continuous_24_7' ? 'continuous_24_7' : 'working_hours',
      min_connection_duration: Number(row.min_connection_duration ?? DEFAULT_SETTINGS.min_connection_duration),
      daily_summary_enabled: row.daily_summary_enabled === 1 || row.daily_summary_enabled === true || row.daily_summary_enabled === '1',
      daily_summary_recipients: parsedRecipients,
      daily_summary_last_sent_date: row.daily_summary_last_sent_date || null,
      gmail_user: row.gmail_user || null,
      gmail_app_password: row.gmail_app_password || null,
      gmail_app_password_configured: Boolean(row.gmail_app_password && String(row.gmail_app_password).trim().length > 0),
    };
  } catch (err) {
    console.error('Error fetching system settings:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function updateSystemSettings(
  db: DbAdapter,
  incoming: Partial<SystemSettings>,
  changedBy: string = 'Admin'
): Promise<{ success: boolean; settings: SystemSettings }> {
  const current = await getSystemSettings(db);

  // If incoming password is empty/blank/undefined, retain stored password
  const newAppPassword =
    incoming.gmail_app_password !== undefined &&
    incoming.gmail_app_password !== null &&
    String(incoming.gmail_app_password).trim() !== ''
      ? String(incoming.gmail_app_password).trim()
      : current.gmail_app_password;

  const updated: SystemSettings = {
    callback_window_minutes:
      incoming.callback_window_minutes !== undefined
        ? Number(incoming.callback_window_minutes)
        : current.callback_window_minutes,
    reconnection_window_minutes:
      incoming.reconnection_window_minutes !== undefined
        ? Number(incoming.reconnection_window_minutes)
        : current.reconnection_window_minutes,
    sms_followup_enabled:
      incoming.sms_followup_enabled !== undefined
        ? Boolean(incoming.sms_followup_enabled)
        : current.sms_followup_enabled,
    sms_deadline_minutes:
      incoming.sms_deadline_minutes !== undefined
        ? Number(incoming.sms_deadline_minutes)
        : current.sms_deadline_minutes,
    working_hours_schedule:
      incoming.working_hours_schedule !== undefined
        ? incoming.working_hours_schedule
        : current.working_hours_schedule,
    clock_mode:
      incoming.clock_mode === 'continuous_24_7' ? 'continuous_24_7' : 'working_hours',
    min_connection_duration:
      incoming.min_connection_duration !== undefined
        ? Number(incoming.min_connection_duration)
        : current.min_connection_duration,
    daily_summary_enabled:
      incoming.daily_summary_enabled !== undefined
        ? Boolean(incoming.daily_summary_enabled)
        : current.daily_summary_enabled,
    daily_summary_recipients:
      incoming.daily_summary_recipients !== undefined
        ? (Array.isArray(incoming.daily_summary_recipients)
            ? incoming.daily_summary_recipients.map(s => String(s).trim()).filter(Boolean)
            : [])
        : current.daily_summary_recipients,
    daily_summary_last_sent_date:
      incoming.daily_summary_last_sent_date !== undefined
        ? incoming.daily_summary_last_sent_date
        : current.daily_summary_last_sent_date,
    gmail_user:
      incoming.gmail_user !== undefined
        ? (incoming.gmail_user ? String(incoming.gmail_user).trim() : null)
        : current.gmail_user,
    gmail_app_password: newAppPassword,
    gmail_app_password_configured: Boolean(newAppPassword && newAppPassword.trim().length > 0),
  };

  // Compare and record differences in settings_change_log
  const changesToLog: { key: string; oldVal: string; newVal: string }[] = [];

  if (current.callback_window_minutes !== updated.callback_window_minutes) {
    changesToLog.push({
      key: 'callback_window_minutes',
      oldVal: `${current.callback_window_minutes} mins`,
      newVal: `${updated.callback_window_minutes} mins`,
    });
  }
  if (current.reconnection_window_minutes !== updated.reconnection_window_minutes) {
    changesToLog.push({
      key: 'reconnection_window_minutes',
      oldVal: `${current.reconnection_window_minutes} mins`,
      newVal: `${updated.reconnection_window_minutes} mins`,
    });
  }
  if (current.sms_followup_enabled !== updated.sms_followup_enabled) {
    changesToLog.push({
      key: 'sms_followup_enabled',
      oldVal: current.sms_followup_enabled ? 'Enabled' : 'Disabled',
      newVal: updated.sms_followup_enabled ? 'Enabled' : 'Disabled',
    });
  }
  if (current.sms_deadline_minutes !== updated.sms_deadline_minutes) {
    changesToLog.push({
      key: 'sms_deadline_minutes',
      oldVal: `${current.sms_deadline_minutes} mins`,
      newVal: `${updated.sms_deadline_minutes} mins`,
    });
  }
  if (current.clock_mode !== updated.clock_mode) {
    changesToLog.push({
      key: 'clock_mode',
      oldVal: current.clock_mode === 'working_hours' ? 'Working hours only' : 'Continuous 24/7',
      newVal: updated.clock_mode === 'working_hours' ? 'Working hours only' : 'Continuous 24/7',
    });
  }
  if (current.min_connection_duration !== updated.min_connection_duration) {
    changesToLog.push({
      key: 'min_connection_duration',
      oldVal: `${current.min_connection_duration}s`,
      newVal: `${updated.min_connection_duration}s`,
    });
  }
  if (current.daily_summary_enabled !== updated.daily_summary_enabled) {
    changesToLog.push({
      key: 'daily_summary_enabled',
      oldVal: current.daily_summary_enabled ? 'Enabled' : 'Disabled',
      newVal: updated.daily_summary_enabled ? 'Enabled' : 'Disabled',
    });
  }
  if (JSON.stringify(current.daily_summary_recipients) !== JSON.stringify(updated.daily_summary_recipients)) {
    changesToLog.push({
      key: 'daily_summary_recipients',
      oldVal: current.daily_summary_recipients.join(', ') || 'None',
      newVal: updated.daily_summary_recipients.join(', ') || 'None',
    });
  }

  if (current.gmail_user !== updated.gmail_user) {
    changesToLog.push({
      key: 'gmail_user',
      oldVal: current.gmail_user || 'Not set',
      newVal: updated.gmail_user || 'Not set',
    });
  }

  if (current.gmail_app_password !== updated.gmail_app_password) {
    changesToLog.push({
      key: 'gmail_app_password',
      oldVal: current.gmail_app_password ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      newVal: updated.gmail_app_password ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
    });
  }

  const oldSchedStr = JSON.stringify(current.working_hours_schedule);
  const newSchedStr = JSON.stringify(updated.working_hours_schedule);
  if (oldSchedStr !== newSchedStr) {
    changesToLog.push({
      key: 'working_hours_schedule',
      oldVal: oldSchedStr,
      newVal: newSchedStr,
    });
  }

  // Persist settings update
  const schedJson = JSON.stringify(updated.working_hours_schedule);
  const recipientsJson = JSON.stringify(updated.daily_summary_recipients);
  await db.execute(
    `INSERT INTO system_settings 
     (id, callback_window_minutes, reconnection_window_minutes, sms_followup_enabled, sms_deadline_minutes, working_hours_schedule, clock_mode, min_connection_duration, daily_summary_enabled, daily_summary_recipients, daily_summary_last_sent_date, gmail_user, gmail_app_password, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       callback_window_minutes = EXCLUDED.callback_window_minutes,
       reconnection_window_minutes = EXCLUDED.reconnection_window_minutes,
       sms_followup_enabled = EXCLUDED.sms_followup_enabled,
       sms_deadline_minutes = EXCLUDED.sms_deadline_minutes,
       working_hours_schedule = EXCLUDED.working_hours_schedule,
       clock_mode = EXCLUDED.clock_mode,
       min_connection_duration = EXCLUDED.min_connection_duration,
       daily_summary_enabled = EXCLUDED.daily_summary_enabled,
       daily_summary_recipients = EXCLUDED.daily_summary_recipients,
       daily_summary_last_sent_date = EXCLUDED.daily_summary_last_sent_date,
       gmail_user = EXCLUDED.gmail_user,
       gmail_app_password = EXCLUDED.gmail_app_password,
       updated_at = CURRENT_TIMESTAMP`,
    [
      updated.callback_window_minutes,
      updated.reconnection_window_minutes,
      updated.sms_followup_enabled ? true : false,
      updated.sms_deadline_minutes,
      schedJson,
      updated.clock_mode,
      updated.min_connection_duration,
      updated.daily_summary_enabled ? true : false,
      recipientsJson,
      updated.daily_summary_last_sent_date,
      updated.gmail_user,
      updated.gmail_app_password,
    ]
  );

  // Insert change logs
  for (const item of changesToLog) {
    await db.execute(
      `INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [item.key, item.oldVal, item.newVal, changedBy]
    );
  }

  return { success: true, settings: updated };
}

export async function updateDailySummaryLastSentDate(
  db: DbAdapter,
  dateStr: string
): Promise<void> {
  await db.execute(
    `UPDATE system_settings SET daily_summary_last_sent_date = ? WHERE id = 1`,
    [dateStr]
  );
}

export async function getSettingsChangeLogs(db: DbAdapter): Promise<SettingsChangeLog[]> {
  try {
    const logs = await db.queryAll<any>(
      `SELECT id, setting_key, old_value, new_value, changed_by,
              datetime(created_at, '+3 hours') as created_at
       FROM settings_change_log
       ORDER BY id DESC LIMIT 200`
    );
    return logs.map((l) => ({
      id: l.id,
      setting_key: l.setting_key,
      old_value: l.old_value,
      new_value: l.new_value,
      changed_by: l.changed_by || 'Admin',
      created_at: l.created_at,
    }));
  } catch (err) {
    console.error('Error fetching settings change log:', err);
    return [];
  }
}
