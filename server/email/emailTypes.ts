export type EmailThreadStatus = 'UNASSIGNED' | 'AWAITING_RESPONSE' | 'IN_PROGRESS' | 'RESOLVED';
export type EmailAssignmentMethod = 'DIRECT' | 'NAME_MATCH' | 'RULE' | 'DEFAULT' | 'ROUND_ROBIN' | 'MANUAL';
export type EmailAlertType =
  | 'EMAIL_UNASSIGNED'
  | 'RESPONSE_WARNING'
  | 'RESPONSE_URGENT'
  | 'RESPONSE_BREACH'
  | 'RESOLUTION_WARNING'
  | 'RESOLUTION_URGENT'
  | 'RESOLUTION_BREACH';

export interface EmailSlaSettings {
  responseMinutes: number;
  responseWarningMinutes: number;
  responseUrgentMinutes: number;
  resolutionMinutes: number;
  resolutionWarningMinutes: number;
  resolutionUrgentMinutes: number;
  holidayDates: string[];
}

export interface EmailSlaState {
  receivedAt: Date;
  responseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
}
