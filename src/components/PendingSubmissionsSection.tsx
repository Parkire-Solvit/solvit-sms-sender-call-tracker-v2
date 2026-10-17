// FIXPASS src/components/PendingSubmissionsSection.tsx
import React, { useState, useEffect, useMemo, FormEvent } from 'react';
import {
  FileText,
  Upload,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Phone,
  MessageSquare,
  User,
  Calendar,
  Send,
  Download,
  Settings as SettingsIcon,
  History,
  AlertCircle,
  X,
  Check,
  Eye,
  EyeOff,
  Sliders,
  ShieldCheck,
  Server,
  PhoneCall,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { parsePendingSubmissionRows } from '../lib/pendingSubmissionsParser';
import { toNairobiInputValue, nairobiInputToIso, formatNairobiDisplay } from '../lib/nairobiTime';
import { groupByCustomerOldestFirst } from '../lib/submissionQueue';
import { PendingCallSessionView } from './PendingCallSessionView';
import AgentKpiPanel from './AgentKpiPanel';

// Feature flags. Each is flipped to true by a LATER fix-pass step. Do not flip early.
const SHOW_WORKFLOW_EXTENDED = true; // flipped in FIXPASS 2
const SHOW_SMS_SETTINGS = true; // flipped in FIXPASS 3
const SHOW_INTEGRATIONS = true; // flipped in FIXPASS 3

/** A GREEN record that was closed because the latest upload no longer contained it (not by an agent). */
const SUBMITTED_OUTCOMES = ['ABSENT_FROM_LATEST_EXPORT', 'SUBMITTED_BY_SOLVER'];
function isSubmittedByUpload(job: { status: string; latest_outcome: string | null }): boolean {
  return job.status === 'GREEN' && SUBMITTED_OUTCOMES.includes(job.latest_outcome ?? '');
}

/** Integer from a text input. An empty or non-numeric value returns the fallback; 0 is kept as 0. */
function intOr(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export interface PendingSubmissionJob {
  id: number;
  external_id: number;
  solver_name: string | null;
  solver_contact: string;
  solver_contact_raw: string;
  solver_email: string | null;
  vehicle_reg: string;
  vehicle_reg_raw: string;
  insurance_company: string | null;
  client_phone: string;
  client_phone_raw: string;
  customer_email: string | null;
  schedule_date: string | null;
  latest_pending_reason: string | null;
  status: 'GREEN' | 'AMBER' | 'RED';
  latest_outcome: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  scheduled_at: string | null;
  scheduled_place: string | null;
  solver_notification_status: string | null;
  solver_notified_at: string | null;
  solver_notification_error: string | null;
  solver_notification_message: string | null;
  solver_notification_transaction_id: string | null;
  solver_notification_attempts: number;
  solver_notification_attempted_at: string | null;
  first_imported_at: string;
  last_seen_in_import_at: string;
  closed_at: string | null;
  client_attempt_count: number;
  solver_attempt_count: number;
  last_client_attempt_at: string | null;
  client_sms_count: number;
  is_overdue: boolean;
  days_overdue: number;
  days_pending: number;
}

export interface PendingSubmissionLog {
  id: number;
  outcome: string;
  comment: string;
  logged_by: string;
  resulting_status: string;
  scheduled_at: string | null;
  scheduled_place: string | null;
  created_at: string;
}

export interface PendingWorkflowSettings {
  max_attempts: number;
  max_sms_attempts: number;
  overdue_after_days: number;
  callback_team_tag: string;
  solver_sms_auto_send: boolean;
  solver_sms_template: string;
  solver_sms_max_resends: number;
  disappearance_alert_fixed_count: number;
  disappearance_alert_percentage: number;
  max_attempts_grace_minutes: number;
}

interface IntegrationField {
  value?: string | boolean | null;
  configured?: boolean;
  source: 'database' | 'environment' | 'default' | null;
}

interface HostPinnacleView {
  ready: boolean;
  missing: string[];
  fields: Record<string, IntegrationField>;
}

interface HostPinnacleForm {
  enabled: boolean;
  auth_mode: 'api_key' | 'user_password';
  sender_id: string;
  country_code: string;
  user_id: string;
  api_key: string; // write-only: the server never returns it
  password: string; // write-only: the server never returns it
  clear_api_key: boolean;
  clear_password: boolean;
}

interface SubmissionAgent {
  id: number;
  name: string;
}

interface ImportSummary {
  file_name: string;
  row_count_total: number;
  new_records_count: number;
  skipped_open_count: number;
  skipped_closed_count: number;
  auto_closed_absent_count: number;
  disappearance_alert?: boolean;
  disappearance_alert_message?: string;
  client_skipped_count?: number;
  reopened_count?: number;
  invalid_rows_count?: number;
  duplicate_in_file_count?: number;
  invalid_rows?: Array<{ row: number; reason: string }>;
}

interface TeamInfo {
  callback_team_tag: string;
  agents: Array<{ id: number; name: string; open_count: number }>;
  unassigned_open_count: number;
  orphaned_open_count: number;
}

interface ImportConfirmationInfo {
  would_close_count: number;
  total_open: number;
  would_close_percentage: number;
  fixed_limit: number;
  percentage_limit: number;
}

interface PendingImportState {
  fileName: string;
  importedBy: string;
  rows: unknown[];
  skippedCount: number;
  confirmation: ImportConfirmationInfo;
}

// Exactly TEN agent-selectable outcomes
export const AGENT_OUTCOMES = [
  { value: 'SCHEDULED', label: 'Scheduled', resultingStatus: 'GREEN', closes: true },
  { value: 'CALL_BACK', label: 'Call back', resultingStatus: 'AMBER', closes: false },
  { value: 'NOT_READY', label: 'Not ready', resultingStatus: 'AMBER', closes: false },
  { value: 'NOT_PICKING', label: 'Not picking', resultingStatus: 'AMBER', closes: false },
  { value: 'UNREACHABLE', label: 'Unreachable', resultingStatus: 'AMBER', closes: false },
  { value: 'WRONG_NUMBER', label: 'Wrong number', resultingStatus: 'AMBER', closes: false },
  { value: 'CHANGED_LOCATION', label: 'Changed location', resultingStatus: 'AMBER', closes: false },
  { value: 'NO_DOCUMENTS', label: 'No documents', resultingStatus: 'AMBER', closes: false },
  { value: 'WRONG_REGISTRATION_SCHEDULE', label: 'Wrong registration schedule', resultingStatus: 'AMBER', closes: false },
  { value: 'WITHDRAWN', label: 'Withdrawn / Invalid', resultingStatus: 'RED', closes: true },
] as const;

// All known outcome labels (new, system, and legacy)
export const OUTCOME_DISPLAY_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  CALL_BACK: 'Call back',
  NOT_READY: 'Not ready',
  NOT_PICKING: 'Not picking',
  UNREACHABLE: 'Unreachable',
  WRONG_NUMBER: 'Wrong number',
  CHANGED_LOCATION: 'Changed location',
  NO_DOCUMENTS: 'No documents',
  WRONG_REGISTRATION_SCHEDULE: 'Wrong registration schedule',
  WITHDRAWN: 'Withdrawn / Invalid',
  // System-written outcomes
  MAX_ATTEMPTS_REACHED: 'Max Attempts Reached',
  ABSENT_FROM_LATEST_EXPORT: 'Submitted',
  REOPENED_BY_SYSTEM: 'Reopened by System',
  REASSIGNED_BY_SYSTEM: 'Reassigned by System',
  // Legacy outcomes from first build
  CONTACT_ATTEMPTED: 'Contact Attempted',
  CLIENT_POSTPONED: 'Client Postponed',
  CLIENT_REFUSED: 'Client Refused',
  AGREED_SCHEDULE: 'Agreed Schedule',
  SUBMITTED_BY_SOLVER: 'Submitted',
};

export function formatOutcome(outcome: string | null | undefined): string {
  if (!outcome) return 'Pending Action';
  const upper = outcome.toUpperCase();
  return OUTCOME_DISPLAY_LABELS[upper] || outcome;
}

export function getOutcomeBadgeColor(outcome: string | null | undefined, status: string): string {
  if (status === 'GREEN') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'RED') return 'bg-rose-100 text-rose-800 border-rose-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
}

interface PendingSubmissionsSectionProps {
  isAdmin?: boolean;
}

export default function PendingSubmissionsSection({ isAdmin }: PendingSubmissionsSectionProps) {
  // Determine admin access (prop or local storage session)
  const isUserAdmin =
    isAdmin ??
    Boolean(localStorage.getItem('solvit_admin_token') || localStorage.getItem('nellions_admin_token'));

  const [jobs, setJobs] = useState<PendingSubmissionJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [workflowSettings, setWorkflowSettings] = useState<PendingWorkflowSettings>({
    max_attempts: 4,
    max_sms_attempts: 4,
    overdue_after_days: 3,
    callback_team_tag: 'Callback Team(Submission)',
    solver_sms_auto_send: true,
    solver_sms_template:
      'Hi {solver_name}, inspection for {vehicle_reg} is scheduled for {scheduled_at} at {scheduled_place}.',
    solver_sms_max_resends: 3,
    disappearance_alert_fixed_count: 50,
    disappearance_alert_percentage: 30,
    max_attempts_grace_minutes: 30,
  });

  const [hostPinnacleView, setHostPinnacleView] = useState<HostPinnacleView | null>(null);
  const [hostPinnacleForm, setHostPinnacleForm] = useState<HostPinnacleForm>({
    enabled: false,
    auth_mode: 'api_key',
    sender_id: '',
    country_code: '254',
    user_id: '',
    api_key: '',
    password: '',
    clear_api_key: false,
    clear_password: false,
  });

  const [agents, setAgents] = useState<SubmissionAgent[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [maxAttemptsOnly, setMaxAttemptsOnly] = useState<boolean>(false);
  const [isCallSessionActive, setIsCallSessionActive] = useState<boolean>(false);
  const [kpiRefreshToken, setKpiRefreshToken] = useState<number>(0);

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'workflow' | 'sms' | 'integration' | 'team'>('workflow');
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);
  const [confirmingImport, setConfirmingImport] = useState<boolean>(false);
  const [outcomeOptions, setOutcomeOptions] = useState<ReadonlyArray<{ value: string; label: string; closes: boolean; resultingStatus: string }>>(AGENT_OUTCOMES);

  // Log Outcome Modal
  const [selectedJobForLog, setSelectedJobForLog] = useState<PendingSubmissionJob | null>(null);
  const [outcomeType, setOutcomeType] = useState<string>('SCHEDULED');
  const [outcomeScheduledAt, setOutcomeScheduledAt] = useState<string>('');
  const [outcomeScheduledPlace, setOutcomeScheduledPlace] = useState<string>('');
  const [outcomeComment, setOutcomeComment] = useState<string>('');
  const [outcomeLoggedBy, setOutcomeLoggedBy] = useState<string>('Mary');
  const [isSubmittingLog, setIsSubmittingLog] = useState<boolean>(false);

  // History Modal
  const [historyJob, setHistoryJob] = useState<PendingSubmissionJob | null>(null);
  const [historyLogs, setHistoryLogs] = useState<PendingSubmissionLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Notify Solver State
  const [notifyingJobId, setNotifyingJobId] = useState<number | null>(null);
  const [notifySuccessMsg, setNotifySuccessMsg] = useState<{ id: number; text: string; error?: boolean } | null>(null);

  // Upload Form State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Settings Modal State
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [settingsSuccessMessage, setSettingsSuccessMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Team tab
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [reassignPreview, setReassignPreview] = useState<{ records: number; clients: number; agents_used: number } | null>(null);
  const [reassigning, setReassigning] = useState<boolean>(false);
  const [teamMessage, setTeamMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Read-only Gmail status (managed in Master Settings)
  const [gmailInfo, setGmailInfo] = useState<{ configured: boolean; user: string | null } | null>(null);

  // Test SMS State
  const [testSmsPhone, setTestSmsPhone] = useState<string>('');
  const [testSmsLoading, setTestSmsLoading] = useState<boolean>(false);
  const [testSmsResult, setTestSmsResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/pending-submissions/settings');
      if (res.ok) {
        const data = await res.json();
        const wf = data.workflow || data;
        setWorkflowSettings({
          max_attempts: Number(wf.max_attempts ?? 4),
          max_sms_attempts: Number(wf.max_sms_attempts ?? 4),
          overdue_after_days: Number(wf.overdue_after_days ?? 3),
          callback_team_tag: wf.callback_team_tag || 'Callback Team(Submission)',
          solver_sms_auto_send: wf.solver_sms_auto_send ?? true,
          solver_sms_template:
            wf.solver_sms_template ||
            'Hi {solver_name}, inspection for {vehicle_reg} is scheduled for {scheduled_at} at {scheduled_place}.',
          solver_sms_max_resends: Number(wf.solver_sms_max_resends ?? 3),
          disappearance_alert_fixed_count: Number(wf.disappearance_alert_fixed_count ?? 50),
          disappearance_alert_percentage: Number(wf.disappearance_alert_percentage ?? 30),
          max_attempts_grace_minutes: Number(wf.max_attempts_grace_minutes ?? 30),
        });

      }
    } catch (e) {
      console.warn('Failed to fetch pending submission settings:', e);
    }
  };

  // FIXPASS:3 Secrets are never returned by the server. The form keeps write-only fields for them.
  const fetchIntegrations = async () => {
    try {
      const res = await fetch('/api/pending-submissions/integrations');
      if (!res.ok) return;
      const data = await res.json();
      const hp = data?.host_pinnacle;
      if (!hp) return;
      setHostPinnacleView({ ready: Boolean(hp.ready), missing: hp.missing || [], fields: hp.fields || {} });
      setHostPinnacleForm({
        enabled: hp.fields?.enabled?.value === true,
        auth_mode: hp.fields?.auth_mode?.value === 'user_password' ? 'user_password' : 'api_key',
        sender_id: String(hp.fields?.sender_id?.value ?? ''),
        country_code: String(hp.fields?.country_code?.value ?? '254'),
        user_id: String(hp.fields?.user_id?.value ?? ''),
        api_key: '',
        password: '',
        clear_api_key: false,
        clear_password: false,
      });
    } catch (e) {
      console.warn('Failed to fetch integrations:', e);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/pending-submissions/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
      }
    } catch (e) {
      console.warn('Failed to fetch submission agents:', e);
    }
  };

  // FIXPASS:2 The server is the source of truth for the agent outcomes. The local constant is the fallback.
  const fetchOutcomes = async () => {
    try {
      const res = await fetch('/api/pending-submissions/outcomes');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setOutcomeOptions(
          data.map((o: any) => ({
            value: String(o.value),
            label: String(o.label),
            closes: Boolean(o.closes),
            resultingStatus: String(o.status ?? o.resultingStatus ?? 'AMBER'),
          }))
        );
      }
    } catch (e) {
      console.warn('Failed to fetch outcomes, using built-in list:', e);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/pending-submissions/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
        setKpiRefreshToken((n) => n + 1);
      }
    } catch (e) {
      console.error('Failed to fetch pending submission jobs:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchAgents();
    fetchOutcomes();
    fetchIntegrations();
    fetchJobs();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchJobs();
  };

  // Distinct Companies
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (j.insurance_company) set.add(j.insurance_company.trim());
    }
    return Array.from(set).sort();
  }, [jobs]);

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Overdue filter
      if (overdueOnly && !job.is_overdue) return false;
      if (maxAttemptsOnly && job.latest_outcome !== 'MAX_ATTEMPTS_REACHED') return false;

      // Status. SUBMITTED is a virtual filter: records closed because an upload no longer contained them.
      if (statusFilter === 'SUBMITTED') {
        if (!isSubmittedByUpload(job)) return false;
      } else if (statusFilter === 'GREEN') {
        if (job.status !== 'GREEN' || isSubmittedByUpload(job)) return false;
      } else if (statusFilter !== 'ALL' && job.status !== statusFilter) {
        return false;
      }

      // Agent
      if (agentFilter !== 'ALL') {
        if (agentFilter === 'UNASSIGNED') {
          if (job.assigned_agent_id !== null) return false;
        } else if (String(job.assigned_agent_id) !== agentFilter) {
          return false;
        }
      }

      // Company
      if (companyFilter !== 'ALL') {
        if (
          !job.insurance_company ||
          job.insurance_company.trim().toLowerCase() !== companyFilter.trim().toLowerCase()
        ) {
          return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesReg =
          job.vehicle_reg.toLowerCase().includes(q) || job.vehicle_reg_raw.toLowerCase().includes(q);
        const matchesClient =
          job.client_phone.toLowerCase().includes(q) || job.client_phone_raw.toLowerCase().includes(q);
        const matchesSolver =
          (job.solver_name && job.solver_name.toLowerCase().includes(q)) ||
          job.solver_contact.toLowerCase().includes(q);
        const matchesCompany =
          job.insurance_company && job.insurance_company.toLowerCase().includes(q);
        const matchesReason =
          job.latest_pending_reason && job.latest_pending_reason.toLowerCase().includes(q);
        const matchesExternalId = String(job.external_id).includes(q.replace(/^#/, ''));

        if (!matchesReg && !matchesClient && !matchesSolver && !matchesCompany && !matchesReason && !matchesExternalId) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, statusFilter, agentFilter, companyFilter, searchQuery, overdueOnly, maxAttemptsOnly]);

  // Metric counts ("Queue Metrics"): scoped by the agent selector only, so the tiles show one agent's queue
  const counts = useMemo(() => {
    const scoped = jobs.filter((j) => {
      if (agentFilter === 'ALL') return true;
      if (agentFilter === 'UNASSIGNED') return j.assigned_agent_id === null;
      return String(j.assigned_agent_id) === agentFilter;
    });
    let amber = 0;
    let green = 0;
    let submitted = 0;
    let red = 0;
    let overdue = 0;
    let maxAttempts = 0;

    for (const j of scoped) {
      if (j.status === 'AMBER') amber++;
      if (j.status === 'GREEN') {
        if (isSubmittedByUpload(j)) submitted++;
        else green++;
      }
      if (j.status === 'RED') red++;
      if (j.is_overdue) overdue++;
      if (j.latest_outcome === 'MAX_ATTEMPTS_REACHED') maxAttempts++;
    }

    return { total: scoped.length, amber, green, submitted, red, overdue, maxAttempts };
  }, [jobs, agentFilter]);

  // One group per customer, ordered by the customer's oldest schedule date (longest overdue first, any company).
  // All of a customer's vehicles stay together, oldest first.
  const customerGroups = useMemo(() => groupByCustomerOldestFirst(filteredJobs), [filteredJobs]);

  // The agent selected in the Agent dropdown, when it is a real agent (not All and not Unassigned)
  const sessionAgent =
    agentFilter !== 'ALL' && agentFilter !== 'UNASSIGNED' ? agents.find((a) => String(a.id) === agentFilter) ?? null : null;

  // Leaving an individual agent's view ends the call session
  useEffect(() => {
    if (!sessionAgent) setIsCallSessionActive(false);
  }, [agentFilter, agents]);

  // FIXPASS:2 Sends the import. The server answers requires_confirmation when the upload would close
  // an unusually large share of open jobs; nothing is written until the user confirms.
  const postImport = async (
    fileName: string,
    importedBy: string,
    rows: unknown[],
    skippedCount: number,
    confirmed: boolean
  ) => {
    const res = await fetch('/api/pending-submissions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: fileName, imported_by: importedBy, rows, confirmed }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to import file');
    }

    const body = await res.json();
    if (body && body.requires_confirmation === true) {
      setPendingImport({
        fileName,
        importedBy,
        rows,
        skippedCount,
        confirmation: {
          would_close_count: Number(body.would_close_count),
          total_open: Number(body.total_open),
          would_close_percentage: Number(body.would_close_percentage),
          fixed_limit: Number(body.fixed_limit),
          percentage_limit: Number(body.percentage_limit),
        },
      });
      setIsUploadOpen(false);
      return;
    }

    setImportSummary({ ...body, client_skipped_count: skippedCount });
    setPendingImport(null);
    setIsUploadOpen(false);
    setUploadFile(null);
    fetchJobs();
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    setConfirmingImport(true);
    try {
      await postImport(pendingImport.fileName, pendingImport.importedBy, pendingImport.rows, pendingImport.skippedCount, true);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setConfirmingImport(false);
    }
  };

  // File Upload Handler (Brian's daily pending submissions sheet)
  const handleFileUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadError(null);

    try {
      const data = await uploadFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });

      if (!rawRows || rawRows.length === 0) {
        throw new Error('Spreadsheet appears to be empty or contains no parseable data');
      }

      const parsed = parsePendingSubmissionRows(rawRows);
      if (parsed.missingHeaders.length > 0) {
        throw new Error(
          `Missing required column(s): ${parsed.missingHeaders.join(', ')}. Expected headers: ID, solver_contact, vehicle_reg, client_no.`
        );
      }
      if (parsed.rows.length === 0) {
        const first = parsed.skipped[0];
        throw new Error(
          `No valid rows found. ${parsed.skipped.length} row(s) were skipped (first: row ${first?.rowNumber}: ${first?.reason}).`
        );
      }
      const validRows = parsed.rows;

      const loggedUser =
        localStorage.getItem('solvit_logged_in_user') ||
        (isUserAdmin ? 'Admin' : 'Mary');

      await postImport(uploadFile.name, loggedUser, validRows, parsed.skipped.length, false);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // Submit Call Outcome Log
  const handleSubmitOutcome = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedJobForLog) return;

    setIsSubmittingLog(true);
    try {
      const res = await fetch(`/api/pending-submissions/jobs/${selectedJobForLog.id}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeType,
          comment: outcomeComment.trim(),
          logged_by: outcomeLoggedBy,
          scheduled_at: outcomeType === 'SCHEDULED' ? nairobiInputToIso(outcomeScheduledAt) : null,
          scheduled_place: outcomeType === 'SCHEDULED' ? outcomeScheduledPlace || null : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to log outcome');
      }

      const result = await res.json();
      setSelectedJobForLog(null);
      setOutcomeComment('');
      setOutcomeScheduledAt('');
      setOutcomeScheduledPlace('');
      fetchJobs();

      if (result.smsDispatched) {
        setNotifySuccessMsg({
          id: selectedJobForLog.id,
          text: `Outcome saved! Automated SMS notification dispatched to solver.`,
        });
        setTimeout(() => setNotifySuccessMsg(null), 5000);
      } else if (result.smsMessage) {
        setNotifySuccessMsg({
          id: selectedJobForLog.id,
          text: result.smsMessage,
          error: true,
        });
        setTimeout(() => setNotifySuccessMsg(null), 7000);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsSubmittingLog(false);
    }
  };

  // FIXPASS:3 First manual send, retry after a failure, or resend. The server enforces the send limit.
  const handleNotifySolver = async (job: PendingSubmissionJob) => {
    setNotifyingJobId(job.id);
    setNotifySuccessMsg(null);
    try {
      const res = await fetch(`/api/pending-submissions/jobs/${job.id}/resend-notification`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send the solver SMS');
      setNotifySuccessMsg({ id: job.id, text: data.message, error: !data.success });
      fetchJobs();
      setTimeout(() => setNotifySuccessMsg(null), 6000);
    } catch (err) {
      setNotifySuccessMsg({ id: job.id, text: (err as Error).message, error: true });
      setTimeout(() => setNotifySuccessMsg(null), 6000);
    } finally {
      setNotifyingJobId(null);
    }
  };

  // View History
  const handleOpenHistory = async (job: PendingSubmissionJob) => {
    setHistoryJob(job);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/pending-submissions/jobs/${job.id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setHistoryLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Save Settings. The Integrations tab saves to its own endpoint; the other tabs save workflow settings.
  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (activeSettingsTab === 'team') return;
    setSavingSettings(true);
    setSettingsSuccessMessage(null);
    setSettingsError(null);

    try {
      if (activeSettingsTab === 'integration') {
        const f = hostPinnacleForm;
        const body: Record<string, unknown> = {
          enabled: f.enabled,
          auth_mode: f.auth_mode,
          sender_id: f.sender_id,
          country_code: f.country_code,
          user_id: f.user_id,
        };
        const clear: string[] = [];
        if (f.clear_api_key) clear.push('api_key');
        else if (f.api_key.trim()) body.api_key = f.api_key.trim();
        if (f.clear_password) clear.push('password');
        else if (f.password.trim()) body.password = f.password.trim();
        if (clear.length > 0) body.clear = clear;

        const res = await fetch('/api/pending-submissions/integrations/host_pinnacle', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save the integration');
        }
        await fetchIntegrations();
        setSettingsSuccessMessage('Integration saved.');
      } else {
        const res = await fetch('/api/pending-submissions/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow: workflowSettings }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save settings');
        }
        await fetchSettings();
        fetchJobs();
        setSettingsSuccessMessage('Settings saved.');
      }
      setTimeout(() => setSettingsSuccessMessage(null), 3000);
    } catch (err) {
      setSettingsError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchTeam = async () => {
    try {
      const res = await fetch('/api/pending-submissions/team');
      if (res.ok) setTeam(await res.json());
    } catch (e) {
      console.warn('Failed to fetch team overview:', e);
    }
  };

  const fetchGmailInfo = async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setGmailInfo({
        configured: Boolean(data?.settings?.gmail_app_password_configured),
        user: data?.settings?.gmail_user || null,
      });
    } catch (e) {
      console.warn('Failed to fetch email settings:', e);
    }
  };

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (activeSettingsTab === 'team') {
      setReassignPreview(null);
      setTeamMessage(null);
      fetchTeam();
    }
    if (activeSettingsTab === 'integration') fetchGmailInfo();
  }, [isSettingsOpen, activeSettingsTab]);

  // Reassign: always preview first (dry run), then confirm
  const handleReassignPreview = async () => {
    setReassigning(true);
    setTeamMessage(null);
    try {
      const res = await fetch('/api/pending-submissions/reassign-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to preview the reassignment');
      if (data.records === 0) {
        setReassignPreview(null);
        setTeamMessage({ text: 'Nothing to reassign. Every open record already belongs to an active team member.' });
      } else {
        setReassignPreview({ records: data.records, clients: data.clients, agents_used: data.agents_used });
      }
    } catch (err) {
      setTeamMessage({ text: (err as Error).message, error: true });
    } finally {
      setReassigning(false);
    }
  };

  const handleReassignConfirm = async () => {
    setReassigning(true);
    try {
      const res = await fetch('/api/pending-submissions/reassign-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to reassign');
      setReassignPreview(null);
      setTeamMessage({ text: `${data.records} record(s) reassigned across ${data.agents_used} agent(s).` });
      await fetchTeam();
      fetchJobs();
    } catch (err) {
      setTeamMessage({ text: (err as Error).message, error: true });
    } finally {
      setReassigning(false);
    }
  };

  // Send Test SMS (uses the SAVED integration settings; the message text is fixed on the server)
  const handleSendTestSms = async () => {
    if (!testSmsPhone.trim()) return;
    setTestSmsLoading(true);
    setTestSmsResult(null);
    try {
      const res = await fetch('/api/pending-submissions/integrations/host_pinnacle/test-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testSmsPhone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setTestSmsResult({ success: false, message: data.error || 'Failed to send the test SMS' });
      } else {
        setTestSmsResult({ success: true, message: `Test SMS accepted by Host Pinnacle. Reference: ${data.transactionId || 'none returned'}` });
      }
    } catch (err) {
      setTestSmsResult({ success: false, message: (err as Error).message || 'Network error sending the test SMS' });
    } finally {
      setTestSmsLoading(false);
    }
  };

  // Max Attempts report: grouped by insurance company, every record with its full history
  const handleExportMaxAttempts = async () => {
    try {
      const res = await fetch('/api/pending-submissions/max-attempts-report');
      if (!res.ok) throw new Error('Failed to load the max attempts report');
      const report: Array<{ insurance_company: string; jobs: Array<PendingSubmissionJob & { logs: PendingSubmissionLog[] }> }> =
        await res.json();
      if (report.length === 0) {
        alert('No records have reached the maximum number of attempts.');
        return;
      }
      const summaryRows: Record<string, unknown>[] = [];
      const historyRows: Record<string, unknown>[] = [];
      for (const group of report) {
        for (const j of group.jobs) {
          summaryRows.push({
            'Insurance Company': group.insurance_company,
            'External ID': j.external_id,
            'Vehicle Reg': j.vehicle_reg_raw || j.vehicle_reg,
            'Client Phone': j.client_phone_raw || j.client_phone,
            'Solver Name': j.solver_name || '',
            'Solver Phone': j.solver_contact_raw || j.solver_contact,
            'Assigned Agent': j.assigned_agent_name || 'Unassigned',
            'Client Attempts': j.client_attempt_count,
            'Solver Attempts': j.solver_attempt_count,
            'Closed At': j.closed_at || '',
          });
          for (const log of j.logs) {
            historyRows.push({
              'Insurance Company': group.insurance_company,
              'External ID': j.external_id,
              'Vehicle Reg': j.vehicle_reg_raw || j.vehicle_reg,
              'When': log.created_at,
              'Outcome': formatOutcome(log.outcome),
              'Logged By': log.logged_by,
              'Comment': log.comment,
            });
          }
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Max Attempts');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historyRows), 'History');
      XLSX.writeFile(wb, `pending_submissions_max_attempts_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredJobs.length === 0) {
      alert('No jobs to export');
      return;
    }

    const rows = filteredJobs.map((j) => ({
      'External ID': j.external_id,
      'Vehicle Reg': j.vehicle_reg_raw || j.vehicle_reg,
      'Insurance Company': j.insurance_company || '',
      'Client Phone': j.client_phone_raw || j.client_phone,
      'Solver Name': j.solver_name || '',
      'Solver Phone': j.solver_contact_raw || j.solver_contact,
      'Assigned Agent': j.assigned_agent_name || 'Unassigned',
      'Status': j.status,
      'Outcome': formatOutcome(j.latest_outcome),
      'Days Pending': j.days_pending,
      'Is Overdue': j.is_overdue ? 'YES' : 'NO',
      'Scheduled At': j.scheduled_at || '',
      'Scheduled Place': j.scheduled_place || '',
      'Solver Notification': j.solver_notification_status || 'NOT_SENT',
      'Solver Notification Attempts': j.solver_notification_attempts || 0,
      'First Imported': j.first_imported_at,
      'Last Seen': j.last_seen_in_import_at,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Submissions');
    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `pending_submissions_${todayStr}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Header */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-rose-50 text-[#ff353e]">
              <FileText className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Pending Submissions</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
              Team: {workflowSettings.callback_team_tag}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Agree inspection time and location with clients for pending valuation jobs, then dispatch automated SMS notifications to field solvers.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Settings Menu Button - Hidden for non-admins as specified in Part B */}
          {isUserAdmin && (
            <button
              id="pending-submissions-settings-btn"
              onClick={() => setIsSettingsOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Configure SLA, SMS template, and Host Pinnacle integration"
            >
              <SettingsIcon className="w-3.5 h-3.5 text-slate-500" />
              <span>Settings</span>
            </button>
          )}

          <button
            onClick={() => setIsUploadOpen(true)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e02831] text-white shadow-xs hover:shadow transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Daily List</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Download visible list to Excel"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
          </button>

          <button
            onClick={handleExportMaxAttempts}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Download the Max Attempts report, grouped by insurance company, with full history"
          >
            <Download className="w-3.5 h-3.5 text-rose-500" />
            <span>Max Attempts Report</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#ff353e]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5">
        <div
          onClick={() => {
            setStatusFilter('ALL');
            setOverdueOnly(false);
            setMaxAttemptsOnly(false);
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'ALL' && !overdueOnly && !maxAttemptsOnly
              ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-slate-700 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider block opacity-70">Total Jobs</span>
          <span className="text-2xl font-black mt-1 block">{counts.total}</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('AMBER');
            setOverdueOnly(false);
            setMaxAttemptsOnly(false);
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'AMBER' && !overdueOnly && !maxAttemptsOnly
              ? 'bg-amber-500 border-amber-600 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-amber-700 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">Open (Amber)</span>
            <Clock className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.amber}</span>
        </div>

        <div
          onClick={() => {
            setOverdueOnly(true);
            setMaxAttemptsOnly(false);
            setStatusFilter('ALL');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            overdueOnly
              ? 'bg-rose-600 border-rose-700 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-rose-700 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">
              Overdue (&gt;{workflowSettings.overdue_after_days}d)
            </span>
            <AlertTriangle className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.overdue}</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('GREEN');
            setOverdueOnly(false);
            setMaxAttemptsOnly(false);
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'GREEN' && !overdueOnly && !maxAttemptsOnly
              ? 'bg-emerald-600 border-emerald-700 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-emerald-700 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">Closed Scheduled</span>
            <CheckCircle2 className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.green}</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('SUBMITTED');
            setOverdueOnly(false);
            setMaxAttemptsOnly(false);
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'SUBMITTED' && !overdueOnly && !maxAttemptsOnly
              ? 'bg-sky-700 border-sky-800 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-sky-700 hover:border-sky-300'
          }`}
          title="Closed because the latest upload no longer contained the record"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">Submitted</span>
            <Send className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.submitted}</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('RED');
            setOverdueOnly(false);
            setMaxAttemptsOnly(false);
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'RED' && !overdueOnly && !maxAttemptsOnly
              ? 'bg-rose-900 border-rose-950 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-slate-700 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">Closed Unsuccessful</span>
            <XCircle className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.red}</span>
        </div>

        <div
          onClick={() => {
            setMaxAttemptsOnly(true);
            setOverdueOnly(false);
            setStatusFilter('ALL');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            maxAttemptsOnly
              ? 'bg-rose-700 border-rose-800 text-white shadow-sm'
              : 'bg-white border-slate-200/80 text-rose-700 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-80">Max Attempts Hit</span>
            <AlertCircle className="w-4 h-4 opacity-70" />
          </div>
          <span className="text-2xl font-black mt-1 block">{counts.maxAttempts}</span>
        </div>
      </div>

      {/* Max Attempts Hit tile is part of the metric grid above; rendered here as a sibling row item */}
      {agentFilter !== 'ALL' && (
        <div className="flex flex-wrap items-center justify-between gap-2 -mt-3">
          <p className="text-[11px] text-slate-500">
            Queue metrics shown for{' '}
            <span className="font-bold">
              {agentFilter === 'UNASSIGNED' ? 'unassigned records' : agents.find((a) => String(a.id) === agentFilter)?.name || 'selected agent'}
            </span>
            .
          </p>
          {sessionAgent && (
            <button
              id="btn-start-pending-calling-session"
              onClick={() => setIsCallSessionActive(true)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isCallSessionActive ? 'bg-slate-900 text-white' : 'bg-[#ff353e] hover:bg-[#e0262f] text-white hover:shadow'
              }`}
              title="Launch one-at-a-time focused calling queue, longest overdue first"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>{isCallSessionActive ? 'Active Call Session' : 'Start Calling'}</span>
              {counts.amber > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-red-700 text-white">{counts.amber}</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Agent completion KPI and pace advice (read only) */}
      <AgentKpiPanel
        section="pending_submissions"
        focusAgentId={sessionAgent ? sessionAgent.id : null}
        refreshToken={kpiRefreshToken}
      />

      {/* Either the focused Call Session View OR the standard filtered list */}
      {isCallSessionActive && sessionAgent ? (
        <PendingCallSessionView
          key={sessionAgent.id}
          selectedAgentId={sessionAgent.id}
          selectedAgentName={sessionAgent.name}
          maxCalls={workflowSettings.max_attempts}
          maxSms={workflowSettings.max_sms_attempts}
          outcomeOptions={outcomeOptions}
          initialCompany={companyFilter}
          availableCompanies={companies}
          onClose={() => {
            setIsCallSessionActive(false);
            fetchJobs();
          }}
          onJobUpdated={(updated) => {
            setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
          }}
        />
      ) : (
        <>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, reg, client phone, solver or company..."
              className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Overdue Filter Toggle */}
          <button
            onClick={() => setOverdueOnly(!overdueOnly)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              overdueOnly
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <span>Overdue Only</span>
          </button>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setOverdueOnly(false);
            setMaxAttemptsOnly(false);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20"
          >
            <option value="ALL">All Statuses</option>
            <option value="AMBER">Open / Pending (AMBER)</option>
            <option value="GREEN">Scheduled (GREEN)</option>
            <option value="SUBMITTED">Submitted (closed by upload)</option>
            <option value="RED">Withdrawn / Closed (RED)</option>
          </select>

          {/* Agent Dropdown */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 max-w-[150px] truncate"
          >
            <option value="ALL">All Agents</option>
            <option value="UNASSIGNED">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>

          {/* Company Dropdown */}
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 max-w-[160px] truncate"
          >
            <option value="ALL">All Companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-[#ff353e]" />
            <span className="text-xs font-medium">Loading pending submission jobs...</span>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No pending submission jobs match your filter</p>
            <p className="text-xs text-slate-400">Upload a fresh export list or adjust your search filters above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Vehicle &amp; ID</th>
                  <th className="py-3.5 px-4">Insurance Company</th>
                  <th className="py-3.5 px-4">Client Contact</th>
                  <th className="py-3.5 px-4">Solver Contact</th>
                  <th className="py-3.5 px-4">Pending Reason</th>
                  <th className="py-3.5 px-4">Assigned Agent</th>
                  <th className="py-3.5 px-4">Status &amp; Outcome</th>
                  <th className="py-3.5 px-4">Follow-ups</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customerGroups.map((group) => (
                  <React.Fragment key={group.client_phone}>
                    <tr className="bg-slate-100/80">
                      <td colSpan={9} className="py-2 px-4 text-[11px] font-black uppercase tracking-wider text-slate-600">
                        <span className="font-mono">{group.records[0].client_phone_raw || group.client_phone}</span>{' '}
                        <span className="font-semibold text-slate-400">
                          ({group.records.length} {group.records.length === 1 ? 'vehicle' : 'vehicles'})
                        </span>
                        {group.oldest_schedule_ms !== Infinity && (
                          <span className="font-semibold normal-case tracking-normal text-slate-500 ml-2">
                            Oldest schedule date: {new Date(group.oldest_schedule_ms).toISOString().slice(0, 10)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {group.records.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Vehicle & ID */}
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-800 font-mono">
                          {job.vehicle_reg_raw || job.vehicle_reg}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Ext ID: #{job.external_id}
                      </div>
                    </td>

                    {/* Company */}
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800">
                        {job.insurance_company || <span className="text-slate-400 italic">Unspecified</span>}
                      </span>
                    </td>

                    {/* Client Contact */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 font-mono text-slate-800">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{job.client_phone_raw || job.client_phone}</span>
                      </div>
                      {job.customer_email && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                          {job.customer_email}
                        </div>
                      )}
                    </td>

                    {/* Solver Contact */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800">{job.solver_name || 'Valuer'}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {job.solver_contact_raw || job.solver_contact}
                      </div>
                    </td>

                    {/* Pending Reason */}
                    <td className="py-3.5 px-4">
                      <div className="max-w-xs text-slate-700 text-[11px]">
                        {job.latest_pending_reason || (
                          <span className="text-slate-400 italic">No reason provided</span>
                        )}
                      </div>
                      {job.schedule_date && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>Schedule Date: {String(job.schedule_date).slice(0, 10)}</span>
                        </div>
                      )}
                    </td>

                    {/* Assigned Agent */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{job.assigned_agent_name || <span className="text-amber-600 font-bold">Unassigned</span>}</span>
                      </div>
                    </td>

                    {/* Status & Outcome */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            job.status === 'GREEN'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : job.status === 'RED'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {isSubmittedByUpload(job)
                            ? 'SUBMITTED'
                            : job.status === 'GREEN'
                            ? 'SCHEDULED'
                            : job.status === 'RED'
                            ? 'WITHDRAWN'
                            : 'AMBER (OPEN)'}
                        </span>

                        {job.latest_outcome && (
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${getOutcomeBadgeColor(
                              job.latest_outcome,
                              job.status
                            )}`}
                          >
                            {formatOutcome(job.latest_outcome)}
                          </span>
                        )}

                        {job.scheduled_at && (
                          <div className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>
                              {formatNairobiDisplay(job.scheduled_at)}{' '}
                              {job.scheduled_place ? `â€¢ ${job.scheduled_place}` : ''}
                            </span>
                          </div>
                        )}

                        {/* Solver Notification Status Badge */}
                        {job.status === 'GREEN' && !isSubmittedByUpload(job) && (
                          <div className="mt-1">
                            {job.solver_notification_status === 'SENT' ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800"
                                title={`Solver notified at ${
                                  job.solver_notified_at
                                    ? new Date(job.solver_notified_at).toLocaleString()
                                    : ''
                                } (${job.solver_notification_attempts} attempt(s))` }
                              >
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>SMS Sent ({job.solver_notification_attempts || 1})</span>
                              </span>
                            ) : job.solver_notification_status === 'FAILED' ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800"
                                title={job.solver_notification_error || 'SMS delivery failed'}
                              >
                                <AlertCircle className="w-3 h-3 text-rose-600" />
                                <span>SMS Failed</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                                <MessageSquare className="w-3 h-3 text-slate-400" />
                                <span>SMS Pending</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Follow-ups */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono font-bold whitespace-nowrap ${
                              job.client_attempt_count >= workflowSettings.max_attempts
                                ? 'text-rose-600'
                                : 'text-slate-800'
                            }`}
                          >
                            Calls {job.client_attempt_count}/{workflowSettings.max_attempts}
                          </span>
                          <span
                            className={`font-mono font-bold whitespace-nowrap ${
                              job.client_sms_count >= workflowSettings.max_sms_attempts
                                ? 'text-rose-600'
                                : 'text-slate-800'
                            }`}
                          >
                            SMS {job.client_sms_count}/{workflowSettings.max_sms_attempts}
                          </span>
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">Solver {job.solver_attempt_count}</span>
                        </div>

                        {job.is_overdue && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            <span>Overdue by {job.days_overdue} {job.days_overdue === 1 ? 'day' : 'days'}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Solver SMS: send, retry or resend for a scheduled job */}
                        {job.status === 'GREEN' && !isSubmittedByUpload(job) && (() => {
                          const maxSends = 1 + workflowSettings.solver_sms_max_resends;
                          const atLimit = Number(job.solver_notification_attempts) >= maxSends;
                          const sending = notifyingJobId === job.id || job.solver_notification_status === 'SENDING';
                          const label =
                            job.solver_notification_status === 'SENT'
                              ? 'Resend SMS'
                              : job.solver_notification_status === 'FAILED'
                              ? 'Retry SMS'
                              : 'Send SMS';
                          return (
                            <button
                              onClick={() => handleNotifySolver(job)}
                              disabled={sending || atLimit}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title={
                                atLimit
                                  ? `Send limit reached (${job.solver_notification_attempts}/${maxSends})`
                                  : `Send SMS to ${job.solver_contact_raw || job.solver_contact}`
                              }
                            >
                              <Send className="w-3 h-3" />
                              <span>{sending ? 'Sending...' : label}</span>
                            </button>
                          );
                        })()}

                        {/* Log Outcome Button (Exactly 10 agent outcomes) */}
                        <button
                          onClick={() => {
                            setSelectedJobForLog(job);
                            setOutcomeType('SCHEDULED');
                            setOutcomeScheduledAt(
                              toNairobiInputValue(job.scheduled_at)
                            );
                            setOutcomeScheduledPlace(job.scheduled_place || '');
                            setOutcomeComment('');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-black text-white transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Log Outcome
                        </button>

                        {/* History Button */}
                        <button
                          onClick={() => handleOpenHistory(job)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="View activity history"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {notifySuccessMsg && notifySuccessMsg.id === job.id && (
                        <div
                          className={`text-[10px] font-semibold mt-1 animate-in fade-in ${
                            notifySuccessMsg.error ? 'text-rose-600' : 'text-emerald-600'
                          }`}
                        >
                          {notifySuccessMsg.text}
                        </div>
                      )}
                    </td>
                  </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

        </>
      )}

      {/* Log Outcome Modal (Exactly TEN agent outcomes) */}
      {selectedJobForLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Log Outcome: {selectedJobForLog.vehicle_reg_raw || selectedJobForLog.vehicle_reg}
                </h3>
                <p className="text-xs text-slate-500">
                  Client: {selectedJobForLog.client_phone_raw || selectedJobForLog.client_phone} â€¢ Solver:{' '}
                  {selectedJobForLog.solver_name || 'Valuer'}
                </p>
              </div>
              <button
                onClick={() => setSelectedJobForLog(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitOutcome} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Call / Contact Outcome (10 Standard Outcomes)
                </label>
                <select
                  value={outcomeType}
                  onChange={(e) => setOutcomeType(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20"
                >
                  {outcomeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} {o.closes ? (o.resultingStatus === 'GREEN' ? '(Closes GREEN)' : '(Closes RED)') : '(Keeps Open AMBER)'}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {outcomeType === 'SCHEDULED'
                    ? 'Agreed schedule will close the job as GREEN and trigger solver notification.'
                    : outcomeType === 'WITHDRAWN'
                    ? 'Job will be closed as RED (withdrawn or invalid).'
                    : 'Job remains open in AMBER state for subsequent follow-up attempts.'}
                </span>
              </div>

              {outcomeType === 'SCHEDULED' && (
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Agreed Schedule Details</span>
                  </span>

                  <div>
                    <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                      Inspection Date &amp; Time (Nairobi time)
                    </label>
                    <input
                      type="datetime-local"
                      value={outcomeScheduledAt}
                      onChange={(e) => setOutcomeScheduledAt(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs font-semibold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                      Agreed Location / Place
                    </label>
                    <input
                      type="text"
                      value={outcomeScheduledPlace}
                      onChange={(e) => setOutcomeScheduledPlace(e.target.value)}
                      placeholder="e.g. TotalEnergies Westlands, client residence, etc."
                      required
                      className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs font-semibold focus:outline-none"
                    />
                  </div>

                  {workflowSettings.solver_sms_auto_send && (
                    <div className="text-[11px] text-emerald-800 bg-emerald-100/70 p-2 rounded-xl flex items-center gap-1.5 font-medium">
                      <Send className="w-3 h-3 text-emerald-700 shrink-0" />
                      <span>Automatic solver SMS dispatch will be triggered via Host Pinnacle upon saving.</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Logged By
                </label>
                <input
                  type="text"
                  value={outcomeLoggedBy}
                  onChange={(e) => setOutcomeLoggedBy(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Notes / Comment <span className="text-rose-500 font-normal lowercase">(required)</span>
                </label>
                <textarea
                  value={outcomeComment}
                  onChange={(e) => setOutcomeComment(e.target.value)}
                  rows={2}
                  required
                  maxLength={2000}
                  placeholder="What was discussed with the client..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedJobForLog(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingLog}
                  className="px-5 py-2 bg-[#ff353e] hover:bg-[#e02831] text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                >
                  {isSubmittingLog ? 'Saving...' : 'Save Outcome'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Daily List Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">Upload Pending Submissions</h3>
                <p className="text-xs text-slate-500">Upload Brian's daily list (.xlsx, .xls, .csv)</p>
              </div>
              <button
                onClick={() => {
                  setIsUploadOpen(false);
                  setUploadError(null);
                }}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFileUpload} className="space-y-4">
              <div className="p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <input
                  type="file"
                  id="pending-submissions-file-input"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setUploadFile(f);
                  }}
                  className="hidden"
                />
                <label
                  htmlFor="pending-submissions-file-input"
                  className="text-xs font-bold text-[#ff353e] hover:underline cursor-pointer block"
                >
                  {uploadFile ? uploadFile.name : 'Choose Excel or CSV spreadsheet'}
                </label>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Expected columns: External ID, Solver Name, Solver Phone, Vehicle Reg, Company, Client Phone, Reason
                </span>
              </div>

              {uploadError && (
                <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="px-5 py-2 bg-[#ff353e] hover:bg-[#e02831] text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>Import File</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FIXPASS:2 Import confirmation: nothing has been written yet */}
      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-start gap-2.5">
              <span className="p-1.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-black text-slate-900">Confirm this import</h3>
                <p className="text-xs text-slate-500">{pendingImport.fileName}</p>
              </div>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              This file is missing {pendingImport.confirmation.would_close_count} of{' '}
              {pendingImport.confirmation.total_open} open jobs (
              {pendingImport.confirmation.would_close_percentage}%). Confirming will close them as submitted by the
              solver. The configured limits are {pendingImport.confirmation.fixed_limit} jobs or{' '}
              {pendingImport.confirmation.percentage_limit}%. If this is the wrong or a partial file, cancel now.
              Nothing has been saved yet.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setPendingImport(null);
                  setUploadFile(null);
                }}
                disabled={confirmingImport}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel import
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={confirmingImport}
                className="px-5 py-2 bg-[#ff353e] hover:bg-[#e02831] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                {confirmingImport ? 'Importing...' : 'Confirm and close them'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Summary Modal with Disappearance Alert */}
      {importSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-xl bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">Import Complete</h3>
                  <p className="text-xs text-slate-500">{importSummary.file_name}</p>
                </div>
              </div>
              <button
                onClick={() => setImportSummary(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Disappearance Alert Banner */}
            {importSummary.disappearance_alert && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Disappearance Alert Triggered</span>
                  <p className="mt-0.5 leading-relaxed">
                    {importSummary.disappearance_alert_message ||
                      'A significant number of open pending jobs were not present in this export and have been auto-closed.'}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2 py-1">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs">
                <span className="font-semibold text-slate-600">Total Rows in File</span>
                <span className="font-mono font-bold text-slate-900">{importSummary.row_count_total}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 text-xs">
                <span className="font-semibold text-emerald-800">New Records Added</span>
                <span className="font-mono font-bold text-emerald-900">+{importSummary.new_records_count}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs">
                <span className="font-semibold text-slate-600">Skipped (Already Open)</span>
                <span className="font-mono font-bold text-slate-800">{importSummary.skipped_open_count}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs">
                <span className="font-semibold text-slate-600">Skipped (Already Closed)</span>
                <span className="font-mono font-bold text-slate-800">{importSummary.skipped_closed_count}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 text-xs">
                <span className="font-semibold text-amber-800">Auto-Closed Absent (Submitted by Solver)</span>
                <span className="font-mono font-bold text-amber-900">{importSummary.auto_closed_absent_count}</span>
              </div>
              {(importSummary.reopened_count ?? 0) > 0 && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-sky-50 text-xs">
                  <span className="font-semibold text-sky-800">Reopened (reappeared in export)</span>
                  <span className="font-mono font-bold text-sky-900">{importSummary.reopened_count}</span>
                </div>
              )}
              {(importSummary.duplicate_in_file_count ?? 0) > 0 && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs">
                  <span className="font-semibold text-slate-600">Duplicate IDs in file (first kept)</span>
                  <span className="font-mono font-bold text-slate-800">{importSummary.duplicate_in_file_count}</span>
                </div>
              )}
              {(importSummary.invalid_rows?.length ?? 0) > 0 && (
                <details className="p-2.5 rounded-xl bg-rose-50 text-xs">
                  <summary className="font-semibold text-rose-800 cursor-pointer">
                    {importSummary.invalid_rows!.length} row(s) rejected by the server
                  </summary>
                  <ul className="mt-2 space-y-1 text-rose-900 max-h-40 overflow-y-auto">
                    {importSummary.invalid_rows!.map((r, i) => (
                      <li key={i}>
                        Row {r.row}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(importSummary.client_skipped_count ?? 0) > 0 && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-rose-50 text-xs">
                  <span className="font-semibold text-rose-800">Rows Skipped (invalid, not uploaded)</span>
                  <span className="font-mono font-bold text-rose-900">{importSummary.client_skipped_count}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setImportSummary(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Drawer Modal */}
      {historyJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  History: {historyJob.vehicle_reg_raw || historyJob.vehicle_reg}
                </h3>
                <p className="text-xs text-slate-500">External ID: #{historyJob.external_id}</p>
              </div>
              <button
                onClick={() => setHistoryJob(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-3 pr-1">
              {loadingHistory ? (
                <div className="p-8 text-center text-slate-400">Loading history...</div>
              ) : historyLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">No outcome logs recorded yet.</div>
              ) : (
                historyLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                        {formatOutcome(log.outcome)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>

                    {log.scheduled_at && (
                      <div className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-emerald-600" />
                        <span>
                          {new Date(log.scheduled_at).toLocaleString()} ({log.scheduled_place || 'Agreed place'})
                        </span>
                      </div>
                    )}

                    {log.comment && <p className="text-xs text-slate-700">{log.comment}</p>}

                    <div className="text-[10px] text-slate-400 pt-0.5">Logged by: {log.logged_by}</div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setHistoryJob(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Menu Modal (Part B: Workflow + Host Pinnacle Integration) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 space-y-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-slate-100 text-slate-700">
                  <Sliders className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">Pending Submissions Settings</h3>
                  <p className="text-xs text-slate-500">Configure workflow SLA, solver notification, &amp; Host Pinnacle SMS</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs inside Settings Modal */}
            <div className="flex bg-slate-100 p-1 rounded-2xl gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveSettingsTab('workflow')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeSettingsTab === 'workflow'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Workflow &amp; SLA
              </button>
              {SHOW_SMS_SETTINGS && (
              <button
                type="button"
                onClick={() => setActiveSettingsTab('sms')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeSettingsTab === 'sms'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Solver SMS Template
              </button>
              )}
              {SHOW_INTEGRATIONS && (
              <button
                type="button"
                onClick={() => setActiveSettingsTab('integration')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeSettingsTab === 'integration'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Integrations</span>
                {hostPinnacleView?.ready ? (
                  <span className="w-2 h-2 rounded-full bg-emerald-500" title="Ready" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-amber-400" title="Not ready" />
                )}
              </button>
              )}
              <button
                type="button"
                onClick={() => setActiveSettingsTab('team')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeSettingsTab === 'team' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Team
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="overflow-y-auto flex-1 space-y-4 pr-1">
              {/* Tab 1: Workflow & SLA */}
              {activeSettingsTab === 'workflow' && (
                <div className="space-y-4 animate-in fade-in">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Submission Team Tag (Agent Filter)
                    </label>
                    <input
                      type="text"
                      value={workflowSettings.callback_team_tag}
                      disabled
                      className="w-full px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono text-slate-500 cursor-not-allowed"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Staff assigned to this feature carry the tag {workflowSettings.callback_team_tag}.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Max Call Attempts
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={workflowSettings.max_attempts}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            max_attempts: intOr(e.target.value, 4),
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Default: 4 call attempts
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Overdue SLA Threshold (Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="90"
                        value={workflowSettings.overdue_after_days}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            overdue_after_days: intOr(e.target.value, 3),
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Default: 3 days. Counted from the schedule date on the sheet.
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Max SMS Attempts
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={workflowSettings.max_sms_attempts}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            max_sms_attempts: intOr(e.target.value, 4),
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Default: 4 SMS. A record closes automatically only when it has reached both the call maximum and the SMS maximum, by its assigned agent.
                      </span>
                    </div>
                  </div>

                  {SHOW_WORKFLOW_EXTENDED && (
                    <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Max Attempts Grace Period (Minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        value={workflowSettings.max_attempts_grace_minutes}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            max_attempts_grace_minutes: intOr(e.target.value, 30),
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Grace period before auto-evaluating max attempts
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Disappearance Alert Fixed Limit
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={workflowSettings.disappearance_alert_fixed_count}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            disappearance_alert_fixed_count: intOr(e.target.value, 50),
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Warn if &gt;= this count disappear (default 50)
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Disappearance Alert Percentage Limit (%)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={workflowSettings.disappearance_alert_percentage}
                      onChange={(e) =>
                        setWorkflowSettings({
                          ...workflowSettings,
                          disappearance_alert_percentage: intOr(e.target.value, 30),
                        })
                      }
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Warn if &gt;= this % of open jobs disappear in an import (default 30%)
                    </span>
                  </div>
                    </>
                  )}
                </div>
              )}

              {/* Tab 2: Solver SMS Notification */}
              {SHOW_SMS_SETTINGS && activeSettingsTab === 'sms' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">
                        Auto-send SMS to Field Solver
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Automatically dispatch inspection schedule SMS when an agent logs "Scheduled"
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={workflowSettings.solver_sms_auto_send}
                        onChange={(e) =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            solver_sms_auto_send: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#ff353e]"></div>
                    </label>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Solver Notification SMS Template
                      </label>
                      <span className="text-[10px] text-slate-400">{'Must include {vehicle_reg}, {scheduled_at} and {scheduled_place}'}</span>
                    </div>
                    <textarea
                      rows={3}
                      value={workflowSettings.solver_sms_template}
                      onChange={(e) =>
                        setWorkflowSettings({
                          ...workflowSettings,
                          solver_sms_template: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none"
                    />

                    {/* Placeholder tokens */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['{solver_name}', '{vehicle_reg}', '{scheduled_at}', '{scheduled_place}', '{client_phone}', '{agent_name}', '{insurance_company}'].map((tok) => (
                        <button
                          key={tok}
                          type="button"
                          onClick={() => {
                            if (!workflowSettings.solver_sms_template.includes(tok)) {
                              setWorkflowSettings({
                                ...workflowSettings,
                                solver_sms_template: `${workflowSettings.solver_sms_template} ${tok}`,
                              });
                            }
                          }}
                          className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-mono cursor-pointer border border-slate-200"
                        >
                          + {tok}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Max Solver SMS Resends Allowed
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={workflowSettings.solver_sms_max_resends}
                      onChange={(e) =>
                        setWorkflowSettings({
                          ...workflowSettings,
                          solver_sms_max_resends: intOr(e.target.value, 3),
                        })
                      }
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Extra sends allowed after the first one, per job (default 3). A job can therefore be messaged at most this number plus one times.
                    </span>
                  </div>
                </div>
              )}

              {/* Tab 4: Team */}
              {activeSettingsTab === 'team' && (
                <div className="space-y-4 animate-in fade-in">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Team tag</label>
                    <input
                      type="text"
                      value={team?.callback_team_tag || workflowSettings.callback_team_tag}
                      disabled
                      className="w-full px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono text-slate-500 cursor-not-allowed"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Change who is on this team by editing their tag in the agents table.
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Active agents and open records
                    </div>
                    {team && team.agents.length > 0 ? (
                      <ul className="divide-y divide-slate-100">
                        {team.agents.map((a) => (
                          <li key={a.id} className="flex items-center justify-between px-3.5 py-2 text-xs">
                            <span className="font-semibold text-slate-800">{a.name}</span>
                            <span className="font-mono font-bold text-slate-900">{a.open_count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-3.5 py-3 text-xs text-amber-700">No active agents carry the team tag.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                      <span className="text-[11px] font-bold text-amber-800 block">Unassigned open records</span>
                      <span className="text-xl font-black text-amber-900">{team?.unassigned_open_count ?? 0}</span>
                    </div>
                    <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                      <span className="text-[11px] font-bold text-amber-800 block">With an inactive agent</span>
                      <span className="text-xl font-black text-amber-900">{team?.orphaned_open_count ?? 0}</span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Redistributes only open records that are unassigned or held by an agent who is archived or no longer on
                      the team. Records held by active team members are never moved, and one client always stays with one agent.
                    </p>
                    {reassignPreview ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-800">
                          {reassignPreview.records} record(s) for {reassignPreview.clients} client(s) will be redistributed across{' '}
                          {reassignPreview.agents_used} agent(s).
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleReassignConfirm}
                            disabled={reassigning}
                            className="px-4 py-1.5 bg-[#ff353e] hover:bg-[#e02831] text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
                          >
                            {reassigning ? 'Reassigning...' : 'Confirm reassignment'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReassignPreview(null)}
                            disabled={reassigning}
                            className="px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleReassignPreview}
                        disabled={reassigning}
                        className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
                      >
                        {reassigning ? 'Checking...' : 'Reassign unassigned and orphaned records'}
                      </button>
                    )}
                    {teamMessage && (
                      <p className={`text-xs font-semibold ${teamMessage.error ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {teamMessage.text}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Integrations (Host Pinnacle SMS) */}
              {SHOW_INTEGRATIONS && activeSettingsTab === 'integration' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-slate-600" />
                      <div>
                        <span className="text-xs font-bold text-slate-900">Host Pinnacle SMS</span>
                        <p className="text-[11px] text-slate-500">Sends the inspection schedule to the field solver</p>
                      </div>
                    </div>
                    {hostPinnacleView?.ready ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Ready</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        {hostPinnacleView && hostPinnacleView.missing.length > 0
                          ? `Missing: ${hostPinnacleView.missing.join(', ')}`
                          : 'Disabled'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">Enable sending</span>
                      <span className="text-[11px] text-slate-500">Nothing is sent while this is off</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={hostPinnacleForm.enabled}
                      onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, enabled: e.target.checked })}
                      className="w-4 h-4 accent-[#ff353e]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Authentication</label>
                    <select
                      value={hostPinnacleForm.auth_mode}
                      onChange={(e) =>
                        setHostPinnacleForm({ ...hostPinnacleForm, auth_mode: e.target.value as 'api_key' | 'user_password' })
                      }
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                    >
                      <option value="api_key">API key</option>
                      <option value="user_password">User ID and password</option>
                    </select>
                  </div>

                  {hostPinnacleForm.auth_mode === 'api_key' ? (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">API key</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={hostPinnacleForm.api_key}
                        disabled={hostPinnacleForm.clear_api_key}
                        onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, api_key: e.target.value })}
                        placeholder={
                          hostPinnacleView?.fields.api_key?.configured ? 'Configured. Leave blank to keep it.' : 'Paste the API key'
                        }
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 disabled:opacity-50"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-slate-400">
                          {hostPinnacleView?.fields.api_key?.source === 'environment'
                            ? 'Currently provided by the server environment. A value saved here overrides it.'
                            : 'Stored on the server. It is never shown again after saving.'}
                        </span>
                        {hostPinnacleView?.fields.api_key?.configured && hostPinnacleView.fields.api_key.source === 'database' && (
                          <label className="text-[10px] font-bold text-rose-600 flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hostPinnacleForm.clear_api_key}
                              onChange={(e) =>
                                setHostPinnacleForm({ ...hostPinnacleForm, clear_api_key: e.target.checked, api_key: '' })
                              }
                            />
                            Remove stored key on save
                          </label>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">User ID</label>
                        <input
                          type="text"
                          autoComplete="off"
                          value={hostPinnacleForm.user_id}
                          onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, user_id: e.target.value })}
                          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={hostPinnacleForm.password}
                          disabled={hostPinnacleForm.clear_password}
                          onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, password: e.target.value })}
                          placeholder={hostPinnacleView?.fields.password?.configured ? 'Configured. Leave blank to keep.' : 'Enter the password'}
                          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 disabled:opacity-50"
                        />
                        {hostPinnacleView?.fields.password?.configured && hostPinnacleView.fields.password.source === 'database' && (
                          <label className="text-[10px] font-bold text-rose-600 flex items-center gap-1 mt-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hostPinnacleForm.clear_password}
                              onChange={(e) =>
                                setHostPinnacleForm({ ...hostPinnacleForm, clear_password: e.target.checked, password: '' })
                              }
                            />
                            Remove stored password on save
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Sender ID</label>
                      <input
                        type="text"
                        maxLength={20}
                        value={hostPinnacleForm.sender_id}
                        onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, sender_id: e.target.value })}
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">Must be approved in your Host Pinnacle account</span>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Country code</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={hostPinnacleForm.country_code}
                        onChange={(e) => setHostPinnacleForm({ ...hostPinnacleForm, country_code: e.target.value.replace(/\D/g, '') })}
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">Digits only, no plus sign (Kenya: 254)</span>
                    </div>
                  </div>

                  {/* Test SMS */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-[#ff353e]" />
                      <span>Send a test SMS</span>
                    </span>
                    <p className="text-[10px] text-slate-500">
                      Uses the saved settings, so save first. Limited to 3 test messages per 10 minutes.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={testSmsPhone}
                        onChange={(e) => setTestSmsPhone(e.target.value)}
                        placeholder="e.g. 0712345678"
                        className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={handleSendTestSms}
                        disabled={
                          testSmsLoading ||
                          !testSmsPhone.trim() ||
                          !hostPinnacleView ||
                          hostPinnacleView.missing.length > 0
                        }
                        className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                      >
                        {testSmsLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>Send test</span>}
                      </button>
                    </div>

                    {testSmsResult && (
                      <div
                        className={`p-2.5 rounded-xl text-xs flex items-start gap-2 ${
                          testSmsResult.success
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {testSmsResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <span className="leading-snug">{testSmsResult.message}</span>
                      </div>
                    )}
                  </div>

                  {/* Gmail daily summary: read-only here */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">Email (daily summary)</span>
                      <span className="text-[11px] text-slate-500">
                        {gmailInfo?.user ? `Sender: ${gmailInfo.user}. ` : ''}Managed in Master Settings.
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        gmailInfo?.configured
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {gmailInfo?.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              )}

              {settingsError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{settingsError}</span>
                </div>
              )}

              {settingsSuccessMessage && (
                <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{settingsSuccessMessage}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
                {activeSettingsTab !== 'team' && (
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-5 py-2 bg-[#ff353e] hover:bg-[#e02831] text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {savingSettings ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{activeSettingsTab === 'integration' ? 'Save Integration' : 'Save Settings'}</span>
                  )}
                </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
// FIXPASS END src/components/PendingSubmissionsSection.tsx

