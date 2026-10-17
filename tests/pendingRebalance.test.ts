// V16 tests/pendingRebalance.test.ts
import { planRebalance, RebalanceUnit } from "../pendingRebalance.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for the pending rebalance planner...");

const A = { id: 1, name: "Alice" };
const B = { id: 2, name: "Bob" };
const C = { id: 3, name: "Cara" };

function applied(units: RebalanceUnit[], agents: Array<{ id: number }>) {
  const moves = planRebalance(units, agents as any);
  const owner = new Map(units.map((u) => [u.key, u.agent_id]));
  for (const m of moves) owner.set(m.key, m.to);
  const load = new Map<number, number>(agents.map((a) => [a.id, 0]));
  for (const u of units) load.set(owner.get(u.key)!, (load.get(owner.get(u.key)!) ?? 0) + u.size);
  return { moves, load };
}

// 1. One agent: nothing to do.
assert(planRebalance([{ key: "c1", agent_id: 1, size: 5, movable: true }], [A]).length === 0, "single agent has no moves");

// 2. Everything with Alice, a new agent Bob joins: ten customers of two vehicles each, all untouched.
{
  const units: RebalanceUnit[] = [];
  for (let i = 1; i <= 10; i++) units.push({ key: `c${String(i).padStart(2, "0")}`, agent_id: 1, size: 2, movable: true });
  const { moves, load } = applied(units, [A, B]);
  assert(moves.length === 5, `five customers move (got ${moves.length})`);
  assert(load.get(1) === 10 && load.get(2) === 10, "loads are 10 and 10");
  assert(moves.every((m) => m.from === 1 && m.to === 2), "all moves go from Alice to Bob");
}

// 3. Touched customers never move, so the spread can stay uneven.
{
  const units: RebalanceUnit[] = [
    { key: "a", agent_id: 1, size: 4, movable: false },
    { key: "b", agent_id: 1, size: 4, movable: false },
    { key: "c", agent_id: 1, size: 2, movable: true },
  ];
  const { moves, load } = applied(units, [A, B]);
  assert(moves.length === 1 && moves[0].key === "c", "only the untouched customer moves");
  assert(load.get(1) === 8 && load.get(2) === 2, "touched work stays where it is");
}

// 4. A move that would not narrow the gap is not made (one big customer).
{
  const units: RebalanceUnit[] = [{ key: "big", agent_id: 1, size: 6, movable: true }];
  assert(planRebalance(units, [A, B]).length === 0, "a single customer larger than the gap is not shuffled");
}

// 5. Already balanced within one record: no moves.
{
  const units: RebalanceUnit[] = [
    { key: "a", agent_id: 1, size: 3, movable: true },
    { key: "b", agent_id: 2, size: 2, movable: true },
  ];
  assert(planRebalance(units, [A, B]).length === 0, "gap of one needs no move");
}

// 6. Three agents, all work with Alice.
{
  const units: RebalanceUnit[] = [];
  for (let i = 1; i <= 12; i++) units.push({ key: `c${String(i).padStart(2, "0")}`, agent_id: 1, size: 1, movable: true });
  const { load } = applied(units, [A, B, C]);
  assert(load.get(1) === 4 && load.get(2) === 4 && load.get(3) === 4, "twelve single records spread 4, 4, 4");
}

// 7. Deterministic: the same input gives the same moves, and each customer moves at most once.
{
  const units: RebalanceUnit[] = [];
  for (let i = 1; i <= 9; i++) units.push({ key: `c${i}`, agent_id: 1, size: (i % 3) + 1, movable: true });
  const first = JSON.stringify(planRebalance(units, [A, B, C]));
  const second = JSON.stringify(planRebalance(units.slice().reverse(), [A, B, C]));
  assert(first === second, "result does not depend on input order");
  const keys = planRebalance(units, [A, B, C]).map((m) => m.key);
  assert(new Set(keys).size === keys.length, "no customer is moved twice");
}

// 8. Units held by an agent outside the active team are ignored by the planner.
{
  const units: RebalanceUnit[] = [{ key: "x", agent_id: 99, size: 5, movable: true }];
  assert(planRebalance(units, [A, B]).length === 0, "units of inactive agents are not planned here");
}

console.log("All pending rebalance planner tests passed!");
// V16 END tests/pendingRebalance.test.ts

