import React, { useState, useEffect } from 'react';
import { 
  X, 
  Phone, 
  PhoneIncoming, 
  PhoneOff, 
  MessageSquare, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  AlertOctagon, 
  User, 
  Tag as TagIcon,
  ShieldCheck,
  ArrowRight,
  Info,
  Calendar
} from 'lucide-react';
import { Obligation, SystemSettings } from '../types/compliance';

interface ContactHistoryModalProps {
  phone: string | null;
  onClose: () => void;
}

interface ThreadData {
  phone: string;
  total_events: number;
  timeline: Array<{
    id: number;
    type: 'CALL' | 'SMS';
    status: string;
    target_phone: string;
    timestamp: string;
    local_timestamp: string;
    duration: number;
    agent_id: number;
    agent_name: string;
    agent_tag: string;
    compliance_label?: {
      badge: string;
      color: string;
      description: string;
      obligation_id?: string;
    } | null;
  }>;
  obligations_summary: Obligation[];
  settings: SystemSettings;
}

export const ContactHistoryModal: React.FC<ContactHistoryModalProps> = ({
  phone,
  onClose,
}) => {
  const [data, setData] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phone) {
      fetchThreadHistory(phone);
    }
  }, [phone]);

  const fetchThreadHistory = async (targetPhone: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contact-history?phone=${encodeURIComponent(targetPhone)}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        const errJson = await res.json();
        setError(errJson.error || 'Failed to fetch contact history');
      }
    } catch (err) {
      setError('Network error loading contact history.');
    } finally {
      setLoading(false);
    }
  };

  if (!phone) return null;

  const formatDuration = (sec?: number) => {
    if (!sec || sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div id="contact-history-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div id="contact-history-modal" className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 font-bold shadow-xs">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 font-mono">
                  {phone}
                </h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Contact History Thread
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Full chronological communication lifecycle &amp; compliance evaluation.
              </p>
            </div>
          </div>

          <button
            id="close-contact-history-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-20 text-center text-slate-400">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-amber-600" />
              <p className="text-xs font-medium">Reconstructing contact history timeline...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {data && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                    Total Timeline Events
                  </span>
                  <span className="text-xl font-extrabold font-mono text-slate-900 mt-0.5 block">
                    {data.total_events}
                  </span>
                  <span className="text-[11px] text-slate-500">Recorded interactions</span>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                    Obligations Summary
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                      {data.obligations_summary.filter(o => o.status === 'MET').length} Met
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800">
                      {data.obligations_summary.filter(o => o.status === 'BREACHED').length} Breached
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                      {data.obligations_summary.filter(o => o.status === 'OPEN').length} Open
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                    Active Compliance Windows
                  </span>
                  <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                    <div>Missed: <strong>{data.settings?.callback_window_minutes || 30}m</strong></div>
                    <div>Reconnect: <strong>{Math.round((data.settings?.reconnection_window_minutes || 1440)/60)}h</strong></div>
                  </div>
                </div>
              </div>

              {/* Obligations Breakdown if any */}
              {data.obligations_summary.length > 0 && (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/30 space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    Response Obligations Triggered on this Contact:
                  </h4>
                  <div className="space-y-2">
                    {data.obligations_summary.map((obl) => (
                      <div
                        key={obl.id}
                        className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                          obl.status === 'MET'
                            ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                            : obl.status === 'BREACHED'
                            ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                            : 'bg-amber-50/60 border-amber-200 text-amber-900'
                        }`}
                      >
                        <div>
                          <span className="font-bold block">
                            {obl.obligation_type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[11px] opacity-80">
                            Triggered: {obl.trigger_local_timestamp || new Date(obl.trigger_timestamp).toLocaleString()} &bull; Agent: {obl.originating_agent_name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {obl.turnaround_minutes !== undefined && obl.turnaround_minutes !== null && (
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-white/70">
                              Resolved in {Math.round(obl.turnaround_minutes)}m
                            </span>
                          )}
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            obl.status === 'MET' ? 'bg-emerald-200 text-emerald-900' :
                            obl.status === 'BREACHED' ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900'
                          }`}>
                            {obl.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chronological Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900">
                  Chronological Event Timeline:
                </h4>

                {data.timeline.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No recorded events found for this phone number.
                  </div>
                ) : (
                  <div className="relative pl-6 border-l-2 border-slate-200 space-y-4">
                    {data.timeline.map((evt) => {
                      const isCall = evt.type === 'CALL';
                      const isSMS = evt.type === 'SMS';
                      const isConnected = evt.status === 'CONNECTED';
                      const isMissed = evt.status === 'MISSED';
                      const isIncoming = evt.status === 'INCOMING';

                      return (
                        <div key={evt.id} className="relative">
                          {/* Timeline dot */}
                          <div className={`absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-xs ${
                            isConnected ? 'bg-emerald-500' :
                            isMissed ? 'bg-rose-500' :
                            isSMS ? 'bg-purple-500' :
                            'bg-blue-500'
                          }`} />

                          <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs hover:border-slate-300 transition-all space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                  isConnected ? 'bg-emerald-100 text-emerald-800' :
                                  isMissed ? 'bg-rose-100 text-rose-800' :
                                  isSMS ? 'bg-purple-100 text-purple-800' :
                                  'bg-blue-100 text-blue-800'
                                }`}>
                                  {evt.type}: {evt.status}
                                </span>

                                {evt.duration > 0 && (
                                  <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                    Duration: {formatDuration(evt.duration)}
                                  </span>
                                )}
                              </div>

                              <span className="text-xs font-mono text-slate-500">
                                {evt.local_timestamp || new Date(evt.timestamp).toLocaleString()}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-600">
                              <div className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-semibold text-slate-800">{evt.agent_name}</span>
                                <span className="text-slate-400">({evt.agent_tag})</span>
                              </div>
                            </div>

                            {/* Compliance Effect Label */}
                            {evt.compliance_label && (
                              <div className="mt-2 pt-2 border-t border-slate-100">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold ${evt.compliance_label.color}`}>
                                  <Info className="w-3 h-3 flex-shrink-0" />
                                  <span>
                                    <strong>{evt.compliance_label.badge}:</strong> {evt.compliance_label.description}
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
