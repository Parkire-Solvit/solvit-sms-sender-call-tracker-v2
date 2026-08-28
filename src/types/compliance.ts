export interface WorkingHoursDay {
  enabled: boolean;
  open: string; // "09:00"
  close: string; // "17:00"
}

export interface WorkingHoursSchedule {
  monday: WorkingHoursDay;
  tuesday: WorkingHoursDay;
  wednesday: WorkingHoursDay;
  thursday: WorkingHoursDay;
  friday: WorkingHoursDay;
  saturday: WorkingHoursDay;
  sunday: WorkingHoursDay;
}

export interface SystemSettings {
  callback_window_minutes: number; // default 30
  reconnection_window_minutes: number; // default 1440 (24h)
  sms_followup_enabled: boolean; // default true
  sms_deadline_minutes: number; // default 30
  sms_template: string;
  working_hours_schedule: WorkingHoursSchedule;
  clock_mode: 'working_hours' | 'continuous_24_7'; // default working_hours
  min_connection_duration: number; // in seconds, default 0
}

export interface SettingsChangeLog {
  id: number;
  setting_key: string;
  old_value: string;
  new_value: string;
  changed_by: string;
  created_at: string;
}

export const DEFAULT_WORKING_HOURS: WorkingHoursSchedule = {
  monday: { enabled: true, open: '09:00', close: '17:00' },
  tuesday: { enabled: true, open: '09:00', close: '17:00' },
  wednesday: { enabled: true, open: '09:00', close: '17:00' },
  thursday: { enabled: true, open: '09:00', close: '17:00' },
  friday: { enabled: true, open: '09:00', close: '17:00' },
  saturday: { enabled: true, open: '09:00', close: '12:00' },
  sunday: { enabled: false, open: '09:00', close: '17:00' },
};

export const DEFAULT_SETTINGS: SystemSettings = {
  callback_window_minutes: 30,
  reconnection_window_minutes: 1440,
  sms_followup_enabled: true,
  sms_deadline_minutes: 30,
  sms_template: '',
  working_hours_schedule: DEFAULT_WORKING_HOURS,
  clock_mode: 'working_hours',
  min_connection_duration: 0,
};

export type ObligationType = 
  | 'MISSED_INCOMING_CALLBACK' // Obligation A
  | 'OUTGOING_RECONNECTION'     // Obligation B
  | 'SMS_FOLLOWUP';            // Obligation C

export type ObligationStatus = 'MET' | 'BREACHED' | 'OPEN';

export interface Obligation {
  id: string;
  target_phone: string;
  obligation_type: ObligationType;
  trigger_event_id: number;
  trigger_timestamp: string; // ISO string (UTC)
  trigger_local_timestamp: string; // Nairobi string
  originating_agent_id: number | null;
  originating_agent_name: string;
  originating_agent_tag: string;
  deadline_timestamp: string; // ISO string
  deadline_local_timestamp: string; // Nairobi string
  status: ObligationStatus;
  resolution_timestamp?: string;
  resolution_local_timestamp?: string;
  resolving_agent_id?: number | null;
  resolving_agent_name?: string;
  turnaround_minutes?: number;
  attributed_agent_id?: number | null;
  attributed_agent_name?: string;
  threshold_minutes: number;
  owed_action: 'CALLBACK' | 'SMS' | 'CALLBACK_AND_SMS';
  sms_sent: boolean;
  sms_sent_timestamp?: string;
  remaining_minutes?: number; // Live working or physical remaining minutes
  is_urgent?: boolean;
}

export interface MeanMedianMetric {
  mean: number | null;
  median: number | null;
  count: number;
  threshold: number;
  status: 'OPTIMAL' | 'WARNING' | 'BREACHED' | 'NO_DATA';
}

export interface TurnaroundMetricsGroup {
  overall_callback_turnaround: MeanMedianMetric;
  overall_connection_turnaround: MeanMedianMetric;
  missed_to_first_attempt: MeanMedianMetric;
  missed_to_connection: MeanMedianMetric;
  failed_outgoing_to_next_attempt: MeanMedianMetric;
  failed_outgoing_to_connection: MeanMedianMetric;
  failed_outgoing_to_sms: MeanMedianMetric;
}

export interface TurnaroundTimeReport {
  company_wide: TurnaroundMetricsGroup;
  by_tag: Record<string, TurnaroundMetricsGroup & { agent_count: number }>;
  by_agent: Record<number, TurnaroundMetricsGroup & { agent_name: string; tag: string }>;
}

export interface AgentComplianceSummary {
  agent_id: number;
  agent_name: string;
  tag: string;
  phone_number?: string;
  installed_at?: string;
  last_active_at?: string;
  
  // Compliance
  incoming_callback_met: number;
  incoming_callback_total: number;
  incoming_callback_compliance_pct: number | null;

  outgoing_reconnect_met: number;
  outgoing_reconnect_total: number;
  outgoing_reconnect_compliance_pct: number | null;

  sms_followup_met: number;
  sms_followup_total: number;
  sms_followup_compliance_pct: number | null;

  combined_compliance_pct: number | null;
  open_obligations_count: number;
  breaches_attributed_count: number;

  // Raw activity counts
  calls_made: number;
  calls_incoming: number;
  calls_connected: number;
  calls_outgoing_connected: number;
  calls_incoming_connected: number;
  calls_not_picked: number;
  calls_missed: number;
  sms_count: number;
}

export interface HeadlineComplianceStats {
  incoming_callback_compliance_pct: number | null;
  incoming_callback_met: number;
  incoming_callback_total: number;
  open_incoming_count: number;

  outgoing_reconnect_compliance_pct: number | null;
  outgoing_reconnect_met: number;
  outgoing_reconnect_total: number;
  open_outgoing_count: number;

  sms_followup_compliance_pct: number | null;
  sms_followup_met: number;
  sms_followup_total: number;
  open_sms_count: number;

  open_obligations_count: number;
}

export interface TagGroupCompliance {
  tag: string;
  agent_count: number;
  compliance_pct: number | null;
  open_obligations_count: number;
  breaches_count: number;
}

export interface ContactThreadObligationSummary {
  obligation_type: ObligationType;
  status: ObligationStatus;
  trigger_time: string;
  deadline_time: string;
  turnaround_minutes: number | null;
  threshold_minutes: number;
  agent_name: string;
  resolution_time?: string;
  resolving_agent_name?: string;
}

export interface EventComplianceLabel {
  eventId: number;
  complianceEffect: 'CREATED_OBLIGATION' | 'CLEARED_OBLIGATION' | 'BREACHED_OBLIGATION' | null;
  description?: string;
}
