// FIXPASS pendingSubmissionOutcomes.ts
// Single source of truth for Pending Submissions outcomes. Do not duplicate these lists elsewhere on the backend.

export type JobStatus = "GREEN" | "AMBER" | "RED";

export interface AgentOutcome {
  value: string;
  label: string;
  status: JobStatus;
  closes: boolean;
}

/** Exactly TEN outcomes an agent may select. */
export const AGENT_OUTCOMES: ReadonlyArray<AgentOutcome> = [
  { value: "SCHEDULED", label: "Scheduled", status: "GREEN", closes: true },
  { value: "CALL_BACK", label: "Call back", status: "AMBER", closes: false },
  { value: "NOT_READY", label: "Not ready", status: "AMBER", closes: false },
  { value: "NOT_PICKING", label: "Not picking", status: "AMBER", closes: false },
  { value: "UNREACHABLE", label: "Unreachable", status: "AMBER", closes: false },
  { value: "WRONG_NUMBER", label: "Wrong number", status: "AMBER", closes: false },
  { value: "CHANGED_LOCATION", label: "Changed location", status: "AMBER", closes: false },
  { value: "NO_DOCUMENTS", label: "No documents", status: "AMBER", closes: false },
  { value: "WRONG_REGISTRATION_SCHEDULE", label: "Wrong registration schedule", status: "AMBER", closes: false },
  { value: "WITHDRAWN", label: "Withdrawn / Invalid", status: "RED", closes: true },
];

/** Written only by the backend. Rejected if an agent submits them. */
export const SYSTEM_OUTCOMES = ["MAX_ATTEMPTS_REACHED", "ABSENT_FROM_LATEST_EXPORT", "REOPENED_BY_SYSTEM"] as const;

/** Values that may exist in rows written by the first build. Display-only; never accepted as input. */
export const LEGACY_OUTCOMES = [
  "CONTACT_ATTEMPTED",
  "CLIENT_POSTPONED",
  "CLIENT_REFUSED",
  "AGREED_SCHEDULE",
  "SUBMITTED_BY_SOLVER",
] as const;

/** A GREEN job whose latest_outcome is one of these was closed by absence and may be reopened by an import. */
export const ABSENT_CLOSE_OUTCOMES: ReadonlyArray<string> = ["ABSENT_FROM_LATEST_EXPORT", "SUBMITTED_BY_SOLVER"];

/** Exact, case-sensitive match. No trimming, no upper-casing, no aliases. */
export function isAgentOutcome(value: unknown): value is string {
  return typeof value === "string" && AGENT_OUTCOMES.some((o) => o.value === value);
}

export function statusForAgentOutcome(value: string): JobStatus {
  const found = AGENT_OUTCOMES.find((o) => o.value === value);
  if (!found) throw new Error(`Not an agent outcome: ${value}`);
  return found.status;
}
// FIXPASS END pendingSubmissionOutcomes.ts

