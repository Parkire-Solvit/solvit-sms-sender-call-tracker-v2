// V15 src/components/PendingCallSessionView.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone,
  PhoneCall,
  Car,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  OctagonAlert,
  ArrowRight,
  X,
  RefreshCw,
  User,
  Copy,
  Check,
  Building2,
  Calendar,
  MessageSquare,
  History,
  ChevronDown,
  Mail,
} from 'lucide-react';
import type { PendingSubmissionJob, PendingSubmissionLog } from './PendingSubmissionsSection';
import { groupByCustomerOldestFirst, CustomerGroup } from '../lib/submissionQueue';
import { nairobiInputToIso } from '../lib/nairobiTime';

export interface SessionOutcomeOption {
  value: string;
  label: string;
  closes: boolean;
  resultingStatus: string;
}

export interface PendingCallSessionViewProps {
  selectedAgentId: number;
  selectedAgentName: string;
  maxCalls: number;
  maxSms: number;
  outcomeOptions: ReadonlyArray<SessionOutcomeOption>;
  onClose: () => void;
  onJobUpdated?: (updatedJob: PendingSubmissionJob) => void;
  initialCompany?: string;
  availableCompanies?: string[];
}

interface VehicleForm {
  outcome: string;
  comment: string;
  scheduledAt: string;
  scheduledPlace: string;
}

interface SaveNotice {
  key: string;
  text: string;
  error: boolean;
}

const EMPTY_FORM: VehicleForm = { outcome: '', comment: '', scheduledAt: '', scheduledPlace: '' };

const SYSTEM_OUTCOME_LABELS: Record<string, string> = {
  MAX_ATTEMPTS_REACHED: 'Max Attempts Reached',
  ABSENT_FROM_LATEST_EXPORT: 'Submitted (absent from export)',
  REOPENED_BY_SYSTEM: 'Reopened by System',
  REASSIGNED_BY_SYSTEM: 'Reassigned by System',
};

function statusText(status: string): string {
  if (status === 'GREEN') return 'Goes Green';
  if (status === 'RED') return 'Goes Red';
  return 'Stays Amber';
}

export const PendingCallSessionView: React.FC<PendingCallSessionViewProps> = ({
  selectedAgentId,
  selectedAgentName,
  maxCalls,
  maxSms,
  outcomeOptions,
  onClose,
  onJobUpdated,
  initialCompany = 'ALL',
  availableCompanies = [],
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [notices, setNotices] = useState<SaveNotice[]>([]);

  // Insurance company filter (the Callbacks session filters by channel partner)
  const [selectedCompany, setSelectedCompany] = useState<string>(initialCompany);
  const [allOpenJobs, setAllOpenJobs] = useState<PendingSubmissionJob[]>([]);

  // Queue state: one customer per screen, the customer with the oldest schedule date first
  const [queue, setQueue] = useState<CustomerGroup<PendingSubmissionJob>[]>([]);
  const [initialTotal, setInitialTotal] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);

  const [vehicleForm, setVehicleForm] = useState<Record<number, VehicleForm>>({});
  const [saving, setSaving] = useState<boolean>(false);

  // Inline attempt history
  const [expandedHistoryJobIds, setExpandedHistoryJobIds] = useState<Set<number>>(new Set());
  const [historyCache, setHistoryCache] = useState<Record<number, PendingSubmissionLog[]>>({});
  const [loadingHistoryIds, setLoadingHistoryIds] = useState<Set<number>>(new Set());

  const outcomeLabel = (outcome?: string | null): string => {
    if (!outcome) return 'No Outcome';
    const found = outcomeOptions.find((o) => o.value === outcome);
    return found?.label || SYSTEM_OUTCOME_LABELS[outcome] || outcome.replace(/_/g, ' ');
  };

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
    if (historyCache[jobId] !== undefined) return;

    setLoadingHistoryIds((prev) => new Set(prev).add(jobId));
    try {
      const res = await fetch(`/api/pending-submissions/jobs/${jobId}/logs`);
      if (res.ok) {
        const data: PendingSubmissionLog[] = await res.json();
        // The server returns newest first; show oldest first so attempt numbers read in order.
        setHistoryCache((prev) => ({ ...prev, [jobId]: [...data].reverse() }));
      } else {
        setHistoryCache((prev) => ({ ...prev, [jobId]: [] }));
      }
    } catch (err) {
      console.error(`[API] Error fetching pending submission logs for job ${jobId}:`, err);
      setHistoryCache((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setLoadingHistoryIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const companies = useMemo(() => {
    const set = new Set<string>();
    availableCompanies.forEach((c) => {
      if (c && c.trim()) set.add(c.trim());
    });
    allOpenJobs.forEach((j) => {
      if (j.insurance_company && j.insurance_company.trim()) set.add(j.insurance_company.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableCompanies, allOpenJobs]);

  const buildQueue = (jobs: PendingSubmissionJob[], company: string): CustomerGroup<PendingSubmissionJob>[] => {
    const open = jobs.filter((j) => j.status === 'AMBER');
    const filtered =
      company === 'ALL'
        ? open
        : open.filter((j) => (j.insurance_company || '').trim().toLowerCase() === company.trim().toLowerCase());
    return groupByCustomerOldestFirst(filtered);
  };

  const initializeClientForm = (group: CustomerGroup<PendingSubmissionJob> | undefined) => {
    if (!group) {
      setVehicleForm({});
      return;
    }
    const next: Record<number, VehicleForm> = {};
    group.records.forEach((v) => {
      next[v.id] = { ...EMPTY_FORM };
    });
    setVehicleForm(next);
  };

  const fetchCallingQueue = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pending-submissions/jobs?agent_id=${encodeURIComponent(String(selectedAgentId))}&status=AMBER`);
      if (!res.ok) throw new Error(`Failed to load queue (${res.status})`);
      const rawJobs: PendingSubmissionJob[] = await res.json();

      // Only this agent's open records are queued
      const mine = rawJobs.filter((j) => j.status === 'AMBER' && Number(j.assigned_agent_id) === selectedAgentId);
      setAllOpenJobs(mine);

      const groups = buildQueue(mine, selectedCompany);
      setQueue(groups);
      if (!isManualRefresh) {
        setInitialTotal(groups.length);
        setCompletedCount(0);
      } else {
        setInitialTotal(completedCount + groups.length);
      }
      initializeClientForm(groups[0]);
    } catch (err: any) {
      console.error('Error loading pending submissions calling queue:', err);
      setError(err.message || 'Failed to load calling queue.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCallingQueue(false);
  }, [selectedAgentId]);

  const handleCompanyChange = (company: string) => {
    setSelectedCompany(company);
    const groups = buildQueue(allOpenJobs, company);
    setQueue(groups);
    setInitialTotal(groups.length);
    setCompletedCount(0);
    initializeClientForm(groups[0]);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(text);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const currentClient = queue[0];

  // Every vehicle needs an outcome and a comment. SCHEDULED also needs a valid time and a place.
  const isFormValid = useMemo(() => {
    if (!currentClient || currentClient.records.length === 0) return false;
    return currentClient.records.every((v) => {
      const f = vehicleForm[v.id];
      if (!f || !f.outcome) return false;
      if (f.comment.trim() === '') return false;
      if (f.outcome === 'SCHEDULED') {
        if (nairobiInputToIso(f.scheduledAt) === null) return false;
        if (f.scheduledPlace.trim() === '') return false;
      }
      return true;
    });
  }, [currentClient, vehicleForm]);

  const updateForm = (jobId: number, patch: Partial<VehicleForm>) => {
    setVehicleForm((prev) => ({ ...prev, [jobId]: { ...(prev[jobId] || EMPTY_FORM), ...patch } }));
  };

  // Save & Next Client: one log request per vehicle. Vehicles that save are removed; any that fail stay on screen.
  const handleSaveAndNext = async () => {
    if (!currentClient || !isFormValid || saving) return;
    setSaving(true);
    setError(null);

    const vehicles = currentClient.records;
    const settled = await Promise.allSettled(
      vehicles.map(async (v) => {
        const f = vehicleForm[v.id];
        const isScheduled = f.outcome === 'SCHEDULED';
        const res = await fetch(`/api/pending-submissions/jobs/${v.id}/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: f.outcome,
            comment: f.comment.trim(),
            logged_by: selectedAgentName,
            scheduled_at: isScheduled ? nairobiInputToIso(f.scheduledAt) : null,
            scheduled_place: isScheduled ? f.scheduledPlace.trim() : null,
          }),
        });
        if (!res.ok) {
          let detail = 'Request failed';
          try {
            const j = await res.json();
            if (j.error) detail = j.error;
          } catch (_) {
            detail = await res.text();
          }
          throw new Error(`Failed to log ${v.vehicle_reg_raw || v.vehicle_reg}: ${detail}`);
        }
        const body = await res.json();
        if (body.job && onJobUpdated) onJobUpdated(body.job);
        return { vehicle: v, body, scheduled: isScheduled };
      })
    );

    const savedIds = new Set<number>();
    const newNotices: SaveNotice[] = [];
    const failures: string[] = [];
    settled.forEach((s, idx) => {
      const v = vehicles[idx];
      const reg = v.vehicle_reg_raw || v.vehicle_reg;
      if (s.status === 'fulfilled') {
        savedIds.add(v.id);
        if (s.value.scheduled) {
          const solver = v.solver_name || 'the solver';
          const b = s.value.body;
          if (b.smsDispatched) {
            newNotices.push({ key: `sms-${v.id}`, text: `${reg}: scheduled. Solver SMS sent to ${solver}.`, error: false });
          } else if (b.smsMessage || b.sms?.message) {
            newNotices.push({ key: `sms-${v.id}`, text: `${reg}: scheduled. ${b.smsMessage || b.sms.message}`, error: true });
          } else {
            newNotices.push({ key: `sms-${v.id}`, text: `${reg}: scheduled.`, error: false });
          }
        }
      } else {
        failures.push(s.reason?.message || `Failed to log ${reg}`);
      }
    });

    setAllOpenJobs((prev) => prev.filter((j) => !savedIds.has(j.id)));
    setNotices(newNotices);

    if (failures.length === 0) {
      const nextQueue = queue.slice(1);
      setQueue(nextQueue);
      setCompletedCount((prev) => prev + 1);
      initializeClientForm(nextQueue[0]);
    } else {
      // Keep the customer on screen with only the vehicles that did not save
      const remaining = currentClient.records.filter((v) => !savedIds.has(v.id));
      setQueue((prev) => [{ ...prev[0], records: remaining }, ...prev.slice(1)]);
      setError(failures.join(' | '));
    }
    setSaving(false);
  };

  const currentClientNumber = completedCount + 1;
  const displayTotal = Math.max(initialTotal, completedCount + queue.length);
  const progressPercent = displayTotal > 0 ? Math.min(100, Math.round((completedCount / displayTotal) * 100)) : 0;

  const noticeBanner = notices.length > 0 && (
    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-bold">Previous customer saved</span>
        <button onClick={() => setNotices([])} className="text-emerald-700 hover:text-emerald-900 text-xs font-bold">
          Dismiss
        </button>
      </div>
      {notices.map((n) => (
        <div key={n.key} className={n.error ? 'text-rose-700 font-semibold' : 'text-emerald-800'}>
          {n.text}
        </div>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-12 border border-slate-200/80 shadow-sm flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-[#ff353e] flex items-center justify-center animate-pulse">
          <PhoneCall className="w-6 h-6 animate-bounce" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">Preparing Focused Call Queue</h3>
          <p className="text-xs text-slate-500 mt-1">
            Loading open pending submissions for <span className="font-bold text-slate-800">{selectedAgentName}</span>, oldest schedule date first...
          </p>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="space-y-4">
        {noticeBanner}
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
                No open pending submissions remaining in <span className="font-bold text-slate-900">{selectedAgentName}</span>'s queue.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-center justify-around">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clients Handled</span>
                <span className="text-xl font-black text-slate-900">{completedCount}</span>
              </div>
              <div className="w-px h-8 bg-slate-200" />
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Remaining Open</span>
                <span className="text-xl font-black text-emerald-600">0</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                id="btn-close-pending-call-session-done"
                onClick={onClose}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Close Session &amp; Return to List</span>
              </button>
              <button
                id="btn-refresh-pending-queue-done"
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
      </div>
    );
  }

  const phoneDigits = (currentClient.client_phone || '').replace(/\D/g, '').slice(-9);
  const dialNumber = `+254${phoneDigits}`;
  const displayNumber = currentClient.records[0]?.client_phone_raw || `0${phoneDigits}`;
  const customerEmail = currentClient.records.find((v) => v.customer_email)?.customer_email || null;
  const customerCompanies = Array.from(new Set(currentClient.records.map((v) => (v.insurance_company || '').trim()).filter(Boolean)));

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {noticeBanner}

      {/* Session Top Bar: Progress, Agent Scope, Controls */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 text-[#ff353e] flex items-center justify-center flex-shrink-0">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black text-slate-900 leading-tight">One-at-a-Time Call Session</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-50 text-[#ff353e] border border-red-100">
                  {selectedAgentName}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Focused queue &bull; Longest overdue first &bull; Logs saved directly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 border border-slate-200 rounded-xl">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <select
                id="select-pending-session-company"
                value={selectedCompany}
                onChange={(e) => handleCompanyChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                title="Filter call session by insurance company"
              >
                <option value="ALL">All Companies ({companies.length})</option>
                {companies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <button
              id="btn-refresh-pending-session-queue"
              onClick={() => fetchCallingQueue(true)}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Refresh queue in case new records were imported or reassigned"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin text-[#ff353e]' : ''}`} />
              <span className="hidden sm:inline">Refresh Queue</span>
            </button>

            <button
              id="btn-close-pending-call-session"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-200/60"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              <span>Close Session</span>
            </button>
          </div>
        </div>

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
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Current Client Calling Screen */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 bg-slate-50/70 border-b border-slate-200/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 text-[#ff353e] flex items-center justify-center font-bold text-base flex-shrink-0 mt-0.5 sm:mt-0">
                <User className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-wide">Valuation Client</h3>
                  {customerCompanies.map((company) => (
                    <span
                      key={company}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center gap-1 shadow-2xs"
                    >
                      <Building2 className="w-3 h-3 text-slate-400" />
                      {company}
                    </span>
                  ))}
                </div>

                {customerEmail && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium mt-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono">{customerEmail}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5">
                    <a
                      id={`link-call-pending-client-phone-${phoneDigits}`}
                      href={`tel:${dialNumber}`}
                      className="text-base sm:text-lg font-black font-mono tracking-wide text-slate-900 hover:text-[#ff353e] flex items-center gap-2 transition-colors bg-white hover:bg-red-50 px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs"
                      title={`Click to dial ${dialNumber}`}
                    >
                      <Phone className="w-4 h-4 text-[#ff353e]" />
                      <span>{displayNumber}</span>
                    </a>
                    <button
                      onClick={() => copyToClipboard(displayNumber)}
                      className="text-slate-400 hover:text-slate-700 p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                      title={`Copy ${displayNumber}`}
                    >
                      {copiedPhone === displayNumber ? (
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
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-xs font-bold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                {currentClient.records.length} {currentClient.records.length === 1 ? 'Open Vehicle' : 'Open Vehicles'} for this client
              </span>
            </div>
          </div>
        </div>

        {/* Vehicle Cards */}
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider">
              Vehicles Requiring Outcome ({currentClient.records.length})
            </span>
            <span className="text-[11px] text-slate-400">All vehicles below must be logged before advancing</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {currentClient.records.map((vehicle, idx) => {
              const form = vehicleForm[vehicle.id] || EMPTY_FORM;
              const callsCount = vehicle.client_attempt_count || 0;
              const smsCount = vehicle.client_sms_count || 0;
              const callsMet = callsCount >= maxCalls;
              const smsMet = smsCount >= maxSms;
              const selectedOpt = outcomeOptions.find((o) => o.value === form.outcome);
              const isScheduled = form.outcome === 'SCHEDULED';

              return (
                <div
                  key={vehicle.id}
                  id={`pending-vehicle-card-${vehicle.id}`}
                  className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3.5 hover:border-slate-300 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-black flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Car className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-black font-mono text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                          {vehicle.vehicle_reg_raw || vehicle.vehicle_reg}
                        </span>
                      </div>

                      {vehicle.insurance_company && (
                        <span className="text-[11px] font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200/60">
                          {vehicle.insurance_company}
                        </span>
                      )}

                      {vehicle.schedule_date && (
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          Schedule date: {String(vehicle.schedule_date).slice(0, 10)}
                        </span>
                      )}

                      {vehicle.is_overdue && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          <span>
                            Overdue by {vehicle.days_overdue} {vehicle.days_overdue === 1 ? 'day' : 'days'}
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1 ${
                          callsMet ? 'bg-red-50 text-red-700 border-red-200 font-black' : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                        title={`Outgoing calls: ${callsCount} / ${maxCalls}`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>
                          {callsCount} / {maxCalls} calls
                        </span>
                      </span>

                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1 ${
                          smsMet ? 'bg-red-50 text-red-700 border-red-200 font-black' : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                        title={`SMS sent: ${smsCount} / ${maxSms}`}
                      >
                        <MessageSquare className="w-3 h-3 text-slate-400" />
                        <span>
                          {smsCount} / {maxSms} SMS
                        </span>
                      </span>

                      {callsMet && !smsMet && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                          SMS needed
                        </span>
                      )}
                      {!callsMet && smsMet && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                          Calls needed
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      <span className="font-bold text-slate-700">Solver: </span>
                      {vehicle.solver_name || 'Valuer'}{' '}
                      <span className="font-mono text-slate-500">{vehicle.solver_contact_raw || vehicle.solver_contact}</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">Ext ID: #{vehicle.external_id}</span>
                  </div>

                  {vehicle.latest_pending_reason && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl text-xs text-slate-600">
                      <span className="font-bold text-slate-700">Pending reason: </span>
                      {vehicle.latest_pending_reason}
                    </div>
                  )}

                  {expandedHistoryJobIds.has(vehicle.id) && (
                    <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5 text-slate-500" />
                          <span>
                            Attempt History ({historyCache[vehicle.id]?.length ?? (loadingHistoryIds.has(vehicle.id) ? '...' : 0)})
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Chronological</span>
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
                            <div key={log.id || logIdx} className="p-2.5 bg-white rounded-lg border border-slate-200/80 text-xs space-y-1 shadow-2xs">
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
                                    {outcomeLabel(log.outcome)}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{new Date(log.created_at).toLocaleString()}</span>
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

                  {/* Outcome dropdown and resulting status */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                    <div className="sm:col-span-6">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-slate-700">
                          Call Outcome <span className="text-red-500">*</span>
                        </label>
                        <button
                          type="button"
                          id={`btn-toggle-pending-session-history-${vehicle.id}`}
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
                            className={`w-3 h-3 transition-transform duration-150 ${expandedHistoryJobIds.has(vehicle.id) ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </div>
                      <select
                        id={`select-pending-outcome-${vehicle.id}`}
                        value={form.outcome}
                        onChange={(e) => updateForm(vehicle.id, { outcome: e.target.value })}
                        className={`w-full px-3 py-2 bg-slate-50 border rounded-xl text-xs font-semibold text-slate-800 outline-none transition-all cursor-pointer ${
                          form.outcome
                            ? 'border-slate-300 focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e]'
                            : 'border-amber-300 bg-amber-50/40 text-slate-700 focus:ring-2 focus:ring-amber-400/20'
                        }`}
                      >
                        <option value="">-- Select Call Outcome (Required) --</option>
                        {outcomeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label} ({statusText(opt.resultingStatus)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-6 flex flex-col justify-end">
                      <div className="h-9 flex items-center">
                        {selectedOpt ? (
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
                            <span>
                              {statusText(selectedOpt.resultingStatus)} &middot; {selectedOpt.closes ? 'Closes the record' : 'Record stays open'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Select an outcome to update vehicle status</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Scheduled: date, time and place. The solver SMS is sent automatically when the outcome is saved. */}
                  {isScheduled && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                            Inspection Date &amp; Time (Nairobi time) <span className="text-red-500">*</span>
                          </label>
                          <input
                            id={`input-pending-scheduled-at-${vehicle.id}`}
                            type="datetime-local"
                            value={form.scheduledAt}
                            onChange={(e) => updateForm(vehicle.id, { scheduledAt: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs font-semibold focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                            Agreed Location / Place <span className="text-red-500">*</span>
                          </label>
                          <input
                            id={`input-pending-scheduled-place-${vehicle.id}`}
                            type="text"
                            value={form.scheduledPlace}
                            onChange={(e) => updateForm(vehicle.id, { scheduledPlace: e.target.value })}
                            placeholder="e.g. TotalEnergies Westlands, client residence"
                            className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs font-semibold focus:outline-none"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-emerald-800 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>
                          An SMS with these details is sent to {vehicle.solver_name || 'the solver'} automatically when you save.
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Comment (required for every outcome) */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Notes &amp; Summary <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id={`textarea-pending-comment-${vehicle.id}`}
                      rows={2}
                      value={form.comment}
                      onChange={(e) => updateForm(vehicle.id, { comment: e.target.value })}
                      placeholder={`e.g. Spoke with customer regarding ${vehicle.vehicle_reg_raw || vehicle.vehicle_reg}; appointment agreed / call back requested...`}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] resize-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom action bar: Save & Next */}
        <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs">
            {!isFormValid ? (
              <div className="flex items-center gap-1.5 text-amber-700 font-semibold">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span>
                  Select an outcome and add a note for all{' '}
                  <span className="font-bold text-amber-900">{currentClient.records.length}</span> vehicle
                  {currentClient.records.length === 1 ? '' : 's'} (and the time and place for any Scheduled) to enable Save &amp; Next.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>All vehicle outcomes complete and ready to save.</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              id="btn-pending-save-and-next"
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
    </div>
  );
};
// V15 END src/components/PendingCallSessionView.tsx

