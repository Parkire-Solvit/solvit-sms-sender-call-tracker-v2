// Comment rule for callback outcomes. Shared by the server and both outcome forms so they cannot drift apart.

/** Outcomes that close a callback as a customer decision. Agents must explain them. */
export const COMMENT_REQUIRED_OUTCOMES: ReadonlyArray<string> = ['DECLINED', 'VALUED_ELSEWHERE'];

/** Minimum length of the trimmed comment, so a space or a full stop cannot satisfy the rule. */
export const MIN_REQUIRED_COMMENT_LENGTH = 10;

export function isCommentRequiredForOutcome(outcome: unknown): boolean {
  return COMMENT_REQUIRED_OUTCOMES.includes(String(outcome ?? '').trim().toUpperCase());
}

/** Returns a message when the comment does not satisfy the rule for this outcome, otherwise null. */
export function callbackCommentProblem(outcome: unknown, comment: unknown): string | null {
  if (!isCommentRequiredForOutcome(outcome)) return null;
  const text = typeof comment === 'string' ? comment.trim() : '';
  if (text.length >= MIN_REQUIRED_COMMENT_LENGTH) return null;
  return `Comment is required for this outcome. Explain the reason in at least ${MIN_REQUIRED_COMMENT_LENGTH} characters.`;
}
