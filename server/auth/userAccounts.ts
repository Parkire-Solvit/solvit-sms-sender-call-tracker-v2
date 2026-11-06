import type { DbAdapter } from '../../db';
import { HttpError } from '../../httpError';
import { hashPassword } from '../../auth';
import { normalizeRole, type UserRole } from './access';

export interface UserAccountView {
  id: number;
  username: string;
  display_name: string;
  active: boolean;
  role: UserRole;
  agent_id: number | null;
  agent_name: string | null;
  agent_tag: string | null;
  agent_archived: boolean;
  created_at: string;
}

const SELECT_USER = `SELECT u.id, u.username, u.display_name, u.active, u.role, u.agent_id, u.created_at,
       a.name AS agent_name, a.tag AS agent_tag, a.archived_at AS agent_archived_at
  FROM users u LEFT JOIN agents a ON a.id = u.agent_id`;

function toView(r: any): UserAccountView {
  return {
    id: Number(r.id),
    username: r.username,
    display_name: r.display_name,
    active: r.active === true || r.active === 1,
    role: normalizeRole(r.role),
    agent_id: r.agent_id === null || r.agent_id === undefined ? null : Number(r.agent_id),
    agent_name: r.agent_name ?? null,
    agent_tag: r.agent_tag ?? null,
    agent_archived: r.agent_archived_at !== null && r.agent_archived_at !== undefined,
    created_at: r.created_at,
  };
}

export async function listUserAccounts(db: DbAdapter): Promise<UserAccountView[]> {
  const rows = await db.queryAll<any>(`${SELECT_USER} ORDER BY u.id ASC`);
  return rows.map(toView);
}

export async function getUserAccount(db: DbAdapter, id: number): Promise<UserAccountView | null> {
  const row = await db.queryOne<any>(`${SELECT_USER} WHERE u.id = ?`, [id]);
  return row ? toView(row) : null;
}

/** Active agents a login can be linked to, with the login (if any) that already uses each. */
export async function listAgentOptions(db: DbAdapter) {
  const rows = await db.queryAll<any>(
    `SELECT a.id, a.name, a.tag, u.username AS linked_username
     FROM agents a LEFT JOIN users u ON u.agent_id = a.id
     WHERE a.archived_at IS NULL AND a.name <> 'Unknown Agent'
     ORDER BY a.name ASC`
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name as string, tag: (r.tag as string) ?? null, linked_username: (r.linked_username as string) ?? null }));
}

async function assertLinkableAgent(db: Pick<DbAdapter, 'queryOne'>, agentId: number, exceptUserId: number | null): Promise<void> {
  const agent = await db.queryOne<{ id: number; archived_at: unknown }>(`SELECT id, archived_at FROM agents WHERE id = ?`, [agentId]);
  if (!agent) throw new HttpError(404, 'That agent was not found.');
  if (agent.archived_at !== null && agent.archived_at !== undefined) throw new HttpError(400, 'That agent is archived. Reactivate the agent before linking a login.');
  const taken = await db.queryOne<{ id: number; username: string }>(
    `SELECT id, username FROM users WHERE agent_id = ? ${exceptUserId === null ? '' : 'AND id <> ?'}`,
    exceptUserId === null ? [agentId] : [agentId, exceptUserId]
  );
  if (taken) throw new HttpError(409, `That agent already has a login ("${taken.username}"). Each agent has one login.`);
}

function parseAgentId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'agent_id must be a valid agent.');
  return n;
}

export interface NewUserInput {
  username?: unknown;
  display_name?: unknown;
  password?: unknown;
  role?: unknown;
  agent_id?: unknown;
}

export async function createUserAccount(db: DbAdapter, input: NewUserInput): Promise<UserAccountView> {
  const username = String(input.username ?? '').trim();
  const displayName = String(input.display_name ?? '').trim() || username;
  const password = String(input.password ?? '').trim();
  // New accounts are agents unless an administrator is asked for explicitly.
  const role: UserRole = input.role === 'admin' ? 'admin' : 'agent';
  const agentId = parseAgentId(input.agent_id);

  if (!username || !password) throw new HttpError(400, 'Username and password are required');
  const existing = await db.queryOne<{ id: number }>(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`, [username]);
  if (existing) throw new HttpError(409, `Username "${username}" already exists`);
  if (agentId !== null) await assertLinkableAgent(db, agentId, null);

  const passwordHash = await hashPassword(password);
  const result = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, active, role, agent_id, created_at, updated_at)
     VALUES (?, ?, ?, TRUE, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [username, passwordHash, displayName, role, agentId]
  );
  return (await getUserAccount(db, Number(result.lastInsertId)))!;
}

export interface UpdateUserInput {
  display_name?: unknown;
  active?: unknown;
  role?: unknown;
  agent_id?: unknown;
}

/** How many active administrators exist other than `exceptUserId`. */
async function otherActiveAdmins(db: Pick<DbAdapter, 'queryOne'>, exceptUserId: number): Promise<number> {
  const row = await db.queryOne<{ n: unknown }>(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = TRUE AND id <> ?`,
    [exceptUserId]
  );
  return Number(row?.n ?? 0);
}

export async function updateUserAccount(db: DbAdapter, id: number, input: UpdateUserInput): Promise<UserAccountView> {
  const current = await getUserAccount(db, id);
  if (!current) throw new HttpError(404, 'User not found');

  const updates: string[] = [];
  const params: any[] = [];

  if (input.display_name !== undefined) {
    const name = String(input.display_name).trim();
    if (!name) throw new HttpError(400, 'Display name cannot be empty.');
    updates.push('display_name = ?');
    params.push(name);
  }
  const nextActive = input.active === undefined ? current.active : Boolean(input.active);
  const nextRole: UserRole = input.role === undefined ? current.role : input.role === 'admin' ? 'admin' : 'agent';
  if (input.active !== undefined) {
    updates.push('active = ?');
    params.push(nextActive);
  }
  if (input.role !== undefined) {
    updates.push('role = ?');
    params.push(nextRole);
  }

  // The last active administrator can be neither demoted nor deactivated: that would lock everyone out of management.
  const wasActiveAdmin = current.role === 'admin' && current.active;
  const staysActiveAdmin = nextRole === 'admin' && nextActive;
  if (wasActiveAdmin && !staysActiveAdmin && (await otherActiveAdmins(db, id)) === 0) {
    throw new HttpError(409, 'At least one active administrator is required. Make another account an administrator first.');
  }

  if (input.agent_id !== undefined) {
    const agentId = parseAgentId(input.agent_id);
    if (agentId !== null) await assertLinkableAgent(db, agentId, id);
    updates.push('agent_id = ?');
    params.push(agentId);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }
  return (await getUserAccount(db, id))!;
}
