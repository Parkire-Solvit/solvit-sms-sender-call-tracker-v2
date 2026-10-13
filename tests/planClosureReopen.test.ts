import { planClosureReopen, ClosureReopenJobInput } from "../closureReopenJob";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("Running unit tests for planClosureReopen...");

const settings = { max_attempts: 4, max_sms_attempts: 4 };
const validAgentIds = new Set<number>([10, 20]);
const allocations = new Map<string, { assigned_agent_id: number | null; assigned_agent_name?: string | null }>([
  ["jubilee", { assigned_agent_id: 10, assigned_agent_name: "Alice" }],
  ["uap", { assigned_agent_id: 99, assigned_agent_name: "Archived Agent" }], // 99 not in validAgentIds
  ["apa", { assigned_agent_id: null, assigned_agent_name: null }],
]);

const jobs: ClosureReopenJobInput[] = [
  // 1: Valid assigned agent (10), meets rule (4 calls, 4 SMS) -> COMPLIANT
  {
    id: 1,
    vehicle_reg: "KAA111A",
    channel_partner: "jubilee",
    assigned_agent_id: 10,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-01T00:00:00Z",
  },
  // 2: Valid assigned agent (10), does not meet rule (4 calls, 1 SMS) -> REOPENED
  {
    id: 2,
    vehicle_reg: "KBB222B",
    channel_partner: "jubilee",
    assigned_agent_id: 10,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-02T00:00:00Z",
  },
  // 3: No assigned agent (null), partner 'jubilee' allocated to valid agent (10), meets rule (5 calls, 4 SMS) -> COMPLIANT
  {
    id: 3,
    vehicle_reg: "KCC333C",
    channel_partner: "jubilee",
    assigned_agent_id: null,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-03T00:00:00Z",
  },
  // 4: No assigned agent (null), partner 'jubilee' allocated to valid agent (10), does not meet rule (4 calls, 0 SMS) -> ASSIGNED_AND_REOPENED
  {
    id: 4,
    vehicle_reg: "KDD444D",
    channel_partner: "jubilee",
    assigned_agent_id: null,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-04T00:00:00Z",
  },
  // 5: Assigned to invalid agent (99), partner 'jubilee' allocated to valid agent (10), does not meet rule -> ASSIGNED_AND_REOPENED
  {
    id: 5,
    vehicle_reg: "KEE555E",
    channel_partner: "jubilee",
    assigned_agent_id: 99,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-05T00:00:00Z",
  },
  // 6: No assigned agent, partner 'uap' allocated to invalid agent (99) -> SKIPPED_NO_ALLOCATION
  {
    id: 6,
    vehicle_reg: "KFF666F",
    channel_partner: "uap",
    assigned_agent_id: null,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-06T00:00:00Z",
  },
  // 7: No assigned agent, partner 'britam' not in allocations -> SKIPPED_NO_ALLOCATION
  {
    id: 7,
    vehicle_reg: "KGG777G",
    channel_partner: "britam",
    assigned_agent_id: null,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-07T00:00:00Z",
  },
  // 8: Assigned agent not valid (archived 99), and partner 'uap' allocation also points to archived agent (99) -> SKIPPED_NO_ALLOCATION
  {
    id: 8,
    vehicle_reg: "KHH888H",
    channel_partner: "uap",
    assigned_agent_id: 99,
    status: "RED",
    latest_outcome: "MAX_ATTEMPTS_REACHED",
    closed_at: "2026-01-08T00:00:00Z",
  },
];

const activityByJobId = new Map<number, { attempt_count: number; sms_count: number }>([
  [1, { attempt_count: 4, sms_count: 4 }],
  [2, { attempt_count: 4, sms_count: 1 }],
  [3, { attempt_count: 5, sms_count: 4 }],
  [4, { attempt_count: 4, sms_count: 0 }],
  [5, { attempt_count: 2, sms_count: 2 }],
  [6, { attempt_count: 1, sms_count: 0 }],
  [7, { attempt_count: 0, sms_count: 0 }],
  [8, { attempt_count: 0, sms_count: 0 }],
]);

const decisions = planClosureReopen(jobs, activityByJobId, allocations, validAgentIds, settings);

assert(decisions.length === 8, "Should have 8 decisions");

assert(decisions[0].action === "COMPLIANT", "Job 1 should be COMPLIANT");
assert(decisions[0].new_assigned_agent_id === 10, "Job 1 agent unchanged");

assert(decisions[1].action === "REOPENED", "Job 2 should be REOPENED");
assert(decisions[1].new_assigned_agent_id === 10, "Job 2 agent preserved");

assert(decisions[2].action === "COMPLIANT", "Job 3 should be COMPLIANT");

assert(decisions[3].action === "ASSIGNED_AND_REOPENED", "Job 4 should be ASSIGNED_AND_REOPENED");
assert(decisions[3].new_assigned_agent_id === 10, "Job 4 new agent is allocated agent (10)");

// Case 1: Assigned agent not valid (archived 99) falls back to the allocated agent (10)
assert(decisions[4].action === "ASSIGNED_AND_REOPENED", "Job 5 should fall back to valid allocated agent (10) and be ASSIGNED_AND_REOPENED");
assert(decisions[4].new_assigned_agent_id === 10, "Job 5 new agent is allocated agent (10)");

// Case 2: Allocation pointing to an archived agent gives SKIPPED_NO_ALLOCATION (unassigned job)
assert(decisions[5].action === "SKIPPED_NO_ALLOCATION", "Job 6 with allocation to archived agent should be SKIPPED_NO_ALLOCATION");
assert(decisions[5].new_assigned_agent_id === null, "Job 6 new agent is null");

assert(decisions[6].action === "SKIPPED_NO_ALLOCATION", "Job 7 should be SKIPPED_NO_ALLOCATION");
assert(decisions[6].new_assigned_agent_id === null, "Job 7 new agent is null");

// Case 2b: Assigned agent not valid (archived 99) and allocation also points to archived agent gives SKIPPED_NO_ALLOCATION
assert(decisions[7].action === "SKIPPED_NO_ALLOCATION", "Job 8 with archived assigned agent and archived allocation should be SKIPPED_NO_ALLOCATION");
assert(decisions[7].new_assigned_agent_id === null, "Job 8 new agent is null");

console.log("All unit tests passed successfully!");
