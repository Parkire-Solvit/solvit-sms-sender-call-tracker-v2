// V18 outcomeReceipts.ts
// Save receipts: every outcome save carries a client_request_id. If the same id arrives again (a retry after a
// lost response, or the browser sending a saved copy later), the server recognises it and does not save it twice.
import { DbAdapter } from "./db";

export type ReceiptSection = "callbacks" | "pending-submissions";
export type ReceiptClaim = "new" | "duplicate" | "none";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Returns "none" when no valid id was sent (the save then behaves exactly as before, without protection). */
export async function claimOutcomeReceipt(
  db: DbAdapter,
  section: ReceiptSection,
  requestId: unknown,
  jobId: number
): Promise<ReceiptClaim> {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  if (!REQUEST_ID_PATTERN.test(id)) return "none";
  const res = await db.execute(
    `INSERT INTO outcome_receipts (request_id, section, job_id) VALUES (?, ?, ?) ON CONFLICT (request_id) DO NOTHING`,
    [id, section, Number.isFinite(jobId) ? jobId : null]
  );
  return res.affectedRows === 1 ? "new" : "duplicate";
}

/** Called when the save itself failed, so the same id can be retried and actually saved. Never throws. */
export async function releaseOutcomeReceipt(db: DbAdapter, requestId: unknown): Promise<void> {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  if (!REQUEST_ID_PATTERN.test(id)) return;
  try {
    await db.execute(`DELETE FROM outcome_receipts WHERE request_id = ?`, [id]);
  } catch (err) {
    console.error("[RECEIPTS] Could not release a save receipt:", (err as Error)?.name);
  }
}
// V18 END outcomeReceipts.ts

