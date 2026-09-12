import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone,
  PhoneCall,
  Car,
  CheckCircle2,
  Clock,
  AlertCircle,
  OctagonAlert,
  ArrowRight,
  X,
  RefreshCw,
  User,
  Copy,
  Check,
  Sparkles,
  Building2,
  Calendar,
  MessageSquare,
  History,
  ChevronDown,
} from 'lucide-react';
import { CallbackJob, CallbackSettings, CallbackJobLog } from '../types/callbacks';

export interface CallSessionClientGroup {
  client_phone: string;
  client_phone_raw: string;
  client_name: string | null;
  channel_partners: string[];
  vehicles: CallbackJob[];
  earliestDate: number;
}

interface OutcomeOption {
  value: string;
  label: string;
  description: string;
  resultingStatus: 'GREEN' | 'AMBER' | 'RED';
}

const SESSION_OUTCOME_OPTIONS: OutcomeOption[] = [
  {
    value: 'SCHEDULED',
    label: 'Job Scheduled',
    description: 'Goes Green · Appointment booked',
    resultingStatus: 'GREEN',
  },
  {
    value: 'NOT_PICKING',
    label: 'Not Picking / No Answer',
    description: 'Stays Amber · Retry later',
    resultingStatus: 'AMBER',
  },
  {
    value: 'NOT_READY',
    label: 'Not Ready to Book',
    description: 'Stays Amber · Callback requested',
    resultingStatus: 'AMBER',
  },
  {
    value: 'UNREACHABLE',
    label: 'Unreachable / Busy',
    description: 'Stays Amber · Busy / out of range',
    resultingStatus: 'AMBER',
  },
  {
    value: 'WRONG_NUMBER',
    label: 'Wrong Number',
    description: 'Stays Amber · Number incorrect',
    resultingStatus: 'AMBER',
  },
  {
    value: 'DECLINED',
    label: 'Customer Rejected / Declined',
    description: 'Goes Red · Refused inspection',
    resultingStatus: 'RED',
  },
  {
    value: 'VALUED_ELSEWHERE',
    label: 'Done / Valued Elsewhere',
    description: 'Goes Red · Already valued',
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

function parseInitiatedDate(dateStr?: string | null): number {
  if (!dateStr || !String(dateStr).trim()) return Infinity;
  const s = String(dateStr).trim();
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return parsed;

  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3 && parts[2].length === 4) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    const testDate = new Date(y, m, d).getTime();
    if (!isNaN(testDate)) return testDate;
  }
  return Infinity;
}

function getGroupEarliestDate(vehicles: CallbackJob[]): number {
  let min = Infinity;
  for (const v of vehicles) {
    let t = parseInitiatedDate(v.initiated_date);
    if (t === Infinity && v.created_at) {
      t = parseInitiatedDate(v.created_at);
    }
    if (t < min) min = t;
  }
  return min;
}

export interface CallSessionViewProps {
  selectedAgent: string;
  settings: CallbackSettings | null;
  callbackAgents: { id?: number; name: string }[];
  onClose: () => void;
  onJobUpdated?: (updatedJob: CallbackJob) => void;
}

export const CallSessionView: React.FC<CallSessionViewProps> = ({
  selectedAgent,
  settings,
  callbackAgents,
  onClose,
  onJobUpdated,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Queue state
  const [queue, setQueue] = useState<CallSessionClientGroup[]>([]);
  const [initialTotal, setInitialTotal] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);

  // Form state for current client's vehicles: jobId -> { outcome, comment }
  const [vehicleForm, setVehicleForm] = useState<
    Record<number, { outcome: string; comment: string }>
  >({});
  const [saving, setSaving] = useState<boolean>(false);

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

  // Helper to build and sort client groups
  const buildClientQueue = (jobs: CallbackJob[]): CallSessionClientGroup[] => {
    const clientMap = new Map<string, CallSessionClientGroup>();

    jobs.forEach((job) => {
      // Must be open AMBER
      if (job.status !== 'AMBER') return;

      const phoneKey = job.client_phone;
      if (!clientMap.has(phoneKey)) {
        clientMap.set(phoneKey, {
          client_phone: job.client_phone,
          client_phone_raw: job.client_phone_raw,
          client_name: job.client_name,
          channel_partners: [],
          vehicles: [],
          earliestDate: Infinity,
        });
      }
      const group = clientMap.get(phoneKey)!;
      if (job.channel_partner && !group.channel_partners.includes(job.channel_partner)) {
        group.channel_partners.push(job.channel_partner);
      }
      group.vehicles.push(job);
    });

    const groups = Array.from(clientMap.values()).map((g) => {
      g.earliestDate = getGroupEarliestDate(g.vehicles);
      return g;
    });

    // Sort by earliest initiated_date, oldest first
    groups.sort((a, b) => a.earliestDate - b.earliestDate);
    return groups;
  };

  // Initialize form for a given client
  const initializeClientForm = (clientGroup: CallSessionClientGroup | undefined) => {
    if (!clientGroup) {
      setVehicleForm({});
      return;
    }
    const newForm: Record<number, { outcome: string; comment: string }> = {};
    clientGroup.vehicles.forEach((v) => {
      newForm[v.id] = { outcome: '', comment: '' };
    });
    setVehicleForm(newForm);
  };

  // Fetch queue from backend
  const fetchCallingQueue = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const targetAgent = callbackAgents.find(
        (a) =>
          a.name.toLowerCase() === selectedAgent.toLowerCase() ||
          (a.id !== undefined && String(a.id) === selectedAgent)
      );
      const agentQueryVal =
        targetAgent?.id !== undefined ? String(targetAgent.id) : selectedAgent;

      const res = await fetch(
        `/api/callback-jobs?assigned_agent_id=${encodeURIComponent(agentQueryVal)}&status=AMBER`
      );

      if (!res.ok) {
        throw new Error(`Failed to load queue (${res.status})`);
      }

      const rawJobs: CallbackJob[] = await res.json();

      // Ensure only this selected agent's open vehicles are queued
      const filteredForAgent = rawJobs.filter((j) => {
        if (j.status !== 'AMBER') return false;
        if (selectedAgent === '__unassigned__') {
          return !j.assigned_agent_name && !j.assigned_agent_id;
        }
        const matchName =
          j.assigned_agent_name &&
          j.assigned_agent_name.toLowerCase() === selectedAgent.toLowerCase();
        const matchId =
          targetAgent?.id !== undefined && j.assigned_agent_id === targetAgent.id;
        return matchName || matchId;
      });

      const groups = buildClientQueue(filteredForAgent);
      setQueue(groups);

      if (!isManualRefresh) {
        setInitialTotal(groups.length);
        setCompletedCount(0);
      } else {
        setInitialTotal(completedCount + groups.length);
      }

      if (groups.length > 0) {
        initializeClientForm(groups[0]);
      } else {
        setVehicleForm({});
      }
    } catch (err: any) {
      console.error('Error loading calling session queue:', err);
      setError(err.message || 'Failed to load calling queue.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCallingQueue(false);
  }, [selectedAgent]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(text);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const currentClient = queue[0];

  // Validate that every vehicle on screen has an outcome selected and non-empty comment
  const isFormValid = useMemo(() => {
    if (!currentClient || currentClient.vehicles.length === 0) return false;
    return currentClient.vehicles.every((v) => {
      const data = vehicleForm[v.id];
      return (
        Boolean(data?.outcome && data.outcome.trim() !== '') &&
        Boolean(data?.comment && data.comment.trim().length > 0)
      );
    });
  }, [currentClient, vehicleForm]);

  // Handle outcome change for a vehicle
  const handleOutcomeChange = (jobId: number, outcome: string) => {
    setVehicleForm((prev) => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || { comment: '' }),
        outcome,
      },
    }));
  };

  // Handle comment change for a vehicle
  const handleCommentChange = (jobId: number, comment: string) => {
    setVehicleForm((prev) => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || { outcome: '' }),
        comment,
      },
    }));
  };

  // Save & Next Client
  const handleSaveAndNext = async () => {
    if (!currentClient || !isFormValid || saving) return;
    setSaving(true);
    setError(null);

    try {
      const loggedBy =
        selectedAgent !== 'ALL' && selectedAgent !== '__unassigned__'
          ? selectedAgent
          : 'Agent';

      // Submit one POST /api/callback-jobs/:id/log per vehicle
      const promises = currentClient.vehicles.map(async (v) => {
        const formData = vehicleForm[v.id];
        const res = await fetch(`/api/callback-jobs/${v.id}/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: formData.outcome,
            comment: formData.comment.trim(),
            logged_by: loggedBy,
          }),
        });

        if (!res.ok) {
          let errDetail = 'Request failed';
          try {
            const errJson = await res.json();
            if (errJson.error) errDetail = errJson.error;
          } catch (_) {
            errDetail = await res.text();
          }
          throw new Error(`Failed to log ${v.vehicle_reg_raw}: ${errDetail}`);
        }

        const updated = await res.json();
        if (onJobUpdated) onJobUpdated(updated);
        return updated;
      });

      await Promise.all(promises);

      // Advance queue
      const nextQueue = queue.slice(1);
      setQueue(nextQueue);
      setCompletedCount((prev) => prev + 1);

      if (nextQueue.length > 0) {
        initializeClientForm(nextQueue[0]);
      } else {
        setVehicleForm({});
      }
    } catch (err: any) {
      console.error('Error saving callback outcomes:', err);
      setError(err.message || 'Failed to save outcomes. Please check entries and retry.');
    } finally {
      setSaving(false);
    }
  };

  // Progress calculations
  const currentClientNumber = completedCount + 1;
  const displayTotal = Math.max(initialTotal, completedCount + queue.length);
  const progressPercent =
    displayTotal > 0 ? Math.min(100, Math.round((completedCount / displayTotal) * 100)) : 0;

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-12 border border-slate-200/80 shadow-sm flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-[#ff353e] flex items-center justify-center animate-pulse">
          <PhoneCall className="w-6 h-6 animate-bounce" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">Preparing Focused Call Queue</h3>
          <p className="text-xs text-slate-500 mt-1">
            Loading open callbacks for <span className="font-bold text-slate-800">{selectedAgent}</span>, sorted by oldest initiated date...
          </p>
        </div>
      </div>
    );
  }

  // All Done Screen
  if (queue.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-200/80 shadow-sm space-y-6">
        <div className="max-w-md mx-auto text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-full border border-emerald-200">
              Queue Complete
            </span>
            <h2 className="text-2xl font-black text-slate-900 mt-2">All Done!</h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              No open AMBER callback vehicles remaining in{' '}
              <span className="font-bold text-slate-900">{selectedAgent}</span>'s queue.
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-center justify-around">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Clients Handled
              </span>
              <span className="text-xl font-black text-slate-900">{completedCount}</span>
            </div>
            <div className="w-px h-8 bg-slate-200" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Remaining Open
              </span>
              <span className="text-xl font-black text-emerald-600">0</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              id="btn-close-call-session-done"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Close Session & Return to List</span>
            </button>
            <button
              id="btn-refresh-queue-done"
              onClick={() => fetchCallingQueue(true)}
              disabled={refreshing}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Check for New Assignments</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Session Top Bar: Progress, Agent Scope, Controls */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black text-slate-900 leading-tight">
                  One-at-a-Time Call Session
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-50 text-[#ff353e] border border-red-100">
                  {selectedAgent}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Focused queue • Sorted by earliest initiated date • Logs saved directly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-refresh-session-queue"
              onClick={() => fetchCallingQueue(true)}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Refresh queue in case new jobs were imported or reassigned"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin text-[#ff353e]' : ''}`} />
              <span className="hidden sm:inline">Refresh Queue</span>
            </button>

            <button
              id="btn-close-call-session"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-200/60"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              <span>Close Session</span>
            </button>
          </div>
        </div>

        {/* Progress bar and counter */}
        <div className="pt-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-black text-slate-800 tracking-tight">
              Client {currentClientNumber} of {displayTotal}
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              {queue.length} client{queue.length === 1 ? '' : 's'} remaining in queue
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-[#ff353e] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Current Client Calling Screen */}
      {currentClient && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
          {/* Client Header Card */}
          <div className="p-4 sm:p-6 bg-slate-50/70 border-b border-slate-200/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-[#ff353e] flex items-center justify-center font-bold text-base flex-shrink-0 mt-0.5 sm:mt-0">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-black text-slate-900 uppercase tracking-wide">
                      {currentClient.client_name || 'Valuation Client'}
                    </h3>
                    {currentClient.channel_partners.map((partner) => (
                      <span
                        key={partner}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center gap-1 shadow-2xs"
                      >
                        <Building2 className="w-3 h-3 text-slate-400" />
                        {partner}
                      </span>
                    ))}
                  </div>

                  {/* Enlarged Phone Number with tel: link and copy button */}
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      id="link-call-client-phone"
                      href={`tel:${currentClient.client_phone_raw}`}
                      className="text-lg sm:text-xl font-black font-mono tracking-wide text-slate-900 hover:text-[#ff353e] flex items-center gap-2 transition-colors bg-white hover:bg-red-50 px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs"
                      title="Click to dial client phone number"
                    >
                      <Phone className="w-4 h-4 text-[#ff353e]" />
                      <span>{currentClient.client_phone_raw}</span>
                    </a>
                    <button
                      id="btn-copy-client-phone"
                      onClick={() => copyToClipboard(currentClient.client_phone_raw)}
                      className="text-slate-400 hover:text-slate-700 p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                      title="Copy phone number"
                    >
                      {copiedPhone === currentClient.client_phone_raw ? (
                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                          <Check className="w-4 h-4" /> Copied!
                        </span>
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                <span className="text-xs font-bold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                  {currentClient.vehicles.length}{' '}
                  {currentClient.vehicles.length === 1 ? 'Open Vehicle' : 'Open Vehicles'} for this client
                </span>
              </div>
            </div>
          </div>

          {/* Vehicle Cards Container */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider">
                Vehicles Requiring Callback Outcome ({currentClient.vehicles.length})
              </span>
              <span className="text-[11px] text-slate-400">
                All vehicles below must be logged before advancing
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {currentClient.vehicles.map((vehicle, idx) => {
                const formData = vehicleForm[vehicle.id] || { outcome: '', comment: '' };
                const maxAtt = vehicle.max_attempts || settings?.max_attempts || 4;
                const attempts = vehicle.attempt_count || 0;
                const selectedOpt = SESSION_OUTCOME_OPTIONS.find(
                  (o) => o.value === formData.outcome
                );

                return (
                  <div
                    key={vehicle.id}
                    id={`vehicle-card-${vehicle.id}`}
                    className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3.5 hover:border-slate-300 transition-colors"
                  >
                    {/* Vehicle Metadata Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-black flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Car className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-black font-mono text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                            {vehicle.vehicle_reg_raw}
                          </span>
                        </div>

                        {vehicle.channel_partner && (
                          <span className="text-[11px] font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200/60">
                            {vehicle.channel_partner}
                          </span>
                        )}

                        {vehicle.initiated_date && (
                          <span className="text-[11px] text-slate-500 flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            Initiated: {vehicle.initiated_date}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        {/* Attempts X / Max */}
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1 ${
                            attempts >= maxAtt
                              ? 'bg-red-50 text-red-700 border-red-200 font-black'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          <span>
                            {attempts} / {maxAtt} calls
                          </span>
                        </span>

                        {/* SMS Count */}
                        <span className="text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-slate-400" />
                          <span>{vehicle.sms_count || 0} SMS</span>
                        </span>
                      </div>
                    </div>

                    {vehicle.brian_reason && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl text-xs text-slate-600">
                        <span className="font-bold text-slate-700">Client/Inspection Note: </span>
                        {vehicle.brian_reason}
                      </div>
                    )}

                    {/* Expanded Prior Attempt History */}
                    {expandedHistoryJobIds.has(vehicle.id) && (
                      <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
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
                          <div className="py-3 text-center text-xs text-slate-500 flex items-center justify-center gap-2 bg-white rounded-lg border border-slate-200/60">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#ff353e]" />
                            <span>Loading attempt history...</span>
                          </div>
                        ) : (historyCache[vehicle.id] || []).length === 0 ? (
                          <div className="py-2.5 px-3 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200/60">
                            No prior attempts or notes logged for this vehicle.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {historyCache[vehicle.id].map((log, logIdx) => (
                              <div
                                key={log.id || logIdx}
                                className="p-2.5 bg-white rounded-lg border border-slate-200/80 text-xs space-y-1 shadow-2xs"
                              >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
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
                                  <p className="text-xs text-slate-700 italic bg-slate-50 p-2 rounded border border-slate-100">
                                    &ldquo;{log.comment}&rdquo;
                                  </p>
                                )}

                                <div className="text-[10px] text-slate-500 flex items-center justify-between pt-0.5">
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

                    {/* Outcome Dropdown & Resulting Status */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                      <div className="sm:col-span-6">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-bold text-slate-700">
                            Call Outcome <span className="text-red-500">*</span>
                          </label>
                          <button
                            type="button"
                            id={`btn-toggle-session-history-${vehicle.id}`}
                            onClick={() => toggleHistory(vehicle.id)}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
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
                        </div>
                        <select
                          id={`select-outcome-${vehicle.id}`}
                          value={formData.outcome}
                          onChange={(e) => handleOutcomeChange(vehicle.id, e.target.value)}
                          className={`w-full px-3 py-2 bg-slate-50 border rounded-xl text-xs font-semibold text-slate-800 outline-none transition-all cursor-pointer ${
                            formData.outcome
                              ? 'border-slate-300 focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]'
                              : 'border-amber-300 bg-amber-50/40 text-slate-700 focus:ring-2 focus:ring-amber-400/20'
                          }`}
                        >
                          <option value="">-- Select Call Outcome (Required) --</option>
                          {SESSION_OUTCOME_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label} ({opt.resultingStatus === 'GREEN' ? 'Goes Green' : opt.resultingStatus === 'RED' ? 'Goes Red' : 'Stays Amber'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-6 flex flex-col justify-end">
                        <div className="h-9 flex items-center">
                          {selectedOpt ? (
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[11px] px-2.5 py-1 rounded-lg font-black border flex items-center gap-1.5 ${
                                  selectedOpt.resultingStatus === 'GREEN'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : selectedOpt.resultingStatus === 'RED'
                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                    : 'bg-amber-100 text-amber-800 border-amber-300'
                                }`}
                              >
                                {selectedOpt.resultingStatus === 'GREEN' ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                ) : selectedOpt.resultingStatus === 'RED' ? (
                                  <OctagonAlert className="w-3.5 h-3.5 text-rose-600" />
                                ) : (
                                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                                )}
                                <span>{selectedOpt.description}</span>
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Select an outcome to update vehicle status
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Required Comment Field */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-slate-700">
                          Callback Notes & Summary <span className="text-red-500">*</span>
                        </label>
                        {formData.comment.trim().length === 0 && (
                          <span className="text-[10px] text-amber-600 font-semibold">
                            Notes required
                          </span>
                        )}
                      </div>
                      <textarea
                        id={`textarea-comment-${vehicle.id}`}
                        rows={2}
                        value={formData.comment}
                        onChange={(e) => handleCommentChange(vehicle.id, e.target.value)}
                        placeholder={`e.g. Spoke with customer regarding ${vehicle.vehicle_reg_raw}; appointment scheduled / callback requested tomorrow at 10am...`}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] resize-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pinned Bottom Action Bar: Save & Next Button */}
          <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs">
              {!isFormValid ? (
                <div className="flex items-center gap-1.5 text-amber-700 font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span>
                    Log an outcome and notes for all{' '}
                    <span className="font-bold text-amber-900">{currentClient.vehicles.length}</span>{' '}
                    vehicle{currentClient.vehicles.length === 1 ? '' : 's'} to enable Save & Next.
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>All vehicle outcomes and notes ready to save.</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="btn-save-and-next"
                onClick={handleSaveAndNext}
                disabled={!isFormValid || saving}
                className={`w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  isFormValid && !saving
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300/60'
                }`}
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Outcomes...</span>
                  </>
                ) : (
                  <>
                    <span>{queue.length === 1 ? 'Save & Finish Queue' : 'Save & Next'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
