import { extractPhoneNumbers } from "../insuranceCallbacks";

interface TestCase {
  input: string;
  expected: string[];
}

const testCases: TestCase[] = [
  {
    input: "0702 280749",
    expected: ["702280749"],
  },
  {
    input: "+254 702 280 749",
    expected: ["702280749"],
  },
  {
    input: "254702280749",
    expected: ["702280749"],
  },
  {
    input: "0722123456/0733123456",
    expected: ["722123456", "733123456"],
  },
  {
    input: "0722123456, 0733123456",
    expected: ["722123456", "733123456"],
  },
  {
    input: "0722123456 or 0733123456",
    expected: ["722123456", "733123456"],
  },
  {
    input: "0722123456 0733123456",
    expected: ["722123456", "733123456"],
  },
];

let failed = 0;
for (const tc of testCases) {
  const result = extractPhoneNumbers(tc.input);
  const pass =
    result.length === tc.expected.length &&
    result.every((val, idx) => val === tc.expected[idx]);

  if (pass) {
    console.log(`[PASS] "${tc.input}" -> [${result.join(", ")}]`);
  } else {
    console.error(
      `[FAIL] "${tc.input}" -> expected [${tc.expected.join(", ")}], got [${result.join(", ")}]`
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${testCases.length} phone extraction tests passed!`);
}
