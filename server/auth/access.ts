// Who may open which section. Pure: no database, no Express. The rules live here so they can be tested on their own.

export type UserRole = 'admin' | 'agent';

/**
 * call_activity: the compliance dashboard (read only for agents).
 * callbacks / pending: the Insurance Callbacks screen, and the Pending Inspection and Pending Submission screens.
 */
export type Section = 'call_activity' | 'callbacks' | 'pending';

export const ALL_SECTIONS: ReadonlyArray<Section> = ['call_activity', 'callbacks', 'pending'];

export const DEFAULT_CALLBACK_TAG = 'Callback Team';
export const DEFAULT_PENDING_TAG = 'Callback Team(Submission)';

export function normalizeRole(value: unknown): UserRole {
  return value === 'agent' ? 'agent' : 'admin';
}

/** Tags are compared without regard to case or surrounding and repeated spaces, as the assignment code does. */
export function tagKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface AccessInput {
  role: UserRole;
  active: boolean;
  /** The agent record the login is linked to, if any. */
  agent: { name: string; tag: string | null; archived: boolean } | null;
  /** The team tag that grants the Callbacks screen, and the one that grants the Pending screens (both tabs). */
  callbackTag: string;
  pendingTag: string;
}

/**
 * Sections for an account. An empty list means no access at all.
 *  - Inactive account: nothing.
 *  - Administrator: everything.
 *  - Agent linked to an archived agent record: nothing (a departed agent's login stops working).
 *  - Agent whose current tag is the callback team tag and/or the pending team tag: those sections only.
 *  - Any other agent (no link, or a tag that matches neither team): Call Activity.
 * The tag is read from the database on every request, so re-tagging an agent changes their access at once.
 */
export function sectionsFor(input: AccessInput): Section[] {
  if (!input.active) return [];
  if (input.role === 'admin') return [...ALL_SECTIONS];
  if (input.agent?.archived) return [];

  const sections: Section[] = [];
  const tag = tagKey(input.agent?.tag);
  if (tag !== '') {
    if (tag === tagKey(input.callbackTag)) sections.push('callbacks');
    if (tag === tagKey(input.pendingTag)) sections.push('pending');
  }
  return sections.length > 0 ? sections : ['call_activity'];
}
