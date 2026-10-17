// FIXPASS tests/pendingSubmissionsParser.test.ts
import { parsePendingSubmissionRows, normalizeHeader, cellToText } from "../src/lib/pendingSubmissionsParser";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for pendingSubmissionsParser...");

// Real header order from the production export. solver_contact precedes client_no on purpose.
const real = [
  {
    ID: 347840,
    solver_name: "George Kinyanjui",
    solver_contact: 731879953,
    solver_email: "georgenkinyanjui@gmail.com",
    vehicle_reg: "KDV  235F",
    insurance_company: "Fidelity",
    client_no: 720892842,
    customer_email: "",
    schedule_date: new Date("2026-09-29T08:41:11Z"),
    latest_pending_reason: "Call back",
  },
];
const r1 = parsePendingSubmissionRows(real);
assert(r1.missingHeaders.length === 0, "no missing headers on the real export");
assert(r1.rows.length === 1 && r1.skipped.length === 0, "the real row is accepted");
assert(r1.rows[0].client_phone === "720892842", "client_phone comes from client_no");
assert(r1.rows[0].solver_contact === "731879953", "solver_contact comes from solver_contact");
assert(r1.rows[0].client_phone !== r1.rows[0].solver_contact, "client and solver numbers are never mixed up");
assert(r1.rows[0].external_id === "347840", "numeric ID becomes text without exponent or decimals");
assert(r1.rows[0].vehicle_reg === "KDV  235F", "raw registration is preserved");
assert(r1.rows[0].schedule_date === "2026-09-29T08:41:11.000Z", "Date cell becomes ISO string");

// Header variants
const r2 = parsePendingSubmissionRows([{ " Client_No ": "0722 111 222", "ID": "12", "Solver Contact": "0700000000", "Vehicle Reg": "KAA 001A" }]);
assert(r2.missingHeaders.length === 0, "header normalisation handles case, spaces and underscores");
assert(r2.rows[0].client_phone === "0722 111 222", "client phone raw text preserved");

// Missing required header is reported, nothing is guessed
const r3 = parsePendingSubmissionRows([{ ID: 1, solver_contact: "0711111111", vehicle_reg: "KAA 001A" }]);
assert(r3.missingHeaders.includes("client_phone"), "missing client phone header is reported");
assert(r3.rows.length === 0, "no rows returned when a required header is missing");

// Substring headers must NOT match
const r4 = parsePendingSubmissionRows([{ ID: 1, solver_contact: "0711111111", vehicle_reg: "KAA 001A", contact_person: "0733333333" }]);
assert(r4.missingHeaders.includes("client_phone"), "contact_person must not be treated as client phone");

// Row-level validation
const r5 = parsePendingSubmissionRows([
  { ID: "", solver_contact: "1", vehicle_reg: "A", client_no: "0722111222" },
  { ID: 2, solver_contact: "1", vehicle_reg: "A", client_no: "123" },
  { ID: 3, solver_contact: "1", vehicle_reg: "", client_no: "0722111222" },
  { ID: 4, solver_contact: "1", vehicle_reg: "KAA 001A", client_no: "0722111222" },
]);
assert(r5.rows.length === 1 && r5.rows[0].external_id === "4", "only the valid row survives");
assert(r5.skipped.length === 3, "three invalid rows are reported");
assert(r5.skipped[0].rowNumber === 2 && r5.skipped[2].rowNumber === 4, "row numbers are spreadsheet row numbers");

assert(normalizeHeader("  Client No. ") === "client_no", "normalizeHeader");
assert(cellToText(null) === "" && cellToText(undefined) === "", "cellToText null");
assert(cellToText(720892842) === "720892842", "cellToText integer");

console.log("All pendingSubmissionsParser tests passed!");
// FIXPASS END tests/pendingSubmissionsParser.test.ts

