import type { EmailAlertType, EmailSlaSettings, EmailSlaState } from './emailTypes';
import { addEmailWorkingMinutes, emailWorkingMinutesBetween, isEmailWorkingTime, validEmailHolidayDate } from '../../shared/emailBusinessHours';

function validDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
}

export function validateEmailSlaSettings(settings: EmailSlaSettings): void {
  const values = [settings.responseMinutes, settings.responseWarningMinutes, settings.responseUrgentMinutes,
    settings.resolutionMinutes, settings.resolutionWarningMinutes, settings.resolutionUrgentMinutes];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Email SLA settings must be non-negative whole minutes');
  }
  if (!(settings.responseWarningMinutes < settings.responseUrgentMinutes &&
        settings.responseUrgentMinutes < settings.responseMinutes)) {
    throw new Error('Response warning, urgent and due times must be in increasing order');
  }
  if (!(settings.resolutionWarningMinutes < settings.resolutionUrgentMinutes &&
        settings.resolutionUrgentMinutes < settings.resolutionMinutes)) {
    throw new Error('Resolution warning, urgent and due times must be in increasing order');
  }
  if (!Array.isArray(settings.holidayDates) || settings.holidayDates.length > 366 ||
      settings.holidayDates.some((date) => typeof date !== 'string' || !validEmailHolidayDate(date)) ||
      new Set(settings.holidayDates).size !== settings.holidayDates.length) {
    throw new Error('Holiday dates must be unique YYYY-MM-DD Nairobi dates');
  }
}

export function startEmailSla(receivedAt: Date, settings: EmailSlaSettings): EmailSlaState {
  validDate(receivedAt, 'receivedAt');
  validateEmailSlaSettings(settings);
  return {
    receivedAt: new Date(receivedAt),
    responseDueAt: addEmailWorkingMinutes(receivedAt, settings.responseMinutes, settings.holidayDates),
    resolutionDueAt: addEmailWorkingMinutes(receivedAt, settings.resolutionMinutes, settings.holidayDates),
    firstResponseAt: null,
    resolvedAt: null,
    responseBreached: false,
    resolutionBreached: false,
  };
}

export function recordFirstResponse(state: EmailSlaState, sentAt: Date): EmailSlaState {
  validDate(sentAt, 'sentAt');
  if (state.firstResponseAt || sentAt.getTime() < state.receivedAt.getTime()) return state;
  return {
    ...state,
    firstResponseAt: new Date(sentAt),
    responseBreached: sentAt.getTime() > state.responseDueAt.getTime(),
  };
}

export function resolveEmailSla(state: EmailSlaState, resolvedAt: Date): EmailSlaState {
  validDate(resolvedAt, 'resolvedAt');
  if (state.resolvedAt) return state;
  if (resolvedAt.getTime() < state.receivedAt.getTime()) throw new Error('Resolution cannot precede receipt');
  return {
    ...state,
    resolvedAt: new Date(resolvedAt),
    resolutionBreached: resolvedAt.getTime() > state.resolutionDueAt.getTime(),
  };
}

export function dueEmailAlerts(
  state: EmailSlaState,
  settings: EmailSlaSettings,
  now: Date,
  alreadyEmitted: ReadonlySet<EmailAlertType>,
  unassigned = false,
): EmailAlertType[] {
  validDate(now, 'now');
  validateEmailSlaSettings(settings);
  // Alerts wait until the next open period; deadlines always use the Nairobi calendar.
  if (!isEmailWorkingTime(now, settings.holidayDates)) return [];
  const responseRemaining = emailWorkingMinutesBetween(now, state.responseDueAt, settings.holidayDates);
  const resolutionRemaining = emailWorkingMinutesBetween(now, state.resolutionDueAt, settings.holidayDates);
  const due: EmailAlertType[] = [];
  if (unassigned) due.push('EMAIL_UNASSIGNED');
  if (!state.firstResponseAt) {
    if (responseRemaining <= settings.responseMinutes - settings.responseWarningMinutes) due.push('RESPONSE_WARNING');
    if (responseRemaining <= settings.responseMinutes - settings.responseUrgentMinutes) due.push('RESPONSE_URGENT');
    if (now >= state.responseDueAt) due.push('RESPONSE_BREACH');
  } else if (state.responseBreached) {
    due.push('RESPONSE_BREACH');
  }
  if (!state.resolvedAt) {
    if (resolutionRemaining <= settings.resolutionMinutes - settings.resolutionWarningMinutes) due.push('RESOLUTION_WARNING');
    if (resolutionRemaining <= settings.resolutionMinutes - settings.resolutionUrgentMinutes) due.push('RESOLUTION_URGENT');
    if (now >= state.resolutionDueAt) due.push('RESOLUTION_BREACH');
  } else if (state.resolutionBreached) {
    due.push('RESOLUTION_BREACH');
  }
  return due.filter((alert) => !alreadyEmitted.has(alert));
}
