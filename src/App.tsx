/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, 
  ShieldCheck, 
  Activity, 
  ArrowRight, 
  CheckCircle2,
  XCircle,
  Clock,
  History,
  ChevronRight,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneOff,
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
  Smartphone,
  LayoutDashboard,
  Tag as TagIcon,
  ExternalLink,
  Car,
  Mail
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { MasterSettingsModal } from './components/MasterSettingsModal';
import { TurnaroundMetricsSection } from './components/TurnaroundMetricsSection';
import { ContactHistoryModal } from './components/ContactHistoryModal';
import { ComplianceAgentTable } from './components/ComplianceAgentTable';
import { SearchContactBar } from './components/SearchContactBar';
import { ConsolidatedMetricCards } from './components/ConsolidatedMetricCards';
import { CardDrilldownModal, DrilldownCardType } from './components/CardDrilldownModal';
import { InsuranceCallbackSection } from './components/InsuranceCallbackSection';
import { AgentPerformanceNarrative } from './components/AgentPerformanceNarrative';
import { EmailSlaSection } from './components/EmailSlaSection';
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
  type: 'mysql' | 'sqlite';
  isMysqlConnected: boolean;
  statusMessage: string;
  mysqlHost?: string;
  mysqlDatabase?: string;
}

const getNairobiDate = () => {
  const now = new Date();
  const nairobi = new Date(now.getTime() + (3 * 60 * 60 * 1000));
  return nairobi.toISOString().split('T')[0];
};

const getNairobiYesterday = () => {
  const now = new Date();
  const nairobiYesterday = new Date(now.getTime() + (3 * 60 * 60 * 1000) - (24 * 60 * 60 * 1000));
  return nairobiYesterday.toISOString().split('T')[0];
};

export default function App() {
  const [view, setView] = useState<'admin' | 'insurance-callbacks' | 'email'>('admin');
  const [agentName, setAgentName] = useState<string>('Kelvin Kimathi');
  const [customTemplate, setCustomTemplate] = useState<string>(
    'Hi, this is {agent_name} from Solvit. I tried calling you regarding your inquiry. Please call me back when convenient so we can assist you.'
  );
  const [isRegistered, setIsRegistered] = useState<boolean>(true);
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

  const [startDate, setStartDate] = useState<string>(getNairobiYesterday());
  const [endDate, setEndDate] = useState<string>(getNairobiYesterday());
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isCallbackAgent, setIsCallbackAgent] = useState(false);
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [emailLoginAvailable, setEmailLoginAvailable] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  
  // Selected phone for Contact History Thread Modal
  const [inspectedPhone, setInspectedPhone] = useState<string | null>(null);

  // Load agent profile & custom template for simulator
  useEffect(() => {
    const savedName = localStorage.getItem('solvit_agent_name') || localStorage.getItem('nellions_agent_name');
    const savedTemplate = localStorage.getItem('solvit_sms_template') || localStorage.getItem('nellions_sms_template');
    if (savedTemplate) {
      setCustomTemplate(savedTemplate);
    }
    if (savedName) {
      setAgentName(savedName);
      setIsRegistered(true);
      logAgentToServer(savedName);
    }
  }, []);

  const logAgentToServer = async (name: string) => {
    try {
      const res = await fetch('/api/log-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone_number: 'Simulated' })
      });
      const data = await res.json();
      if (data.agent_id) {
        localStorage.setItem('solvit_agent_id', data.agent_id.toString());
      }
    } catch (err) {
      console.warn('Failed to log agent:', err);
    }
  };

  const handleSaveName = () => {
    if (agentName.trim()) {
      localStorage.setItem('solvit_agent_name', agentName.trim());
      localStorage.setItem('solvit_sms_template', customTemplate);
      setIsRegistered(true);
      logAgentToServer(agentName.trim());
    }
  };

  // The server, not localStorage, determines whether this browser is signed in.
  useEffect(() => {
    fetch('/api/session').then((res) => res.json()).then((session) => {
      setIsAdminAuthenticated(session.role === 'admin');
      setIsCallbackAgent(session.role === 'callback_agent');
      setMemberEmail(session.role === 'cs_member' ? session.email : null);
      setEmailLoginAvailable(Boolean(session.emailLoginAvailable));
      if (session.role === 'cs_member') setView('email');
      if (session.role === 'callback_agent') setView('insurance-callbacks');
      if (new URLSearchParams(window.location.search).has('emailAuthError')) {
        setLoginError('Microsoft sign-in failed or this account is not approved for the CS pilot.');
        window.history.replaceState({}, '', window.location.pathname);
      }
      if (new URLSearchParams(window.location.search).has('emailAuth')) window.history.replaceState({}, '', window.location.pathname);
    }).catch(() => setIsAdminAuthenticated(false));
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
        const data = await res.json().catch(() => ({} as any));
        setLoginForm({ username: '', password: '' });
        if (data.role === 'callback_agent') {
          setIsCallbackAgent(true);
          setView('insurance-callbacks');
        } else {
          setIsAdminAuthenticated(true);
        }
      } else {
        setLoginError('Invalid username or password');
      }
    } catch (err) {
      setLoginError('Server error. Please try again.');
    }
  };

  const handleLogout = () => {
    void fetch('/api/logout', { method: 'POST' });
    setIsAdminAuthenticated(false);
    setIsCallbackAgent(false);
    setMemberEmail(null);
    setView('admin');
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
        ...(agentId && agentId !== 'ALL' && { agentId }),
        ...(tag && tag !== 'ALL' && { tag })
      });

      const fetchJsonSafely = async (url: string, retries = 1, delayMs = 800) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              return await res.json();
            }
            if (attempt < retries && (res.status >= 500 || res.status === 429)) {
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
            return null;
          } catch (err) {
            if (attempt < retries) {
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
            console.warn(`[Stats Sync] Notice fetching ${url}:`, (err as Error).message);
            return null;
          }
        }
        return null;
      };

      const [dataStats, dataCompliance] = await Promise.all([
        fetchJsonSafely(`/api/stats?${params.toString()}`),
        fetchJsonSafely(`/api/compliance-stats?${params.toString()}`)
      ]);

      if (dataStats) {
        setStats(dataStats);
        if (dataStats.db_type) {
          fetchDbStatus();
        }
      }

      if (dataCompliance) {
        setComplianceStats(dataCompliance);
      }
    } catch (err) {
      console.warn('Notice syncing stats:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuthenticated]);

  useEffect(() => {
    if (isAdminAuthenticated) {
      fetchAllStats(startDate, endDate, selectedAgentId, selectedTag);
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
            {isAdminAuthenticated && view === 'admin' && (
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

            {/* View switcher (admins only) */}
            {isAdminAuthenticated && (
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                id="nav-tab-admin-dashboard"
                onClick={() => {
                  setView('admin');
                  if (isAdminAuthenticated) {
                    fetchAllStats(startDate, endDate, selectedAgentId, selectedTag);
                  }
                }}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  view === 'admin' ? "bg-white text-[#ff353e] shadow-xs" : "text-slate-600 hover:text-[#ff353e]"
                )}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Admin Dashboard</span>
              </button>
              <button
                id="nav-tab-insurance-callbacks"
                onClick={() => setView('insurance-callbacks')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  view === 'insurance-callbacks' ? "bg-white text-[#ff353e] shadow-xs" : "text-slate-600 hover:text-[#ff353e]"
                )}
              >
                <Car className="w-3.5 h-3.5" />
                <span>Callbacks</span>
              </button>
              <button
                id="nav-tab-email-sla"
                onClick={() => setView('email')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  view === 'email' ? "bg-white text-[#ff353e] shadow-xs" : "text-slate-600 hover:text-[#ff353e]"
                )}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email SLA</span>
              </button>
            </div>
            )}

            {(isAdminAuthenticated || memberEmail || isCallbackAgent) && (
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
      {!isAdminAuthenticated && !memberEmail && !isCallbackAgent ? (
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
            {emailLoginAvailable && (
              <a
                href="/api/email-auth/start"
                className="mt-3 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-sm border border-slate-200"
              >
                <Mail className="w-4 h-4" />
                <span>Account Managers Sign in with Outlook</span>
              </a>
            )}
          </motion.div>
        </div>
      ) : view === 'email' ? (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <EmailSlaSection employeeEmail={memberEmail || undefined} />
        </main>
      ) : (view === 'insurance-callbacks' || isCallbackAgent) ? (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <InsuranceCallbackSection
            onOpenSettings={isAdminAuthenticated ? () => setShowMasterSettings(true) : undefined}
            allAgents={stats?.allAgents || []}
            canManage={isAdminAuthenticated}
          />
        </main>
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
                  dbStatus?.type === 'mysql' && dbStatus.isMysqlConnected
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-red-50/50 border-red-100 text-slate-800"
                )}>
                  <Server className={cn("w-6 h-6 shrink-0 mt-0.5", dbStatus?.type === 'mysql' ? "text-emerald-600" : "text-[#ff353e]")} />
                  <div>
                    <p className="font-bold text-sm">Active Storage Engine: {dbStatus?.type?.toUpperCase() || 'SQLITE'}</p>
                    <p className="text-xs text-slate-600 mt-1">{dbStatus?.statusMessage || 'Database initialized and operational.'}</p>
                    {dbStatus?.mysqlHost && dbStatus.mysqlHost !== "Not configured" && (
                      <p className="text-xs text-slate-500 mt-1 font-mono">
                        Host: {dbStatus.mysqlHost} | Database: {dbStatus.mysqlDatabase}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Connecting Your Production MySQL Server</h4>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">
                    The backend supports both local SQLite and remote/managed MySQL. Set the environment variables in your server configuration or <code>.env</code> file:
                  </p>
                  <div className="bg-slate-900 text-slate-100 p-4 rounded-2xl font-mono text-xs overflow-x-auto space-y-1">
                    <div><span className="text-rose-300">MYSQL_HOST</span>=your-mysql-server.example.com</div>
                    <div><span className="text-rose-300">MYSQL_PORT</span>=3306</div>
                    <div><span className="text-rose-300">MYSQL_USER</span>=solvit_admin</div>
                    <div><span className="text-rose-300">MYSQL_PASSWORD</span>=your_secure_password</div>
                    <div><span className="text-rose-300">MYSQL_DATABASE</span>=solvit_tracker</div>
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
  const [tagEditMode, setTagEditMode] = useState<'select' | 'create'>('select');
  const [customNewTag, setCustomNewTag] = useState<string>('');
  const [selectedTagValue, setSelectedTagValue] = useState<string>('Uncategorised');
  const [isUpdatingTag, setIsUpdatingTag] = useState<boolean>(false);

  // Agent deletion state with type-to-confirm protection
  const [agentToDelete, setAgentToDelete] = useState<{ id: number, name: string } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState<string>('');
  const [isDeletingAgent, setIsDeletingAgent] = useState<boolean>(false);
  const [contactToDelete, setContactToDelete] = useState<number | null>(null);

  const [internalContacts, setInternalContacts] = useState<any[]>([]);
  const [showInternalContactsModal, setShowInternalContactsModal] = useState(false);
  const [newInternalContact, setNewInternalContact] = useState({ phone_number: '', label: '' });

  const [drilldownCardType, setDrilldownCardType] = useState<DrilldownCardType | null>(null);

  const handleDrillDown = (type: 'MISSED_INCOMING_CALLBACK' | 'OUTGOING_RECONNECTION' | 'SMS_FOLLOWUP') => {
    setDrilldownCardType(type);
  };

  const openDeleteAgentModal = (agent: { id: number, name: string }) => {
    setAgentToDelete(agent);
    setDeleteConfirmInput('');
  };

  const openEditTagModal = (agent: { id: number, name: string, tag: string }) => {
    setEditingTag(agent);
    setSelectedTagValue(agent.tag || 'Uncategorised');
    setCustomNewTag('');
    setTagEditMode('select');
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
    const finalTag = tag.trim();
    if (!finalTag) return;
    setIsUpdatingTag(true);
    try {
      const res = await fetch('/api/update-agent-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tag: finalTag })
      });
      if (res.ok) {
        setEditingTag(null);
        setCustomNewTag('');
        setTagEditMode('select');
        onRefresh();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update tag');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update tag. Please check server connection.');
    } finally {
      setIsUpdatingTag(false);
    }
  };

  const handleDeleteAgent = async (id: number) => {
    setIsDeletingAgent(true);
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        if (selectedAgentId === id.toString()) {
          setSelectedAgentId('');
        }
        setAgentToDelete(null);
        setDeleteConfirmInput('');
        onRefresh();
      } else {
        alert(data.error || 'Failed to delete agent');
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
      alert('Failed to delete agent. Please check server connection.');
    } finally {
      setIsDeletingAgent(false);
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

      const agentData = complianceAgents?.map((a: AgentComplianceSummary) => ({
        'Agent Name': a.agent_name,
        'Tag': a.tag || 'Uncategorised',
        'Missed': a.calls_missed,
        'Outgoing Connected': a.calls_outgoing_connected,
        'Outgoing Made': a.calls_made,
        'Called Back': a.incoming_callback_met,
        'Called Back Total': a.incoming_callback_total,
        'SMS Follow-Through': a.sms_followup_met,
        'SMS Follow-Through Total': a.sms_followup_total,
        'Carried Over': a.carried_over_count || 0,
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

  const existingTagsList = useMemo(() => {
    const defaultTags = ['Customer Service', 'Move Consultant', 'Operations', 'Callback Team', 'Uncategorised'];
    const agentTags = (agentsList || []).map((a: any) => a.tag).filter(Boolean);
    return Array.from(new Set([...defaultTags, ...agentTags]));
  }, [agentsList]);

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

  // Type-to-delete confirmation logic
  const isDeleteConfirmed = Boolean(
    agentToDelete && (
      deleteConfirmInput.trim().toUpperCase() === 'DELETE' ||
      deleteConfirmInput.trim().toLowerCase() === agentToDelete.name.trim().toLowerCase()
    )
  );

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

          {/* Today Button */}
          <div className="flex flex-col justify-end">
            <button
              id="btn-set-date-today"
              type="button"
              onClick={() => {
                const today = getNairobiDate();
                setStartDate(today);
                setEndDate(today);
              }}
              className="px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl transition-all text-xs h-[36px] flex items-center justify-center cursor-pointer shadow-2xs"
              title="Set date range to today"
            >
              Today
            </button>
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

      {/* 1. RESPONSE TURNAROUND TIME METRICS (Mean & Median) */}
      {turnaroundReport && (
        <TurnaroundMetricsSection
          report={turnaroundReport}
          selectedTag={selectedTag}
          selectedAgentId={selectedAgentId}
        />
      )}

      {/* 2. THREE CONSOLIDATED COMPLIANCE & ACTIVITY CARDS (Incoming Calls, Outgoing, SMS) */}
      <ConsolidatedMetricCards
        headlineStats={complianceStats?.headline_stats}
        summary={activeSummary}
        turnaroundGroup={activeTurnaroundGroup}
        settings={complianceStats?.settings}
        onDrillDown={handleDrillDown}
      />

      {/* 3. AGENT COMPLIANCE & OPERATIONAL PERFORMANCE TABLE */}
      <ComplianceAgentTable
        agents={agentsList}
        tagGroups={complianceStats?.tag_groups}
        selectedTag={selectedTag}
        onSelectTag={(tag) => setSelectedTag(tag)}
        onEditAgentTag={(agent) => openEditTagModal(agent)}
        onInspectAgent={(agentId) => setSelectedAgentId(agentId.toString())}
        onDeleteAgent={(agent) => openDeleteAgentModal(agent)}
        onRemoveAgent={(agent) => openDeleteAgentModal(agent)}
        allObligations={complianceStats?.all_obligations || openObligations}
        allEvents={complianceStats?.all_events || []}
        turnaroundReport={complianceStats?.turnaround_report}
        startDate={startDate}
        endDate={endDate}
        onInspectContact={(phone) => onInspectContact(phone)}
      />

      {/* 4. CUSTOMER SERVICE PERFORMANCE SUMMARY */}
      <AgentPerformanceNarrative
        agents={agentsList}
        turnaroundReport={turnaroundReport}
      />

      {/* Edit Agent Tag Modal with Create New Tag feature */}
      {editingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <TagIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Update Team Tag</h3>
                <p className="text-xs text-slate-500">
                  Assign team role or create a new tag for <strong>{editingTag.name}</strong>
                </p>
              </div>
            </div>

            {/* Mode selection tabs */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl mb-4 text-xs font-semibold">
              <button
                type="button"
                id="tab-select-existing-tag"
                onClick={() => setTagEditMode('select')}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  tagEditMode === 'select'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TagIcon className="w-3.5 h-3.5" />
                Select Existing
              </button>
              <button
                type="button"
                id="tab-create-new-tag"
                onClick={() => setTagEditMode('create')}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  tagEditMode === 'create'
                    ? 'bg-white text-amber-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-amber-600" />
                Create New Tag
              </button>
            </div>

            <div className="space-y-4">
              {tagEditMode === 'select' ? (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">
                    Choose from Active Tags
                  </label>
                  <select
                    id="select-agent-tag-modal"
                    value={selectedTagValue}
                    onChange={(e) => {
                      if (e.target.value === '__CREATE_NEW__') {
                        setTagEditMode('create');
                      } else {
                        setSelectedTagValue(e.target.value);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white text-slate-900"
                  >
                    {existingTagsList.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                    <option value="__CREATE_NEW__" className="font-bold text-amber-600">
                      + Create New Tag...
                    </option>
                  </select>

                  {/* Quick Select Tag Pills */}
                  <div className="mt-3">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">Quick Select:</span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {existingTagsList.map((tag) => {
                        const isSelected = selectedTagValue === tag;
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setSelectedTagValue(tag)}
                            className={`px-2.5 py-1 rounded-lg text-xs transition-all border ${
                              isSelected
                                ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold shadow-2xs'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setTagEditMode('create')}
                      className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Need a tag not in this list? Create a new tag
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">
                    Enter New Tag Name
                  </label>
                  <input
                    id="input-create-new-tag"
                    type="text"
                    value={customNewTag}
                    onChange={(e) => setCustomNewTag(e.target.value)}
                    placeholder="e.g. Sales, VIP Support, Claims, Retention"
                    autoFocus
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customNewTag.trim()) {
                        e.preventDefault();
                        updateAgentTag(editingTag.id, customNewTag.trim());
                      }
                    }}
                  />
                  
                  {/* Tag Preview */}
                  {customNewTag.trim() && (
                    <div className="mt-2.5 flex items-center gap-2 p-2.5 bg-amber-50/60 border border-amber-200 rounded-xl text-xs">
                      <span className="text-slate-500 text-[11px] font-medium">Preview:</span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        <TagIcon className="w-3 h-3 text-amber-600" />
                        {customNewTag.trim()}
                      </span>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 mt-2">
                    Creating this tag will immediately apply it to <strong>{editingTag.name}</strong> and add it to the system team filters.
                  </p>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setTagEditMode('select')}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                      ← Back to existing tags
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  id="btn-cancel-edit-tag"
                  disabled={isUpdatingTag}
                  onClick={() => {
                    setEditingTag(null);
                    setCustomNewTag('');
                    setTagEditMode('select');
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-save-agent-tag"
                  disabled={isUpdatingTag || (tagEditMode === 'create' && !customNewTag.trim())}
                  onClick={() => {
                    const tagToSave = tagEditMode === 'create' ? customNewTag.trim() : selectedTagValue;
                    updateAgentTag(editingTag.id, tagToSave);
                  }}
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isUpdatingTag ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    tagEditMode === 'create' ? 'Create & Apply Tag' : 'Save Tag'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Agent Confirmation Modal with Type-to-Delete Protection */}
      {agentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Agent</h3>
                <p className="text-xs text-slate-500 mt-1">
                  You are about to delete <strong>{agentToDelete.name}</strong> from the active agent list.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-600 mb-4 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Operational Impact:</span>
              </div>
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-4">
                <li>The agent will be permanently removed from this performance roster and team views.</li>
                <li>Past call records and communication logs remain preserved in the audit history.</li>
                <li>Active task assignments will be safely unlinked.</li>
              </ul>
            </div>

            {/* Type-to-delete confirmation prompt box */}
            <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-xl mb-5 space-y-2.5">
              <label htmlFor="input-type-to-delete-agent" className="block text-xs font-bold text-rose-950">
                To confirm deletion, please type <span className="font-mono bg-white px-2 py-0.5 rounded border border-rose-300 text-rose-600 font-bold select-all">DELETE</span> below:
              </label>
              <input
                id="input-type-to-delete-agent"
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder='Type "DELETE" to confirm'
                autoFocus
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-xs font-medium outline-none transition-all ${
                  isDeleteConfirmed
                    ? 'border-emerald-500 ring-2 ring-emerald-400/30 text-slate-900 font-semibold'
                    : 'border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-400/30 text-slate-900'
                }`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isDeleteConfirmed && !isDeletingAgent) {
                    e.preventDefault();
                    handleDeleteAgent(agentToDelete.id);
                  }
                }}
              />
              <div className="flex items-center justify-between text-[11px]">
                {isDeleteConfirmed ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Confirmation text verified. Ready to delete.
                  </span>
                ) : (
                  <span className="text-rose-600 font-medium">
                    {deleteConfirmInput ? 'Text does not match. Please type DELETE.' : 'Type DELETE to unlock the delete button.'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                id="btn-cancel-delete-agent"
                type="button"
                disabled={isDeletingAgent}
                onClick={() => {
                  setAgentToDelete(null);
                  setDeleteConfirmInput('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-delete-agent"
                type="button"
                disabled={!isDeleteConfirmed || isDeletingAgent}
                onClick={() => handleDeleteAgent(agentToDelete.id)}
                className={`px-4 py-2 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 ${
                  isDeleteConfirmed && !isDeletingAgent
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer ring-2 ring-rose-300'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 opacity-60'
                }`}
              >
                {isDeletingAgent ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Agent
                  </>
                )}
              </button>
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
                    {contactToDelete === c.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-rose-600 font-semibold">Delete?</span>
                        <button
                          type="button"
                          onClick={() => {
                            deleteInternalContact(c.id);
                            setContactToDelete(null);
                          }}
                          className="px-2 py-0.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setContactToDelete(null)}
                          className="px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-md"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setContactToDelete(c.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="Delete Exclusion"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3.5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => {
                  setShowInternalContactsModal(false);
                  setContactToDelete(null);
                }}
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

// --- Agent Android App Simulator Component ---
function AgentPreview({ 
  agentName, 
  setAgentName, 
  customTemplate, 
  setCustomTemplate, 
  isRegistered, 
  setIsRegistered, 
  handleSaveName,
  onSwitchToAdmin
}: any) {
  const [showOverlay, setShowOverlay] = useState<boolean>(false);
  const [lastCallNumber, setLastCallNumber] = useState<string>('0712 345 678');
  const [smsSent, setSmsSent] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(60);
  const [callDuration, setCallDuration] = useState<number>(45);
  const [seedingLoading, setSeedingLoading] = useState<boolean>(false);
  const [simulationLog, setSimulationLog] = useState<Array<{
    id: string;
    time: string;
    type: string;
    phone: string;
    status: string;
    detail: string;
  }>>([]);

  const addLog = (type: string, phone: string, status: string, detail: string) => {
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setSimulationLog(prev => [
      { id: Math.random().toString(), time: timeStr, type, phone, status, detail },
      ...prev.slice(0, 9)
    ]);
  };

  const triggerCallEvent = async (status: string, duration = 0) => {
    setShowOverlay(status === 'MISSED');
    if (status === 'MISSED') {
      setCountdown(60);
      setSmsSent(false);
    }

    const effectiveName = (agentName || 'Kelvin Kimathi').trim();
    if (!isRegistered) {
      handleSaveName();
    }

    try {
      const res = await fetch('/api/log-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: effectiveName,
          type: 'CALL',
          target_phone: lastCallNumber,
          status: status,
          duration: duration
        })
      });
      if (res.ok) {
        addLog('CALL', lastCallNumber, status, duration > 0 ? `Duration: ${duration}s` : 'Call event logged');
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    let timer: any;
    if (showOverlay && countdown > 0) {
      timer = setInterval(() => setCountdown((prev: number) => prev - 1), 1000);
    } else if (countdown === 0) {
      setShowOverlay(false);
    }
    return () => clearInterval(timer);
  }, [showOverlay, countdown]);

  const handleSendSms = async () => {
    setSmsSent(true);
    const effectiveName = (agentName || 'Kelvin Kimathi').trim();

    try {
      const res = await fetch('/api/log-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: effectiveName,
          type: 'SMS',
          target_phone: lastCallNumber,
          status: 'SENT'
        })
      });
      if (res.ok) {
        addLog('SMS', lastCallNumber, 'SENT', 'Auto follow-up SMS text dispatched');
      }
    } catch (err) {
      console.error(err);
    }

    setTimeout(() => {
      setShowOverlay(false);
      setSmsSent(false);
    }, 2000);
  };

  const handleSeedFullScenario = async () => {
    setSeedingLoading(true);
    try {
      const res = await fetch('/api/seed-simulation', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        addLog('SYSTEM', 'Multi-Agent', 'SEEDED', data.message || 'Seeded realistic daily activity scenario');
        if (onSwitchToAdmin) {
          setTimeout(() => onSwitchToAdmin(), 800);
        }
      }
    } catch (err) {
      console.error('Failed to seed simulation:', err);
    } finally {
      setSeedingLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#ff353e]/10 text-[#ff353e] flex items-center justify-center font-bold">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Solvit Android Tracker Simulator</h2>
              <p className="text-xs text-slate-500">Test call events, durations, obligations, and SLA compliance</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSeedFullScenario}
              disabled={seedingLoading}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              title="Populate complete demo dataset with multiple agents, calls, callbacks, and obligations"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", seedingLoading && "animate-spin")} />
              <span>{seedingLoading ? 'Generating...' : '⚡ Seed Full Scenario Data'}</span>
            </button>

            {onSwitchToAdmin && (
              <button
                onClick={onSwitchToAdmin}
                className="px-4 py-2 bg-[#ff353e] hover:bg-[#e02831] text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <span>View Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Profile Setup */}
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Simulated Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Kelvin Kimathi"
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-[#ff353e] outline-none"
              />
            </div>
            <button
              onClick={handleSaveName}
              className="px-5 py-2 bg-[#ff353e] text-white rounded-xl text-xs font-bold hover:bg-[#e02831] shadow-xs cursor-pointer"
            >
              Save Agent
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="w-full sm:w-1/2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Target Customer Phone Number</label>
              <input
                type="text"
                value={lastCallNumber}
                onChange={(e) => setLastCallNumber(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div className="w-full sm:w-1/2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Simulated Connected Duration (Sec)</label>
              <input
                type="number"
                value={callDuration}
                onChange={(e) => setCallDuration(Number(e.target.value) || 0)}
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Action Triggers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Simulate Incoming &amp; Outgoing Calls</h3>
            <span className="text-[11px] text-slate-500 font-medium">Click any action to emit real-time event to database</span>
          </div>

          {/* Incoming Calls Section */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <PhoneIncoming className="w-3.5 h-3.5 text-blue-600" />
              <span>Incoming Customer Calls</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => triggerCallEvent('MISSED', 0)}
                className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-rose-600 font-bold mb-1 flex items-center justify-between">
                  <span>1. Incoming Missed Call</span>
                  <PhoneIncoming className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-rose-600 font-normal block">Customer called, agent missed. Triggers 30m callback SLA</span>
              </button>

              <button
                onClick={() => triggerCallEvent('INCOMING', callDuration)}
                className="p-3.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-blue-600 font-bold mb-1 flex items-center justify-between">
                  <span>2. Incoming Answered Call</span>
                  <PhoneCall className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-blue-600 font-normal block">Inbound call answered directly ({callDuration}s duration)</span>
              </button>

              <button
                onClick={() => triggerCallEvent('CONNECTED', callDuration)}
                className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-emerald-600 font-bold mb-1 flex items-center justify-between">
                  <span>3. Incoming Callback Connected</span>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-emerald-600 font-normal block">Agent successfully connected callback ({callDuration}s)</span>
              </button>
            </div>
          </div>

          {/* Outgoing Calls Section */}
          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <PhoneOutgoing className="w-3.5 h-3.5 text-amber-600" />
              <span>Outgoing Agent Calls &amp; Follow-ups</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => triggerCallEvent('NOT_PICKED', 0)}
                className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-amber-600 font-bold mb-1 flex items-center justify-between">
                  <span>4. Outgoing Unanswered / Failed</span>
                  <PhoneOff className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-amber-600 font-normal block">Agent called, customer did not answer. Triggers 24h reconnect SLA</span>
              </button>

              <button
                onClick={() => triggerCallEvent('CONNECTED', callDuration)}
                className="p-3.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-teal-600 font-bold mb-1 flex items-center justify-between">
                  <span>5. Outgoing Connected Call</span>
                  <PhoneOutgoing className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-teal-600 font-normal block">Agent dialed customer &amp; spoke ({callDuration}s duration)</span>
              </button>

              <button
                onClick={handleSendSms}
                className="p-3.5 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 text-xs font-bold text-left transition-colors cursor-pointer"
              >
                <div className="text-purple-600 font-bold mb-1 flex items-center justify-between">
                  <span>6. Outgoing Follow-up SMS</span>
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] text-purple-600 font-normal block">Dispatches follow-up SMS to customer</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Simulation Feed */}
        {simulationLog.length > 0 && (
          <div className="p-4 bg-slate-900 rounded-2xl text-slate-100 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                Live Ingestion Stream
              </span>
              <span className="text-[10px] text-slate-400">Showing last {simulationLog.length} events</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {simulationLog.map(item => (
                <div key={item.id} className="flex items-center justify-between text-[11px] py-0.5 border-b border-slate-800/40">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{item.time}</span>
                    <span className={cn(
                      "px-1.5 py-0.2 rounded font-bold text-[10px]",
                      item.status === 'MISSED' ? "bg-rose-900/60 text-rose-300" :
                      item.status === 'CONNECTED' ? "bg-emerald-900/60 text-emerald-300" :
                      item.status === 'SENT' ? "bg-purple-900/60 text-purple-300" :
                      "bg-amber-900/60 text-amber-300"
                    )}>
                      {item.type} • {item.status}
                    </span>
                    <span className="text-slate-300">{item.phone}</span>
                  </div>
                  <span className="text-slate-400 text-[10px]">{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Floating Overlay Simulation */}
        {showOverlay && (
          <div className="mt-8 p-5 bg-[#ff353e] text-white rounded-2xl shadow-xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-red-100 block">Solvit Quick Response Overlay</span>
              <p className="text-sm font-bold mt-0.5">Missed call from {lastCallNumber}</p>
              <p className="text-xs text-red-100">Auto-dismisses in {countdown}s</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => triggerCallEvent('CONNECTED', 30)}
                className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Call Back Now
              </button>
              <button
                onClick={handleSendSms}
                className="px-4 py-2 bg-white text-[#ff353e] rounded-xl text-xs font-bold hover:bg-red-50 cursor-pointer"
              >
                {smsSent ? 'SMS Sent!' : 'Send SMS Follow-up'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
