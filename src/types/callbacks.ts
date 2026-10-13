export type CallbackJobStatus = 'GREEN' | 'AMBER' | 'RED';

export type AgentCallbackOutcome = 
  | 'SCHEDULED'
  | 'DECLINED'
  | 'VALUED_ELSEWHERE'
  | 'NOT_PICKING'
  | 'WRONG_NUMBER'
  | 'NOT_READY'
  | 'UNREACHABLE';

export type SystemCallbackOutcome =
  | 'MAX_ATTEMPTS_REACHED'
  | 'ABSENT_FROM_LATEST_EXPORT';

export type CallbackOutcome = AgentCallbackOutcome | SystemCallbackOutcome;

export interface CallbackJobLog {
  id: number;
  callback_job_id: number;
  outcome: string;
  comment: string;
  logged_by: string;
  resulting_status: CallbackJobStatus;
  created_at: string;
}

export interface CallbackJobPhone {
  id?: number;
  callback_job_id?: number;
  phone_normalised: string;
  source: 'PRIMARY' | 'IMPORT' | 'MANUAL';
  created_at?: string;
}

export interface CallbackJob {
  id: number;
  vehicle_reg: string;
  vehicle_reg_raw: string;
  client_name: string | null;
  client_phone: string;
  client_phone_raw: string;
  customer_email?: string | null;
  channel_partner: string | null;
  initiated_date: string | null;
  brian_reason: string | null;
  status: CallbackJobStatus;
  assigned_agent_id: number | null;
  assigned_agent_name?: string | null;
  latest_outcome?: string | null;
  first_imported_at: string;
  last_seen_in_import_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  phones?: CallbackJobPhone[];
  // Computed activity metrics
  attempt_count: number;
  sms_count: number;
  sms_sent?: boolean;
  last_attempt_at: string | null;
  max_attempts: number;
  max_sms_attempts: number;
}
export interface LogOutcomePayload {
  outcome: string;
  comment?: string;
  logged_by: string;
}

export type MaxAttemptsChronologyEntry =
  | { kind: 'CALL'; status: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted?: boolean }
  | { kind: 'SMS'; status: string; note: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted?: boolean }
  | { kind: 'OUTCOME'; outcome: string; comment: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted?: boolean };

export interface MaxAttemptsReportAttempt {
  attempt_number: number;
  outcome: string;
  comment: string;
  logged_by: string;
  created_at: string;
}

export interface MaxAttemptsReportRecord {
  vehicle_reg_raw: string;
  client_name: string | null;
  client_phone_raw: string;
  customer_email?: string | null;
  initiated_date: string | null;
  closed_at: string | null;
  assigned_agent_id?: number | null;
  assigned_agent_name?: string | null;
  outgoing_calls_count?: number;
  sms_count?: number;
  attempts: MaxAttemptsReportAttempt[];
  chronology?: MaxAttemptsChronologyEntry[];
}

export interface MaxAttemptsReportGroup {
  channel_partner: string;
  allocated_agent_id?: number | null;
  allocated_agent_name?: string | null;
  records: MaxAttemptsReportRecord[];
}

export interface ChannelPartnerAllocation {
  channel_partner: string;
  assigned_agent_id: number | null;
  assigned_agent_name?: string | null;
  updated_at?: string;
}

export interface UserAccount {
  id: number;
  username: string;
  display_name: string;
  active: boolean;
  created_at: string;
}

export interface CallbackSettings {
  id: number;
  staff_count: number;
  callback_team_tag: string;
  max_attempts: number;
  max_sms_attempts: number;
  disappearance_alert_fixed_count?: number;
  disappearance_alert_percentage?: number;
  active_agents?: Array<{ id: number; name: string }>;
  updated_at?: string;
}

export interface CallbackImportSummary {
  requiresConfirmation?: boolean;
  wouldCloseCount?: number;
  wouldClosePercentage?: number;
  totalCurrentlyOpen?: number;
  filenameWarning?: string | null;
  row_count_total: number;
  new_records_count: number;
  skipped_open_count: number;
  skipped_closed_count: number;
  auto_closed_absent_count?: number;
}

export interface CallbackImportRow {
  vehicle_reg: string;
  client_name?: string;
  client_phone: string;
  customer_email?: string;
  channel_partner?: string;
  initiated_date?: string;
  reason?: string;
}

export interface CallbackImportPayload {
  file_name: string;
  imported_by: string;
  rows: CallbackImportRow[];
  confirmed?: boolean;
}

export type UnmatchedActivityReason =
  | 'NO_JOB_FOR_NUMBER'
  | 'ASSIGNED_TO_OTHER_AGENT'
  | 'UNRECOGNISED_AGENT';

export interface UnmatchedActivitySuggestedJob {
  id: number;
  vehicle_reg: string;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
}

export interface UnmatchedActivityItem {
  id: number;
  timestamp: string;
  agent_id: number | null;
  agent_name: string;
  type: string;
  status: string | null;
  target_phone: string;
  reg_no: string | null;
  reason: UnmatchedActivityReason;
  suggested_job: UnmatchedActivitySuggestedJob | null;
}

export interface AgentNeedsReview {
  id: number;
  name: string;
  tag: string;
  needs_review: boolean;
  event_count: number;
  last_active_at: string | null;
}

export function hasReachedMaxAttempts(
  job: { attempt_count: number; sms_count: number; max_attempts?: number; max_sms_attempts?: number },
  settings?: { max_attempts: number; max_sms_attempts: number }
): boolean {
  const targetCalls = settings?.max_attempts ?? job.max_attempts ?? 4;
  const targetSms = settings?.max_sms_attempts ?? job.max_sms_attempts ?? 4;
  return (job.attempt_count || 0) >= targetCalls && (job.sms_count || 0) >= targetSms;
}
