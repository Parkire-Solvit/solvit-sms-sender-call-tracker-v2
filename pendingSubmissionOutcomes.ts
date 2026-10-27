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
export const SYSTEM_OUTCOMES = ["MAX_ATTEMPTS_REACHED", "ABSENT_FROM_LATEST_EXPORT", "REOPENED_BY_SYSTEM", "TYPE_CHANGED_BY_SYSTEM"] as const;

// ---------------------------------------------------------------------------
// Job types (V19)
// ---------------------------------------------------------------------------

/** INSPECTION: the solver has not yet seen the car. SUBMISSION: inspected in the field, but the solver has not submitted the data. */
export type PendingJobType = "INSPECTION" | "SUBMISSION";
export const PENDING_JOB_TYPES: ReadonlyArray<PendingJobType> = ["INSPECTION", "SUBMISSION"];
export const JOB_TYPE_LABELS: Record<PendingJobType, string> = {
  INSPECTION: "Pending Inspection",
  SUBMISSION: "Pending Submission",
};

/** Reads the job_status cell of the upload. Only the two exact names are accepted (any case, spaces or underscores). */
export function parseJobStatus(value: unknown): PendingJobType | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, " ");
  if (text === "pending inspection") return "INSPECTION";
  if (text === "pending submission") return "SUBMISSION";
  return null;
}

/** Anything that is not exactly SUBMISSION is an inspection job (the default of existing records). */
export function normalizeJobType(value: unknown): PendingJobType {
  return value === "SUBMISSION" ? "SUBMISSION" : "INSPECTION";
}

/** Reads a job_type query parameter. Returns undefined when it is missing or not one of the two types. */
export function parseJobTypeParam(value: unknown): PendingJobType | undefined {
  const text = String(value ?? "").trim().toUpperCase();
  return text === "INSPECTION" || text === "SUBMISSION" ? text : undefined;
}

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

/**
 * The Pending Submission stream has the same outcomes except that SCHEDULED is replaced by SOLVER_SUBMITTED
 * ("Submitted"), which closes the job GREEN because that is the success for this stream.
 * SOLVER_SUBMITTED is NOT in ABSENT_CLOSE_OUTCOMES: a job an agent closed as submitted is never reopened by an upload.
 */
export const SUBMISSION_OUTCOMES: ReadonlyArray<AgentOutcome> = [
  { value: "SOLVER_SUBMITTED", label: "Submitted", status: "GREEN", closes: true },
  ...AGENT_OUTCOMES.filter((o) => o.value !== "SCHEDULED"),
];

export function outcomesFor(jobType: PendingJobType): ReadonlyArray<AgentOutcome> {
  return jobType === "SUBMISSION" ? SUBMISSION_OUTCOMES : AGENT_OUTCOMES;
}

/**
 * Exact, case-sensitive match. No trimming, no upper-casing, no aliases.
 * With a job type, the outcome must belong to that type's list. Without one, it may belong to either list.
 */
export function isAgentOutcome(value: unknown, jobType?: PendingJobType): value is string {
  if (typeof value !== "string") return false;
  if (jobType) return outcomesFor(jobType).some((o) => o.value === value);
  return AGENT_OUTCOMES.some((o) => o.value === value) || SUBMISSION_OUTCOMES.some((o) => o.value === value);
}

export function statusForAgentOutcome(value: string): JobStatus {
  const found = AGENT_OUTCOMES.find((o) => o.value === value) ?? SUBMISSION_OUTCOMES.find((o) => o.value === value);
  if (!found) throw new Error(`Not an agent outcome: ${value}`);
  return found.status;
}
// FIXPASS END pendingSubmissionOutcomes.ts
