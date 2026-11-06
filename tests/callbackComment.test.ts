// tests/callbackComment.test.ts
// Comment rule for callback outcomes: Customer Rejected (DECLINED) and Done Elsewhere (VALUED_ELSEWHERE) need a real comment.
import {
  callbackCommentProblem,
  isCommentRequiredForOutcome,
  COMMENT_REQUIRED_OUTCOMES,
  MIN_REQUIRED_COMMENT_LENGTH,
} from "../src/lib/callbackComment";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

console.log("Running tests for callbackComment...");

assert(MIN_REQUIRED_COMMENT_LENGTH === 10, "minimum length is 10 characters");
assert(COMMENT_REQUIRED_OUTCOMES.join(",") === "DECLINED,VALUED_ELSEWHERE", "exactly the two outcomes are covered");

assert(isCommentRequiredForOutcome("DECLINED") && isCommentRequiredForOutcome("VALUED_ELSEWHERE"), "both outcomes need a comment");
assert(isCommentRequiredForOutcome(" declined ") && isCommentRequiredForOutcome("valued_elsewhere"), "outcome is read case-insensitively and trimmed, like the server does");
for (const o of ["SCHEDULED", "NOT_PICKING", "WRONG_NUMBER", "NOT_READY", "UNREACHABLE", "", null, undefined]) {
  assert(!isCommentRequiredForOutcome(o), `${String(o)} does not need the extra rule`);
  assert(callbackCommentProblem(o, "") === null, `${String(o)} with no comment is not blocked by this rule`);
}

for (const o of ["DECLINED", "VALUED_ELSEWHERE"]) {
  assert(callbackCommentProblem(o, undefined) !== null, `${o}: missing comment is refused`);
  assert(callbackCommentProblem(o, null) !== null, `${o}: null comment is refused`);
  assert(callbackCommentProblem(o, "") !== null, `${o}: empty comment is refused`);
  assert(callbackCommentProblem(o, "     ") !== null, `${o}: spaces only is refused`);
  assert(callbackCommentProblem(o, ".") !== null, `${o}: a single character is refused`);
  assert(callbackCommentProblem(o, "  too short ") !== null, `${o}: fewer than 10 characters after trimming is refused`);
  assert(callbackCommentProblem(o, 12345678901234 as unknown) !== null, `${o}: a non-text comment is refused`);
  assert(callbackCommentProblem(o, "1234567890") === null, `${o}: exactly 10 characters is accepted`);
  assert(callbackCommentProblem(o, "  Customer refused the inspection.  ") === null, `${o}: a real comment is accepted`);
}
assert(/at least 10 characters/.test(callbackCommentProblem("DECLINED", "") ?? ""), "the message states the minimum");

console.log("All callbackComment tests passed!");
