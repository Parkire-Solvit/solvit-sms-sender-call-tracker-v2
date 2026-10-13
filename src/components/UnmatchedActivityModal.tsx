import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  PhoneCall,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  X,
  Search,
  RefreshCw,
  Plus,
  UserCheck,
  UserX,
  Car,
  Filter
} from 'lucide-react';
import { UnmatchedActivityItem, UnmatchedActivityReason } from '../types/callbacks';

interface UnmatchedActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAgentReview?: () => void;
  onDataChanged?: () => void;
}

export const UnmatchedActivityModal: React.FC<UnmatchedActivityModalProps> = ({
  isOpen,
  onClose,
  onOpenAgentReview,
  onDataChanged,
}) => {
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);
  const [activities, setActivities] = useState<UnmatchedActivityItem[]>([]);
  const [reasonFilter, setReasonFilter] = useState<'ALL' | UnmatchedActivityReason>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/callback-jobs/unmatched-activity?days=${days}`);
      if (res.ok) {
        const data: UnmatchedActivityItem[] = await res.json();
        setActivities(data);
      } else {
        setActivities([]);
      }
    } catch (err) {
      console.error('Error fetching unmatched activity:', err);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setNotification(null);
      fetchActivities();
    }
  }, [isOpen, days]);

  const filtered = useMemo(() => {
    return activities.filter((item) => {
      if (reasonFilter !== 'ALL' && item.reason !== reasonFilter) {
        return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        const phoneMatch = item.target_phone.toLowerCase().includes(term);
        const agentMatch = item.agent_name.toLowerCase().includes(term);
        const regMatch = (item.reg_no || '').toLowerCase().includes(term);
        const suggestedRegMatch = (item.suggested_job?.vehicle_reg || '').toLowerCase().includes(term);
        if (!phoneMatch && !agentMatch && !regMatch && !suggestedRegMatch) {
          return false;
        }
      }
      return true;
    });
  }, [activities, reasonFilter, searchTerm]);

  if (!isOpen) return null;

  const handleAddPhoneToJob = async (jobId: number, phone: string, activityId: number) => {
    setWorkingId(activityId);
    setNotification(null);
    try {
      const res = await fetch(`/api/callback-jobs/${jobId}/add-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add phone to job');

      setNotification({
        type: 'success',
        message: `Phone ${phone} successfully linked to vehicle! Activity will now count toward callbacks.`,
      });
      await fetchActivities();
      if (onDataChanged) onDataChanged();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error adding phone to job' });
    } finally {
      setWorkingId(null);
    }
  };

  const handleAssignJobToAgent = async (jobId: number, agentId: number | null, activityId: number) => {
    setWorkingId(activityId);
    setNotification(null);
    try {
      const res = await fetch(`/api/callback-jobs/${jobId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, apply_to_client: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reassign vehicle');

      setNotification({
        type: 'success',
        message: `Vehicle reassigned to agent! Calls and SMSs now match this callback.`,
      });
      await fetchActivities();
      if (onDataChanged) onDataChanged();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error assigning job' });
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 border border-blue-200">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                  Unmatched Activity Monitor
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-mono">
                  {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Calls and SMSs by callback team that did not count towards any open or closed vehicle.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              <option value={7}>Last 7 Days</option>
              <option value={14}>Last 14 Days</option>
              <option value={30}>Last 30 Days</option>
              <option value={60}>Last 60 Days</option>
            </select>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="p-3 sm:px-5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <button
              type="button"
              onClick={() => setReasonFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                reasonFilter === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              All Unmatched ({activities.length})
            </button>
            <button
              type="button"
              onClick={() => setReasonFilter('NO_JOB_FOR_NUMBER')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                reasonFilter === 'NO_JOB_FOR_NUMBER'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              No Job For Number ({activities.filter((a) => a.reason === 'NO_JOB_FOR_NUMBER').length})
            </button>
            <button
              type="button"
              onClick={() => setReasonFilter('ASSIGNED_TO_OTHER_AGENT')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                reasonFilter === 'ASSIGNED_TO_OTHER_AGENT'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Assigned to Other ({activities.filter((a) => a.reason === 'ASSIGNED_TO_OTHER_AGENT').length})
            </button>
            <button
              type="button"
              onClick={() => setReasonFilter('UNRECOGNISED_AGENT')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                reasonFilter === 'UNRECOGNISED_AGENT'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Unrecognised Agent ({activities.filter((a) => a.reason === 'UNRECOGNISED_AGENT').length})
            </button>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by phone, reg, or agent..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Notifications */}
        {notification && (
          <div
            className={`p-3 mx-4 mt-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              notification.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-3 sm:p-5">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-500">Checking call & SMS event records...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-black text-slate-800">No Unmatched Activity</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                All call and SMS activity in this timeframe successfully matched callback jobs and assignments!
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Agent</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Target Phone</th>
                      <th className="py-2.5 px-3">Reg in Event</th>
                      <th className="py-2.5 px-3">Reason</th>
                      <th className="py-2.5 px-3">Suggested Match &amp; Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((item) => {
                      const isWorking = workingId === item.id;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                            {new Date(item.timestamp).toLocaleString([], {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                            {item.agent_name}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.type === 'CALL'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-blue-50 text-blue-800 border border-blue-200'
                              }`}
                            >
                              {item.type === 'CALL' ? (
                                <PhoneCall className="w-3 h-3" />
                              ) : (
                                <MessageSquare className="w-3 h-3" />
                              )}
                              <span>{item.type}</span>
                              {item.status && <span className="opacity-60 font-normal">({item.status})</span>}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                            {item.target_phone}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {item.reg_no || '-'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {item.reason === 'NO_JOB_FOR_NUMBER' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                No Job For Number
                              </span>
                            )}
                            {item.reason === 'ASSIGNED_TO_OTHER_AGENT' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                                Assigned to Other
                              </span>
                            )}
                            {item.reason === 'UNRECOGNISED_AGENT' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                Unrecognised Agent
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5">
                              {item.suggested_job ? (
                                <>
                                  <div className="text-[11px] leading-tight">
                                    <span className="font-mono font-black text-slate-900">
                                      {item.suggested_job.vehicle_reg}
                                    </span>
                                    <span className="text-slate-400 ml-1">
                                      (Assigned: {item.suggested_job.assigned_agent_name || 'Unassigned'})
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 mt-1 sm:mt-0">
                                    <button
                                      type="button"
                                      disabled={isWorking}
                                      onClick={() =>
                                        handleAddPhoneToJob(item.suggested_job!.id, item.target_phone, item.id)
                                      }
                                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-40"
                                      title="Add this phone to vehicle so call/SMS counts toward this job"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Link Phone</span>
                                    </button>

                                    {item.agent_id &&
                                      item.agent_id !== item.suggested_job.assigned_agent_id && (
                                        <button
                                          type="button"
                                          disabled={isWorking}
                                          onClick={() =>
                                            handleAssignJobToAgent(
                                              item.suggested_job!.id,
                                              item.agent_id,
                                              item.id
                                            )
                                          }
                                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-40"
                                          title={`Reassign ${item.suggested_job.vehicle_reg} to ${item.agent_name}`}
                                        >
                                          <UserCheck className="w-3 h-3" />
                                          <span>Assign to {item.agent_name.split(' ')[0]}</span>
                                        </button>
                                      )}
                                  </div>
                                </>
                              ) : item.reason === 'UNRECOGNISED_AGENT' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    if (onOpenAgentReview) onOpenAgentReview();
                                  }}
                                  className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                                >
                                  <UserX className="w-3 h-3" />
                                  <span>Review &amp; Merge Agent</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400 italic">No job found matching number</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {filtered.length} of {activities.length} unmatched events
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
