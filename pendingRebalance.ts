// V16 pendingRebalance.ts
// Pure planning for the Pending Submissions workload rebalance. No database access.

export interface RebalanceUnit {
  /** Identifies one customer's open records held by one agent. */
  key: string;
  agent_id: number;
  /** Number of open records in this unit. */
  size: number;
  /** True only when every record in the unit is untouched (no calls, no SMS, no logged outcome). */
  movable: boolean;
}

export interface RebalanceMove {
  key: string;
  from: number;
  to: number;
}

/**
 * Plans moves of whole units from busier agents to less busy agents.
 * - Only movable units are ever moved, and each unit moves at most once.
 * - A move is made only when it strictly narrows the gap between the two agents (unit size < gap).
 * - Among the moves that narrow the gap, the one that leaves the two agents closest to equal is chosen.
 * - The result is deterministic: ties are broken by agent name, agent id and unit key.
 * Because a customer is never split, the final spread can differ by up to the size of one customer.
 */
export function planRebalance(
  units: RebalanceUnit[],
  agents: Array<{ id: number; name: string }>
): RebalanceMove[] {
  const moves: RebalanceMove[] = [];
  if (agents.length < 2) return moves;

  const nameOf = new Map<number, string>(agents.map((a) => [a.id, a.name]));
  const load = new Map<number, number>(agents.map((a) => [a.id, 0]));
  const state = units
    .filter((u) => load.has(u.agent_id))
    .map((u) => ({ ...u }));
  for (const u of state) load.set(u.agent_id, (load.get(u.agent_id) ?? 0) + u.size);

  const moved = new Set<string>();
  const byName = (a: number, b: number) =>
    (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "") || a - b;

  for (let guard = 0; guard < state.length + 1; guard++) {
    // All (heavier, lighter) pairs with the widest gap first.
    const ids = agents.map((a) => a.id);
    const pairs: Array<{ hi: number; lo: number; gap: number }> = [];
    for (const hi of ids) {
      for (const lo of ids) {
        const gap = (load.get(hi) ?? 0) - (load.get(lo) ?? 0);
        if (hi !== lo && gap > 1) pairs.push({ hi, lo, gap });
      }
    }
    pairs.sort((a, b) => b.gap - a.gap || byName(a.lo, b.lo) || byName(a.hi, b.hi));

    let made = false;
    for (const p of pairs) {
      const candidates = state
        .filter((u) => u.agent_id === p.hi && u.movable && !moved.has(u.key) && u.size < p.gap)
        .sort(
          (a, b) =>
            Math.abs(p.gap - 2 * a.size) - Math.abs(p.gap - 2 * b.size) ||
            a.key.localeCompare(b.key)
        );
      if (candidates.length === 0) continue;
      const chosen = candidates[0];
      moves.push({ key: chosen.key, from: p.hi, to: p.lo });
      moved.add(chosen.key);
      chosen.agent_id = p.lo;
      load.set(p.hi, (load.get(p.hi) ?? 0) - chosen.size);
      load.set(p.lo, (load.get(p.lo) ?? 0) + chosen.size);
      made = true;
      break;
    }
    if (!made) break;
  }
  return moves;
}
// V16 END pendingRebalance.ts

