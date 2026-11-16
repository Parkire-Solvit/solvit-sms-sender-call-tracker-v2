import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/PendingSubmissionsSection.tsx", import.meta.url), "utf8");

assert.match(server, /express\.json\(\{ limit: process\.env\.JSON_BODY_LIMIT \|\| "2mb" \}\)/);
assert.match(server, /err\?\.type === "entity\.too\.large"/);
assert.match(component, /Failed to import file \(server returned \$\{res\.status\}\)/);

console.log("Pending upload size and error handling checks passed.");
