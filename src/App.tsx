/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  ArrowRight, 
  XCircle,
  Clock,
  History,
  ChevronRight,
  Phone,
  AlertCircle,
  Download,
  Filter,
  Trash2,
  Plus,
  Edit2,
  Database,
  Server,
  RefreshCw,
  LogOut,
  Users,
  UserMinus,
  Settings as SettingsIcon,
  Tag as TagIcon,
  ExternalLink
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { MasterSettingsModal } from './components/MasterSettingsModal';
import { TurnaroundMetricsSection } from './components/TurnaroundMetricsSection';
import { CallbackListSection } from './components/CallbackListSection';
import { ContactHistoryModal } from './components/ContactHistoryModal';
import { ComplianceAgentTable } from './components/ComplianceAgentTable';
import { SearchContactBar } from './components/SearchContactBar';
import { ConsolidatedMetricCards } from './components/ConsolidatedMetricCards';
import { CardDrilldownModal, DrilldownCardType } from './components/CardDrilldownModal';
import { SystemSettings, TurnaroundTimeReport, Obligation, AgentComplianceSummary, TagGroupCompliance } from './types/compliance';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PermissionStatus {
  name: string;
  granted: boolean;
  description: string;
}

interface DbStatus {
  type: 'postgresql';
  isConnected: boolean;
  statusMessage: string;
  database?: string;
}

export default function App() {
  const [stats, setStats] = useState<any>(null);
  const [complianceStats, setComplianceStats] = useState<{
    summary?: any;
    agents?: AgentComplianceSummary[];
    tag_groups?: TagGroupCompliance[];
    turnaround_report?: TurnaroundTimeReport;
    open_obligations?: Obligation[];
    settings?: SystemSettings;
    db_type?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [showDbModal, setShowDbModal] = useState(false);
  const [showMasterSettings, setShowMasterSettings] = useState(false);

  const getNairobiDate = () => {
    const now = new Date();
    const nairobi = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return nairobi.toISOString().split('T')[0];
  };

  const [startDate, setStartDate] = useState<string>(getNairobiDate());
  const [endDate, setEndDate] = useState<string>(getNairobiDate());
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  
  // Selected phone for Contact History Thread Modal
  const [inspectedPhone, setInspectedPhone] = useState<string | null>(null);

  // Check for existing session
  useEffect(() => {
    if (localStorage.getItem('solvit_admin_token') || localStorage.getItem('nellions_admin_token')) {
      setIsAdminAuthenticated(true);
    }
  }, []);

  // Fetch Database engine status
  const fetchDbStatus = async () => {
    try {
      const res = await fetch('/api/db-status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data);
      }
    } catch (e) {
      console.warn('Failed to fetch DB status:', e);
    }
  };

  useEffect(() => {
    fetchDbStatus();
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      if (res.ok) {
        setIsAdminAuthenticated(true);
        localStorage.setItem('solvit_admin_token', 'true');
      } else {
        setLoginError('Invalid username or password');
      }
    } catch (err) {
      setLoginError('Server error. Please try again.');
    }
  };

  const handleLogout = () => {
    setIsAdminAuthenticated(false);
    localStorage.removeItem('solvit_admin_token');
    localStorage.removeItem('nellions_admin_token');
  };

  // Fetch stats & compliance metrics
  const fetchAllStats = useCallback(async (start: string, end: string, agentId: string, tag: string) => {
    if (!isAdminAuthenticated) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate: start,
        endDate: end,
        ...(agentId && { agentId }),
        ...(tag && { tag })
      });

      const [resStats, resCompliance] = await Promise.all([
        fetch(`/api/stats?${params.toString()}`),
        fetch(`/api/compliance-stats?${params.toString()}`)
      ]);

      if (resStats.ok) {
        const data = await resStats.json();
        setStats(data);
        if (data.db_type) {
          fetchDbStatus();
        }
      }

      if (resCompliance.ok) {
        const compData = await resCompliance.json();
        setComplianceStats(compData);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuthenticated]);

  useEffect(() => {
    if (isAdminAuthenticated) {
      fetchAllStats(startDate, endDate, selectedAgentId, selectedTag);
      const interval = setInterval(() => fetchAllStats(startDate, endDate, selectedAgentId, selectedTag), 25000);
      return () => clearInterval(interval);
    }
  }, [startDate, endDate, selectedAgentId, selectedTag, fetchAllStats, isAdminAuthenticated]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 pb-24">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#ff353e] rounded-xl flex items-center justify-center text-white shadow-md shadow-[#ff353e]/25">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Solvit</h1>
                <span className="bg-[#ff353e]/10 text-[#ff353e] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Compliance &amp; SLA Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Customer Response Obligations &amp; Communications Tracking (Nairobi UTC+3)</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Quick Contact Search Bar */}
            {isAdminAuthenticated && (
              <SearchContactBar onSelectPhone={(phone) => setInspectedPhone(phone)} />
            )}

            {/* Master Settings Button (Admin Only) */}
            {isAdminAuthenticated && (
              <button
                id="top-nav-master-settings-btn"
                onClick={() => setShowMasterSettings(true)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Configure centralized evaluation rules, thresholds & working hours schedule"
              >
                <SettingsIcon className="w-3.5 h-3.5 text-slate-700" />
                <span>Master Settings</span>
              </button>
            )}

            {isAdminAuthenticated && (
              <button
                id="btn-admin-logout"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 hover:bg-red-50 text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-200 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Sign out of Admin Dashboard"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main View Area */}
      {!isAdminAuthenticated ? (
        <div className="max-w-md mx-auto mt-20 px-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-8 shadow-xl border border-slate-200"
          >
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 bg-[#ff353e]/10 text-[#ff353e] rounded-2xl flex items-center justify-center mb-4 shadow-xs">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Solvit Compliance Portal</h1>
              <p className="text-slate-500 text-xs text-center mt-1">
                Sign in to audit response obligation adherence, callback SLA turnaround, and team metrics.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="p-3 bg-red-50/60 border border-red-100 rounded-xl flex items-center justify-between text-xs">
                <div className="text-slate-700">
                  <span className="font-bold text-[#ff353e]">Default Credentials:</span>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    User: <strong className="text-slate-800 font-mono">admin</strong> | Pass: <strong className="text-slate-800 font-mono">admin123</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLoginForm({ username: 'admin', password: 'admin123' })}
                  className="px-3 py-1.5 bg-[#ff353e] hover:bg-[#e02831] text-white font-bold rounded-lg text-xs shadow-xs transition-all cursor-pointer shrink-0"
                >
                  Quick Fill
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Username</label>
                <input 
                  id="login-username"
                  type="text" 
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] transition-all text-slate-900 text-sm"
                  placeholder="admin"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Password</label>
                <input 
                  id="login-password"
                  type="password" 
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff353e]/20 focus:border-[#ff353e] transition-all text-slate-900 text-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
              {loginError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}
              <button 
                id="login-submit-btn"
                type="submit"
                className="w-full py-3.5 bg-[#ff353e] hover:bg-[#e02831] text-white font-bold rounded-xl shadow-lg shadow-[#ff353e]/20 transition-all cursor-pointer flex items-center justify-center gap-2 text-sm"
              >
                <span>Sign In to Compliance Portal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        </div>
      ) : (
        <ComplianceAdminDashboard 
          stats={stats}
          complianceStats={complianceStats}
          loading={loading} 
          onRefresh={() => fetchAllStats(startDate, endDate, selectedAgentId, selectedTag)} 
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          onLogout={handleLogout}
          onInspectContact={(phone) => setInspectedPhone(phone)}
          onOpenMasterSettings={() => setShowMasterSettings(true)}
          onOpenDbModal={() => setShowDbModal(true)}
        />
      )}

      {/* Master Settings Modal */}
      <MasterSettingsModal
        isOpen={showMasterSettings}
        onClose={() => setShowMasterSettings(false)}
        onSettingsSaved={() => {
          fetchAllStats(startDate, endDate, selectedAgentId, selectedTag);
        }}
      />

      {/* Contact History Modal */}
      <ContactHistoryModal
        phone={inspectedPhone}
        onClose={() => setInspectedPhone(null)}
      />

      {/* Database Diagnostic & Connection Modal */}
      <AnimatePresence>
        {showDbModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDbModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-200"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#ff353e]/10 text-[#ff353e] rounded-xl flex items-center justify-center">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Database Storage Configuration</h3>
                    <p className="text-xs text-slate-500">MySQL &amp; Persistence Engine Details</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDbModal(false)}
                  className="p-2 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  <XCircle className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className={cn(
                  "p-4 rounded-2xl border flex items-start gap-4",
                  dbStatus?.type === 'postgresql' && dbStatus.isConnected
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-red-50/50 border-red-100 text-slate-800"
                )}>
                  <Server className={cn("w-6 h-6 shrink-0 mt-0.5", dbStatus?.isConnected ? "text-emerald-600" : "text-[#ff353e]")} />
                  <div>
                    <p className="font-bold text-sm">Active Storage Engine: {dbStatus?.type?.toUpperCase() || 'POSTGRESQL'}</p>
                    <p className="text-xs text-slate-600 mt-1">{dbStatus?.statusMessage || 'Database initialized and operational.'}</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Production PostgreSQL Configuration</h4>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">
                    PostgreSQL is required. Link the Render database and run migrations before starting the service:
                  </p>
                  <div className="bg-slate-900 text-slate-100 p-4 rounded-2xl font-mono text-xs overflow-x-auto space-y-1">
                    <div><span className="text-rose-300">DATABASE_URL</span>=postgresql://... (Render secret)</div>
                    <div><span className="text-rose-300">DB_SSL</span>=true</div>
                    <div>npm run db:migrate</div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button 
                  onClick={() => setShowDbModal(false)}
                  className="px-6 py-2.5 bg-[#ff353e] hover:bg-[#e02831] text-white text-xs font-bold rounded-xl transition-all shadow-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Enhanced Compliance Admin Dashboard Component ---
function ComplianceAdminDashboard({
  stats,
  complianceStats,
  loading,
  onRefresh,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  selectedAgentId,
  setSelectedAgentId,
  selectedTag,
  setSelectedTag,
  onLogout,
  onInspectContact,
  onOpenMasterSettings,
  onOpenDbModal,
}: any) {
  const [editingTag, setEditingTag] = useState<{ id: number, name: string, tag: string } | null>(null);
  const [editingName, setEditingName] = useState<{ id: number, name: string } | null>(null);
  const [agentNameError, setAgentNameError] = useState('');
  const [internalContacts, setInternalContacts] = useState<any[]>([]);
  const [showInternalContactsModal, setShowInternalContactsModal] = useState(false);
  const [newInternalContact, setNewInternalContact] = useState({ phone_number: '', label: '' });

  const [callbackListFilter, setCallbackListFilter] = useState<string>('ALL');
  const [drilldownCardType, setDrilldownCardType] = useState<DrilldownCardType | null>(null);

  const handleDrillDown = (type: 'MISSED_INCOMING_CALLBACK' | 'OUTGOING_RECONNECTION' | 'SMS_FOLLOWUP') => {
    setDrilldownCardType(type);
    setCallbackListFilter(type);
  };

  const fetchInternalContacts = async () => {
    try {
      const res = await fetch('/api/internal-contacts');
      const data = await res.json();
      setInternalContacts(data);
    } catch (err) {
      console.error(err);
    }
  };

  const addInternalContact = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/internal-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInternalContact)
      });
      if (res.ok) {
        setNewInternalContact({ phone_number: '', label: '' });
        fetchInternalContacts();
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteInternalContact = async (id: number) => {
    try {
      const res = await fetch(`/api/internal-contacts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchInternalContacts();
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInternalContacts();
  }, []);

  const updateAgentTag = async (id: number, tag: string) => {
    try {
      const res = await fetch('/api/update-agent-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tag })
      });
      if (res.ok) {
        setEditingTag(null);
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateAgentName = async (id: number, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      setAgentNameError('Agent name is required.');
      return;
    }
    try {
      const res = await fetch('/api/update-agent-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: cleanName })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAgentNameError(result.error || 'Unable to update the agent name.');
        return;
      }
      setEditingName(null);
      setAgentNameError('');
      onRefresh();
    } catch {
      setAgentNameError('Unable to reach the server. Please try again.');
    }
  };

  const handleExportExcel = async () => {
    if (!stats) return;

    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        ...(selectedAgentId && { agentId: selectedAgentId }),
        ...(selectedTag && { tag: selectedTag })
      });
      const res = await fetch(`/api/export-full-data?${params.toString()}`);
      const fullEvents = await res.json();

      const complianceAgents = complianceStats?.agents || stats.agents;

      const agentData = complianceAgents?.map((a: any) => ({
        'Agent Name': a.agent_name || a.name,
        'Tag': a.tag || 'Uncategorised',
        'Incoming Callback Met %': a.incoming_callback_compliance_pct ? a.incoming_callback_compliance_pct.toFixed(1) + '%' : 'N/A',
        'Outgoing Reconnect Met %': a.outgoing_reconnect_compliance_pct ? a.outgoing_reconnect_compliance_pct.toFixed(1) + '%' : 'N/A',
        'SMS Follow-up Met %': a.sms_followup_compliance_pct ? a.sms_followup_compliance_pct.toFixed(1) + '%' : 'N/A',
        'Combined Compliance %': a.combined_compliance_pct ? a.combined_compliance_pct.toFixed(1) + '%' : 'N/A',
        'Open Obligations': a.open_obligations_count || 0,
        'Attributed Breaches': a.breaches_attributed_count || 0,
        'Outgoing Calls': a.calls_made,
        'Outgoing Connected': a.calls_outgoing_connected,
        'Incoming Calls': a.calls_incoming,
        'Incoming Connected': a.calls_incoming_connected,
        'Missed Calls': a.calls_missed,
        'SMS Sent': a.sms_count,
      }));

      const detailedCallLogs = fullEvents.map((e: any) => ({
        'Time (UTC+3)': new Date(e.local_timestamp || e.timestamp).toLocaleString(),
        'Agent': e.agent_name,
        'Type': e.type,
        'Target Phone': e.target_phone,
        'Status': e.status,
        'Duration (sec)': e.duration || 0,
      }));

      const wb = XLSX.utils.book_new();
      const wsAgents = XLSX.utils.json_to_sheet(agentData);
      const wsDetailed = XLSX.utils.json_to_sheet(detailedCallLogs);

      XLSX.utils.book_append_sheet(wb, wsAgents, "Solvit Compliance Scorecard");
      XLSX.utils.book_append_sheet(wb, wsDetailed, "Detailed Communication Logs");

      const fileName = `Solvit_Compliance_Report_${startDate}_to_${endDate}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to generate report. Please try again.');
    }
  };

  const agentsList = complianceStats?.agents || stats?.agents || [];
  const openObligations = complianceStats?.open_obligations || [];
  const turnaroundReport = complianceStats?.turnaround_report;
  const allAgents = complianceStats?.allAgents || stats?.allAgents || [];
  const activeSummary = complianceStats?.summary || complianceStats?.raw_summary || stats?.summary || stats?.raw_summary || {};

  const formatMinutes = (minutes: number | null | undefined) => {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return 'N/A';
    if (minutes < 1) return '< 1 min';
    if (minutes >= 60) {
      const hrs = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return `${hrs}h ${mins}m`;
    }
    return `${Math.round(minutes)} min`;
  };

  // Resolve active overall callback metric according to current agent/tag filters
  let activeTurnaroundGroup = turnaroundReport?.company_wide;
  if (selectedAgentId && turnaroundReport?.by_agent?.[Number(selectedAgentId)]) {
    activeTurnaroundGroup = turnaroundReport.by_agent[Number(selectedAgentId)];
  } else if (selectedTag && turnaroundReport?.by_tag?.[selectedTag]) {
    activeTurnaroundGroup = turnaroundReport.by_tag[selectedTag];
  }
  const overallCallbackTAT = activeTurnaroundGroup?.overall_callback_turnaround || activeTurnaroundGroup?.missed_to_first_attempt;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Solvit Response Compliance &amp; SLA Monitor
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Evaluating active obligations against Master Settings thresholds (Nairobi Time UTC+3)
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2.5">
          {/* Exclusions Modal Button */}
          <button 
            id="btn-open-exclusions"
            onClick={() => setShowInternalContactsModal(true)}
            className="px-3.5 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-all h-[36px] flex items-center justify-center gap-1.5 shadow-xs"
          >
            <UserMinus className="w-3.5 h-3.5" />
            Exclusions ({internalContacts.length})
          </button>

          {/* Export Excel Button */}
          <button 
            id="btn-export-excel"
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-[#ff353e] text-white rounded-xl text-xs font-bold hover:bg-[#e02831] transition-all h-[36px] flex items-center justify-center gap-1.5 shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export SLA Report
          </button>

          {/* Agent Filter */}
          <div className="flex flex-col min-w-[130px]">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1">Agent Filter</label>
            <select 
              id="filter-select-agent"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none text-slate-800 h-[36px]"
            >
              <option value="">All Agents</option>
              {allAgents.map((agent: any) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>

          {/* Date range pickers */}
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1">From</label>
            <input 
              id="input-date-from"
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none text-slate-800 h-[36px]"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1">To</label>
            <input 
              id="input-date-to"
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none text-slate-800 h-[36px]"
            />
          </div>

          {/* Refresh button */}
          <button 
            id="btn-refresh-stats"
            onClick={onRefresh}
            className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl transition-all h-[36px] flex items-center justify-center"
            title="Refresh Compliance Data"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-amber-600")} />
          </button>
        </div>
      </div>

      {/* 1. THREE CONSOLIDATED COMPLIANCE & ACTIVITY CARDS */}
      <ConsolidatedMetricCards
        headlineStats={complianceStats?.headline_stats}
        summary={activeSummary}
        turnaroundGroup={activeTurnaroundGroup}
        settings={complianceStats?.settings}
        onDrillDown={handleDrillDown}
      />

      {/* 2. AGENT COMPLIANCE & OPERATIONAL PERFORMANCE TABLE */}
      <ComplianceAgentTable
        agents={agentsList}
        tagGroups={complianceStats?.tag_groups}
        selectedTag={selectedTag}
        onSelectTag={(tag) => setSelectedTag(tag)}
        onEditAgentTag={(agent) => setEditingTag(agent)}
        onEditAgentName={(agent) => {
          setAgentNameError('');
          setEditingName(agent);
        }}
        onInspectAgent={(agentId) => setSelectedAgentId(agentId.toString())}
      />

      {/* Edit Agent Name Modal */}
      {editingName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-sm">
            <h3 className="text-base font-bold text-slate-900 mb-1">Update Agent Name</h3>
            <p className="text-xs text-slate-500 mb-4">The Android app will receive this name during configuration sync.</p>
            <input
              autoFocus
              value={editingName.name}
              onChange={(e) => setEditingName({ ...editingName, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updateAgentName(editingName.id, editingName.name);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              maxLength={191}
            />
            {agentNameError && <p className="mt-2 text-xs font-semibold text-rose-600">{agentNameError}</p>}
            <div className="flex items-center justify-end gap-2 pt-4">
              <button type="button" onClick={() => setEditingName(null)} className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button type="button" onClick={() => updateAgentName(editingName.id, editingName.name)} className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs">Save Name</button>
            </div>
          </div>
        </div>
      )}

      {/* RESPONSE TURNAROUND TIME METRICS (Mean & Median) */}
      {turnaroundReport && (
        <TurnaroundMetricsSection
          report={turnaroundReport}
          selectedTag={selectedTag}
          selectedAgentId={selectedAgentId}
        />
      )}

      {/* 3. ACTIONABLE CALLBACK & RECONNECTION OBLIGATIONS */}
      <CallbackListSection
        obligations={openObligations}
        onInspectContact={(phone) => onInspectContact(phone)}
        selectedTag={selectedTag}
        selectedAgentId={selectedAgentId}
        filterType={callbackListFilter}
        onFilterChange={setCallbackListFilter}
      />

      {/* Edit Agent Tag Modal */}
      {editingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-sm">
            <h3 className="text-base font-bold text-slate-900 mb-1">Update Agent Department Tag</h3>
            <p className="text-xs text-slate-500 mb-4">Set operational role for <strong>{editingTag.name}</strong></p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Select Tag</label>
                <select
                  id="select-agent-tag-modal"
                  value={editingTag.tag}
                  onChange={(e) => setEditingTag({ ...editingTag, tag: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  <option value="Customer Service">Customer Service</option>
                  <option value="Move Consultant">Move Consultant</option>
                  <option value="Operations">Operations</option>
                  <option value="Uncategorised">Uncategorised</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingTag(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => updateAgentTag(editingTag.id, editingTag.tag)}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs"
                >
                  Save Tag
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Internal Exclusions Modal */}
      {showInternalContactsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-purple-50 text-purple-700">
                  <UserMinus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Internal Exclusions List</h3>
                  <p className="text-xs text-slate-500">Phone numbers excluded from compliance evaluation and stats</p>
                </div>
              </div>
              <button
                onClick={() => setShowInternalContactsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 border-b border-slate-100 bg-white">
              <form onSubmit={addInternalContact} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Phone (e.g. 0712345678)"
                  value={newInternalContact.phone_number}
                  onChange={(e) => setNewInternalContact({ ...newInternalContact, phone_number: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  required
                />
                <input
                  type="text"
                  placeholder="Label (e.g. HQ Dispatch)"
                  value={newInternalContact.label}
                  onChange={(e) => setNewInternalContact({ ...newInternalContact, label: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </form>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {internalContacts.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 italic">
                  No excluded internal phone numbers yet.
                </div>
              ) : (
                internalContacts.map((c) => (
                  <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-xs text-slate-900 block">{c.phone_number}</span>
                      <span className="text-[10px] text-slate-400">{c.label || 'Internal Team Member'}</span>
                    </div>
                    <button
                      onClick={() => deleteInternalContact(c.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md"
                      title="Remove Exclusion"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="p-3.5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowInternalContactsModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. CARD DRILLDOWN MODAL (Agent-level Breakdown & Raw Data) */}
      <CardDrilldownModal
        isOpen={!!drilldownCardType}
        onClose={() => setDrilldownCardType(null)}
        cardType={drilldownCardType}
        headlineStats={complianceStats?.headline_stats}
        summary={activeSummary}
        agents={agentsList}
        turnaroundReport={turnaroundReport}
        settings={complianceStats?.settings}
        allObligations={complianceStats?.all_obligations || openObligations}
        allEvents={complianceStats?.all_events || []}
        startDate={startDate}
        endDate={endDate}
        onInspectContact={(phone) => {
          setDrilldownCardType(null);
          onInspectContact(phone);
        }}
        onSelectAgent={(agentId) => {
          setSelectedAgentId(agentId.toString());
          setDrilldownCardType(null);
        }}
      />
    </div>
  );
}
