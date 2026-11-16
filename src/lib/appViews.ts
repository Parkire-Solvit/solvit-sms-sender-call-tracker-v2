// Which screens a signed-in account may open. Pure: no React. The server enforces the same rules on every route;
// this only decides what the interface offers.

export type AccountRole = 'admin' | 'agent' | 'cs_member';
export type Section = 'call_activity' | 'callbacks' | 'pending';
export type AppView = 'admin' | 'insurance-callbacks' | 'pending-submissions' | 'email';

const VIEW_FOR_SECTION: Record<Section, AppView> = {
  call_activity: 'admin',
  callbacks: 'insurance-callbacks',
  pending: 'pending-submissions',
};

/** Screens in the order they are offered. Administrators see all of them. */
export function allowedViews(role: AccountRole | null, sections: ReadonlyArray<Section>): AppView[] {
  if (role === 'admin') return ['admin', 'insurance-callbacks', 'email', 'pending-submissions'];
  if (role === 'cs_member') return ['email'];
  if (role === 'agent') {
    const order: Section[] = ['callbacks', 'pending', 'call_activity'];
    return order.filter((s) => sections.includes(s)).map((s) => VIEW_FOR_SECTION[s]);
  }
  return [];
}

/** The screen to show: the requested one when it is allowed, otherwise the first allowed one. */
export function resolveView(requested: AppView, allowed: ReadonlyArray<AppView>): AppView {
  if (allowed.includes(requested)) return requested;
  return allowed[0] ?? requested;
}

/** Where a person lands after signing in. */
export function landingView(role: AccountRole | null, sections: ReadonlyArray<Section>): AppView {
  const allowed = allowedViews(role, sections);
  return role === 'admin' ? 'admin' : allowed[0] ?? 'admin';
}

export const VIEW_LABELS: Record<AppView, string> = {
  admin: 'Call Activity',
  'insurance-callbacks': 'Callbacks',
  email: 'Email SLA',
  'pending-submissions': 'Pending Submissions',
};
