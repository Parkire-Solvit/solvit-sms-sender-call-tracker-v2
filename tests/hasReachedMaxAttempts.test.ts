import { hasReachedMaxAttempts } from "../insuranceCallbacks";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("Running unit tests for hasReachedMaxAttempts...");

const defaultSettings = { max_attempts: 4, max_sms_attempts: 4 };

// (4,4) -> true
assert(
  hasReachedMaxAttempts({ attempt_count: 4, sms_count: 4 }, defaultSettings) === true,
  "(4,4) should be true under default (4,4) thresholds"
);

// (10,3) -> false
assert(
  hasReachedMaxAttempts({ attempt_count: 10, sms_count: 3 }, defaultSettings) === false,
  "(10,3) should be false under default (4,4) thresholds"
);

// (3,10) -> false
assert(
  hasReachedMaxAttempts({ attempt_count: 3, sms_count: 10 }, defaultSettings) === false,
  "(3,10) should be false under default (4,4) thresholds"
);

// (4,0) -> false
assert(
  hasReachedMaxAttempts({ attempt_count: 4, sms_count: 0 }, defaultSettings) === false,
  "(4,0) should be false under default (4,4) thresholds"
);

// Thresholds 5 and 2:
const customSettings = { max_attempts: 5, max_sms_attempts: 2 };

// (5,2) -> true
assert(
  hasReachedMaxAttempts({ attempt_count: 5, sms_count: 2 }, customSettings) === true,
  "(5,2) should be true under thresholds (5,2)"
);

// (4,2) -> false
assert(
  hasReachedMaxAttempts({ attempt_count: 4, sms_count: 2 }, customSettings) === false,
  "(4,2) should be false under thresholds (5,2)"
);

console.log("All hasReachedMaxAttempts tests passed successfully!");
