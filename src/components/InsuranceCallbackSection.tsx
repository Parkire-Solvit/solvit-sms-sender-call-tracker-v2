import React, { useState, useEffect, useMemo, useRef } from 'react';
import AgentKpiPanel from './AgentKpiPanel';
import * as XLSX from 'xlsx';
import {
  Car,
  Upload,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  OctagonAlert,
  MessageSquare,
  User,
  Phone,
  PhoneCall,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  FileSpreadsheet,
  Calendar,
  Layers,
  Sparkles,
  ShieldCheck,
  Check,
  X,
  Building2,
  Copy,
  Users,
  UserCheck,
  Tag,
  FileText,
  Download,
  History,
  HelpCircle,
  AlertTriangle,
  Activity,
  RotateCcw
} from 'lucide-react';
import {
  CallbackJob,
  CallbackJobStatus,
  CallbackSettings,
  CallbackImportSummary,
  CallbackImportRow,
  CallbackJobLog,
  MaxAttemptsReportGroup,
  ChannelPartnerAllocation,
} from '../types/callbacks';
import { CallSessionView } from './CallSessionView';
import DataResetPanel from './DataResetPanel';
import { saveOutcome } from '../lib/safeSave';
import { OnboardingTour } from './OnboardingTour';
import { AgentReviewModal } from './AgentReviewModal';
import { UnmatchedActivityModal } from './UnmatchedActivityModal';

interface InsuranceCallbackSectionProps {
  onOpenSettings?: () => void;
  allAgents?: { id: number; name: string; tag?: string }[];
}

interface OutcomeOption {
  value: string;
  label: string;
  description: string;
  category: 'YES' | 'NO_AMBER' | 'NO_RED';
  resultingStatus: CallbackJobStatus;
}

const OUTCOME_OPTIONS: OutcomeOption[] = [
  {
    value: 'SCHEDULED',
    label: 'Job Scheduled',
    description: 'Goes Green · Appointment booked',
    category: 'YES',
    resultingStatus: 'GREEN',
  },
  {
    value: 'NOT_PICKING',
    label: 'Not Picking / No Answer',
    description: 'Stays Amber · Retry later',
    category: 'NO_AMBER',
    resultingStatus: 'AMBER',
  },
  {
    value: 'NOT_READY',
    label: 'Not Ready to Book',
    description: 'Stays Amber · Callback requested',
    category: 'NO_AMBER',
    resultingStatus: 'AMBER',
  },
  {
    value: 'UNREACHABLE',
    label: 'Unreachable / Busy',
    description: 'Stays Amber · Busy / out of range',
    category: 'NO_AMBER',
    resultingStatus: 'AMBER',
  },
  {
    value: 'WRONG_NUMBER',
    label: 'Wrong Number',
    description: 'Stays Amber · Number incorrect',
    category: 'NO_AMBER',
    resultingStatus: 'AMBER',
  },
  {
    value: 'DECLINED',
    label: 'Customer Rejected',
    description: 'Goes Red · Refused inspection',
    category: 'NO_RED',
    resultingStatus: 'RED',
  },
  {
    value: 'VALUED_ELSEWHERE',
    label: 'Done Elsewhere',
    description: 'Goes Red · Already valued',
    category: 'NO_RED',
    resultingStatus: 'RED',
  },
];

const OUTCOME_LABEL_MAP: Record<string, string> = {
  SCHEDULED: 'Job Scheduled',
  NOT_PICKING: 'Not Picking / No Answer',
  NOT_READY: 'Not Ready to Book',
  UNREACHABLE: 'Unreachable / Busy',
  WRONG_NUMBER: 'Wrong Number',
  DECLINED: 'Customer Rejected',
  VALUED_ELSEWHERE: 'Done / Valued Elsewhere',
  MAX_ATTEMPTS_REACHED: 'Max Attempts Reached',
  ABSENT_FROM_LATEST_EXPORT: 'Absent from Latest Export',
};

function getOutcomeLabel(outcome?: string | null): string {
  if (!outcome) return 'No Outcome';
  return OUTCOME_LABEL_MAP[outcome] || outcome.replace(/_/g, ' ');
}

export const InsuranceCallbackSection: React.FC<InsuranceCallbackSectionProps> = ({
  onOpenSettings,
  allAgents = [],
}) => {
  // Data state
  const [jobs, setJobs] = useState<CallbackJob[]>([]);
  const [settings, setSettings] = useState<CallbackSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPartner, setSelectedPartner] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');
  const [kpiRefreshToken, setKpiRefreshToken] = useState(0);

  // Focused One-at-a-Time Call Session
  const [isCallSessionActive, setIsCallSessionActive] = useState(false);

  // Expanded partners state (default all open)
  const [collapsedPartners, setCollapsedPartners] = useState<Record<string, boolean>>({});

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [importedBy, setImportedBy] = useState('Caroline');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<CallbackImportSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    summary: CallbackImportSummary;
    mappedRows: CallbackImportRow[];
    fileName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-close upload modal 2.5s after successful import
  useEffect(() => {
    if (uploadSummary && isUploadOpen) {
      const timer = setTimeout(() => setIsUploadOpen(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [uploadSummary, isUploadOpen]);

  // Onboarding tour state & persistence
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem('solvit_callback_onboarding_seen');
      if (!seen) {
        setIsOnboardingOpen(true);
      }
    } catch {
      // Fallback if localStorage restricted
    }
  }, []);

  const handleCloseOnboardingTour = () => {
    try {
      localStorage.setItem('solvit_callback_onboarding_seen', 'true');
    } catch {
      // Fallback
    }
    setIsOnboardingOpen(false);
  };

  const handleOpenOnboardingTourManual = () => {
    setIsOnboardingOpen(true);
  };

  const openUploadModal = () => {
    setUploadFile(null);
    setUploadError(null);
    setUploadSummary(null);
    setPendingConfirmation(null);
    setIsUploadOpen(true);
  };

  // Inline settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempStaffCount, setTempStaffCount] = useState(2);
  const [tempTeamTag, setTempTeamTag] = useState('Callback Team');
  const [tempMaxAttempts, setTempMaxAttempts] = useState(4);
  const [tempMaxSmsAttempts, setTempMaxSmsAttempts] = useState(4);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [isDownloadingReopenReport, setIsDownloadingReopenReport] = useState(false);
  const [reopenReportMsg, setReopenReportMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const isAdmin =
    typeof window !== 'undefined' &&
    (!!localStorage.getItem('solvit_admin_token') || !!localStorage.getItem('nellions_admin_token'));

  // Review Agents & Unmatched Activity modals state
  const [isReviewAgentsOpen, setIsReviewAgentsOpen] = useState(false);
  const [isUnmatchedActivityOpen, setIsUnmatchedActivityOpen] = useState(false);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  // Outcome Logging Modal State
  const [outcomeJob, setOutcomeJob] = useState<CallbackJob | null>(null);
  const [isJobScheduledQuestion, setIsJobScheduledQuestion] = useState<'YES' | 'NO' | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<string>('SCHEDULED');
  const [outcomeComment, setOutcomeComment] = useState('');
  const [outcomeLoggedBy, setOutcomeLoggedBy] = useState('Caroline');
  const [isSubmittingOutcome, setIsSubmittingOutcome] = useState(false);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  // Job History Logs Modal State
  const [historyJob, setHistoryJob] = useState<CallbackJob | null>(null);
  const [historyLogs, setHistoryLogs] = useState<CallbackJobLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Inline Attempt History state & cache
  const [expandedHistoryJobIds, setExpandedHistoryJobIds] = useState<Set<number>>(new Set());
  const [historyCache, setHistoryCache] = useState<Record<number, CallbackJobLog[]>>({});
  const [loadingHistoryIds, setLoadingHistoryIds] = useState<Set<number>>(new Set());

  const toggleHistory = async (jobId: number) => {
    if (expandedHistoryJobIds.has(jobId)) {
      setExpandedHistoryJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      return;
    }

    setExpandedHistoryJobIds((prev) => new Set(prev).add(jobId));

    // Cache hit: do not refetch
    if (historyCache[jobId] !== undefined) {
      return;
    }

    // Cache miss: fetch from API
    setLoadingHistoryIds((prev) => new Set(prev).add(jobId));
    try {
      const res = await fetch(`/api/callback-jobs/${jobId}/logs`);
      if (res.ok) {
        const data: CallbackJobLog[] = await res.json();
        setHistoryCache((prev) => ({ ...prev, [jobId]: data }));
      } else {
        setHistoryCache((prev) => ({ ...prev, [jobId]: [] }));
      }
    } catch (err) {
      console.error(`[API] Error fetching callback logs for job ${jobId}:`, err);
      setHistoryCache((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setLoadingHistoryIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  // Max Attempts Report Modal State
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportData, setReportData] = useState<MaxAttemptsReportGroup[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportAgentFilter, setReportAgentFilter] = useState<string>('ALL');
  const [reportPartnerFilter, setReportPartnerFilter] = useState<string>('ALL');

  // Bulk assignment in Unassigned filter view
  const [selectedUnassignedJobIds, setSelectedUnassignedJobIds] = useState<Set<number>>(new Set());
  const [bulkTargetAgentId, setBulkTargetAgentId] = useState<string>('');
  const [isBulkAssigning, setIsBulkAssigning] = useState<boolean>(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick clipboard state
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Overview Tiles Drilldown Modal State
  type OverviewDrilldownType = 'TOTAL' | 'AMBER' | 'GREEN' | 'RED' | 'MAX_ATTEMPTS';
  const [drilldownModalType, setDrilldownModalType] = useState<OverviewDrilldownType | null>(null);
  const [drilldownJobs, setDrilldownJobs] = useState<CallbackJob[]>([]);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [drilldownSearchTerm, setDrilldownSearchTerm] = useState('');

  const openDrilldown = async (type: OverviewDrilldownType) => {
    setDrilldownModalType(type);
    setDrilldownSearchTerm('');
    setLoadingDrilldown(true);

    try {
      const params = new URLSearchParams();
      if (type === 'AMBER') params.append('status', 'AMBER');
      else if (type === 'GREEN') params.append('status', 'GREEN');
      else if (type === 'RED' || type === 'MAX_ATTEMPTS') params.append('status', 'RED');

      if (selectedAgent !== 'ALL' && selectedAgent !== '__unassigned__') {
        params.append('assigned_agent_id', selectedAgent);
      }

      const res = await fetch(`/api/callback-jobs${params.toString() ? `?${params.toString()}` : ''}`);
      if (res.ok) {
        let list: CallbackJob[] = await res.json();

        // Scope to selected agent if unassigned or name match needed
        if (selectedAgent === '__unassigned__') {
          list = list.filter((j) => !j.assigned_agent_name && !j.assigned_agent_id);
        } else if (selectedAgent !== 'ALL') {
          const target = selectedAgent.trim().toLowerCase();
          list = list.filter((j) => {
            const agentName = j.assigned_agent_name ? j.assigned_agent_name.trim().toLowerCase() : '';
            return agentName === target || String(j.assigned_agent_id) === selectedAgent;
          });
        }

        // For MAX_ATTEMPTS: filter to latest_outcome === 'MAX_ATTEMPTS_REACHED'
        if (type === 'MAX_ATTEMPTS') {
          list = list.filter((j) => j.latest_outcome === 'MAX_ATTEMPTS_REACHED');
        }

        setDrilldownJobs(list);
      } else {
        throw new Error('Failed to fetch callback jobs for drilldown');
      }
    } catch (err) {
      console.warn('Drilldown fetch error, falling back to local jobs cache:', err);
      let list = [...jobs];
      if (selectedAgent === '__unassigned__') {
        list = list.filter((j) => !j.assigned_agent_name && !j.assigned_agent_id);
      } else if (selectedAgent !== 'ALL') {
        const target = selectedAgent.trim().toLowerCase();
        list = list.filter((j) => {
          const agentName = j.assigned_agent_name ? j.assigned_agent_name.trim().toLowerCase() : '';
          return agentName === target || String(j.assigned_agent_id) === selectedAgent;
        });
      }

      if (type === 'AMBER') list = list.filter((j) => j.status === 'AMBER');
      else if (type === 'GREEN') list = list.filter((j) => j.status === 'GREEN');
      else if (type === 'RED') list = list.filter((j) => j.status === 'RED');
      else if (type === 'MAX_ATTEMPTS') list = list.filter((j) => j.latest_outcome === 'MAX_ATTEMPTS_REACHED');

      setDrilldownJobs(list);
    } finally {
      setLoadingDrilldown(false);
    }
  };

  const filteredDrilldownJobs = useMemo(() => {
    if (!drilldownSearchTerm.trim()) return drilldownJobs;
    const term = drilldownSearchTerm.toLowerCase();
    return drilldownJobs.filter((j) => {
      const reg = (j.vehicle_reg_raw || j.vehicle_reg || '').toLowerCase();
      const client = (j.client_name || '').toLowerCase();
      const phone = (j.client_phone_raw || j.client_phone || '').toLowerCase();
      const partner = (j.channel_partner || '').toLowerCase();
      const agent = (j.assigned_agent_name || '').toLowerCase();
      return (
        reg.includes(term) ||
        client.includes(term) ||
        phone.includes(term) ||
        partner.includes(term) ||
        agent.includes(term)
      );
    });
  }, [drilldownJobs, drilldownSearchTerm]);

  const handleExportDrilldownToExcel = async () => {
    if (!drilldownModalType || filteredDrilldownJobs.length === 0) return;

    if (drilldownModalType === 'MAX_ATTEMPTS') {
      try {
        const params = new URLSearchParams();
        if (selectedAgent !== 'ALL') params.set('assigned_agent_name', selectedAgent);
        const res = await fetch(`/api/callback-jobs/max-attempts-report?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch max attempts chronology');
        const groups: MaxAttemptsReportGroup[] = await res.json();

        // Build set of currently filtered vehicles in drilldown if user searched/filtered in modal
        const filteredRegs = new Set(filteredDrilldownJobs.map((j) => (j.vehicle_reg_raw || j.vehicle_reg).toUpperCase()));

        const rows: any[] = [];
        for (const group of groups) {
          for (const rec of group.records) {
            // Respect the active drilldown filtering (search box and selected agent)
            if (filteredRegs.size > 0 && !filteredRegs.has(rec.vehicle_reg_raw.toUpperCase())) {
              continue;
            }

            const entries = rec.chronology && rec.chronology.length > 0
              ? rec.chronology
              : (rec.attempts || []).map((a) => ({
                  timestamp: a.created_at,
                  kind: 'OUTCOME' as const,
                  outcome: a.outcome,
                  comment: a.comment,
                  logged_by: a.logged_by,
                  logged_by_phone: null,
                }));

            if (entries.length === 0) {
              rows.push({
                'Vehicle Registration': rec.vehicle_reg_raw,
                'Client Name': rec.client_name || 'N/A',
                'Client Phone': rec.client_phone_raw || '',
                'Channel Partner': group.channel_partner,
                'Timestamp': '',
                'Type': 'NONE',
                'Status / Outcome': 'MAX_ATTEMPTS_REACHED',
                'Notes': '',
                'Agent Name': '',
                'Agent Phone': '',
              });
            } else {
              for (const entry of entries) {
                const statusOutcome = entry.kind === 'OUTCOME' ? (entry.outcome || '') : ((entry as any).status || '');
                const notes = entry.kind === 'OUTCOME' ? (entry.comment || '') : (entry.kind === 'SMS' ? ((entry as any).note || '') : '');
                rows.push({
                  'Vehicle Registration': rec.vehicle_reg_raw,
                  'Client Name': rec.client_name || 'N/A',
                  'Client Phone': rec.client_phone_raw || '',
                  'Channel Partner': group.channel_partner,
                  'Timestamp': entry.timestamp || '',
                  'Type': entry.kind,
                  'Status / Outcome': statusOutcome,
                  'Notes': notes,
                  'Agent Name': entry.logged_by || '',
                  'Agent Phone': (entry as any).logged_by_phone || '',
                });
              }
            }
          }
        }

        const wb = XLSX.utils.book_new();
        const wsRaw = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw Data');

        // Sheet 2: Summary - deduplicated by timestamp|kind|status/outcome per client phone
        type SummaryRow = {
          clientName: string;
          clientPhone: string;
          channelPartners: Set<string>;
          vehicles: Set<string>;
          agent: string;
          callKeys: Set<string>;
          smsKeys: Set<string>;
        };

        const summaryByPhone = new Map<string, SummaryRow>();

        for (const group of groups) {
          for (const record of group.records) {
            // Respect the active drilldown filtering
            if (filteredRegs.size > 0 && !filteredRegs.has(record.vehicle_reg_raw.toUpperCase())) {
              continue;
            }

            const phone = record.client_phone_raw;
            let entry = summaryByPhone.get(phone);
            if (!entry) {
              entry = {
                clientName: record.client_name || 'N/A',
                clientPhone: phone,
                channelPartners: new Set(),
                vehicles: new Set(),
                agent: (record as any).assigned_agent_name || 'Unassigned',
                callKeys: new Set(),
                smsKeys: new Set(),
              };
              summaryByPhone.set(phone, entry);
            }
            entry.channelPartners.add(group.channel_partner);
            entry.vehicles.add(record.vehicle_reg_raw);
            for (const chrono of record.chronology || []) {
              const dedupeKey = `${chrono.timestamp}|${chrono.kind}|${'status' in chrono ? chrono.status : (chrono as any).outcome}`;
              if (chrono.kind === 'CALL') entry.callKeys.add(dedupeKey);
              if (chrono.kind === 'SMS') entry.smsKeys.add(dedupeKey);
            }
          }
        }

        const summaryRows = [...summaryByPhone.values()].map((e) => ({
          'Client Name': e.clientName,
          'Client Phone': e.clientPhone,
          'Channel Partner(s)': [...e.channelPartners].join(', '),
          'Vehicles': [...e.vehicles].join(', '),
          'Vehicle Count': e.vehicles.size,
          'Assigned Agent': e.agent,
          'Total Contact Attempts': e.callKeys.size,
          'Total SMSs Sent': e.smsKeys.size,
        }));

        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        const agentTag = selectedAgent !== 'ALL' ? `_${selectedAgent.replace(/\s+/g, '_')}` : '';
        XLSX.writeFile(wb, `Max_Attempts_Chronology${agentTag}_${new Date().toISOString().split('T')[0]}.xlsx`);
        return;
      } catch (err) {
        console.error('Error exporting max attempts chronology to Excel:', err);
      }
    }

    // existing summary export for the other four tiles, unchanged below this line
    const data = filteredDrilldownJobs.map((j) => ({
      'Vehicle Registration': j.vehicle_reg_raw || j.vehicle_reg,
      'Client Name': j.client_name || 'N/A',
      'Client Phone': j.client_phone_raw || j.client_phone,
      'Channel Partner': j.channel_partner || 'Unassigned',
      'Status': j.status,
      'Attempt Count': j.attempt_count ?? 0,
      'Assigned Agent': j.assigned_agent_name || 'Unassigned',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Callbacks');

    const agentTag = selectedAgent !== 'ALL' ? `_${selectedAgent.replace(/\s+/g, '_')}` : '';
    const typeTag = drilldownModalType.toLowerCase();
    const fileName = `Callback_${typeTag}${agentTag}_${new Date().toISOString().split('T')[0]}.xlsx`;

    XLSX.writeFile(wb, fileName);
  };

  // Initial load
  useEffect(() => {
    fetchSettings();
    fetchJobs();
    fetchAllocations();
  }, []);

  const [partnerAllocations, setPartnerAllocations] = useState<ChannelPartnerAllocation[]>([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);

  const fetchAllocations = async () => {
    setLoadingAllocations(true);
    try {
      const res = await fetch('/api/channel-partner-allocations');
      if (res.ok) {
        const raw = await res.json();
        const list: ChannelPartnerAllocation[] = Array.isArray(raw)
          ? raw
          : (raw && Array.isArray(raw.allocations) ? raw.allocations : []);
        setPartnerAllocations(list);
      }
    } catch (err) {
      console.warn('Failed to load channel partner allocations', err);
    } finally {
      setLoadingAllocations(false);
    }
  };

  const handleUpdateAllocation = async (partner: string, agentId: number | null) => {
    try {
      const res = await fetch('/api/channel-partner-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_partner: partner,
          assigned_agent_id: agentId,
        }),
      });
      if (res.ok) {
        fetchAllocations();
      }
    } catch (err) {
      console.error('Failed to update allocation:', err);
    }
  };

  // Exit call session if agent filter resets to ALL
  useEffect(() => {
    if (selectedAgent === 'ALL' && isCallSessionActive) {
      setIsCallSessionActive(false);
    }
  }, [selectedAgent, isCallSessionActive]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/callback-settings');
      if (res.ok) {
        const data: CallbackSettings = await res.json();
        setSettings(data);
        setTempStaffCount(data.staff_count);
        setTempTeamTag(data.callback_team_tag);
        setTempMaxAttempts(data.max_attempts);
        setTempMaxSmsAttempts(data.max_sms_attempts ?? 4);
      }
    } catch (err) {
      console.warn('Failed to load callback settings', err);
    }
  };

  const fetchJobs = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [resJobs, resSettings] = await Promise.all([
        fetch('/api/callback-jobs'),
        fetch('/api/callback-settings')
      ]);
      if (!resJobs.ok) throw new Error('Failed to fetch callback jobs');
      const data: CallbackJob[] = await resJobs.json();
      setJobs(data);

      if (resSettings.ok) {
        const dataSettings: CallbackSettings = await resSettings.json();
        setSettings(dataSettings);
        setTempStaffCount(dataSettings.staff_count);
        setTempTeamTag(dataSettings.callback_team_tag);
        setTempMaxAttempts(dataSettings.max_attempts);
        setTempMaxSmsAttempts(dataSettings.max_sms_attempts ?? 4);
      }
      fetchReviewAndUnmatchedCounts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const fetchReviewAndUnmatchedCounts = async () => {
    try {
      const [reviewRes, unmatchedRes] = await Promise.all([
        fetch('/api/agents/needs-review'),
        fetch('/api/callback-jobs/unmatched-activity?days=14')
      ]);
      if (reviewRes.ok) {
        const reviewData = await reviewRes.json();
        setNeedsReviewCount(Array.isArray(reviewData) ? reviewData.length : 0);
      }
      if (unmatchedRes.ok) {
        const unmatchedData = await unmatchedRes.json();
        setUnmatchedCount(Array.isArray(unmatchedData) ? unmatchedData.length : 0);
      }
    } catch (_) {}
  };

  const handleAssignJob = async (jobId: number, agentId: number | null) => {
    try {
      const res = await fetch(`/api/callback-jobs/${jobId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, apply_to_client: true }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to reassign vehicle');
        return;
      }
      const updated: CallbackJob = await res.json();
      setJobs((prev) =>
        prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j))
      );
      fetchJobs();
      fetchReviewAndUnmatchedCounts();
    } catch (err: any) {
      console.error('Error assigning callback job:', err);
      alert('Error updating assignment: ' + err.message);
    }
  };

  // Open Outcome logging modal
  const openOutcomeModal = (job: CallbackJob) => {
    setOutcomeJob(job);
    setIsJobScheduledQuestion(null);
    setSelectedOutcome('SCHEDULED');
    setOutcomeComment('');
    setOutcomeError(null);
    const defaultAgent = job.assigned_agent_name || importedBy || 'Caroline';
    setOutcomeLoggedBy(defaultAgent);
  };

  // Open Log History modal
  const openHistoryModal = async (job: CallbackJob) => {
    setHistoryJob(job);
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/callback-jobs/${job.id}/logs`);
      if (res.ok) {
        const data: CallbackJobLog[] = await res.json();
        setHistoryLogs(data);
      } else {
        setHistoryLogs([]);
      }
    } catch (err) {
      console.error('Error fetching job logs:', err);
      setHistoryLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Submit Outcome & Callback Notes
  const handleSubmitOutcome = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!outcomeJob) return;

    if (!selectedOutcome) {
      setOutcomeError('Please select a specific outcome.');
      return;
    }
    // Comment is now optional

    setIsSubmittingOutcome(true);
    setOutcomeError(null);

    try {
      const saved = await saveOutcome(
        `/api/callback-jobs/${outcomeJob.id}/outcome`,
        { outcome: selectedOutcome, comment: outcomeComment.trim(), logged_by: outcomeLoggedBy.trim() || 'Agent' },
        outcomeJob.vehicle_reg_raw || outcomeJob.vehicle_reg
      );
      // Only a confirmation from the server counts as saved. Otherwise the form stays open and the outcome is kept on this device.
      if (!saved.ok) throw new Error(saved.error || 'Failed to log outcome.');
      if (saved.duplicate) fetchJobs();

      const updated: CallbackJob = saved.data;
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)));
      // Completion is served by a separate KPI endpoint. Refresh it immediately
      // after an outcome changes a record instead of leaving the old percentage
      // visible until the panel's five-minute background refresh.
      setKpiRefreshToken((value) => value + 1);
      // Refresh cached history if expanded or cached
      try {
        const logsRes = await fetch(`/api/callback-jobs/${outcomeJob.id}/logs`);
        if (logsRes.ok) {
          const freshLogs: CallbackJobLog[] = await logsRes.json();
          setHistoryCache((prev) => ({ ...prev, [outcomeJob.id]: freshLogs }));
        }
      } catch (_) {}
      setOutcomeJob(null);
    } catch (err) {
      setOutcomeError((err as Error).message);
    } finally {
      setIsSubmittingOutcome(false);
    }
  };

  // Open Max Attempts Report modal
  const openMaxAttemptsReport = async () => {
    setIsReportOpen(true);
    setLoadingReport(true);
    setReportError(null);
    setReportAgentFilter('ALL');
    setReportPartnerFilter('ALL');
    try {
      const res = await fetch('/api/callback-jobs/max-attempts-report');
      if (!res.ok) throw new Error('Failed to load max-attempts report.');
      const data: MaxAttemptsReportGroup[] = await res.json();
      setReportData(data);
    } catch (err) {
      setReportError((err as Error).message);
    } finally {
      setLoadingReport(false);
    }
  };

  // Derived values for Max Attempts modal
  const agentOptions = useMemo(() => {
    const agentMap = new Map<string, { id: string; name: string; count: number }>();
    let unallocatedCount = 0;
    let hasUnallocatedGroup = false;

    for (const g of reportData) {
      if (g.allocated_agent_id !== null && g.allocated_agent_id !== undefined) {
        const idKey = String(g.allocated_agent_id);
        const existing = agentMap.get(idKey);
        if (existing) {
          existing.count += g.records.length;
        } else {
          agentMap.set(idKey, {
            id: idKey,
            name: g.allocated_agent_name || 'Agent',
            count: g.records.length,
          });
        }
      } else {
        hasUnallocatedGroup = true;
        unallocatedCount += g.records.length;
      }
    }

    const sortedAgents = Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const options: Array<{ value: string; label: string; name?: string }> = [
      { value: 'ALL', label: 'All agents' },
      ...sortedAgents.map((a) => ({
        value: a.id,
        label: `${a.name} (${a.count})`,
        name: a.name,
      })),
    ];

    if (hasUnallocatedGroup) {
      options.push({
        value: 'UNALLOCATED',
        label: `Unallocated partners (${unallocatedCount})`,
      });
    }

    return options;
  }, [reportData]);

  const groupsForAgent = useMemo(() => {
    if (reportAgentFilter === 'ALL') return reportData;
    if (reportAgentFilter === 'UNALLOCATED') {
      return reportData.filter((g) => g.allocated_agent_id === null || g.allocated_agent_id === undefined);
    }
    return reportData.filter((g) => String(g.allocated_agent_id) === reportAgentFilter);
  }, [reportData, reportAgentFilter]);

  const partnerOptions = useMemo(() => {
    const sorted = [...groupsForAgent].sort((a, b) => a.channel_partner.localeCompare(b.channel_partner));
    return [
      { value: 'ALL', label: 'All channel partners' },
      ...sorted.map((g) => ({
        value: g.channel_partner,
        label: `${g.channel_partner} (${g.records.length})`,
      })),
    ];
  }, [groupsForAgent]);

  // When agent selection changes and current partner is not in new partnerOptions, reset to 'ALL'
  useEffect(() => {
    if (reportPartnerFilter !== 'ALL') {
      const exists = partnerOptions.some((opt) => opt.value === reportPartnerFilter);
      if (!exists) {
        setReportPartnerFilter('ALL');
      }
    }
  }, [reportAgentFilter, partnerOptions, reportPartnerFilter]);

  const visibleGroups = useMemo(() => {
    if (reportPartnerFilter === 'ALL') return groupsForAgent;
    return groupsForAgent.filter((g) => g.channel_partner === reportPartnerFilter);
  }, [groupsForAgent, reportPartnerFilter]);

  const allUnassignedCount = useMemo(() => {
    return jobs.filter((j) => !j.assigned_agent_id && !j.assigned_agent_name).length;
  }, [jobs]);

  const totalReportRecords = useMemo(() => {
    return reportData.reduce((acc, g) => acc + g.records.length, 0);
  }, [reportData]);

  const visibleRecordCount = useMemo(() => {
    return visibleGroups.reduce((acc, g) => acc + g.records.length, 0);
  }, [visibleGroups]);

  const isReportFiltered = reportAgentFilter !== 'ALL' || reportPartnerFilter !== 'ALL';

  const getDownloadButtonLabel = () => {
    if (reportPartnerFilter !== 'ALL') {
      return `Download ${reportPartnerFilter}`;
    }
    if (reportAgentFilter !== 'ALL') {
      const opt = agentOptions.find((o) => o.value === reportAgentFilter);
      const agentName = reportAgentFilter === 'UNALLOCATED' ? 'Unallocated' : (opt?.name || 'Agent');
      return `Download ${agentName} records`;
    }
    return 'Download Excel Report';
  };

  // Bulk assignment action handler
  const handleBulkAssign = async (mode: 'SELECTED' | 'ALL') => {
    if (!bulkTargetAgentId) {
      setBulkMessage({ type: 'error', text: 'Please select a callback team agent first.' });
      return;
    }
    const agentId = Number(bulkTargetAgentId);
    const targetAgent = callbackAgents.find((a) => a.id === agentId);
    const agentName = targetAgent?.name || 'Agent';

    const allUnassignedIds = jobs
      .filter((j) => !j.assigned_agent_id && !j.assigned_agent_name)
      .map((j) => j.id);
    const idsToAssign = mode === 'ALL' ? allUnassignedIds : Array.from(selectedUnassignedJobIds);

    if (idsToAssign.length === 0) {
      setBulkMessage({ type: 'error', text: 'No unassigned records to assign.' });
      return;
    }

    setIsBulkAssigning(true);
    setBulkMessage(null);
    try {
      const res = await fetch('/api/callback-jobs/assign-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToAssign, agent_id: agentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to bulk assign jobs');
      }
      setBulkMessage({
        type: 'success',
        text: `Successfully assigned ${idsToAssign.length} vehicle(s) to ${agentName}.`,
      });
      setSelectedUnassignedJobIds(new Set());
      await fetchJobs();
    } catch (err: any) {
      setBulkMessage({ type: 'error', text: err.message || 'Error bulk assigning jobs' });
    } finally {
      setIsBulkAssigning(false);
    }
  };

  // Export Max Attempts Report to Excel directly using XLSX with per-partner sheets
  const handleExportMaxAttemptsReportToExcel = (groupsToExport?: MaxAttemptsReportGroup[], exportPartnerName?: string) => {
    try {
      const targetGroups = groupsToExport || visibleGroups;
      if (!targetGroups || targetGroups.length === 0) return;

      const wb = XLSX.utils.book_new();

      // Sheet 1: Summary - one row per client phone with maximum counts per phone
      type SummaryRow = {
        clientName: string;
        clientPhone: string;
        channelPartners: Set<string>;
        vehicles: Set<string>;
        allocatedAgents: Set<string>;
        outgoingCallsMax: number;
        smsSentMax: number;
      };

      const summaryByPhone = new Map<string, SummaryRow>();

      for (const group of targetGroups) {
        const allocName = group.allocated_agent_name || 'Unallocated';
        for (const record of group.records) {
          const phone = record.client_phone_raw;
          let entry = summaryByPhone.get(phone);
          if (!entry) {
            entry = {
              clientName: record.client_name || 'N/A',
              clientPhone: phone,
              channelPartners: new Set(),
              vehicles: new Set(),
              allocatedAgents: new Set(),
              outgoingCallsMax: 0,
              smsSentMax: 0,
            };
            summaryByPhone.set(phone, entry);
          }
          entry.channelPartners.add(group.channel_partner);
          entry.vehicles.add(record.vehicle_reg_raw);
          entry.allocatedAgents.add(allocName);

          const calls = Number(record.outgoing_calls_count || 0);
          const sms = Number(record.sms_count || 0);
          entry.outgoingCallsMax = Math.max(entry.outgoingCallsMax, calls);
          entry.smsSentMax = Math.max(entry.smsSentMax, sms);
        }
      }

      const summaryRows = [...summaryByPhone.values()].map((e) => ({
        'Client Name': e.clientName,
        'Client Phone': e.clientPhone,
        'Channel Partner(s)': [...e.channelPartners].join(', '),
        'Vehicles': [...e.vehicles].join(', '),
        'Vehicle Count': e.vehicles.size,
        'Allocated Agent': [...e.allocatedAgents].join(', ') || 'Unallocated',
        'Outgoing Calls': e.outgoingCallsMax,
        'SMS Sent': e.smsSentMax,
      }));

      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      wsSummary['!cols'] = [
        { wch: 22 },
        { wch: 16 },
        { wch: 26 },
        { wch: 24 },
        { wch: 14 },
        { wch: 20 },
        { wch: 24 },
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      // Helper function to build rows for a group
      const buildRowsForGroup = (group: MaxAttemptsReportGroup) => {
        const rows: any[] = [];
        const allocAgent = group.allocated_agent_name || 'Unallocated';
        for (const rec of group.records) {
          const entries = rec.chronology && rec.chronology.length > 0
            ? rec.chronology
            : (rec.attempts || []).map((a) => ({
                timestamp: a.created_at,
                kind: 'OUTCOME' as const,
                outcome: a.outcome,
                comment: a.comment,
                logged_by: a.logged_by,
                logged_by_phone: null,
                counted: false,
              }));

          if (entries.length === 0) {
            rows.push({
              'Vehicle Registration': rec.vehicle_reg_raw,
              'Client Name': rec.client_name || 'N/A',
              'Client Phone': rec.client_phone_raw || '',
              'Channel Partner': group.channel_partner,
              'Timestamp': rec.closed_at || '',
              'Type': 'NONE',
              'Status / Outcome': 'MAX_ATTEMPTS_REACHED',
              'Notes': '',
              'Agent Name': '',
              'Agent Phone': '',
              'Allocated Agent': allocAgent,
              'Counted Towards Max Attempts': 'No',
            });
          } else {
            for (const item of entries) {
              const statusOutcome = item.kind === 'OUTCOME' ? item.outcome : item.status;
              const notes = item.kind === 'OUTCOME' ? item.comment : (item.kind === 'SMS' ? item.note : '');
              const isCounted = item.counted === true || (item.kind === 'SMS') || (item.kind === 'CALL' && String(item.status || '').toUpperCase() === 'OUTGOING');
              rows.push({
                'Vehicle Registration': rec.vehicle_reg_raw,
                'Client Name': rec.client_name || 'N/A',
                'Client Phone': rec.client_phone_raw || '',
                'Channel Partner': group.channel_partner,
                'Timestamp': item.timestamp || '',
                'Type': item.kind,
                'Status / Outcome': statusOutcome || '',
                'Notes': notes || '',
                'Agent Name': item.logged_by || '',
                'Agent Phone': item.logged_by_phone || '',
                'Allocated Agent': allocAgent,
                'Counted Towards Max Attempts': isCounted ? 'Yes' : 'No',
              });
            }
          }
        }
        return rows;
      };

      const rawCols = [
        { wch: 20 },
        { wch: 22 },
        { wch: 16 },
        { wch: 24 },
        { wch: 20 },
        { wch: 10 },
        { wch: 22 },
        { wch: 30 },
        { wch: 20 },
        { wch: 16 },
        { wch: 20 },
        { wch: 28 },
      ];

      // Sheet name sanitizer
      const usedSheetNames = new Set<string>(['summary', 'raw data']);
      const sanitizeSheetName = (rawName: string): string => {
        let name = rawName.replace(/[\[\]:*?/\\]/g, '-').trim();
        if (!name) name = 'Partner';
        if (name.toLowerCase() === 'summary' || name.toLowerCase() === 'raw data') {
          name = `${name}-Partner`;
        }
        if (name.length > 31) name = name.slice(0, 31).trim();

        if (!usedSheetNames.has(name.toLowerCase())) {
          usedSheetNames.add(name.toLowerCase());
          return name;
        }

        let counter = 2;
        while (true) {
          const suffix = ` (${counter})`;
          const maxBase = 31 - suffix.length;
          const base = name.slice(0, maxBase).trim();
          const candidate = `${base}${suffix}`;
          if (!usedSheetNames.has(candidate.toLowerCase())) {
            usedSheetNames.add(candidate.toLowerCase());
            return candidate;
          }
          counter++;
        }
      };

      // Then one sheet per channel partner in alphabetical order
      const sortedPartners = [...targetGroups].sort((a, b) => a.channel_partner.localeCompare(b.channel_partner));
      const allRawRows: any[] = [];

      for (const group of sortedPartners) {
        const groupRows = buildRowsForGroup(group);
        allRawRows.push(...groupRows);
        const wsPartner = XLSX.utils.json_to_sheet(groupRows);
        wsPartner['!cols'] = rawCols;
        const validSheetName = sanitizeSheetName(group.channel_partner);
        XLSX.utils.book_append_sheet(wb, wsPartner, validSheetName);
      }

      // Last sheet "Raw Data": all rows combined
      const wsRaw = XLSX.utils.json_to_sheet(allRawRows);
      wsRaw['!cols'] = rawCols;
      XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw Data');

      // Compute file name: max_attempts_report_<agent or all>_<partner or all>_<YYYY-MM-DD>.xlsx
      const cleanPart = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'all';
      let agentPart = 'all';
      if (reportAgentFilter !== 'ALL') {
        if (reportAgentFilter === 'UNALLOCATED') {
          agentPart = 'unallocated';
        } else {
          const opt = agentOptions.find((o) => o.value === reportAgentFilter);
          agentPart = cleanPart(opt?.name || reportAgentFilter);
        }
      }
      let partnerPart = 'all';
      if (exportPartnerName) {
        partnerPart = cleanPart(exportPartnerName);
      } else if (reportPartnerFilter !== 'ALL') {
        partnerPart = cleanPart(reportPartnerFilter);
      }
      const todayStr = new Date().toISOString().split('T')[0];
      const filename = `max_attempts_report_${agentPart}_${partnerPart}_${todayStr}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('Error generating Max Attempts Excel:', err);
    }
  };

  // Save settings
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsSuccess(false);
    try {
      const res = await fetch('/api/callback-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_team_tag: tempTeamTag,
          max_attempts: tempMaxAttempts,
          max_sms_attempts: tempMaxSmsAttempts,
        }),
      });
      if (!res.ok) throw new Error('Failed to save settings');
      const data: CallbackSettings = await res.json();
      setSettings(data);
      setTempStaffCount(data.staff_count);
      setSettingsSuccess(true);
      setTimeout(() => {
        setSettingsSuccess(false);
        setIsSettingsOpen(false);
      }, 1500);
      fetchJobs();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Download one-time closure reopen report
  const handleDownloadReopenReport = async () => {
    try {
      setIsDownloadingReopenReport(true);
      setReopenReportMsg(null);
      const res = await fetch('/api/callback-jobs/one-time-reopen/report');
      if (!res.ok) {
        if (res.status === 404) {
          const errData = await res.json().catch(() => ({}));
          setReopenReportMsg({
            type: 'error',
            text: errData.error || 'The one-time closure reopen job has not run yet.',
          });
          return;
        }
        throw new Error(`Failed to download report (${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `one_time_reopen_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setReopenReportMsg({ type: 'success', text: 'Report downloaded successfully.' });
    } catch (err) {
      console.error('Failed to download reopen report:', err);
      setReopenReportMsg({
        type: 'error',
        text: 'Failed to download report: ' + (err as Error).message,
      });
    } finally {
      setIsDownloadingReopenReport(false);
    }
  };

  // Handle Excel upload & robust client-side parsing via SheetJS
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadFile(e.target.files[0]);
      setUploadError(null);
    }
  };

  const handleImportSubmit = async () => {
    if (!uploadFile) {
      setUploadError('Please select an .xlsx or .xls file to upload.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const arrayBuffer = await uploadFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('The uploaded workbook contains no readable sheets.');
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // Read as 2D array of rows to reliably detect the header row
      const raw2D: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (!raw2D || raw2D.length === 0) {
        throw new Error('The uploaded Excel sheet contains no rows.');
      }

      // Aliases for header matching
      const regAliases = ['reg', 'vehiclereg', 'registration', 'regno', 'numberplate', 'plate', 'asset', 'vehreg', 'carreg'];
      const phoneAliases = ['phone', 'cell', 'cellno', 'mobile', 'telephone', 'clientcellno', 'clientphone', 'contact', 'mobilenumber'];
      const emailAliases = ['email', 'customeremail', 'clientemail', 'emailaddress', 'mail'];
      const nameAliases = ['name', 'clientname', 'customername', 'client', 'customer', 'policyholder', 'insured'];
      const partnerAliases = ['partner', 'channelpartner', 'insurance', 'underwriter', 'channel', 'company', 'broker'];
      const dateAliases = ['date', 'initiateddate', 'dateinitiated', 'incidentdate', 'bookingdate', 'createddate'];
      const reasonAliases = ['reason', 'brianreason', 'remarks', 'notes', 'statusreason', 'comment'];

      const normalizeColName = (c: any) => String(c || '').trim().toLowerCase().replace(/[\s_\-.]+/g, '');

      // Locate header row index
      let headerRowIndex = -1;
      for (let r = 0; r < Math.min(raw2D.length, 10); r++) {
        const row = raw2D[r];
        if (!Array.isArray(row)) continue;
        const normalizedCells = row.map(normalizeColName);
        const hasReg = normalizedCells.some((c) => regAliases.some((alias) => c.includes(alias)));
        const hasPhone = normalizedCells.some((c) => phoneAliases.some((alias) => c.includes(alias)));
        if (hasReg || hasPhone) {
          headerRowIndex = r;
          break;
        }
      }

      const mappedRows: CallbackImportRow[] = [];

      if (headerRowIndex !== -1) {
        const headers = raw2D[headerRowIndex].map(normalizeColName);
        const findColIdx = (aliases: string[]) => {
          return headers.findIndex((h) => aliases.some((alias) => h === alias || h.includes(alias)));
        };

        const regIdx = findColIdx(regAliases);
        const phoneIdx = findColIdx(phoneAliases);
        const emailIdx = findColIdx(emailAliases);
        const nameIdx = findColIdx(nameAliases);
        const partnerIdx = findColIdx(partnerAliases);
        const dateIdx = findColIdx(dateAliases);
        const reasonIdx = findColIdx(reasonAliases);

        for (let r = headerRowIndex + 1; r < raw2D.length; r++) {
          const row = raw2D[r];
          if (!row || !Array.isArray(row)) continue;

          const formatVal = (idx: number) => {
            if (idx === -1 || idx >= row.length) return '';
            const val = row[idx];
            if (val === null || val === undefined) return '';
            if (val instanceof Date) {
              return val.toISOString().split('T')[0];
            }
            return String(val).replace(/\.0$/, '').trim();
          };

          const vehicleReg = formatVal(regIdx);
          const clientPhone = formatVal(phoneIdx);
          const customerEmail = formatVal(emailIdx);
          const clientName = formatVal(nameIdx);
          const channelPartner = formatVal(partnerIdx);
          const initiatedDate = formatVal(dateIdx);
          const reason = formatVal(reasonIdx);

          if (vehicleReg || clientPhone) {
            mappedRows.push({
              vehicle_reg: vehicleReg,
              client_name: clientName || undefined,
              client_phone: clientPhone,
              customer_email: customerEmail || undefined,
              channel_partner: channelPartner || 'Unassigned Partner',
              initiated_date: initiatedDate || undefined,
              reason: reason || undefined,
            });
          }
        }
      } else {
        // Fallback to standard sheet_to_json
        const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        for (const row of rawRows) {
          const getVal = (candidates: string[]) => {
            for (const key of Object.keys(row)) {
              const cleanKey = normalizeColName(key);
              for (const cand of candidates) {
                if (cleanKey === cand || cleanKey.includes(cand)) {
                  const val = row[key];
                  if (val instanceof Date) return val.toISOString().split('T')[0];
                  return String(val).replace(/\.0$/, '').trim();
                }
              }
            }
            return '';
          };

          const vehicleReg = getVal(regAliases);
          const clientPhone = getVal(phoneAliases);
          const customerEmail = getVal(emailAliases);
          const clientName = getVal(nameAliases);
          const channelPartner = getVal(partnerAliases);
          const initiatedDate = getVal(dateAliases);
          const reason = getVal(reasonAliases);

          if (vehicleReg || clientPhone) {
            mappedRows.push({
              vehicle_reg: vehicleReg,
              client_name: clientName || undefined,
              client_phone: clientPhone,
              customer_email: customerEmail || undefined,
              channel_partner: channelPartner || 'Unassigned Partner',
              initiated_date: initiatedDate || undefined,
              reason: reason || undefined,
            });
          }
        }
      }

      if (mappedRows.length === 0) {
        throw new Error(
          'Could not identify Vehicle Reg and Phone Number columns in the uploaded file. Please ensure column headers include "Vehicle Reg" and "Phone Number".'
        );
      }

      // POST to backend API
      const res = await fetch('/api/callback-jobs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: uploadFile.name,
          imported_by: importedBy.trim() || 'Caroline',
          rows: mappedRows,
        }),
      });

      if (!res.ok) {
        let errorMsg = 'Failed to import callback jobs.';
        try {
          const errData = await res.json();
          if (errData.error) errorMsg = errData.error;
        } catch (_) {
          const text = await res.text();
          errorMsg = `Server error (${res.status}): ${text || res.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const summary: CallbackImportSummary = await res.json();

      if (summary.requiresConfirmation) {
        setPendingConfirmation({
          summary,
          mappedRows,
          fileName: uploadFile.name,
        });
        return;
      }

      setUploadSummary(summary);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchJobs();
    } catch (err) {
      console.error('Import error:', err);
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingConfirmation) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      const res = await fetch('/api/callback-jobs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: pendingConfirmation.fileName,
          imported_by: importedBy.trim() || 'Caroline',
          rows: pendingConfirmation.mappedRows,
          confirmed: true,
        }),
      });

      if (!res.ok) {
        let errorMsg = 'Failed to confirm and import callback jobs.';
        try {
          const errData = await res.json();
          if (errData.error) errorMsg = errData.error;
        } catch (_) {
          const text = await res.text();
          errorMsg = `Server error (${res.status}): ${text || res.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const summary: CallbackImportSummary = await res.json();
      setPendingConfirmation(null);
      setUploadSummary(summary);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchJobs();
    } catch (err) {
      console.error('Confirm import error:', err);
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  // Distinct channel partners for filter
  const channelPartners = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => {
      if (j.channel_partner) set.add(j.channel_partner);
    });
    return Array.from(set).sort();
  }, [jobs]);

  // Callback agents: auto-generated strictly from agents having the "Callback Team" tag
  const callbackAgents = useMemo(() => {
    const map = new Map<string, { id?: number; name: string }>();
    const teamTag = (settings?.callback_team_tag || 'Callback Team').trim().toLowerCase();

    if (settings?.active_agents && Array.isArray(settings.active_agents)) {
      settings.active_agents.forEach((a) => {
        if (a.name) {
          map.set(a.name.trim().toLowerCase(), { id: a.id, name: a.name.trim() });
        }
      });
    }

    if (allAgents && Array.isArray(allAgents)) {
      allAgents.forEach((a) => {
        if (a.name && a.tag && a.tag.trim().toLowerCase() === teamTag) {
          const key = a.name.trim().toLowerCase();
          if (!map.has(key)) {
            map.set(key, { id: a.id, name: a.name.trim() });
          } else if (a.id && !map.get(key)!.id) {
            map.get(key)!.id = a.id;
          }
        }
      });
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [settings, allAgents]);

  // Per-agent vehicle count metrics (open Amber vs total)
  const agentMetrics = useMemo(() => {
    const metrics: Record<string, { total: number; amber: number; green: number; red: number }> = {};

    jobs.forEach((j) => {
      const key = j.assigned_agent_name ? j.assigned_agent_name.trim().toLowerCase() : '__unassigned__';
      if (!metrics[key]) {
        metrics[key] = { total: 0, amber: 0, green: 0, red: 0 };
      }
      metrics[key].total++;
      if (j.status === 'AMBER') metrics[key].amber++;
      else if (j.status === 'GREEN') metrics[key].green++;
      else if (j.status === 'RED') metrics[key].red++;
    });

    return metrics;
  }, [jobs]);

  const unassignedCount = useMemo(() => {
    return jobs.filter((j) => !j.assigned_agent_name && !j.assigned_agent_id).length;
  }, [jobs]);

  const totalOpenAmberCount = useMemo(() => {
    return jobs.filter((j) => j.status === 'AMBER').length;
  }, [jobs]);

  // Total max attempts reached records
  const totalMaxAttemptsCount = useMemo(() => {
    return jobs.filter((j) => {
      const callsLimit = j.max_attempts || settings?.max_attempts || 4;
      const smsLimit = j.max_sms_attempts || settings?.max_sms_attempts || 4;
      return (
        j.latest_outcome === 'MAX_ATTEMPTS_REACHED' ||
        (j.status === 'RED' && (j.attempt_count || 0) >= callsLimit && (j.sms_count || 0) >= smsLimit)
      );
    }).length;
  }, [jobs, settings]);

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (selectedPartner !== 'ALL' && job.channel_partner !== selectedPartner) return false;
      if (selectedStatus !== 'ALL' && job.status !== selectedStatus) return false;

      if (selectedAgent !== 'ALL') {
        const target = selectedAgent.trim().toLowerCase();
        const jobAgentName = job.assigned_agent_name ? job.assigned_agent_name.trim().toLowerCase() : '';

        if (target === '__unassigned__') {
          if (job.assigned_agent_name || job.assigned_agent_id) return false;
        } else {
          const matchName = jobAgentName === target;
          const matchId = job.assigned_agent_id !== null && String(job.assigned_agent_id) === selectedAgent;
          if (!matchName && !matchId) return false;
        }
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchName = job.client_name?.toLowerCase().includes(term);
        const matchPhone = job.client_phone.includes(term) || job.client_phone_raw.includes(term);
        const matchReg =
          job.vehicle_reg.toLowerCase().includes(term) || job.vehicle_reg_raw.toLowerCase().includes(term);
        const matchPartner = job.channel_partner?.toLowerCase().includes(term);
        const matchAgent = job.assigned_agent_name?.toLowerCase().includes(term);
        const matchOutcome = job.latest_outcome?.toLowerCase().includes(term);
        if (!matchName && !matchPhone && !matchReg && !matchPartner && !matchAgent && !matchOutcome) return false;
      }
      return true;
    });
  }, [jobs, selectedPartner, selectedStatus, selectedAgent, searchTerm]);

  const visibleUnassignedJobs = useMemo(() => {
    return filteredJobs.filter((j) => !j.assigned_agent_id && !j.assigned_agent_name);
  }, [filteredJobs]);

  // Grouping: by channel_partner, then by client_phone
  const groupedData = useMemo(() => {
    const partnerMap = new Map<
      string,
      Map<string, { client_name: string | null; client_phone_raw: string; vehicles: CallbackJob[] }>
    >();

    filteredJobs.forEach((job) => {
      const partner = job.channel_partner || 'Unassigned Partner';
      if (!partnerMap.has(partner)) {
        partnerMap.set(partner, new Map());
      }
      const clientMap = partnerMap.get(partner)!;

      const phoneKey = job.client_phone;
      if (!clientMap.has(phoneKey)) {
        clientMap.set(phoneKey, {
          client_name: job.client_name,
          client_phone_raw: job.client_phone_raw,
          vehicles: [],
        });
      }
      clientMap.get(phoneKey)!.vehicles.push(job);
    });

    return partnerMap;
  }, [filteredJobs]);

  // Aggregate stats
  const stats = useMemo(() => {
    let amber = 0;
    let green = 0;
    let red = 0;
    let needsAction = 0;
    const maxAtt = settings?.max_attempts || 4;

    const sourceJobs =
      selectedAgent !== 'ALL'
        ? jobs.filter((job) => {
            const target = selectedAgent.trim().toLowerCase();
            const jobAgentName = job.assigned_agent_name ? job.assigned_agent_name.trim().toLowerCase() : '';
            if (target === '__unassigned__') {
              return !job.assigned_agent_name && !job.assigned_agent_id;
            }
            return (
              jobAgentName === target ||
              (job.assigned_agent_id !== null && String(job.assigned_agent_id) === selectedAgent)
            );
          })
        : jobs;

    sourceJobs.forEach((j) => {
      if (j.status === 'AMBER') {
        amber++;
      } else if (j.status === 'GREEN') {
        green++;
      } else if (j.status === 'RED') {
        red++;
      }
      if (j.latest_outcome === 'MAX_ATTEMPTS_REACHED') {
        needsAction++;
      }
    });

    return { total: sourceJobs.length, amber, green, red, needsAction };
  }, [jobs, selectedAgent, settings]);

  const togglePartnerCollapse = (partner: string) => {
    setCollapsedPartners((prev) => ({
      ...prev,
      [partner]: !prev[partner],
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(text);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  // Outcome badge component helper
  const renderOutcomeBadge = (outcome?: string | null, status?: CallbackJobStatus) => {
    if (!outcome) {
      if (status === 'GREEN') {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Scheduled
          </span>
        );
      }
      if (status === 'RED') {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <OctagonAlert className="w-3 h-3 text-rose-600" />
            Closed
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          Pending Callback
        </span>
      );
    }

    switch (outcome) {
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Job Scheduled
          </span>
        );
      case 'NOT_PICKING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Not Picking
          </span>
        );
      case 'NOT_READY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Not Ready to Book
          </span>
        );
      case 'UNREACHABLE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Unreachable / Busy
          </span>
        );
      case 'WRONG_NUMBER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Wrong Number
          </span>
        );
      case 'DECLINED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <OctagonAlert className="w-3 h-3 text-rose-600" />
            Customer Rejected
          </span>
        );
      case 'VALUED_ELSEWHERE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <OctagonAlert className="w-3 h-3 text-rose-600" />
            Done Elsewhere
          </span>
        );
      case 'MAX_ATTEMPTS_REACHED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-red-600 text-white border border-red-700 shadow-xs">
            <OctagonAlert className="w-3 h-3 text-white" />
            Max Attempts Reached
          </span>
        );
      case 'ABSENT_FROM_LATEST_EXPORT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-teal-100 text-teal-900 border border-teal-300">
            <CheckCircle2 className="w-3 h-3 text-teal-700" />
            Absent from Export (Auto-Scheduled)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            {outcome}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-[#ff353e] text-white flex items-center justify-center shadow-md shadow-red-500/20 flex-shrink-0">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">Callbacks to clients pending scheduling</h1>
                <button
                  id="btn-open-onboarding-tour"
                  type="button"
                  onClick={handleOpenOnboardingTourManual}
                  className="w-6 h-6 rounded-full border border-slate-200 hover:border-[#ff353e] bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-[#ff353e] flex items-center justify-center transition-colors cursor-pointer text-xs font-bold shrink-0"
                  title="How this callback list works (quick tour)"
                  aria-label="How this callback list works"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-[#ff353e] border border-red-100">
                  Valuation Intake
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Daily callbacks for pending vehicle valuations. Outcome logging is required per contact attempt: records go Green only when scheduled, stay Amber (notes are optional), and automatically close Red when max attempts are reached.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            {/* Max Attempts Report Button */}
            <button
              id="btn-open-max-attempts-report"
              onClick={openMaxAttemptsReport}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="View Channel-Partner report of jobs closed due to max attempts"
            >
              <FileText className="w-3.5 h-3.5 text-[#ff353e]" />
              <span>Max Attempts Report</span>
              {totalMaxAttemptsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-red-100 text-red-700">
                  {totalMaxAttemptsCount}
                </span>
              )}
            </button>

            {/* Unmatched Activity Button */}
            <button
              id="btn-open-unmatched-activity"
              onClick={() => setIsUnmatchedActivityOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="View call and SMS events that did not match any callback job"
            >
              <Activity className="w-3.5 h-3.5 text-blue-600" />
              <span>Unmatched Activity</span>
              {unmatchedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-blue-100 text-blue-700">
                  {unmatchedCount}
                </span>
              )}
            </button>

            {/* Team Settings Button */}
            <button
              id="btn-open-callback-settings"
              onClick={() => setIsSettingsOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Configure staff balancing and max attempts"
            >
              <SettingsIcon className="w-3.5 h-3.5 text-slate-500" />
              <span>Team Settings</span>
            </button>

            {/* Upload latest pending scheduling list Button */}
            <button
              id="btn-open-import-modal"
              onClick={openUploadModal}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload latest pending scheduling list</span>
            </button>

            {/* Refresh Button */}
            <button
              id="btn-refresh-callbacks"
              onClick={fetchJobs}
              disabled={refreshing}
              className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all cursor-pointer"
              title="Refresh callback jobs"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#ff353e]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Unrecognised Agent Names Notice Banner */}
        {needsReviewCount > 0 && (
          <div
            onClick={() => setIsReviewAgentsOpen(true)}
            className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-100/80 transition-all text-amber-950 shadow-2xs"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black">
                  {needsReviewCount} unrecognised agent {needsReviewCount === 1 ? 'name needs' : 'names need'} review
                </span>
                <span className="text-[11px] text-amber-800 ml-1.5 hidden sm:inline">
                  Unrecognised agent names from Android app logs need merge or confirmation.
                </span>
              </div>

            </div>
            <button
              type="button"
              className="px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-2xs"
            >
              Review Names &rarr;
            </button>
          </div>
        )}

        {/* Callback Agent Filter Bar */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-[#ff353e]/10 text-[#ff353e] flex items-center justify-center">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Filter by Callback Agent:
              </span>
              <span className="text-[11px] text-slate-500">
                Click your name to view your assigned callbacks
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-[#ff353e] border border-rose-200/60">
                <Tag className="w-2.5 h-2.5" />
                Auto-synced: {settings?.callback_team_tag || 'Callback Team'} ({callbackAgents.length} agents)
              </span>
            </div>

            {selectedAgent !== 'ALL' && (
              <button
                id="btn-clear-agent-filter"
                onClick={() => setSelectedAgent('ALL')}
                className="text-xs font-bold text-[#ff353e] hover:text-[#d9222b] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Show All Agents ({jobs.length} total)</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick-select Agent Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="filter-agent-all-btn"
              onClick={() => setSelectedAgent('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                selectedAgent === 'ALL'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>All Callback Agents</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  selectedAgent === 'ALL' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200/80 text-slate-700'
                }`}
              >
                {totalOpenAmberCount} open
              </span>
            </button>

            {callbackAgents.map((ag) => {
              const isSelected =
                selectedAgent.toLowerCase() === ag.name.toLowerCase() ||
                (ag.id !== undefined && selectedAgent === String(ag.id));
              const m = agentMetrics[ag.name.toLowerCase()] || { total: 0, amber: 0, green: 0, red: 0 };

              return (
                <button
                  key={ag.name}
                  id={`filter-agent-btn-${ag.name.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setSelectedAgent(isSelected ? 'ALL' : ag.name)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-[#ff353e] text-white shadow-sm ring-2 ring-[#ff353e]/30'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                  }`}
                >
                  <User className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                  <span>{ag.name}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                      isSelected ? 'bg-red-700 text-white' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {m.amber} open
                  </span>
                  {m.total > m.amber && (
                    <span className={`text-[10px] ${isSelected ? 'text-red-100' : 'text-slate-400'}`}>
                      / {m.total} total
                    </span>
                  )}
                </button>
              );
            })}

            {unassignedCount > 0 && (
              <button
                id="filter-agent-unassigned-btn"
                onClick={() => setSelectedAgent(selectedAgent === '__unassigned__' ? 'ALL' : '__unassigned__')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedAgent === '__unassigned__'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Unassigned ({unassignedCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats Metrics Bar */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {selectedAgent !== 'ALL' ? `Queue Metrics: ${selectedAgent}` : 'Team Callback Overview'}
            </span>
            {selectedAgent !== 'ALL' && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-50 text-[#ff353e] border border-red-100">
                  Viewing assigned callbacks for {selectedAgent}
                </span>
                <button
                  id="btn-start-calling-session"
                  onClick={() => setIsCallSessionActive(true)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                    isCallSessionActive
                      ? 'bg-slate-900 text-white'
                      : 'bg-[#ff353e] hover:bg-[#e0262f] text-white hover:shadow'
                  }`}
                  title="Launch one-at-a-time focused calling queue"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>{isCallSessionActive ? 'Active Call Session' : 'Start Calling'}</span>
                  {stats.amber > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-red-700 text-white">
                      {stats.amber}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            <div
              id="tile-overview-total"
              onClick={() => openDrilldown('TOTAL')}
              role="button"
              tabIndex={0}
              title="Click to view and export all queued vehicles"
              className="group bg-slate-50/80 hover:bg-slate-100/90 rounded-xl p-3 border border-slate-200/80 hover:border-slate-300 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {selectedAgent !== 'ALL' ? `${selectedAgent}'s Vehicles` : 'Total Vehicles'}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-2xl font-black text-slate-900 mt-0.5 block">{stats.total}</span>
            </div>

            <div
              id="tile-overview-amber"
              onClick={() => openDrilldown('AMBER')}
              role="button"
              tabIndex={0}
              title="Click to view and export open amber callback vehicles"
              className="group bg-amber-50/70 hover:bg-amber-100/80 rounded-xl p-3 border border-amber-200/80 hover:border-amber-300 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">Open / Amber</span>
                <ChevronRight className="w-3.5 h-3.5 text-amber-500 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-2xl font-black text-amber-700 mt-0.5 block">{stats.amber}</span>
            </div>

            <div
              id="tile-overview-green"
              onClick={() => openDrilldown('GREEN')}
              role="button"
              tabIndex={0}
              title="Click to view and export completed green callback vehicles"
              className="group bg-emerald-50/70 hover:bg-emerald-100/80 rounded-xl p-3 border border-emerald-200/80 hover:border-emerald-300 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Closed / Green</span>
                <ChevronRight className="w-3.5 h-3.5 text-emerald-500 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-2xl font-black text-emerald-700 mt-0.5 block">{stats.green}</span>
            </div>

            <div
              id="tile-overview-red"
              onClick={() => openDrilldown('RED')}
              role="button"
              tabIndex={0}
              title="Click to view and export closed red callback vehicles"
              className="group bg-rose-50/70 hover:bg-rose-100/80 rounded-xl p-3 border border-rose-200/80 hover:border-rose-300 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">Closed / Red</span>
                <ChevronRight className="w-3.5 h-3.5 text-rose-500 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-2xl font-black text-rose-700 mt-0.5 block">{stats.red}</span>
            </div>

            <div
              id="tile-overview-max-attempts"
              onClick={() => openDrilldown('MAX_ATTEMPTS')}
              role="button"
              tabIndex={0}
              title="Click to view and export vehicles that hit maximum call attempts"
              className="group col-span-2 sm:col-span-4 lg:col-span-1 bg-red-50/60 hover:bg-red-100/70 rounded-xl p-3 border border-red-200/80 hover:border-red-300 hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-red-700 uppercase tracking-wider block flex items-center gap-1">
                  <OctagonAlert className="w-3.5 h-3.5 text-red-600" />
                  <span>Max Attempts Hit</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-red-500 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-2xl font-black text-red-700 mt-0.5 block">{stats.needsAction}</span>
            </div>
          </div>
        </div>
      </div>

      <AgentKpiPanel
        section="callbacks"
        focusAgentName={selectedAgent !== 'ALL' && selectedAgent !== '__unassigned__' ? selectedAgent : null}
        refreshToken={kpiRefreshToken}
      />

      {/* Upload Success Banner */}
      {uploadSummary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4.5 shadow-xs flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-950">Daily Export Successfully Processed</h4>
              <p className="text-xs text-emerald-800 mt-0.5">
                <span className="font-bold text-emerald-900">{uploadSummary.new_records_count}</span> new vehicles queued •{' '}
                <span className="font-bold text-emerald-900">{uploadSummary.skipped_open_count}</span> already open (updated last seen) •{' '}
                <span className="font-bold text-emerald-900">{uploadSummary.skipped_closed_count}</span> already completed •{' '}
                <span className="font-bold text-emerald-900">{uploadSummary.auto_closed_absent_count || 0}</span> absent from export (auto-scheduled/closed Green).
              </p>
            </div>
          </div>
          <button
            onClick={() => setUploadSummary(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Either Focused Call Session View OR standard Search & Partner Filtered List */}
      {isCallSessionActive ? (
        <CallSessionView
          selectedAgent={selectedAgent}
          settings={settings}
          callbackAgents={callbackAgents}
          initialPartner={selectedPartner}
          availablePartners={channelPartners}
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
          {/* Search & Filter Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="input-search-callbacks"
            type="text"
            placeholder="Search by client name, phone number, vehicle registration..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Partner Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 border border-slate-200 rounded-xl">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              id="select-filter-channel-partner"
              value={selectedPartner}
              onChange={(e) => setSelectedPartner(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
            >
              <option value="ALL">All Partners ({channelPartners.length})</option>
              {channelPartners.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 border border-slate-200 rounded-xl">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              id="select-filter-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="AMBER">Open / Amber</option>
              <option value="GREEN">Closed / Green</option>
              <option value="RED">Closed / Red</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-[#ff353e] animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-600">Loading callback jobs...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm font-bold text-red-800">{error}</p>
          <button
            onClick={fetchJobs}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors"
          >
            Retry Loading
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-3xl p-16 border border-slate-200/80 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-red-50 text-[#ff353e] mx-auto flex items-center justify-center">
            <FileSpreadsheet className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-black text-slate-900">No Callback Records Found</h3>
            <p className="text-xs text-slate-500">
              Upload Brian&rsquo;s daily valuation Excel export (.xlsx) to queue pending callbacks and auto-balance records across your callback team.
            </p>
          </div>
          <button
            onClick={openUploadModal}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Upload latest pending scheduling list</span>
          </button>
        </div>
      ) : groupedData.size === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-2">
          <Search className="w-8 h-8 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No records match your filters</h3>
          <p className="text-xs text-slate-400">Try clearing the search term or resetting the filter options.</p>
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedPartner('ALL');
              setSelectedStatus('ALL');
              setSelectedAgent('ALL');
            }}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-colors mt-2"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Bulk Assignment Bar in Unassigned filter view */}
          {selectedAgent === '__unassigned__' && (
            <div className="bg-white rounded-2xl p-4 border border-amber-200 shadow-xs space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                {/* Left: Select all checkbox & selection count */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={
                        visibleUnassignedJobs.length > 0 &&
                        visibleUnassignedJobs.every((j) => selectedUnassignedJobIds.has(j.id))
                      }
                      onChange={() => {
                        const allSelected =
                          visibleUnassignedJobs.length > 0 &&
                          visibleUnassignedJobs.every((j) => selectedUnassignedJobIds.has(j.id));
                        if (allSelected) {
                          setSelectedUnassignedJobIds(new Set());
                        } else {
                          const next = new Set(selectedUnassignedJobIds);
                          visibleUnassignedJobs.forEach((j) => next.add(j.id));
                          setSelectedUnassignedJobIds(next);
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#ff353e] focus:ring-[#ff353e] cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700">
                      Select all ({visibleUnassignedJobs.length})
                    </span>
                  </label>
                  <span className="text-xs text-slate-400 font-mono">
                    | {selectedUnassignedJobIds.size} selected
                  </span>
                </div>

                {/* Right: Agent selector and Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={bulkTargetAgentId}
                    onChange={(e) => setBulkTargetAgentId(e.target.value)}
                    className="text-xs font-semibold px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#ff353e] cursor-pointer"
                  >
                    <option value="">Select agent to assign...</option>
                    {callbackAgents
                      .filter((a) => a.id !== undefined)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleBulkAssign('SELECTED')}
                    disabled={selectedUnassignedJobIds.size === 0 || !bulkTargetAgentId || isBulkAssigning}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      selectedUnassignedJobIds.size === 0 || !bulkTargetAgentId || isBulkAssigning
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                        : 'bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-2xs'
                    }`}
                  >
                    {isBulkAssigning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                    <span>Assign selected ({selectedUnassignedJobIds.size}) to...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleBulkAssign('ALL')}
                    disabled={allUnassignedCount === 0 || !bulkTargetAgentId || isBulkAssigning}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      allUnassignedCount === 0 || !bulkTargetAgentId || isBulkAssigning
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                        : 'bg-slate-900 hover:bg-slate-800 text-white shadow-2xs'
                    }`}
                  >
                    {isBulkAssigning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                    <span>Assign all {allUnassignedCount} unassigned to...</span>
                  </button>
                </div>
              </div>

              {/* Success / Error Message Banner */}
              {bulkMessage && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 ${
                    bulkMessage.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {bulkMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    )}
                    <span>{bulkMessage.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBulkMessage(null)}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {Array.from(groupedData.entries()).map(([partner, clientMap]) => {
            const isCollapsed = collapsedPartners[partner];
            let pTotal = 0;
            let pAmber = 0;
            let pGreen = 0;
            let pRed = 0;

            clientMap.forEach((c) => {
              c.vehicles.forEach((v) => {
                pTotal++;
                if (v.status === 'AMBER') pAmber++;
                else if (v.status === 'GREEN') pGreen++;
                else if (v.status === 'RED') pRed++;
              });
            });

            return (
              <div
                key={partner}
                className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden transition-all"
              >
                {/* Channel Partner Accordion Header */}
                <div
                  onClick={() => togglePartnerCollapse(partner)}
                  className="px-6 py-4 bg-slate-50/70 border-b border-slate-200/70 flex items-center justify-between cursor-pointer hover:bg-slate-100/70 transition-colors select-none"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center shadow-2xs">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <span>{partner}</span>
                        <span className="text-xs font-mono font-bold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                          {pTotal} {pTotal === 1 ? 'vehicle' : 'vehicles'}
                        </span>
                      </h3>
                      <span className="text-[11px] text-slate-400">
                        {clientMap.size} {clientMap.size === 1 ? 'client' : 'clients'} listed
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {pAmber > 0 && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">
                        {pAmber} Amber
                      </span>
                    )}
                    {pGreen > 0 && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {pGreen} Green
                      </span>
                    )}
                    {pRed > 0 && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800">
                        {pRed} Red
                      </span>
                    )}
                  </div>
                </div>

                {/* Clients nested under this Partner */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {Array.from(clientMap.entries()).map(([clientPhone, clientData]) => {
                      return (
                        <div key={clientPhone} className="p-5 hover:bg-slate-50/40 transition-colors">
                          {/* Client Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-100">
                            <div className="flex items-start sm:items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5 sm:mt-0">
                                <User className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                                  {clientData.client_name || 'Valuation Client'}
                                </h4>

                                {/* Phone numbers with tel: link per number in phones array */}
                                {(() => {
                                  const clientPhones: Array<{ phone_normalised: string; source: string }> = (() => {
                                    const map = new Map<string, { phone_normalised: string; source: string }>();
                                    for (const v of clientData.vehicles) {
                                      if (v.phones && v.phones.length > 0) {
                                        for (const p of v.phones) {
                                          if (!map.has(p.phone_normalised)) {
                                            map.set(p.phone_normalised, { phone_normalised: p.phone_normalised, source: p.source });
                                          }
                                        }
                                      }
                                    }
                                    if (map.size === 0) {
                                      const raw = clientData.client_phone_raw || clientData.vehicles[0]?.client_phone || '';
                                      const norm = raw.replace(/\D/g, '').slice(-9);
                                      if (norm) {
                                        map.set(norm, { phone_normalised: norm, source: 'PRIMARY' });
                                      }
                                    }
                                    return Array.from(map.values());
                                  })();

                                  return (
                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                      {clientPhones.map((p, idx) => {
                                        const dialNumber = `+254${p.phone_normalised}`;
                                        const displayNumber = `0${p.phone_normalised}`;
                                        const isAlternate = idx > 0 || p.source !== 'PRIMARY';

                                        return (
                                          <div key={p.phone_normalised} className="flex items-center gap-1.5">
                                            <a
                                              href={`tel:${dialNumber}`}
                                              className="text-base sm:text-lg font-black font-mono tracking-wide text-slate-900 hover:text-[#ff353e] flex items-center gap-1.5 transition-colors bg-slate-100 hover:bg-red-50 px-2.5 py-1 rounded-lg border border-slate-200/80"
                                              title={`Click to dial ${dialNumber}`}
                                            >
                                              <Phone className="w-4 h-4 text-[#ff353e]" />
                                              <span>{displayNumber}</span>
                                              {isAlternate && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wide">
                                                  alternate
                                                </span>
                                              )}
                                            </a>
                                            <button
                                              onClick={() => copyToClipboard(displayNumber)}
                                              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 border border-slate-200/60 transition-colors cursor-pointer"
                                              title={`Copy ${displayNumber}`}
                                            >
                                              {copiedPhone === displayNumber ? (
                                                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                                  <Check className="w-3.5 h-3.5" /> Copied!
                                                </span>
                                              ) : (
                                                <Copy className="w-3.5 h-3.5" />
                                              )}
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                                {clientData.vehicles.length}{' '}
                                {clientData.vehicles.length === 1 ? 'vehicle attached' : 'vehicles attached'}
                              </span>
                            </div>
                          </div>

                          {/* Vehicles Table / List */}
                          <div className="space-y-2.5">
                            {clientData.vehicles.map((vehicle) => {
                              const callsLimit = vehicle.max_attempts || settings?.max_attempts || 4;
                              const smsLimit = vehicle.max_sms_attempts || settings?.max_sms_attempts || 4;
                              const callsCount = vehicle.attempt_count || 0;
                              const smsCount = vehicle.sms_count || 0;
                              const callsMet = callsCount >= callsLimit;
                              const smsMet = smsCount >= smsLimit;
                              const isMaxReached = callsMet && smsMet && vehicle.status === 'AMBER';

                              return (
                                <div
                                  key={vehicle.id}
                                  className={`rounded-2xl p-4 border transition-all flex flex-col gap-3.5 ${
                                    vehicle.status === 'GREEN'
                                      ? 'bg-emerald-50/20 border-emerald-200/70'
                                      : vehicle.status === 'RED'
                                      ? 'bg-rose-50/20 border-rose-200/70'
                                      : isMaxReached
                                      ? 'bg-red-50/40 border-red-200'
                                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                                  }`}
                                >
                                  <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
                                    {/* Left: Vehicle Plate, Status Pill, Reason & Latest Outcome */}
                                    <div className="flex items-start sm:items-center gap-3 flex-wrap">
                                      {selectedAgent === '__unassigned__' && (
                                        <div className="flex items-center self-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                          <input
                                            type="checkbox"
                                            checked={selectedUnassignedJobIds.has(vehicle.id)}
                                            onChange={() => {
                                              setSelectedUnassignedJobIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(vehicle.id)) {
                                                  next.delete(vehicle.id);
                                                } else {
                                                  next.add(vehicle.id);
                                                }
                                                return next;
                                              });
                                            }}
                                            className="w-4 h-4 rounded border-slate-300 text-[#ff353e] focus:ring-[#ff353e] cursor-pointer"
                                            title="Select vehicle for assignment"
                                          />
                                        </div>
                                      )}

                                      {/* Number Plate badge */}
                                      <div className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white font-mono font-black text-xs tracking-wider shadow-xs border border-slate-700 flex-shrink-0">
                                      {vehicle.vehicle_reg_raw}
                                    </div>

                                    {/* Status Pill */}
                                    <div
                                      className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                                        vehicle.status === 'GREEN'
                                          ? 'bg-emerald-600 text-white'
                                          : vehicle.status === 'RED'
                                          ? 'bg-rose-600 text-white'
                                          : 'bg-amber-500 text-white'
                                      }`}
                                    >
                                      {vehicle.status === 'GREEN' ? (
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                      ) : vehicle.status === 'RED' ? (
                                        <OctagonAlert className="w-3.5 h-3.5" />
                                      ) : (
                                        <Clock className="w-3.5 h-3.5" />
                                      )}
                                      <span>{vehicle.status}</span>
                                    </div>

                                    {/* Outcome Badge */}
                                    {renderOutcomeBadge(vehicle.latest_outcome, vehicle.status)}

                                    {/* Brian Reason */}
                                    {vehicle.brian_reason && (
                                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                                        <span className="text-slate-400 font-medium">Reason:</span>
                                        <span className="font-semibold text-slate-700">{vehicle.brian_reason}</span>
                                      </div>
                                    )}

                                    {/* Initiated Date */}
                                    {vehicle.initiated_date && (
                                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                        <Calendar className="w-3 h-3 text-slate-400" />
                                        <span>{vehicle.initiated_date}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Right: Attempts, SMS, Assigned Agent & Log Outcome Action */}
                                  <div className="flex items-center gap-3 flex-wrap xl:flex-nowrap justify-between xl:justify-end">
                                    {/* Max attempts warning flag */}
                                    {isMaxReached && (
                                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-100 text-red-700 text-[10px] font-black animate-pulse">
                                        <OctagonAlert className="w-3.5 h-3.5" />
                                        <span>Max Attempts Hit</span>
                                      </div>
                                    )}

                                    {/* Call Attempt Count Badge */}
                                    <div
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                                        callsMet
                                          ? 'bg-red-50 text-red-700 border border-red-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200/60'
                                      }`}
                                      title={`Contact attempts by callback team: ${callsCount} / ${callsLimit}`}
                                    >
                                      <Phone className="w-3 h-3 text-slate-500" />
                                      <span>
                                        {callsCount} / {callsLimit} calls
                                      </span>
                                    </div>

                                    {/* SMS Count Badge */}
                                    <div
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                                        smsMet
                                          ? 'bg-red-50 text-red-700 border border-red-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200/60'
                                      }`}
                                      title={`SMS messages sent to this client: ${smsCount} / ${smsLimit}`}
                                    >
                                      <MessageSquare className="w-3 h-3 text-slate-500" />
                                      <span>
                                        {smsCount} / {smsLimit} SMS
                                      </span>
                                    </div>

                                    {/* Amber Hints when one threshold is met but not the other */}
                                    {callsMet && !smsMet && vehicle.status === 'AMBER' && (
                                      <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                                        SMS needed
                                      </span>
                                    )}
                                    {!callsMet && smsMet && vehicle.status === 'AMBER' && (
                                      <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                                        Calls needed
                                      </span>
                                    )}

                                    {/* Assigned Agent Dropdown */}
                                    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                                      <select
                                        id={`select-assign-agent-${vehicle.id}`}
                                        value={vehicle.assigned_agent_id ?? ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          handleAssignJob(vehicle.id, val === '' ? null : Number(val));
                                        }}
                                        className="text-xs font-bold pl-2.5 pr-6 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#ff353e] cursor-pointer appearance-none shadow-2xs"
                                        title="Assign callback agent (applies to client)"
                                      >
                                        <option value="">Unassigned</option>
                                        {callbackAgents
                                          .filter((a) => a.id !== undefined)
                                          .map((a) => (
                                            <option key={a.id} value={a.id}>
                                              {a.name}
                                            </option>
                                          ))}
                                      </select>
                                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 pointer-events-none" />
                                    </div>

                                    {/* History Toggle Button */}
                                    <button
                                      id={`btn-toggle-history-${vehicle.id}`}
                                      type="button"
                                      onClick={() => toggleHistory(vehicle.id)}
                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                        expandedHistoryJobIds.has(vehicle.id)
                                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs'
                                      }`}
                                      title="Toggle attempt history"
                                    >
                                      <History className="w-3.5 h-3.5" />
                                      <span>History</span>
                                      <ChevronDown
                                        className={`w-3 h-3 transition-transform duration-150 ${
                                          expandedHistoryJobIds.has(vehicle.id) ? 'rotate-180' : ''
                                        }`}
                                      />
                                    </button>

                                    {/* Outcome Logging Button */}
                                    <button
                                      id={`btn-log-outcome-${vehicle.id}`}
                                      type="button"
                                      onClick={() => openOutcomeModal(vehicle)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                                        vehicle.status === 'AMBER'
                                          ? 'bg-slate-900 hover:bg-slate-800 text-white'
                                          : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                      }`}
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 text-[#ff353e]" />
                                      <span>Log Outcome</span>
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded Prior Attempt History */}
                                {expandedHistoryJobIds.has(vehicle.id) && (
                                  <div className="pt-3 border-t border-slate-200/80 space-y-2.5 animate-in fade-in duration-150">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 px-1">
                                      <div className="flex items-center gap-1.5">
                                        <History className="w-3.5 h-3.5 text-slate-500" />
                                        <span>
                                          Attempt History ({historyCache[vehicle.id]?.length ?? (loadingHistoryIds.has(vehicle.id) ? '...' : 0)})
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                                        Chronological
                                      </span>
                                    </div>

                                    {loadingHistoryIds.has(vehicle.id) && !historyCache[vehicle.id] ? (
                                      <div className="py-3 text-center text-xs text-slate-500 flex items-center justify-center gap-2 bg-slate-50 rounded-xl border border-slate-200/60">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#ff353e]" />
                                        <span>Loading attempt history...</span>
                                      </div>
                                    ) : (historyCache[vehicle.id] || []).length === 0 ? (
                                      <div className="py-2.5 px-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200/60">
                                        No prior attempts or notes logged for this vehicle.
                                      </div>
                                    ) : (
                                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {historyCache[vehicle.id].map((log, logIdx) => (
                                          <div
                                            key={log.id || logIdx}
                                            className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs space-y-1.5 shadow-2xs"
                                          >
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                              <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-black text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                                                  Attempt #{logIdx + 1}
                                                </span>
                                                <span
                                                  className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                                                    log.resulting_status === 'GREEN'
                                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                      : log.resulting_status === 'RED'
                                                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                                                      : 'bg-amber-100 text-amber-800 border-amber-300'
                                                  }`}
                                                >
                                                  {getOutcomeLabel(log.outcome)}
                                                </span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 font-mono">
                                                {new Date(log.created_at).toLocaleString()}
                                              </span>
                                            </div>

                                            {log.comment && (
                                              <p className="text-xs text-slate-700 italic bg-white p-2 rounded-lg border border-slate-200/60">
                                                &ldquo;{log.comment}&rdquo;
                                              </p>
                                            )}

                                            <div className="text-[10px] text-slate-500 flex items-center justify-between pt-0.5 px-0.5">
                                              <span>
                                                Logged by: <strong className="text-slate-700">{log.logged_by || 'Unknown'}</strong>
                                              </span>
                                              <span className="text-slate-400">
                                                Resulting Status: <strong className="font-semibold">{log.resulting_status}</strong>
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Outcome Logging Modal */}
      {outcomeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-3.5 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 leading-tight">Log Call Outcome & Notes</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Vehicle: <span className="font-mono font-bold text-slate-800">{outcomeJob.vehicle_reg_raw}</span> • {outcomeJob.client_phone_raw}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOutcomeJob(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmitOutcome} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-3.5 sm:p-5 overflow-y-auto space-y-3 flex-1 min-h-0">
                {outcomeError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span>{outcomeError}</span>
                  </div>
                )}

                {/* Primary Question: Job Scheduled? */}
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                  <label className="text-[11px] font-black text-slate-800 block mb-1.5 uppercase tracking-wide">
                    Job Scheduled?
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsJobScheduledQuestion('YES');
                        setSelectedOutcome('SCHEDULED');
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                        isJobScheduledQuestion === 'YES' || selectedOutcome === 'SCHEDULED'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Yes, Scheduled (Green)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsJobScheduledQuestion('NO');
                        if (selectedOutcome === 'SCHEDULED') setSelectedOutcome('NOT_PICKING');
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                        isJobScheduledQuestion === 'NO' || (selectedOutcome !== 'SCHEDULED' && isJobScheduledQuestion !== 'YES')
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>No (Amber / Red)</span>
                    </button>
                  </div>
                </div>

                {/* Detailed Outcome Options if Not Scheduled */}
                {(isJobScheduledQuestion === 'NO' || selectedOutcome !== 'SCHEDULED') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                        Select Call Outcome
                      </label>
                      <span className="text-[10px] text-slate-400">Amber = retry · Red = closed</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {OUTCOME_OPTIONS.filter((o) => o.value !== 'SCHEDULED').map((opt) => {
                        const isSelected = selectedOutcome === opt.value;
                        const isRed = opt.resultingStatus === 'RED';
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSelectedOutcome(opt.value)}
                            className={`px-2.5 py-1.5 text-left rounded-lg text-xs transition-all border cursor-pointer flex items-center justify-between gap-1.5 ${
                              isSelected
                                ? isRed
                                  ? 'bg-rose-50 border-rose-500 text-rose-950 font-bold ring-1.5 ring-rose-400 shadow-2xs'
                                  : 'bg-amber-50 border-amber-500 text-amber-950 font-bold ring-1.5 ring-amber-400 shadow-2xs'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            <div className="min-w-0 pr-1">
                              <span className="font-bold text-[11px] leading-tight block truncate">
                                {opt.label}
                              </span>
                              <span className="text-[9px] text-slate-500 leading-tight block truncate">
                                {opt.description}
                              </span>
                            </div>
                            <span
                              className={`text-[8.5px] px-1.5 py-0.5 rounded font-black tracking-wide shrink-0 ${
                                isRed
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {opt.resultingStatus}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Callback Notes & Logged By side-by-side */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Callback Notes & Summary <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={outcomeComment}
                      onChange={(e) => setOutcomeComment(e.target.value)}
                      placeholder="Notes (e.g. callback requested tomorrow 2pm, optional)..."
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Logged By</label>
                    <input
                      type="text"
                      required
                      value={outcomeLoggedBy}
                      onChange={(e) => setOutcomeLoggedBy(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                    />
                  </div>
                </div>
              </div>

              {/* Pinned Modal Footer (Always visible, never hidden) */}
              <div className="p-3 sm:px-5 sm:py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setOutcomeJob(null)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/70 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOutcome || !selectedOutcome}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmittingOutcome ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Outcome & Notes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attempt History & Notes Modal */}
      {historyJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[88vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden my-auto">
            {/* Pinned Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center flex-shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 leading-tight">Attempt History & Notes</h3>
                  <p className="text-xs text-slate-500">
                    Vehicle: <span className="font-mono font-bold text-slate-800">{historyJob.vehicle_reg_raw}</span> • {historyJob.client_name || 'Client'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistoryJob(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 space-y-3">
              {loadingLogs ? (
                <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#ff353e]" />
                  <span>Loading log history...</span>
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
                  No outcome notes logged for this vehicle yet. Click &ldquo;Log Outcome&rdquo; to add call notes.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {historyLogs.map((log, idx) => (
                    <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-slate-800">
                            Attempt #{historyLogs.length - idx}: {log.outcome}
                          </span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-black ${
                              log.resulting_status === 'GREEN'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.resulting_status === 'RED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {log.resulting_status}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 italic bg-white p-2 rounded-lg border border-slate-200/50">
                        &ldquo;{log.comment}&rdquo;
                      </p>
                      <div className="text-[10px] text-slate-500 flex items-center justify-between pt-0.5">
                        <span>Logged by: <strong className="text-slate-700">{log.logged_by}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pinned Footer */}
            <div className="p-3 sm:px-5 sm:py-3 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end flex-shrink-0">
              <button
                onClick={() => setHistoryJob(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors shadow-2xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Max Attempts Reached Report Modal */}
      {isReportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl border border-slate-100 space-y-4 sm:space-y-5 max-h-[88vh] flex flex-col my-auto overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 sm:pb-4 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900">
                    Max Attempts Reached: Channel Partner Report
                  </h3>
                  <p className="text-xs text-slate-500">
                    Vehicles closed Red after reaching the minimum outgoing calls and minimum SMS without booking • Total Records:{' '}
                    <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">
                      {isReportFiltered ? `${visibleRecordCount} of ${totalReportRecords} total` : visibleRecordCount}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReportOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter row: Agent and Channel Partner selectors */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200 flex-shrink-0">
              <div className="flex-1 flex flex-col gap-1">
                <label htmlFor="select-report-agent-filter" className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Agent
                </label>
                <select
                  id="select-report-agent-filter"
                  value={reportAgentFilter}
                  onChange={(e) => setReportAgentFilter(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#ff353e] cursor-pointer"
                >
                  {agentOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 flex flex-col gap-1">
                <label htmlFor="select-report-partner-filter" className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Channel Partner
                </label>
                <select
                  id="select-report-partner-filter"
                  value={reportPartnerFilter}
                  onChange={(e) => setReportPartnerFilter(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#ff353e] cursor-pointer"
                >
                  {partnerOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {reportError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span>{reportError}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {loadingReport ? (
                <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#ff353e]" />
                  <span>Compiling Channel-Partner report...</span>
                </div>
              ) : visibleGroups.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
                  {reportData.length === 0
                    ? 'No records currently closed under "Max Attempts Reached".'
                    : 'No records for this selection.'}
                </div>
              ) : (
                visibleGroups.map((group) => (
                  <div key={group.channel_partner} className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#ff353e]" />
                        <h4 className="text-xs font-black text-slate-900 uppercase">
                          {group.channel_partner}
                        </h4>
                        <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">
                          {group.records.length} {group.records.length === 1 ? 'record' : 'records'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleExportMaxAttemptsReportToExcel([group], group.channel_partner)}
                        type="button"
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs flex items-center gap-1 transition-colors w-fit cursor-pointer"
                        title={`Download Excel for ${group.channel_partner}`}
                      >
                        <Download className="w-3 h-3 text-slate-500" />
                        <span>Download {group.channel_partner} Excel</span>
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {group.records.map((rec) => (
                        <div key={rec.vehicle_reg_raw} className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white font-mono font-bold text-xs">
                                {rec.vehicle_reg_raw}
                              </span>
                              <span className="text-xs font-bold text-slate-800">
                                {rec.client_name || 'Client'}
                              </span>
                              <span className="text-xs font-mono text-slate-500">
                                {rec.client_phone_raw}
                              </span>
                              {rec.customer_email && (
                                <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {rec.customer_email}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Closed: {rec.closed_at ? new Date(rec.closed_at).toLocaleDateString() : 'N/A'}
                            </span>
                          </div>

                          {rec.chronology && rec.chronology.length > 0 ? (
                            <div className="bg-slate-50 rounded-lg p-2 text-[11px] space-y-1 border border-slate-100">
                              <span className="font-bold text-slate-600 block text-[10px]">
                                Chronological Attempt &amp; SMS History ({rec.chronology.length} events):
                              </span>
                              {rec.chronology.map((entry, idx) => {
                                const isUncountedCall = entry.kind === 'CALL' && !entry.counted;
                                return (
                                  <div
                                    key={idx}
                                    className={`flex items-baseline gap-1.5 flex-wrap ${
                                      isUncountedCall ? 'text-slate-400' : 'text-slate-700'
                                    }`}
                                  >
                                    {entry.kind === 'SMS' ? (
                                      <span className="font-bold text-indigo-700 bg-indigo-50 px-1 py-0.2 rounded text-[10px]">
                                        SMS ({entry.status}):
                                      </span>
                                    ) : entry.kind === 'CALL' ? (
                                      entry.counted ? (
                                        <span className="font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded text-[10px]">
                                          Call ({entry.status}):
                                        </span>
                                      ) : (
                                        <span className="font-semibold text-slate-400 bg-slate-100 px-1 py-0.2 rounded text-[10px]">
                                          Call ({entry.status}) (not counted):
                                        </span>
                                      )
                                    ) : (
                                      <span className="font-bold text-slate-800 text-[10px]">
                                        Outcome ({entry.outcome}):
                                      </span>
                                    )}
                                    <span className={`italic ${isUncountedCall ? 'text-slate-400' : 'text-slate-600'}`}>
                                      {entry.kind === 'SMS' ? entry.note : entry.kind === 'OUTCOME' ? (entry.comment ? `"${entry.comment}"` : '(No comment)') : ''}
                                    </span>
                                    <span className="text-slate-400 text-[10px] ml-auto font-mono">
                                      {entry.logged_by}{entry.logged_by_phone ? ` (${entry.logged_by_phone})` : ''} • {new Date(entry.timestamp).toLocaleDateString()}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : rec.attempts.length > 0 ? (
                            <div className="bg-slate-50 rounded-lg p-2 text-[11px] space-y-1 border border-slate-100">
                              <span className="font-bold text-slate-600 block text-[10px]">
                                Attempt Trail ({rec.attempts.length} attempts):
                              </span>
                              {rec.attempts.map((att) => (
                                <div key={att.attempt_number} className="text-slate-700 flex items-baseline gap-1.5">
                                  <span className="font-bold text-slate-800">#{att.attempt_number} ({att.outcome}):</span>
                                  <span className="italic text-slate-600">&ldquo;{att.comment}&rdquo;</span>
                                  <span className="text-slate-400 text-[10px] ml-auto font-mono">
                                    {att.logged_by} • {new Date(att.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-400 italic">No notes recorded.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">
                Excel (.xlsx) contains full attempt details per vehicle for partner reconciliation.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsReportOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => handleExportMaxAttemptsReportToExcel()}
                  type="button"
                  disabled={visibleRecordCount === 0}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    visibleRecordCount === 0
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                      : 'bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{getDownloadButtonLabel()}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload latest pending scheduling list Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[88vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden my-auto">
            {/* Pinned Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 leading-tight">Upload latest pending scheduling list</h3>
                  <p className="text-xs text-slate-500">Excel (.xlsx) daily list from Brian</p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 space-y-4">
              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadSummary ? (
                <div className="flex flex-col items-center text-center py-4 gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                    <Check className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-950">Daily Export Successfully Processed</h4>
                    <p className="text-xs text-slate-600 mt-1">
                      <span className="font-bold text-emerald-700">{uploadSummary.new_records_count}</span> new vehicles queued •{' '}
                      <span className="font-bold text-emerald-700">{uploadSummary.skipped_open_count}</span> already open •{' '}
                      <span className="font-bold text-emerald-700">{uploadSummary.skipped_closed_count}</span> already completed
                      {uploadSummary.auto_closed_absent_count !== undefined && (
                        <> • <span className="font-bold text-emerald-700">{uploadSummary.auto_closed_absent_count}</span> absent closed</>
                      )}.
                    </p>
                  </div>
                </div>
              ) : pendingConfirmation ? (
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-rose-100 text-rose-700 flex-shrink-0">
                        <AlertCircle className="w-5 h-5 text-rose-600" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-rose-950">Safety Confirmation Required</h4>
                        <p className="text-xs text-rose-900 leading-relaxed">
                          This file would mark <strong className="font-bold text-rose-950">{pendingConfirmation.summary.wouldCloseCount} of {pendingConfirmation.summary.totalCurrentlyOpen}</strong> currently open vehicles ({pendingConfirmation.summary.wouldClosePercentage}%) as Scheduled.
                        </p>
                      </div>
                    </div>

                    {pendingConfirmation.summary.filenameWarning && (
                      <div className="p-3 bg-white/90 border border-rose-300 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block">File Date Warning:</span>
                          <span>{pendingConfirmation.summary.filenameWarning}</span>
                        </div>
                      </div>
                    )}

                    <div className="bg-white/80 p-3 rounded-xl border border-rose-200/70 text-xs text-slate-700 space-y-1">
                      <div className="font-bold text-slate-900">Import Progress:</div>
                      <div>• {pendingConfirmation.summary.new_records_count} new vehicles have been added to the callback queue</div>
                      <div>• {pendingConfirmation.summary.skipped_open_count} already open vehicles have had their timestamps refreshed</div>
                      <div>• {pendingConfirmation.summary.wouldCloseCount} vehicles absent from this sheet are pending closure as Scheduled</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Imported By (Staff Name)</label>
                    <input
                      type="text"
                      value={importedBy}
                      onChange={(e) => setImportedBy(e.target.value)}
                      placeholder="e.g. Caroline or Mercy"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Select .xlsx File</label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 hover:border-[#ff353e]/40 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-red-50/20"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-400 mx-auto flex items-center justify-center mb-2 shadow-2xs">
                        <Upload className="w-5 h-5 text-[#ff353e]" />
                      </div>
                      {uploadFile ? (
                        <div>
                          <span className="text-xs font-black text-slate-900 block">{uploadFile.name}</span>
                          <span className="text-[11px] text-slate-400 block mt-0.5">
                            {(uploadFile.size / 1024).toFixed(1)} KB • Click to replace file
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="text-xs font-bold text-slate-700 block">Click or drag Excel export here</span>
                          <span className="text-[11px] text-slate-400 block mt-0.5">Supports .xlsx or .xls</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-3 text-[11px] text-slate-500 space-y-1">
                    <span className="font-bold text-slate-700 block">Automatic Processing Rules:</span>
                    <p>• Duplicate registrations are deduplicated. Already closed jobs are preserved.</p>
                    <p>• Open jobs still in the sheet have their last seen timestamp refreshed.</p>
                    <p>• Open jobs absent from this latest export are automatically marked scheduled & closed (Green).</p>
                    <p>• New vehicles will be balanced equally across active callback staff.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Pinned Footer */}
            <div className="p-3 sm:px-5 sm:py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end gap-2.5 flex-shrink-0">
              {uploadSummary ? (
                <button
                  onClick={() => setIsUploadOpen(false)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  Done
                </button>
              ) : pendingConfirmation ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingConfirmation(null);
                      setUploadFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setIsUploadOpen(false);
                      fetchJobs();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/70 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={handleConfirmImport}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Processing Confirmation...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Yes, this is correct, proceed</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsUploadOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/70 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-confirm-import-upload"
                    disabled={!uploadFile || isUploading}
                    onClick={handleImportSubmit}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Parsing & Importing...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Import Callbacks</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[88vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden my-auto">
            {/* Pinned Modal Header (Always visible at top) */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center flex-shrink-0">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 leading-tight">Callback Team Settings</h3>
                  <p className="text-xs text-slate-500">Workload distribution & SLA thresholds</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 space-y-4">
              {settingsSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Callback team settings saved successfully!</span>
                </div>
              )}

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-bold text-slate-800">
                      Active Staff Count (Workload Balancing)
                    </label>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Auto-Assigned
                    </span>
                  </div>
                  <span className="font-mono font-bold text-xs text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                    {settings?.staff_count || 0} active staff
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Automatically determined by active agents with the tag &ldquo;{tempTeamTag}&rdquo;.
                </p>
                {settings?.active_agents && settings.active_agents.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70">
                    <span className="text-[10px] font-semibold text-slate-600">Assigned Agents:</span>
                    {settings.active_agents.map((agent) => (
                      <span
                        key={agent.id}
                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800 font-medium text-[10px]"
                      >
                        {agent.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-700 italic pt-1 border-t border-slate-200/70">
                    No agents currently have this tag. Tag agents as &ldquo;{tempTeamTag}&rdquo; to include them in workload balancing.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Callback Team Agent Tag</label>
                <input
                  type="text"
                  value={tempTeamTag}
                  onChange={(e) => setTempTeamTag(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                />
                <span className="text-[11px] text-slate-400 block mt-1">
                  Changing this tag recalculates the active staff count based on agents holding this tag.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Minimum outgoing calls
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tempMaxAttempts}
                    onChange={(e) => setTempMaxAttempts(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Minimum SMS
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tempMaxSmsAttempts}
                    onChange={(e) => setTempMaxSmsAttempts(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                  />
                </div>
              </div>
              <span className="text-[11px] text-slate-400 block -mt-1">
                A vehicle closes automatically as Max Attempts Reached only when it has at least this many outgoing calls AND at least this many SMS. Incoming and missed calls are not counted. Default is 4 and 4.
              </span>

              {/* Channel Partner Allocations Section */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#ff353e]" />
                    <span>Channel Partner Agent Allocations</span>
                  </label>
                  <span className="text-[10px] font-semibold text-slate-500">
                    Auto-assigned on import
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Map each underwriter or channel partner to a designated callback agent.
                </p>

                {loadingAllocations ? (
                  <div className="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#ff353e]" />
                    <span>Loading allocations...</span>
                  </div>
                ) : (!Array.isArray(partnerAllocations) || partnerAllocations.length === 0) ? (
                  <p className="text-[11px] text-slate-400 italic p-2 bg-slate-50 rounded-lg">
                    No channel partner allocations mapped yet.
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                    {(partnerAllocations || []).map((alloc) => (
                      <div
                        key={alloc.channel_partner}
                        className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs"
                      >
                        <span className="font-bold text-slate-800 text-[11px] pr-2 truncate">
                          {alloc.channel_partner}
                        </span>
                        <select
                          value={alloc.assigned_agent_id ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            handleUpdateAllocation(alloc.channel_partner, val);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none cursor-pointer shrink-0"
                        >
                          <option value="">Unassigned</option>
                          {callbackAgents
                            .filter((a) => a.id !== undefined)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <DataResetPanel section="callbacks" onChanged={() => fetchJobs()} />
            </div>

            {/* Pinned Modal Footer (Always visible at bottom) */}
            <div className="p-3 sm:px-5 sm:py-3.5 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 flex-shrink-0">
              <div className="flex flex-col gap-1">
                {isAdmin && (
                  <button
                    type="button"
                    id="btn-download-one-time-reopen-report"
                    onClick={handleDownloadReopenReport}
                    disabled={isDownloadingReopenReport}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs w-fit"
                    title="Download one-time reopen report (.xlsx)"
                  >
                    {isDownloadingReopenReport ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-500" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>Download one-time reopen report</span>
                  </button>
                )}
                {reopenReportMsg && (
                  <span
                    className={
                      reopenReportMsg.type === 'error'
                        ? 'text-[11px] text-rose-600 font-medium'
                        : 'text-[11px] text-emerald-600 font-medium'
                    }
                  >
                    {reopenReportMsg.text}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-end gap-2.5">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/70 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-save-callback-settings"
                  disabled={isSavingSettings}
                  onClick={handleSaveSettings}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingSettings ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Settings</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Callback Overview Drilldown Modal */}
      {drilldownModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    drilldownModalType === 'AMBER'
                      ? 'bg-amber-100 text-amber-700'
                      : drilldownModalType === 'GREEN'
                      ? 'bg-emerald-100 text-emerald-700'
                      : drilldownModalType === 'RED'
                      ? 'bg-rose-100 text-rose-700'
                      : drilldownModalType === 'MAX_ATTEMPTS'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {drilldownModalType === 'AMBER' && <Clock className="w-5 h-5" />}
                  {drilldownModalType === 'GREEN' && <CheckCircle2 className="w-5 h-5" />}
                  {drilldownModalType === 'RED' && <AlertCircle className="w-5 h-5" />}
                  {drilldownModalType === 'MAX_ATTEMPTS' && <OctagonAlert className="w-5 h-5" />}
                  {drilldownModalType === 'TOTAL' && <Car className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                      {drilldownModalType === 'TOTAL' &&
                        (selectedAgent !== 'ALL' ? `${selectedAgent}'s Vehicles` : 'Total Vehicles')}
                      {drilldownModalType === 'AMBER' && 'Open / Amber Vehicles'}
                      {drilldownModalType === 'GREEN' && 'Closed / Green Vehicles'}
                      {drilldownModalType === 'RED' && 'Closed / Red Vehicles'}
                      {drilldownModalType === 'MAX_ATTEMPTS' && 'Max Attempts Hit Vehicles'}
                    </h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                      {filteredDrilldownJobs.length} {filteredDrilldownJobs.length === 1 ? 'record' : 'records'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedAgent !== 'ALL'
                      ? `Filtered by agent: ${selectedAgent}`
                      : 'Team-wide callback overview'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-download-drilldown-excel"
                  onClick={() => handleExportDrilldownToExcel()}
                  disabled={filteredDrilldownJobs.length === 0}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                  title="Export these filtered callback records to Excel (.xlsx)"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download Excel</span>
                  <span className="sm:hidden">Excel</span>
                </button>
                <button
                  onClick={() => setDrilldownModalType(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filter Search Bar */}
            <div className="p-3 sm:px-5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter within list (registration, client, phone, partner, agent)..."
                  value={drilldownSearchTerm}
                  onChange={(e) => setDrilldownSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#ff353e]"
                />
              </div>
              {drilldownSearchTerm && (
                <button
                  onClick={() => setDrilldownSearchTerm('')}
                  className="text-xs text-slate-500 hover:text-slate-700 font-semibold px-2 py-1 hover:bg-slate-200 rounded cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Records List Table */}
            <div className="flex-1 overflow-y-auto min-h-0 p-3 sm:p-5">
              {loadingDrilldown ? (
                <div className="py-16 text-center space-y-3">
                  <RefreshCw className="w-6 h-6 text-[#ff353e] animate-spin mx-auto" />
                  <p className="text-xs font-bold text-slate-500">Loading records...</p>
                </div>
              ) : filteredDrilldownJobs.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-700">No records found</p>
                  <p className="text-xs text-slate-400">There are no records matching this overview category.</p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">Vehicle Reg</th>
                          <th className="py-2.5 px-3">Client Name</th>
                          <th className="py-2.5 px-3">Phone</th>
                          <th className="py-2.5 px-3">Channel Partner</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-center">Attempts</th>
                          <th className="py-2.5 px-3">Assigned Agent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredDrilldownJobs.map((j) => (
                          <tr key={j.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                              {j.vehicle_reg_raw || j.vehicle_reg}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-800">
                              {j.client_name || '-'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                              {j.client_phone_raw || j.client_phone}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-700">
                              {j.channel_partner || 'Unassigned'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                  j.status === 'GREEN'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : j.status === 'RED'
                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                    : 'bg-amber-100 text-amber-800 border-amber-300'
                                }`}
                              >
                                {j.status === 'AMBER'
                                  ? 'Open (Amber)'
                                  : j.status === 'GREEN'
                                  ? 'Closed (Green)'
                                  : 'Closed (Red)'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700">
                              {j.attempt_count ?? 0}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800 whitespace-nowrap">
                              {j.assigned_agent_name ? (
                                <span className="inline-flex items-center gap-1 text-slate-800">
                                  <User className="w-3 h-3 text-slate-400" />
                                  <span>{j.assigned_agent_name}</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Unassigned</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:px-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {filteredDrilldownJobs.length} of {drilldownJobs.length} records
              </span>
              <button
                onClick={() => setDrilldownModalType(null)}
                className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-time Onboarding Tour */}
      <OnboardingTour
        isOpen={isOnboardingOpen}
        onClose={handleCloseOnboardingTour}
      />

      {/* Agent Review Modal */}
      <AgentReviewModal
        isOpen={isReviewAgentsOpen}
        onClose={() => setIsReviewAgentsOpen(false)}
        onUpdated={() => {
          fetchReviewAndUnmatchedCounts();
          fetchJobs();
        }}
        allAgents={allAgents}
      />

      {/* Unmatched Activity Modal */}
      <UnmatchedActivityModal
        isOpen={isUnmatchedActivityOpen}
        onClose={() => setIsUnmatchedActivityOpen(false)}
        onOpenAgentReview={() => setIsReviewAgentsOpen(true)}
        onDataChanged={() => {
          fetchReviewAndUnmatchedCounts();
          fetchJobs();
        }}
      />
    </div>
  );
};
