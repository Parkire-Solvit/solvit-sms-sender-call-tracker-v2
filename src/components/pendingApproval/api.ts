// Pending Approval: the browser side of the API, plus the types the screens share.
import type { ApprovalContext, ApprovalDirectory, ApprovalJob, ApprovalSolver } from '../../../shared/pendingApproval';

export interface ApprovalState {
  revision: string;
  settings: { target_conversion: number };
  directory: ApprovalDirectory;
  solvers: ApprovalSolver[];
  jobs: ApprovalJob[];
  mail: { configured: boolean; can_send: boolean; verified: boolean };
  me: { name: string };
}

export interface ApprovalEmailRow { id: number; at: string; by: string; kind: string; key: string; to: string[]; cc: string[]; subject: string; jobs: string[] }
export interface AdminSettings { team_tag: string; default_sender_mailbox: string; senders: Array<{ username: string; mailbox: string }>; mail_configured: boolean; env_sender: string; mail_checks: Array<{ mailbox: string; ok: boolean; message: string; checked_by: string; checked_at: string }> }
export interface MailCheckResult { ok: boolean; attempted: boolean; message: string; steps: Array<{ name: string; ok: boolean | null; detail: string }> }

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    if (r.status === 401) throw new Error('You have been signed out. Sign in again to continue.');
    throw new Error((data && data.error) || `Request failed (${r.status})`);
  }
  return data as T;
}

/** What the screens pass around: the people and rules that go with the jobs. */
export interface Shared {
  state: ApprovalState;
  ctx: ApprovalContext;
  actor: string;
  /** Reloads the jobs from the server straight away (after any change). */
  reload: () => Promise<void>;
  toast: (message: string, bad?: boolean) => void;
}

export const blobToBase64 = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export function downloadBlob(filename: string, data: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
