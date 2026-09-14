import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  HelpCircle
} from 'lucide-react';
import {
  CallbackJob,
  CallbackJobStatus,
  CallbackSettings,
  CallbackImportSummary,
  CallbackImportRow,
  CallbackJobLog,
  MaxAttemptsReportGroup,
} from '../types/callbacks';
import { CallSessionView } from './CallSessionView';
import { OnboardingTour } from './OnboardingTour';

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
    setIsUploadOpen(true);
  };

  // Inline settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempStaffCount, setTempStaffCount] = useState(2);
  const [tempTeamTag, setTempTeamTag] = useState('Callback Team');
  const [tempMaxAttempts, setTempMaxAttempts] = useState(4);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

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

  // Quick clipboard state
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    fetchSettings();
    fetchJobs();
  }, []);

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
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
      setLoading(false);
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
    if (!outcomeComment.trim()) {
      setOutcomeError('Callback notes / comment are required for every attempt.');
      return;
    }

    setIsSubmittingOutcome(true);
    setOutcomeError(null);

    try {
      const res = await fetch(`/api/callback-jobs/${outcomeJob.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: selectedOutcome,
          comment: outcomeComment.trim(),
          logged_by: outcomeLoggedBy.trim() || 'Agent',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to log outcome.');
      }

      const updated: CallbackJob = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)));
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
          const clientName = formatVal(nameIdx);
          const channelPartner = formatVal(partnerIdx);
          const initiatedDate = formatVal(dateIdx);
          const reason = formatVal(reasonIdx);

          if (vehicleReg || clientPhone) {
            mappedRows.push({
              vehicle_reg: vehicleReg,
              client_name: clientName || undefined,
              client_phone: clientPhone,
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
          const clientName = getVal(nameAliases);
          const channelPartner = getVal(partnerAliases);
          const initiatedDate = getVal(dateAliases);
          const reason = getVal(reasonAliases);

          if (vehicleReg || clientPhone) {
            mappedRows.push({
              vehicle_reg: vehicleReg,
              client_name: clientName || undefined,
              client_phone: clientPhone,
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
    return jobs.filter(
      (j) =>
        j.latest_outcome === 'MAX_ATTEMPTS_REACHED' ||
        (j.attempt_count >= (j.max_attempts || 4) && j.status === 'RED')
    ).length;
  }, [jobs]);

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
        if (j.attempt_count >= maxAtt) needsAction++;
      } else if (j.status === 'GREEN') {
        green++;
      } else if (j.status === 'RED') {
        red++;
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
                Daily callbacks for pending vehicle valuations. Outcome logging is required per contact attempt: records go Green only when scheduled, stay Amber with notes, and automatically close Red when max attempts are reached.
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
            <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {selectedAgent !== 'ALL' ? `${selectedAgent}'s Vehicles` : 'Total Vehicles'}
              </span>
              <span className="text-2xl font-black text-slate-900 mt-0.5 block">{stats.total}</span>
            </div>
            <div className="bg-amber-50/70 rounded-xl p-3 border border-amber-100/80">
              <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">Open / Amber</span>
              <span className="text-2xl font-black text-amber-700 mt-0.5 block">{stats.amber}</span>
            </div>
            <div className="bg-emerald-50/70 rounded-xl p-3 border border-emerald-100/80">
              <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Closed / Green</span>
              <span className="text-2xl font-black text-emerald-700 mt-0.5 block">{stats.green}</span>
            </div>
            <div className="bg-rose-50/70 rounded-xl p-3 border border-rose-100/80">
              <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">Closed / Red</span>
              <span className="text-2xl font-black text-rose-700 mt-0.5 block">{stats.red}</span>
            </div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-1 bg-red-50/50 rounded-xl p-3 border border-red-100">
              <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block flex items-center gap-1">
                <OctagonAlert className="w-3.5 h-3.5" />
                <span>Max Attempts Hit</span>
              </span>
              <span className="text-2xl font-black text-red-700 mt-0.5 block">{stats.needsAction}</span>
            </div>
          </div>
        </div>
      </div>

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

                                {/* Bigger phone number display */}
                                <div className="flex items-center gap-2 mt-1">
                                  <a
                                    href={`tel:${clientData.client_phone_raw}`}
                                    className="text-base sm:text-lg font-black font-mono tracking-wide text-slate-900 hover:text-[#ff353e] flex items-center gap-1.5 transition-colors bg-slate-100 hover:bg-red-50 px-2.5 py-1 rounded-lg border border-slate-200/80"
                                    title="Click to place call"
                                  >
                                    <Phone className="w-4 h-4 text-[#ff353e]" />
                                    <span>{clientData.client_phone_raw}</span>
                                  </a>
                                  <button
                                    onClick={() => copyToClipboard(clientData.client_phone_raw)}
                                    className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 border border-slate-200/60 transition-colors"
                                    title="Copy phone number"
                                  >
                                    {copiedPhone === clientData.client_phone_raw ? (
                                      <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                        <Check className="w-3.5 h-3.5" /> Copied!
                                      </span>
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
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
                              const isMaxReached =
                                vehicle.attempt_count >= (vehicle.max_attempts || 4) &&
                                vehicle.status === 'AMBER';

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
                                        vehicle.attempt_count >= (vehicle.max_attempts || 4)
                                          ? 'bg-red-50 text-red-700 border border-red-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200/60'
                                      }`}
                                      title={`Contact attempts by callback team: ${vehicle.attempt_count} / ${vehicle.max_attempts || 4}`}
                                    >
                                      <Phone className="w-3 h-3 text-slate-500" />
                                      <span>
                                        {vehicle.attempt_count} / {vehicle.max_attempts || 4} calls
                                      </span>
                                    </div>

                                    {/* SMS Count Indicator */}
                                    <div
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                                        vehicle.sms_count > 0
                                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                          : 'bg-slate-50 text-slate-400 border border-slate-100'
                                      }`}
                                      title={`SMS messages sent to this client: ${vehicle.sms_count}`}
                                    >
                                      <MessageSquare className="w-3 h-3 text-blue-500" />
                                      <span>
                                        {vehicle.sms_count} {vehicle.sms_count === 1 ? 'SMS' : 'SMSs'}
                                      </span>
                                    </div>

                                    {/* Assigned Agent Pill */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (vehicle.assigned_agent_name) {
                                          setSelectedAgent(
                                            selectedAgent.toLowerCase() === vehicle.assigned_agent_name.toLowerCase()
                                              ? 'ALL'
                                              : vehicle.assigned_agent_name
                                          );
                                        }
                                      }}
                                      title={
                                        vehicle.assigned_agent_name
                                          ? `Filter callbacks for ${vehicle.assigned_agent_name}`
                                          : 'Unassigned'
                                      }
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                                        vehicle.assigned_agent_name &&
                                        selectedAgent.toLowerCase() === vehicle.assigned_agent_name.toLowerCase()
                                          ? 'bg-red-50 text-[#ff353e] border border-red-200 font-bold'
                                          : 'bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-700 font-semibold'
                                      }`}
                                    >
                                      <User className="w-3 h-3 text-slate-400" />
                                      <span>{vehicle.assigned_agent_name || 'Unassigned'}</span>
                                    </button>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 leading-tight">Log Call Outcome & Notes</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Vehicle: <span className="font-mono font-bold text-slate-800">{outcomeJob.vehicle_reg_raw}</span> • {outcomeJob.client_phone_raw}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOutcomeJob(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmitOutcome} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
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
                      Callback Notes & Summary <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={outcomeComment}
                      onChange={(e) => setOutcomeComment(e.target.value)}
                      placeholder="Notes (e.g. callback requested tomorrow 2pm)..."
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
                  disabled={isSubmittingOutcome || !outcomeComment.trim()}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Attempt History & Notes</h3>
                  <p className="text-xs text-slate-500">
                    Vehicle: <span className="font-mono font-bold text-slate-800">{historyJob.vehicle_reg_raw}</span> • {historyJob.client_name || 'Client'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistoryJob(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
              <div className="max-h-80 overflow-y-auto space-y-2.5 pr-1">
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

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setHistoryJob(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Max Attempts Reached Report Modal */}
      {isReportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-100 space-y-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Max Attempts Reached — Channel Partner Report
                  </h3>
                  <p className="text-xs text-slate-500">
                    Vehicles closed Red due to hitting maximum contact attempts without booking
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsReportOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
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
              ) : reportData.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
                  No records currently closed under &ldquo;Max Attempts Reached&rdquo;.
                </div>
              ) : (
                reportData.map((group) => (
                  <div key={group.channel_partner} className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#ff353e]" />
                        <h4 className="text-xs font-black text-slate-900 uppercase">
                          {group.channel_partner}
                        </h4>
                      </div>
                      <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">
                        {group.records.length} {group.records.length === 1 ? 'record' : 'records'}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {group.records.map((rec) => (
                        <div key={rec.vehicle_reg_raw} className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white font-mono font-bold text-xs">
                                {rec.vehicle_reg_raw}
                              </span>
                              <span className="text-xs font-bold text-slate-800">
                                {rec.client_name || 'Client'}
                              </span>
                              <span className="text-xs font-mono text-slate-500">
                                {rec.client_phone_raw}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Closed: {rec.closed_at ? new Date(rec.closed_at).toLocaleDateString() : 'N/A'}
                            </span>
                          </div>

                          {rec.attempts.length > 0 ? (
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
                CSV contains full attempt details per vehicle for partner reconciliation.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsReportOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
                <a
                  href="/api/callback-jobs/max-attempts-report/csv"
                  download
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV Report</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload latest pending scheduling list Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Upload latest pending scheduling list</h3>
                  <p className="text-xs text-slate-500">Excel (.xlsx) daily list from Brian</p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
                    <span className="font-bold text-emerald-700">{uploadSummary.skipped_closed_count}</span> already completed.
                  </p>
                </div>
                <button
                  onClick={() => setIsUploadOpen(false)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
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

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setIsUploadOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
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
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Team Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Callback Team Settings</h3>
                  <p className="text-xs text-slate-500">Workload distribution & SLA thresholds</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {settingsSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Callback team settings saved successfully!</span>
              </div>
            )}

            <div className="space-y-4">
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

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Max Call Attempts Threshold</label>
                <input
                  type="number"
                  min="1"
                  max="15"
                  value={tempMaxAttempts}
                  onChange={(e) => setTempMaxAttempts(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]"
                />
                <span className="text-[11px] text-slate-400 block mt-1">
                  When reached without scheduling, the vehicle automatically transitions to Red with the outcome &ldquo;MAX_ATTEMPTS_REACHED&rdquo;.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
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
      )}

      {/* First-time Onboarding Tour */}
      <OnboardingTour
        isOpen={isOnboardingOpen}
        onClose={handleCloseOnboardingTour}
      />
    </div>
  );
};
