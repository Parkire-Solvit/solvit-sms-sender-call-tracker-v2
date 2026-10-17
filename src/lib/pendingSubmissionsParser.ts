// FIXPASS src/lib/pendingSubmissionsParser.ts
// Pure, dependency-free mapper from raw spreadsheet rows to import rows.
// Header matching is EXACT (after normalisation). Substring matching is forbidden.

export interface ParsedPendingRow {
  external_id: string;
  solver_name: string;
  solver_contact: string;
  solver_email: string;
  vehicle_reg: string;
  insurance_company: string;
  client_phone: string;
  customer_email: string;
  schedule_date: string;
  latest_pending_reason: string;
}

export interface SkippedRow {
  rowNumber: number; // spreadsheet row number; header is row 1, first data row is row 2
  reason: string;
}

export interface ParseResult {
  rows: ParsedPendingRow[];
  skipped: SkippedRow[];
  missingHeaders: string[]; // canonical field names that have no matching header
}

type FieldName = keyof ParsedPendingRow;

export const HEADER_ALIASES: Record<FieldName, string[]> = {
  external_id: ["id", "external_id", "job_id"],
  solver_name: ["solver_name"],
  solver_contact: ["solver_contact"],
  solver_email: ["solver_email"],
  vehicle_reg: ["vehicle_reg"],
  insurance_company: ["insurance_company"],
  client_phone: ["client_no", "client_phone"],
  customer_email: ["customer_email"],
  schedule_date: ["schedule_date"],
  latest_pending_reason: ["latest_pending_reason"],
};

export const REQUIRED_FIELDS: FieldName[] = ["external_id", "solver_contact", "vehicle_reg", "client_phone"];

export function normalizeHeader(header: string): string {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") {
    if (!isFinite(value)) return "";
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  return String(value).trim();
}

export function parsePendingSubmissionRows(rawRows: Array<Record<string, unknown>>): ParseResult {
  const result: ParseResult = { rows: [], skipped: [], missingHeaders: [] };
  if (!rawRows || rawRows.length === 0) {
    result.missingHeaders = [...REQUIRED_FIELDS];
    return result;
  }

  // Resolve source header -> field using the union of keys across all rows.
  const headerToField = new Map<string, FieldName>();
  const fieldToHeader = new Map<FieldName, string>();
  const seenKeys: string[] = [];
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      if (!seenKeys.includes(key)) seenKeys.push(key);
    }
  }
  for (const key of seenKeys) {
    const normalised = normalizeHeader(key);
    for (const field of Object.keys(HEADER_ALIASES) as FieldName[]) {
      if (fieldToHeader.has(field)) continue; // first matching header wins
      if (HEADER_ALIASES[field].includes(normalised)) {
        headerToField.set(key, field);
        fieldToHeader.set(field, key);
        break;
      }
    }
  }

  result.missingHeaders = REQUIRED_FIELDS.filter((f) => !fieldToHeader.has(f));
  if (result.missingHeaders.length > 0) return result;

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const out = {} as ParsedPendingRow;
    for (const field of Object.keys(HEADER_ALIASES) as FieldName[]) {
      const header = fieldToHeader.get(field);
      out[field] = header ? cellToText(raw[header]) : "";
    }

    if (!/^\d+$/.test(out.external_id)) {
      result.skipped.push({ rowNumber, reason: "ID is missing or not a whole number" });
      return;
    }
    if (out.client_phone.replace(/\D/g, "").length < 9) {
      result.skipped.push({ rowNumber, reason: "Client number has fewer than 9 digits" });
      return;
    }
    if (!out.vehicle_reg) {
      result.skipped.push({ rowNumber, reason: "Vehicle registration is missing" });
      return;
    }
    result.rows.push(out);
  });

  return result;
}
// FIXPASS END src/lib/pendingSubmissionsParser.ts

