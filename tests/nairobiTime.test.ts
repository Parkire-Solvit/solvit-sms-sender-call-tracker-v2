// FIXPASS tests/nairobiTime.test.ts
import assert from "node:assert/strict";
import { toNairobiInputValue, nairobiInputToIso, formatNairobiDisplay } from "../src/lib/nairobiTime";

function check(name: string, fn: () => void) {
  fn();
  console.log(`PASS ${name}`);
}

check("UTC instant renders as Nairobi wall clock", () => {
  assert.equal(toNairobiInputValue("2026-10-14T07:30:00.000Z"), "2026-10-14T10:30");
});
check("midnight renders as 00:xx, never 24:xx", () => {
  assert.equal(toNairobiInputValue("2026-10-13T21:05:00.000Z"), "2026-10-14T00:05");
});
check("null and garbage return empty string", () => {
  assert.equal(toNairobiInputValue(null), "");
  assert.equal(toNairobiInputValue("not a date"), "");
});
check("local input becomes an ISO string with +03:00", () => {
  assert.equal(nairobiInputToIso("2026-10-14T10:30"), "2026-10-14T10:30:00+03:00");
  assert.equal(Date.parse(nairobiInputToIso("2026-10-14T10:30")!), Date.parse("2026-10-14T07:30:00.000Z"));
});
check("malformed input returns null", () => {
  assert.equal(nairobiInputToIso(""), null);
  assert.equal(nairobiInputToIso("2026-10-14"), null);
});
check("round trip", () => {
  const iso = nairobiInputToIso("2026-12-31T23:59")!;
  assert.equal(toNairobiInputValue(new Date(iso).toISOString()), "2026-12-31T23:59");
});
check("display format matches the server SMS format", () => {
  assert.equal(formatNairobiDisplay("2026-10-14T07:30:00.000Z"), "Wed 14 Oct 2026, 10:30 AM");
  assert.equal(formatNairobiDisplay("2026-10-14T19:05:00.000Z"), "Wed 14 Oct 2026, 10:05 PM");
  assert.equal(formatNairobiDisplay(null), "");
  assert.equal(formatNairobiDisplay("junk"), "");
});
console.log("nairobiTime tests passed");
// FIXPASS END tests/nairobiTime.test.ts

