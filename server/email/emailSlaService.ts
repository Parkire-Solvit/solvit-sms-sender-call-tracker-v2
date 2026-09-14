import type { EmailAlertType, EmailSlaSettings, EmailSlaState } from './emailTypes';

const minuteMs = 60_000;

function validDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
}

export function validateEmailSlaSettings(settings: EmailSlaSettings): void {
  const values = Object.values(settings);
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
}

export function startEmailSla(receivedAt: Date, settings: EmailSlaSettings): EmailSlaState {
  validDate(receivedAt, 'receivedAt');
  validateEmailSlaSettings(settings);
  return {
    receivedAt: new Date(receivedAt),
    responseDueAt: new Date(receivedAt.getTime() + settings.responseMinutes * minuteMs),
    resolutionDueAt: new Date(receivedAt.getTime() + settings.resolutionMinutes * minuteMs),
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
  const elapsed = (now.getTime() - state.receivedAt.getTime()) / minuteMs;
  const due: EmailAlertType[] = [];
  if (unassigned) due.push('EMAIL_UNASSIGNED');
  if (!state.firstResponseAt) {
    if (elapsed >= settings.responseWarningMinutes) due.push('RESPONSE_WARNING');
    if (elapsed >= settings.responseUrgentMinutes) due.push('RESPONSE_URGENT');
    if (elapsed > settings.responseMinutes) due.push('RESPONSE_BREACH');
  } else if (state.responseBreached) {
    due.push('RESPONSE_BREACH');
  }
  if (!state.resolvedAt) {
    if (elapsed >= settings.resolutionWarningMinutes) due.push('RESOLUTION_WARNING');
    if (elapsed >= settings.resolutionUrgentMinutes) due.push('RESOLUTION_URGENT');
    if (elapsed > settings.resolutionMinutes) due.push('RESOLUTION_BREACH');
  } else if (state.resolutionBreached) {
    due.push('RESOLUTION_BREACH');
  }
  return due.filter((alert) => !alreadyEmitted.has(alert));
}
