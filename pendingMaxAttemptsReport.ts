// V18 pendingMaxAttemptsReport.ts
// Pending Submissions max attempts Excel report, in the same format as the Callbacks max attempts report:
// a Summary sheet, one sheet per insurance company (the Callbacks version uses channel partner), and a Raw Data sheet.
import * as XLSX from "xlsx";
import { DbAdapter } from "./db";
import { normalizeRegAlphaNumeric } from "./insuranceCallbacks";
import {
  ContactEvent,
  ContactJob,
  PendingSubmissionJobView,
  countClientContacts,
  getPendingSubmissionMaxAttemptsReport,
  getPendingSubmissionSettings,
  normalizePhone,
  parseDbTimestamp,
} from "./pendingSubmissions";

export type ChronologyEntry =
  | { kind: "OUTCOME"; outcome: string; comment: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted: false }
  | { kind: "CALL"; status: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted: boolean }
  | { kind: "SMS"; status: string; note: string; logged_by: string; logged_by_phone: string | null; timestamp: string; counted: boolean };

export interface PendingMaxAttemptsRecord {
  job: PendingSubmissionJobView;
  chronology: ChronologyEntry[];
}

export interface PendingMaxAttemptsGroup {
  insurance_company: string;
  records: PendingMaxAttemptsRecord[];
}

const DAY_MS = 86_400_000;

/** Every record that reached max attempts, grouped by insurance company, each with its merged call, SMS and outcome trail. */
export async function getPendingMaxAttemptsTimeline(db: DbAdapter): Promise<PendingMaxAttemptsGroup[]> {
  const grouped = await getPendingSubmissionMaxAttemptsReport(db);
  const allJobs = grouped.flatMap((g) => g.jobs);
  if (allJobs.length === 0) return [];

  const settings = await getPendingSubmissionSettings(db);
  const agentRows = await db.queryAll<{ id: unknown; name: string; phone_number: string | null; tag: string | null; archived_at: unknown }>(
    `SELECT id, name, phone_number, tag, archived_at FROM agents`
  );
  const agentById = new Map<number, { name: string; phone: string | null }>();
  const phoneByName = new Map<string, string | null>();
  const teamIds = new Set<number>();
  const teamTag = String(settings.callback_team_tag || "").trim().toLowerCase();
  for (const a of agentRows) {
    const id = Number(a.id);
    agentById.set(id, { name: a.name, phone: a.phone_number ?? null });
    phoneByName.set(a.name, a.phone_number ?? null);
    if ((a.archived_at === null || a.archived_at === undefined) && String(a.tag || "").trim().toLowerCase() === teamTag) teamIds.add(id);
  }

  const assignedIds = [...new Set(allJobs.map((j) => j.assigned_agent_id).filter((x): x is number => x !== null && x !== undefined))];
  let minMs = Infinity;
  for (const j of allJobs) {
    const ms = parseDbTimestamp(j.first_imported_at);
    if (!isNaN(ms) && ms < minMs) minMs = ms;
  }
  const eventsByAgent = new Map<number, ContactEvent[]>();
  if (assignedIds.length > 0 && isFinite(minMs)) {
    const lowerBound = new Date(minMs - 2 * DAY_MS).toISOString().slice(0, 10);
    const events = await db.queryAll<ContactEvent>(
      `SELECT id, agent_id, type, status, timestamp, target_phone, reg_no
       FROM events
       WHERE agent_id IN (${assignedIds.map(() => "?").join(", ")}) AND type IN ('CALL', 'SMS') AND timestamp >= ?`,
      [...assignedIds, lowerBound]
    );
    for (const ev of events) {
      const key = Number(ev.agent_id);
      const list = eventsByAgent.get(key) ?? [];
      list.push(ev);
      eventsByAgent.set(key, list);
    }
  }

  const buildFor = (job: PendingSubmissionJobView & { logs: Array<{ outcome: string; comment: string; logged_by: string; created_at: string }> }): PendingMaxAttemptsRecord => {
    const chronology: ChronologyEntry[] = job.logs.map((l) => ({
      kind: "OUTCOME" as const,
      outcome: l.outcome,
      comment: l.comment || "",
      logged_by: l.logged_by,
      logged_by_phone: phoneByName.get(l.logged_by) ?? null,
      timestamp: String(l.created_at),
      counted: false as const,
    }));

    if (job.assigned_agent_id !== null && job.assigned_agent_id !== undefined) {
      const agentId = Number(job.assigned_agent_id);
      const agent = agentById.get(agentId);
      const firstMs = parseDbTimestamp(job.first_imported_at);
      const ctx: ContactJob = {
        id: job.id,
        assigned_agent_id: agentId,
        client_phone: job.client_phone,
        solver_contact: job.solver_contact,
        vehicle_reg: job.vehicle_reg,
        first_imported_at: job.first_imported_at,
      };
      const clientPhone = normalizePhone(job.client_phone);
      const reg = normalizeRegAlphaNumeric(job.vehicle_reg);
      for (const ev of eventsByAgent.get(agentId) ?? []) {
        const ts = parseDbTimestamp(ev.timestamp);
        if (isNaN(ts) || (!isNaN(firstMs) && ts < firstMs)) continue;
        const phoneMatch = clientPhone !== "" && normalizePhone(ev.target_phone) === clientPhone;
        const regMatch = ev.type === "SMS" && reg !== "" && normalizeRegAlphaNumeric(ev.reg_no) === reg;
        if (!phoneMatch && !regMatch) continue;
        const act = countClientContacts([ctx], [ev], teamIds).get(job.id);
        const counted = teamIds.has(agentId) && !!act && act.client_attempt_count + act.client_sms_count > 0;
        if (ev.type === "CALL") {
          chronology.push({
            kind: "CALL",
            status: String(ev.status || "OUTGOING"),
            logged_by: agent?.name || "Unknown",
            logged_by_phone: agent?.phone ?? null,
            timestamp: String(ev.timestamp),
            counted,
          });
        } else {
          chronology.push({
            kind: "SMS",
            status: String(ev.status || "SENT"),
            note: "SMS follow-up dispatched",
            logged_by: agent?.name || "System",
            logged_by_phone: agent?.phone ?? null,
            timestamp: String(ev.timestamp),
            counted,
          });
        }
      }
    }

    chronology.sort((a, b) => parseDbTimestamp(a.timestamp) - parseDbTimestamp(b.timestamp));
    return { job, chronology };
  };

  return grouped.map((g) => ({ insurance_company: g.insurance_company, records: g.jobs.map(buildFor) }));
}

export function filterMaxAttemptsGroups(groups: PendingMaxAttemptsGroup[], agentFilter: string, companyFilter: string): PendingMaxAttemptsGroup[] {
  let out = groups;
  const company = (companyFilter || "").trim();
  if (company && company.toUpperCase() !== "ALL") {
    out = out.filter((g) => g.insurance_company.toLowerCase() === company.toLowerCase());
  }
  const agent = (agentFilter || "").trim();
  if (agent && agent.toUpperCase() !== "ALL") {
    out = out
      .map((g) => ({
        ...g,
        records: g.records.filter((r) => {
          if (agent.toUpperCase() === "UNASSIGNED" || agent === "__unassigned__") return r.job.assigned_agent_id === null;
          return (
            (r.job.assigned_agent_name !== null && r.job.assigned_agent_name.toLowerCase() === agent.toLowerCase()) ||
            (r.job.assigned_agent_id !== null && String(r.job.assigned_agent_id) === agent)
          );
        }),
      }))
      .filter((g) => g.records.length > 0);
  }
  return out;
}

export function buildPendingMaxAttemptsWorkbook(groups: PendingMaxAttemptsGroup[], agentFilter: string, companyFilter: string, nowMs: number = Date.now()) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary. One row per client phone with the maximum counts for that phone.
  type SummaryRow = {
    solverName: string;
    clientPhone: string;
    companies: Set<string>;
    vehicles: Set<string>;
    agent: string;
    calls: number;
    sms: number;
  };
  const byPhone = new Map<string, SummaryRow>();
  for (const g of groups) {
    for (const r of g.records) {
      const phone = r.job.client_phone_raw || r.job.client_phone;
      let entry = byPhone.get(phone);
      if (!entry) {
        entry = {
          solverName: r.job.solver_name || "N/A",
          clientPhone: phone,
          companies: new Set(),
          vehicles: new Set(),
          agent: r.job.assigned_agent_name || "Unassigned",
          calls: 0,
          sms: 0,
        };
        byPhone.set(phone, entry);
      }
      entry.companies.add(g.insurance_company);
      entry.vehicles.add(r.job.vehicle_reg_raw || r.job.vehicle_reg);
      entry.calls = Math.max(entry.calls, Number(r.job.client_attempt_count || 0));
      entry.sms = Math.max(entry.sms, Number(r.job.client_sms_count || 0));
    }
  }
  const summaryRows = [...byPhone.values()].map((e) => ({
    "Solver Name": e.solverName,
    "Client Phone": e.clientPhone,
    "Insurance Company(ies)": [...e.companies].join(", "),
    "Vehicles": [...e.vehicles].join(", "),
    "Vehicle Count": e.vehicles.size,
    "Assigned Agent": e.agent,
    "Outgoing Calls": e.calls,
    "SMS Sent": e.sms,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

  const rowsFor = (company: string, records: PendingMaxAttemptsRecord[]) => {
    const rows: Array<Record<string, unknown>> = [];
    for (const rec of records) {
      const j = rec.job;
      const base = {
        "Vehicle Registration": j.vehicle_reg_raw || j.vehicle_reg,
        "Solver Name": j.solver_name || "N/A",
        "Client Phone": j.client_phone_raw || j.client_phone || "",
        "Insurance Company": company,
      };
      const agent = j.assigned_agent_name || "Unassigned";
      if (rec.chronology.length === 0) {
        rows.push({ ...base, "Timestamp": j.closed_at || "", "Type": "NONE", "Status / Outcome": "MAX_ATTEMPTS_REACHED", "Notes": "", "Agent Name": "", "Agent Phone": "", "Assigned Agent": agent, "Counted Towards Max Attempts": "No" });
        continue;
      }
      for (const item of rec.chronology) {
        rows.push({
          ...base,
          "Timestamp": item.timestamp || "",
          "Type": item.kind,
          "Status / Outcome": item.kind === "OUTCOME" ? item.outcome : item.status,
          "Notes": item.kind === "OUTCOME" ? item.comment : item.kind === "SMS" ? item.note : "",
          "Agent Name": item.logged_by || "",
          "Agent Phone": item.logged_by_phone || "",
          "Assigned Agent": agent,
          "Counted Towards Max Attempts": item.counted ? "Yes" : "No",
        });
      }
    }
    return rows;
  };

  const allRaw: Array<Record<string, unknown>> = [];
  const used = new Set<string>(["summary", "raw data"]);
  for (const g of groups) {
    const rows = rowsFor(g.insurance_company, g.records);
    allRaw.push(...rows);
    let clean = g.insurance_company.replace(/[:\\/?*\[\]]/g, "_").trim().slice(0, 31);
    if (!clean) clean = "Company";
    let finalName = clean;
    let counter = 2;
    while (used.has(finalName.toLowerCase())) {
      const suffix = ` (${counter})`;
      finalName = clean.slice(0, 31 - suffix.length) + suffix;
      counter++;
    }
    used.add(finalName.toLowerCase());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), finalName);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRaw), "Raw Data");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const clean = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "all";
  const agentPart = agentFilter && agentFilter.toUpperCase() !== "ALL" ? clean(agentFilter) : "all";
  const companyPart = companyFilter && companyFilter.toUpperCase() !== "ALL" ? clean(companyFilter) : "all";
  const today = new Date(nowMs).toISOString().split("T")[0];
  return { buffer, filename: `pending_max_attempts_report_${agentPart}_${companyPart}_${today}.xlsx`, summaryRows: summaryRows.length };
}
// V18 END pendingMaxAttemptsReport.ts

