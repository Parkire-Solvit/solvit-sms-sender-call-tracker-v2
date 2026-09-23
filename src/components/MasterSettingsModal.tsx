import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Clock, 
  Calendar, 
  MessageSquare, 
  PhoneCall, 
  CheckCircle2, 
  AlertCircle, 
  Save, 
  RotateCcw, 
  History, 
  X,
  Info,
  ShieldCheck,
  Car,
  Users,
  Mail,
  Send,
  Trash2,
  Plus,
  Lock,
  Building2,
  UserPlus,
  Key,
  Power,
  UserCheck,
  UserX,
  RefreshCw,
} from 'lucide-react';
import { SystemSettings, SettingsChangeLog, DEFAULT_SETTINGS } from '../types/compliance';
import { CallbackSettings, UserAccount, ChannelPartnerAllocation } from '../types/callbacks';

interface MasterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: () => void;
}

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

export const MasterSettingsModal: React.FC<MasterSettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'schedule' | 'logs' | 'insurance' | 'users'>('rules');
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [callbackSettings, setCallbackSettings] = useState<CallbackSettings>({
    id: 1,
    staff_count: 2,
    callback_team_tag: 'Callback Team',
    max_attempts: 4,
  });
  const [logs, setLogs] = useState<SettingsChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Team Accounts (Users) state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userSuccess, setUserSuccess] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Channel Partner Allocations state
  const [partnerAllocations, setPartnerAllocations] = useState<ChannelPartnerAllocation[]>([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);

  // (Daily-summary/Gmail email settings intentionally omitted — Email SLA is a
  // separate feature owned elsewhere and is not part of this settings modal.)

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      fetchCallbackSettings();
      fetchUsers();
      fetchAllocations();
    }
  }, [isOpen]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setUserError(null);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else {
        setUserError('Failed to fetch team accounts');
      }
    } catch (err) {
      setUserError('Network error loading team accounts');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim() || !newDisplayName.trim()) {
      setUserError('Please fill in all fields (username, display name, and password).');
      return;
    }
    setIsCreatingUser(true);
    setUserError(null);
    setUserSuccess(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword.trim(),
          display_name: newDisplayName.trim(),
        }),
      });
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        setNewDisplayName('');
        setUserSuccess('Team user account created successfully.');
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setUserError(data.error || 'Failed to create user account');
      }
    } catch (err) {
      setUserError('Network error while creating user');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleToggleUserActive = async (u: UserAccount) => {
    setUserError(null);
    setUserSuccess(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !u.active }),
      });
      if (res.ok) {
        setUserSuccess(`Account "${u.username}" status updated to ${!u.active ? 'Active' : 'Disabled'}.`);
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setUserError(data.error || 'Failed to update user status');
      }
    } catch (err) {
      setUserError('Network error updating user status');
    }
  };

  const handleSaveDisplayName = async (userId: number) => {
    if (!editingDisplayName.trim()) return;
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: editingDisplayName.trim() }),
      });
      if (res.ok) {
        setEditingUserId(null);
        setEditingDisplayName('');
        setUserSuccess('Display name updated successfully.');
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setUserError(data.error || 'Failed to update display name');
      }
    } catch (err) {
      setUserError('Network error updating display name');
    }
  };

  const handleResetPassword = async (userId: number) => {
    if (!resetNewPassword.trim()) {
      setUserError('Please provide a new password.');
      return;
    }
    setIsResettingPassword(true);
    setUserError(null);
    setUserSuccess(null);
    try {
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: resetNewPassword.trim() }),
      });
      if (res.ok) {
        setUserSuccess('Password updated successfully.');
        setResettingUserId(null);
        setResetNewPassword('');
      } else {
        const data = await res.json().catch(() => ({}));
        setUserError(data.error || 'Failed to reset password');
      }
    } catch (err) {
      setUserError('Network error resetting password');
    } finally {
      setIsResettingPassword(false);
    }
  };

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
      console.warn('Failed to load allocations:', err);
    } finally {
      setLoadingAllocations(false);
    }
  };

  const handleUpdateAllocation = async (partner: string, agentId: number | null) => {
    try {
      const res = await fetch('/api/channel-partner-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_partner: partner, assigned_agent_id: agentId }),
      });
      if (res.ok) {
        fetchAllocations();
      }
    } catch (err) {
      console.error('Failed to update allocation:', err);
    }
  };

  const fetchCallbackSettings = async () => {
    try {
      const res = await fetch('/api/callback-settings');
      if (res.ok) {
        const data = await res.json();
        setCallbackSettings(data);
      }
    } catch (err) {
      console.warn('Failed to load callback settings in master modal', err);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
        }
        if (data.logs) {
          setLogs(data.logs);
        }
      }
    } catch (err) {
      console.warn('Failed to load settings:', err);
      setSaveError('Could not load current settings from server.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      const settingsPayload: any = {
        ...settings,
      };

      const [resSettings, resCallback] = await Promise.all([
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: settingsPayload,
            changed_by: 'Admin Portal User',
          }),
        }),
        fetch('/api/callback-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staff_count: callbackSettings.staff_count,
            callback_team_tag: callbackSettings.callback_team_tag,
            max_attempts: callbackSettings.max_attempts,
          }),
        }),
      ]);

      if (resSettings.ok && resCallback.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3500);
        if (onSettingsSaved) onSettingsSaved();
        fetchSettings(); // Refresh logs
        fetchCallbackSettings();
      } else {
        const errData = !resSettings.ok ? await resSettings.json() : await resCallback.json();
        setSaveError(errData.error || 'Failed to save settings.');
      }
    } catch (err) {
      setSaveError('Network error while saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (confirm('Are you sure you want to reset all compliance settings to system defaults?')) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  if (!isOpen) return null;

  return (
    <div id="master-settings-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div id="master-settings-modal" className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 font-semibold shadow-xs">
              <SettingsIcon className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Master Compliance Rules &amp; Schedule
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Admin Only
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Centralized evaluation thresholds, working hours, and response obligation rules.
              </p>
            </div>
          </div>
          <button
            id="close-master-settings-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 px-6 gap-2 bg-slate-50/30">
          <button
            id="tab-compliance-rules-btn"
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'rules'
                ? 'border-amber-600 text-amber-700 bg-white shadow-xs rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Clock className="w-4 h-4" />
            Response Windows &amp; Logic
          </button>
          <button
            id="tab-schedule-btn"
            onClick={() => setActiveTab('schedule')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'schedule'
                ? 'border-amber-600 text-amber-700 bg-white shadow-xs rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Working Hours &amp; Clock Mode
          </button>
          <button
            id="tab-change-logs-btn"
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'logs'
                ? 'border-amber-600 text-amber-700 bg-white shadow-xs rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <History className="w-4 h-4" />
            Audit &amp; Change Log ({logs.length})
          </button>
          <button
            id="tab-insurance-callbacks-btn"
            onClick={() => setActiveTab('insurance')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'insurance'
                ? 'border-amber-600 text-amber-700 bg-white shadow-xs rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Car className="w-4 h-4 text-[#ff353e]" />
            Callbacks
          </button>
          <button
            id="tab-team-accounts-btn"
            onClick={() => {
              setActiveTab('users');
              fetchUsers();
            }}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'users'
                ? 'border-indigo-600 text-indigo-700 bg-white shadow-xs rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600" />
            Team Accounts ({users.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-slate-400">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-amber-600" />
              <p className="text-sm">Loading current master settings...</p>
            </div>
          ) : (
            <>
              {saveSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span><strong>Settings saved successfully.</strong> All downstream compliance evaluation metrics will immediately use these thresholds.</span>
                </div>
              )}

              {saveError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {/* TAB 1: RESPONSE WINDOWS & LOGIC */}
              {activeTab === 'rules' && (
                <div className="space-y-6">
                  {/* Missed Incoming Callback */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                          <PhoneCall className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Missed Incoming Call Callback Window</h3>
                          <p className="text-xs text-slate-500">
                            Time within which a missed incoming call must result in a connected call back to that number.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="input-callback-window-minutes"
                          type="number"
                          min="1"
                          max="10080"
                          value={settings.callback_window_minutes}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              callback_window_minutes: Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="w-24 px-3 py-1.5 text-right font-mono font-bold text-slate-900 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        />
                        <span className="text-xs font-semibold text-slate-500">minutes</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>Default is 30 minutes. If multiple missed calls arrive from the same number, deduplication keeps one open obligation.</span>
                    </div>
                  </div>

                  {/* Outgoing Reconnection Window */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                          <PhoneCall className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Outgoing Call Reconnection Window</h3>
                          <p className="text-xs text-slate-500">
                            Time within which an outgoing call that did not connect must be retried and connected.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="input-reconnection-window-minutes"
                          type="number"
                          min="1"
                          max="20160"
                          value={settings.reconnection_window_minutes}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              reconnection_window_minutes: Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="w-24 px-3 py-1.5 text-right font-mono font-bold text-slate-900 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        />
                        <span className="text-xs font-semibold text-slate-500">minutes ({Math.round(settings.reconnection_window_minutes / 60)}h)</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>Default is 1440 minutes (24 hours). Reconnecting connects with that customer number.</span>
                    </div>
                  </div>

                  {/* SMS Follow-up Rules */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">SMS Follow-up Requirement</h3>
                          <p className="text-xs text-slate-500">
                            Require an SMS follow-up after an unconnected outgoing call.
                          </p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          id="toggle-sms-followup-enabled"
                          type="checkbox"
                          checked={settings.sms_followup_enabled}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              sms_followup_enabled: e.target.checked,
                            })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                      </label>
                    </div>

                    {settings.sms_followup_enabled && (
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          SMS Follow-up Deadline (after failed outgoing call):
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            id="input-sms-deadline-minutes"
                            type="number"
                            min="1"
                            max="1440"
                            value={settings.sms_deadline_minutes}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                sms_deadline_minutes: Math.max(1, parseInt(e.target.value) || 1),
                              })
                            }
                            className="w-24 px-3 py-1.5 text-right font-mono font-bold text-slate-900 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          />
                          <span className="text-xs font-semibold text-slate-500">minutes</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Minimum Call Duration */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Minimum Connected Call Duration</h3>
                          <p className="text-xs text-slate-500">
                            Minimum duration in seconds for a call to qualify as a valid &quot;Connected&quot; resolution.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="input-min-connection-duration"
                          type="number"
                          min="0"
                          max="600"
                          value={settings.min_connection_duration}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              min_connection_duration: Math.max(0, parseInt(e.target.value) || 0),
                            })
                          }
                          className="w-24 px-3 py-1.5 text-right font-mono font-bold text-slate-900 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        />
                        <span className="text-xs font-semibold text-slate-500">seconds</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>Set to 0 if any connection status counts. If set to e.g. 10s, accidental 1-second pick-and-drops will not clear obligations.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SCHEDULE & CLOCK MODE */}
              {activeTab === 'schedule' && (
                <div className="space-y-6">
                  {/* Clock Mode Selector */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Compliance Clock Calculation Mode</h3>
                        <p className="text-xs text-slate-500">
                          Determines whether countdowns pause outside working business hours.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <label
                        id="radio-clock-mode-working-hours"
                        className={`flex items-start p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                          settings.clock_mode === 'working_hours'
                            ? 'border-amber-600 bg-amber-50/40 text-slate-900'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="clock_mode"
                          value="working_hours"
                          checked={settings.clock_mode === 'working_hours'}
                          onChange={() => setSettings({ ...settings, clock_mode: 'working_hours' })}
                          className="mt-0.5 mr-3 text-amber-600 focus:ring-amber-500"
                        />
                        <div>
                          <span className="text-xs font-bold block text-slate-900">Working Hours Only (Recommended)</span>
                          <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                            Compliance countdowns pause outside of working hours and automatically resume at next opening.
                          </span>
                        </div>
                      </label>

                      <label
                        id="radio-clock-mode-continuous"
                        className={`flex items-start p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                          settings.clock_mode === 'continuous_24_7'
                            ? 'border-amber-600 bg-amber-50/40 text-slate-900'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="clock_mode"
                          value="continuous_24_7"
                          checked={settings.clock_mode === 'continuous_24_7'}
                          onChange={() => setSettings({ ...settings, clock_mode: 'continuous_24_7' })}
                          className="mt-0.5 mr-3 text-amber-600 focus:ring-amber-500"
                        />
                        <div>
                          <span className="text-xs font-bold block text-slate-900">Continuous 24/7 Clock</span>
                          <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                            Countdowns run non-stop regardless of day, night, or weekend hours.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Day by Day Schedule */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Company Working Hours Schedule (Nairobi Time UTC+3)</h3>
                      <p className="text-xs text-slate-500">
                        Configure opening and closing times for each day of the week.
                      </p>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {DAYS_OF_WEEK.map(({ key, label }) => {
                        const dayConfig = settings.working_hours_schedule[key] || {
                          enabled: false,
                          open: '09:00',
                          close: '17:00',
                        };
                        return (
                          <div
                            key={key}
                            className={`py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                              !dayConfig.enabled ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 w-36">
                              <input
                                id={`checkbox-day-${key}`}
                                type="checkbox"
                                checked={dayConfig.enabled}
                                onChange={(e) => {
                                  setSettings({
                                    ...settings,
                                    working_hours_schedule: {
                                      ...settings.working_hours_schedule,
                                      [key]: { ...dayConfig, enabled: e.target.checked },
                                    },
                                  });
                                }}
                                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                              />
                              <span className="text-xs font-bold text-slate-800">{label}</span>
                            </div>

                            {dayConfig.enabled ? (
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-slate-400 font-medium">Opens:</span>
                                  <input
                                    id={`input-open-${key}`}
                                    type="time"
                                    value={dayConfig.open}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        working_hours_schedule: {
                                          ...settings.working_hours_schedule,
                                          [key]: { ...dayConfig, open: e.target.value },
                                        },
                                      });
                                    }}
                                    className="px-2.5 py-1 text-xs font-mono font-medium border border-slate-300 rounded-md focus:ring-1 focus:ring-amber-500 outline-none"
                                  />
                                </div>
                                <span className="text-slate-300">&mdash;</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-slate-400 font-medium">Closes:</span>
                                  <input
                                    id={`input-close-${key}`}
                                    type="time"
                                    value={dayConfig.close}
                                    onChange={(e) => {
                                      setSettings({
                                        ...settings,
                                        working_hours_schedule: {
                                          ...settings.working_hours_schedule,
                                          [key]: { ...dayConfig, close: e.target.value },
                                        },
                                      });
                                    }}
                                    className="px-2.5 py-1 text-xs font-mono font-medium border border-slate-300 rounded-md focus:ring-1 focus:ring-amber-500 outline-none"
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs italic text-slate-400">Closed (Countdowns pause)</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: AUDIT & CHANGE LOG */}
              {activeTab === 'logs' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Historical Settings Changes</h3>
                      <p className="text-xs text-slate-500">
                        Immutable record of all changes made to master compliance rules.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-400">{logs.length} entries</span>
                  </div>

                  {logs.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs">No configuration changes logged yet.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3">Timestamp (UTC+3)</th>
                            <th className="px-4 py-3">Setting Key</th>
                            <th className="px-4 py-3">Previous Value</th>
                            <th className="px-4 py-3">New Value</th>
                            <th className="px-4 py-3">Changed By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {logs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50/50">
                              <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                                {new Date(log.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-slate-900">
                                {log.setting_key.replace(/_/g, ' ')}
                              </td>
                              <td className="px-4 py-2.5 text-rose-600 font-mono text-[11px] max-w-xs truncate">
                                {log.old_value || 'None'}
                              </td>
                              <td className="px-4 py-2.5 text-emerald-600 font-mono text-[11px] max-w-xs truncate font-semibold">
                                {log.new_value}
                              </td>
                              <td className="px-4 py-2.5 text-slate-600 font-medium">
                                {log.changed_by}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: CALLBACKS */}
              {activeTab === 'insurance' && (
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200/70 p-4.5 rounded-2xl flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-white text-[#ff353e] shadow-xs">
                      <Car className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Callback Configuration</h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Controls load balancing across active callback staff, tag-based activity scoping, and max attempt prompt thresholds.
                      </p>
                    </div>
                  </div>

                  {/* Active Staff Count (Auto-assigned) */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-red-50 text-[#ff353e]">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">Active Staff Count (Workload Balancing)</h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Auto-Assigned
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Automatically determined by the number of active agents tagged with &ldquo;{callbackSettings.callback_team_tag}&rdquo;.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="px-3.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-right">
                          <span className="font-mono font-bold text-base text-slate-900 mr-1.5">
                            {callbackSettings.staff_count}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">active staff</span>
                        </div>
                      </div>
                    </div>

                    {callbackSettings.active_agents && callbackSettings.active_agents.length > 0 ? (
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg flex flex-wrap items-center gap-1.5 border border-slate-100">
                        <span className="font-semibold text-slate-700">Tagged Agents:</span>
                        {callbackSettings.active_agents.map((agent) => (
                          <span
                            key={agent.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800 font-medium text-[10px]"
                          >
                            {agent.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-700 bg-amber-50/70 p-2.5 rounded-lg flex items-center gap-2 border border-amber-200/60">
                        <Info className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                        <span>
                          No agents currently have the &ldquo;{callbackSettings.callback_team_tag}&rdquo; tag. Assign this tag in the Agent Table to auto-include agents in workload balancing.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Callback Team Tag */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Callback Team Agent Tag</h3>
                          <p className="text-xs text-slate-500">
                            Tag assigned to agents participating in insurance valuation callbacks.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="input-callback-team-tag"
                          type="text"
                          value={callbackSettings.callback_team_tag}
                          onChange={(e) =>
                            setCallbackSettings({
                              ...callbackSettings,
                              callback_team_tag: e.target.value,
                            })
                          }
                          className="w-64 px-3 py-1.5 text-right font-semibold text-slate-900 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-[#ff353e] focus:border-[#ff353e] outline-none"
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>Only agents with this tag are assigned imported callback jobs, and only CALL/SMS events logged by these agents count toward attempt counts.</span>
                    </div>
                  </div>

                  {/* Max Attempts Threshold */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                          <PhoneCall className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Max Call Attempts Threshold</h3>
                          <p className="text-xs text-slate-500">
                            Threshold after which a visual prompt flag encourages the agent to close the record.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="input-max-attempts"
                          type="number"
                          min="1"
                          max="20"
                          value={callbackSettings.max_attempts}
                          onChange={(e) =>
                            setCallbackSettings({
                              ...callbackSettings,
                              max_attempts: Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="w-20 px-3 py-1.5 text-right font-mono font-bold text-slate-900 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        />
                        <span className="text-xs font-semibold text-slate-500">attempts</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>Default is 4. When attempt count reaches or exceeds this number, a visual flag prompts the staff member to close the record, but never changes status automatically.</span>
                    </div>
                  </div>

                  {/* Channel Partner Allocations */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Channel Partner Agent Allocations</h3>
                          <p className="text-xs text-slate-500">
                            Predefined mapping used to auto-assign incoming valuation jobs to designated team members on Excel import.
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-slate-600 font-mono bg-slate-100 px-2 py-0.5 rounded-md">
                        {Array.isArray(partnerAllocations) ? partnerAllocations.length : 0} Partners Configured
                      </span>
                    </div>

                    {loadingAllocations ? (
                      <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                        <span>Loading partner allocations...</span>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1 border border-slate-100 rounded-xl p-2 bg-slate-50/50">
                        {(Array.isArray(partnerAllocations) ? partnerAllocations : []).map((alloc) => (
                          <div
                            key={alloc.channel_partner}
                            className="flex items-center justify-between gap-2 p-2 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs"
                          >
                            <span className="font-bold text-slate-800 truncate" title={alloc.channel_partner}>
                              {alloc.channel_partner}
                            </span>
                            <select
                              value={alloc.assigned_agent_id ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? null : Number(e.target.value);
                                handleUpdateAllocation(alloc.channel_partner, val);
                              }}
                              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-800 outline-none cursor-pointer focus:ring-1 focus:ring-indigo-500 shrink-0"
                            >
                              <option value="">Unassigned</option>
                              {callbackSettings.active_agents &&
                                callbackSettings.active_agents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: DAILY PERFORMANCE SUMMARY EMAIL */}

              {/* TAB 6: TEAM ACCOUNTS (USERS) */}
              {activeTab === 'users' && (
                <div className="space-y-6">
                  {/* Banner */}
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200/80 p-4.5 rounded-2xl flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-white text-indigo-600 shadow-xs border border-indigo-200/60">
                      <Users className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Dashboard Team Accounts</h4>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        Manage login credentials for compliance portal team members. Accounts are stored in the database with secure <code>scrypt</code> password hashing. These accounts are separate from telephony agent caller IDs.
                      </p>
                    </div>
                  </div>

                  {/* Feedback alerts */}
                  {userError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                      <span>{userError}</span>
                    </div>
                  )}
                  {userSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span>{userSuccess}</span>
                    </div>
                  )}

                  {/* Create User Form */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-indigo-600" />
                      <h3 className="text-sm font-bold text-slate-900">Add New Team Member Account</h3>
                    </div>

                    <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">Username / Login ID</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. mercy, brian"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">Display Name</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Mercy W., Brian O."
                          value={newDisplayName}
                          onChange={(e) => setNewDisplayName(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">Temporary Password</label>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            required
                            placeholder="Password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono"
                          />
                          <button
                            type="submit"
                            disabled={isCreatingUser}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Create</span>
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {/* Users Table */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Existing Team Accounts</h3>
                        <p className="text-xs text-slate-500">
                          Accounts currently authorized to log in to the dashboard.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={fetchUsers}
                        className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {loadingUsers ? (
                      <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                        <span>Loading team accounts...</span>
                      </div>
                    ) : users.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-6 text-center">No accounts found.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                              <th className="py-2.5 px-3">User</th>
                              <th className="py-2.5 px-3">Display Name</th>
                              <th className="py-2.5 px-3">Status</th>
                              <th className="py-2.5 px-3">Created</th>
                              <th className="py-2.5 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                            {users.map((u) => (
                              <React.Fragment key={u.id}>
                                <tr className="hover:bg-slate-50/60 transition-colors">
                                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                                    {u.username}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {editingUserId === u.id ? (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          value={editingDisplayName}
                                          onChange={(e) => setEditingDisplayName(e.target.value)}
                                          className="px-2 py-1 text-xs border border-indigo-300 rounded font-medium outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleSaveDisplayName(u.id)}
                                          className="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] font-bold"
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingUserId(null)}
                                          className="px-1.5 py-1 text-slate-400 hover:text-slate-600 text-[11px]"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        <span>{u.display_name}</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingUserId(u.id);
                                            setEditingDisplayName(u.display_name);
                                          }}
                                          className="text-slate-400 hover:text-indigo-600 text-[10px] underline"
                                        >
                                          Edit
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                        u.active
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                          : 'bg-slate-100 text-slate-600 border-slate-200'
                                      }`}
                                    >
                                      {u.active ? (
                                        <>
                                          <UserCheck className="w-2.5 h-2.5" /> Active
                                        </>
                                      ) : (
                                        <>
                                          <UserX className="w-2.5 h-2.5" /> Disabled
                                        </>
                                      )}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (resettingUserId === u.id) {
                                            setResettingUserId(null);
                                          } else {
                                            setResettingUserId(u.id);
                                            setResetNewPassword('');
                                          }
                                        }}
                                        className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                                      >
                                        <Key className="w-3 h-3 text-amber-600" />
                                        <span>Reset Password</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleUserActive(u)}
                                        className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                          u.active
                                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        }`}
                                      >
                                        <Power className="w-3 h-3" />
                                        <span>{u.active ? 'Disable' : 'Enable'}</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {resettingUserId === u.id && (
                                  <tr className="bg-amber-50/50">
                                    <td colSpan={5} className="py-2.5 px-3">
                                      <div className="flex items-center gap-2 justify-end">
                                        <span className="text-[11px] text-slate-600 font-semibold">
                                          New Password for {u.username}:
                                        </span>
                                        <input
                                          type="password"
                                          placeholder="Enter new password"
                                          value={resetNewPassword}
                                          onChange={(e) => setResetNewPassword(e.target.value)}
                                          className="px-2.5 py-1 text-xs border border-amber-300 rounded-lg outline-none font-mono bg-white"
                                        />
                                        <button
                                          type="button"
                                          disabled={isResettingPassword}
                                          onClick={() => handleResetPassword(u.id)}
                                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                                        >
                                          {isResettingPassword ? 'Updating...' : 'Update Password'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setResettingUserId(null)}
                                          className="px-2 py-1 text-slate-500 hover:text-slate-700 text-xs"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            id="reset-defaults-settings-btn"
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <div className="flex items-center gap-3">
            <button
              id="cancel-settings-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-200/60 transition-colors"
            >
              Close
            </button>
            <button
              id="save-master-settings-btn"
              type="button"
              disabled={saving || loading}
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm transition-all"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Apply & Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
