// V18 src/components/DataResetPanel.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, RefreshCw, Trash2, Undo2, CheckCircle2, X } from 'lucide-react';

export type DataResetSection = 'callbacks' | 'pending-submissions';

interface LastUpload {
  id: number;
  file_name: string | null;
  imported_at: string | null;
  created_count: number;
  closed_absent_count: number;
  worked_created_count: number;
  can_undo: boolean;
  reason: string | null;
}

interface Preview {
  section: DataResetSection;
  label: string;
  reset_key_configured: boolean;
  delete_all_phrase: string;
  undo_phrase: string;
  totals: { jobs: number; open: number; closed: number; logs: number; phones: number };
  last_upload: LastUpload | null;
}

type Mode = 'delete' | 'undo' | null;

interface Props {
  section: DataResetSection;
  onChanged?: () => void;
}

const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400';

export default function DataResetPanel({ section, onChanged }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [resetKey, setResetKey] = useState('');
  const [backupToken, setBackupToken] = useState('');
  const [backupName, setBackupName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [countText, setCountText] = useState('');
  const [allowWorked, setAllowWorked] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch(`/api/data-reset/${section}/preview`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load the data reset details.');
      setPreview(body as Preview);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the data reset details.');
    }
  }, [section]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const clearFlow = () => {
    setMode(null);
    setResetKey('');
    setBackupToken('');
    setBackupName('');
    setPhrase('');
    setCountText('');
    setAllowWorked(false);
    setError(null);
  };

  const startFlow = (m: Exclude<Mode, null>) => {
    clearFlow();
    setDone(null);
    setMode(m);
    loadPreview();
  };

  const downloadBackup = async () => {
    setError(null);
    setBusy('backup');
    try {
      const res = await fetch(`/api/data-reset/${section}/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_key: resetKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'The backup could not be created.');
      }
      const token = res.headers.get('X-Backup-Token') || '';
      const name = res.headers.get('X-Backup-Filename') || `${section}-backup.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (!token) throw new Error('The backup was created but no confirmation token came back. Try again.');
      setBackupToken(token);
      setBackupName(name);
    } catch (err) {
      setBackupToken('');
      setBackupName('');
      setError(err instanceof Error ? err.message : 'The backup could not be created.');
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!preview || !mode) return;
    setError(null);
    setBusy('run');
    try {
      const url = mode === 'delete' ? `/api/data-reset/${section}/delete-all` : `/api/data-reset/${section}/undo-last-upload`;
      const payload =
        mode === 'delete'
          ? { reset_key: resetKey, confirm_phrase: phrase, confirm_count: countText, backup_token: backupToken }
          : { reset_key: resetKey, confirm_phrase: phrase, backup_token: backupToken, allow_worked: allowWorked };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The backup is single use, so any refusal means a new backup is needed before trying again.
        setBackupToken('');
        setBackupName('');
        throw new Error(body.error || 'The action was refused.');
      }
      if (mode === 'delete') {
        setDone(`Deleted ${body.deleted_records} record(s), ${body.deleted_history_rows} outcome history row(s) and ${body.deleted_phone_rows} phone number row(s).`);
      } else {
        setDone(`Removed ${body.removed_records} record(s) created by the upload and reopened ${body.restored_records} record(s) it had closed.`);
      }
      clearFlow();
      await loadPreview();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action was refused.');
    } finally {
      setBusy(null);
    }
  };

  if (loadError && !preview) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{loadError}</div>
    );
  }
  if (!preview) {
    return <div className="text-xs text-slate-400">Loading data reset options...</div>;
  }

  const last = preview.last_upload;
  const expectedPhrase = mode === 'delete' ? preview.delete_all_phrase : preview.undo_phrase;
  const needsWorkedConsent = mode === 'undo' && !!last && last.worked_created_count > 0;
  const stepOneDone = resetKey.length > 0 && backupToken.length > 0;
  const canRun =
    stepOneDone &&
    phrase === expectedPhrase &&
    (mode !== 'delete' || countText.trim() === String(preview.totals.jobs)) &&
    (!needsWorkedConsent || allowWorked) &&
    busy === null;

  return (
    <div className="border border-red-200 bg-red-50/40 rounded-2xl p-4 space-y-3" data-testid="data-reset-panel">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-black text-red-700 leading-tight">Danger zone: {preview.label} data</h4>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Use this only to correct a bad upload or to start again. Agents, settings, upload history and the Android call and SMS events are never touched.
          </p>
        </div>
      </div>

      {!preview.reset_key_configured && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
          Data reset is switched off. An administrator must set DATA_RESET_KEY (at least 12 characters) on the server before these actions can run.
        </div>
      )}

      {done && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{done}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white border border-slate-200 rounded-xl py-2">
          <div className="text-base font-black text-slate-900">{preview.totals.jobs}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">Records</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl py-2">
          <div className="text-base font-black text-slate-900">{preview.totals.open}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">Open</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl py-2">
          <div className="text-base font-black text-slate-900">{preview.totals.logs}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">History rows</div>
        </div>
      </div>

      {mode === null && (
        <div className="space-y-2">
          <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5">
            <div className="text-xs font-bold text-slate-800">Remove last upload</div>
            {last ? (
              <p className="text-[11px] text-slate-600">
                Latest upload: <span className="font-bold">{last.file_name || 'unnamed file'}</span>
                {last.imported_at ? ` (${last.imported_at})` : ''}. It created {last.created_count} record(s) and closed {last.closed_absent_count} record(s) as absent.
                {last.can_undo
                  ? ' Undoing deletes the records it created and reopens the ones it closed.'
                  : ` ${last.reason || 'It cannot be undone.'}`}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">There is no upload that can be undone.</p>
            )}
            <button
              type="button"
              disabled={!preview.reset_key_configured || !last || !last.can_undo}
              onClick={() => startFlow('undo')}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Remove last upload</span>
            </button>
            <p className="text-[10px] text-slate-400">
              Records the upload merely refreshed or reopened are not reverted. Only uploads made after this feature was added can be undone.
            </p>
          </div>

          <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5">
            <div className="text-xs font-bold text-slate-800">Delete all records</div>
            <p className="text-[11px] text-slate-600">
              Permanently deletes all {preview.totals.jobs} record(s), their outcome history and their phone numbers. It cannot be undone, so a backup is required first.
            </p>
            <button
              type="button"
              disabled={!preview.reset_key_configured || preview.totals.jobs === 0}
              onClick={() => startFlow('delete')}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete all records</span>
            </button>
          </div>
        </div>
      )}

      {mode !== null && (
        <div className="p-3 bg-white border border-red-200 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-black text-red-700">
              {mode === 'delete' ? `Delete all ${preview.label} records` : 'Remove last upload'}
            </div>
            <button type="button" onClick={clearFlow} className="text-slate-400 hover:text-slate-600 cursor-pointer" title="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>

          {mode === 'undo' && last && (
            <p className="text-[11px] text-slate-600">
              This will delete {last.created_count} record(s) created by <span className="font-bold">{last.file_name || 'the latest upload'}</span> and reopen {last.closed_absent_count} record(s) it closed as absent.
            </p>
          )}
          {mode === 'delete' && (
            <p className="text-[11px] text-slate-600">
              This will permanently delete {preview.totals.jobs} record(s), {preview.totals.logs} history row(s) and {preview.totals.phones} phone number row(s).
            </p>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Step 1. Reset key and backup</label>
            <input
              type="password"
              autoComplete="off"
              value={resetKey}
              onChange={(e) => {
                setResetKey(e.target.value);
                setBackupToken('');
                setBackupName('');
              }}
              placeholder="Reset key"
              className={inputClass}
            />
            <button
              type="button"
              disabled={resetKey.length === 0 || busy !== null}
              onClick={downloadBackup}
              className="mt-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              {busy === 'backup' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>{backupToken ? 'Download the backup again' : 'Download Excel backup'}</span>
            </button>
            {backupToken && (
              <p className="text-[11px] text-emerald-700 mt-1.5">Backup downloaded: {backupName}. Keep it safe. It is valid for 20 minutes.</p>
            )}
          </div>

          <div className={stepOneDone ? 'space-y-2' : 'space-y-2 opacity-50'}>
            <label className="block text-[11px] font-bold text-slate-700">
              Step 2. Type <span className="font-mono text-red-700">{expectedPhrase}</span> to confirm
            </label>
            <input type="text" disabled={!stepOneDone} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" className={inputClass} />
            {mode === 'delete' && (
              <>
                <label className="block text-[11px] font-bold text-slate-700">
                  Step 3. Type the number of records being deleted (<span className="font-mono text-red-700">{preview.totals.jobs}</span>)
                </label>
                <input type="text" disabled={!stepOneDone} value={countText} onChange={(e) => setCountText(e.target.value)} autoComplete="off" inputMode="numeric" className={inputClass} />
              </>
            )}
            {needsWorkedConsent && last && (
              <label className="flex items-start gap-2 text-[11px] text-slate-700">
                <input type="checkbox" disabled={!stepOneDone} checked={allowWorked} onChange={(e) => setAllowWorked(e.target.checked)} className="mt-0.5" />
                <span>
                  {last.worked_created_count} record(s) from this upload have already been worked or closed. I understand they will be deleted with their history.
                </span>
              </label>
            )}
          </div>

          {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={clearFlow} className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canRun}
              onClick={run}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              {busy === 'run' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{mode === 'delete' ? 'Permanently delete' : 'Remove last upload'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
// V18 END src/components/DataResetPanel.tsx

