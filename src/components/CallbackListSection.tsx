import React, { useState } from 'react';
import { 
  PhoneCall, 
  MessageSquare, 
  Clock, 
  AlertTriangle, 
  AlertOctagon, 
  CheckCircle2, 
  Search, 
  Filter, 
  ExternalLink,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { Obligation } from '../types/compliance';

interface CallbackListSectionProps {
  obligations: Obligation[];
  onInspectContact: (phone: string) => void;
  selectedTag?: string;
  selectedAgentId?: string;
  filterType?: string;
  onFilterChange?: (type: string) => void;
}

export const CallbackListSection: React.FC<CallbackListSectionProps> = ({
  obligations,
  onInspectContact,
  filterType: controlledFilterType,
  onFilterChange,
}) => {
  const [internalFilterType, setInternalFilterType] = useState<string>('ALL');
  const [searchPhone, setSearchPhone] = useState<string>('');

  const currentFilter = controlledFilterType !== undefined ? controlledFilterType : internalFilterType;
  const setFilter = (type: string) => {
    if (onFilterChange) onFilterChange(type);
    setInternalFilterType(type);
  };

  const formatRemaining = (mins?: number) => {
    if (mins === undefined || isNaN(mins)) return 'Calculating';
    if (mins <= 0) return 'BREACHED (Overdue)';
    if (mins < 60) return `${Math.round(mins)} min remaining`;
    const hrs = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${hrs}h ${m}m remaining`;
  };

  const getUrgencyColor = (mins?: number) => {
    if (mins === undefined || mins <= 0) {
      return {
        badge: 'bg-rose-100 text-rose-800 border-rose-200 animate-pulse',
        row: 'border-l-4 border-l-rose-500 bg-rose-50/20',
        text: 'text-rose-600 font-bold',
      };
    }
    if (mins < 15) {
      return {
        badge: 'bg-amber-100 text-amber-800 border-amber-200',
        row: 'border-l-4 border-l-amber-500 bg-amber-50/20',
        text: 'text-amber-700 font-bold',
      };
    }
    return {
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      row: 'border-l-4 border-l-emerald-500 bg-emerald-50/10',
      text: 'text-emerald-700 font-semibold',
    };
  };

  const filteredObligations = obligations.filter((obl) => {
    if (currentFilter !== 'ALL' && obl.obligation_type !== currentFilter) return false;
    if (searchPhone.trim()) {
      const cleanSearch = searchPhone.replace(/[^\d]/g, '');
      const cleanPhone = obl.target_phone.replace(/[^\d]/g, '');
      if (!cleanPhone.includes(cleanSearch)) return false;
    }
    return true;
  });

  return (
    <div id="callback-list-section" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Section Header */}
      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 font-bold shadow-xs">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Actionable Callback &amp; Reconnection Obligations
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  {obligations.length} Open
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Live queue of active customer response obligations sorted by urgency. Click any contact to view thread history.
              </p>
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-callback-phone"
                type="text"
                placeholder="Search phone number..."
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none w-48 shadow-xs"
              />
            </div>

            <select
              id="select-callback-type"
              value={currentFilter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none shadow-xs"
            >
              <option value="ALL">All Obligation Types</option>
              <option value="MISSED_INCOMING_CALLBACK">Missed Incoming Callbacks</option>
              <option value="OUTGOING_RECONNECTION">Outgoing Reconnections</option>
              <option value="SMS_FOLLOWUP">SMS Follow-ups</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Content */}
      {filteredObligations.length === 0 ? (
        <div className="py-14 text-center text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-700">No Open Obligations Pending</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
            All missed incoming calls and unconnected outgoing calls have met their required callbacks and reconnection thresholds!
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Customer Phone</th>
                <th className="px-4 py-3">Obligation Type</th>
                <th className="px-4 py-3">Originating Agent &amp; Tag</th>
                <th className="px-4 py-3">Trigger Time</th>
                <th className="px-4 py-3">Deadline Time</th>
                <th className="px-4 py-3">Action Owed</th>
                <th className="px-4 py-3">Time Remaining</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredObligations.map((obl) => {
                const urgency = getUrgencyColor(obl.remaining_minutes);
                return (
                  <tr
                    key={obl.id}
                    id={`callback-row-${obl.id}`}
                    onClick={() => onInspectContact(obl.target_phone)}
                    className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${urgency.row}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {obl.target_phone}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      {obl.obligation_type === 'MISSED_INCOMING_CALLBACK' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                          <PhoneCall className="w-3 h-3 text-blue-600" />
                          Missed Incoming Callback
                        </span>
                      )}
                      {obl.obligation_type === 'OUTGOING_RECONNECTION' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <PhoneCall className="w-3 h-3 text-amber-600" />
                          Outgoing Reconnection
                        </span>
                      )}
                      {obl.obligation_type === 'SMS_FOLLOWUP' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          <MessageSquare className="w-3 h-3 text-purple-600" />
                          SMS Follow-up
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900">
                          {obl.originating_agent_name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Tag: {obl.originating_agent_tag}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                      {obl.trigger_local_timestamp || new Date(obl.trigger_timestamp).toLocaleTimeString()}
                    </td>

                    <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                      {obl.deadline_local_timestamp || new Date(obl.deadline_timestamp).toLocaleTimeString()}
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                        {obl.owed_action === 'CALLBACK_AND_SMS' ? 'Callback + SMS' : obl.owed_action}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${urgency.badge}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {formatRemaining(obl.remaining_minutes)}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectContact(obl.target_phone);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors border border-amber-200"
                      >
                        Inspect History
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
