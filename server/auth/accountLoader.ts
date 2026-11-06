import type { DbAdapter } from '../../db';
import { DEFAULT_CALLBACK_TAG, DEFAULT_PENDING_TAG, normalizeRole, sectionsFor } from './access';
import type { AuthContext } from './adminSession';

/**
 * Loads one account with its linked agent and the two team tags in a single query and works out its access.
 * Returns null when there is nothing the account may open: unknown or inactive account, or a login whose agent
 * record has been archived. The same function serves the login check and every later request.
 */
export async function loadAuthContext(db: Pick<DbAdapter, 'queryOne'>, userId: number): Promise<AuthContext | null> {
  const row = await db.queryOne<{
    id: unknown;
    username: string;
    display_name: string;
    active: unknown;
    role: string;
    agent_id: unknown;
    agent_name: string | null;
    agent_tag: string | null;
    agent_archived_at: unknown;
    callback_tag: string | null;
    pending_tag: string | null;
  }>(
    `SELECT u.id, u.username, u.display_name, u.active, u.role, u.agent_id,
            a.name AS agent_name, a.tag AS agent_tag, a.archived_at AS agent_archived_at,
            (SELECT callback_team_tag FROM callback_settings WHERE id = 1) AS callback_tag,
            (SELECT callback_team_tag FROM pending_submission_settings WHERE id = 1) AS pending_tag
     FROM users u
     LEFT JOIN agents a ON a.id = u.agent_id
     WHERE u.id = ?`,
    [userId]
  );
  if (!row) return null;

  const role = normalizeRole(row.role);
  const sections = sectionsFor({
    role,
    active: row.active === true || row.active === 1,
    agent: row.agent_id === null || row.agent_id === undefined
      ? null
      : { name: row.agent_name ?? '', tag: row.agent_tag, archived: row.agent_archived_at !== null && row.agent_archived_at !== undefined },
    callbackTag: row.callback_tag || DEFAULT_CALLBACK_TAG,
    pendingTag: row.pending_tag || DEFAULT_PENDING_TAG,
  });
  if (sections.length === 0) return null;

  return {
    userId: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role,
    agentId: row.agent_id === null || row.agent_id === undefined ? null : Number(row.agent_id),
    agentName: row.agent_name ?? null,
    sections,
  };
}
