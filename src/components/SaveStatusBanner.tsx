// V18 src/components/SaveStatusBanner.tsx
import React, { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { flushQueue, describeQueue, getSaveState, subscribeSaveState } from '../lib/safeSave';

export default function SaveStatusBanner() {
  const state = useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const count = state.pending.length;
  const signedOut = state.sessionProblem || state.authProblem;
  if (count === 0 && !signedOut) return null;

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(describeQueue());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white shadow-lg"
      role="alert"
      data-testid="save-status-banner"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-xs font-semibold">
        <div className="flex items-start gap-2 flex-1">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            {signedOut && (
              <div>
                You have been signed out. Reload the page and sign in again before logging more outcomes.
              </div>
            )}
            {count > 0 && (
              <div>
                {count} outcome{count === 1 ? ' is' : 's are'} NOT saved to the server yet. They are kept on this device and will be sent
                automatically. Keep this page open and do not clear your browser data.
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {count > 0 && (
            <button
              type="button"
              onClick={() => flushQueue()}
              disabled={state.flushing}
              className="px-3 py-1.5 rounded-lg bg-white text-red-700 font-bold hover:bg-red-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${state.flushing ? 'animate-spin' : ''}`} />
              <span>Retry now</span>
            </button>
          )}
          {signedOut && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg bg-white text-red-700 font-bold hover:bg-red-50 cursor-pointer"
            >
              Reload and sign in
            </button>
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-white/60 hover:bg-red-700 cursor-pointer"
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      </div>
      {showDetails && count > 0 && (
        <div className="bg-red-700 px-4 py-2 text-[11px] font-medium">
          <div className="max-w-6xl mx-auto space-y-1">
            {state.pending.map((e) => (
              <div key={e.id}>
                {e.label}: {e.lastError || 'waiting to be sent'}
              </div>
            ))}
            <button type="button" onClick={copyDetails} className="underline cursor-pointer">
              {copied ? 'Copied' : 'Copy the unsaved outcomes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
// V18 END src/components/SaveStatusBanner.tsx

