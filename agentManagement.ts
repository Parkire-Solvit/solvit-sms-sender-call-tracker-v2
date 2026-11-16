import { DbAdapter } from "./db";
import { HttpError } from "./httpError";

export interface NewAgentInput {
  name?: unknown;
  phone_number?: unknown;
  tag?: unknown;
}

export interface CreatedAgent {
  id: number;
  name: string;
  phone_number: string | null;
  tag: string;
}

export async function createAgent(db: DbAdapter, input: NewAgentInput): Promise<CreatedAgent> {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  const tag = String(input.tag ?? "Callback Team").trim().replace(/\s+/g, " ") || "Callback Team";
  const rawPhone = String(input.phone_number ?? "").trim();
  const phone = rawPhone ? rawPhone.replace(/[^\d+]/g, "") : null;

  if (name.length < 2) throw new HttpError(400, "Agent name must contain at least 2 characters.");
  if (name.length > 191) throw new HttpError(400, "Agent name must be 191 characters or fewer.");
  if (name.toLowerCase() === "unknown agent") throw new HttpError(400, "Unknown Agent is reserved by the system.");
  if (tag.length > 100) throw new HttpError(400, "Team tag must be 100 characters or fewer.");
  if (phone && phone.replace(/\D/g, "").length < 9) {
    throw new HttpError(400, "Phone number must contain at least 9 digits.");
  }

  const existing = await db.queryOne<{ id: number; archived_at: string | null }>(
    "SELECT id, archived_at FROM agents WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1",
    [name]
  );
  if (existing) {
    throw new HttpError(
      409,
      existing.archived_at
        ? "An archived agent already uses this name. Reactivate that agent instead."
        : "An agent with this name already exists."
    );
  }

  const inserted = await db.execute(
    "INSERT INTO agents (name, phone_number, tag, needs_review) VALUES (?, ?, ?, FALSE)",
    [name, phone, tag]
  );
  return { id: Number(inserted.lastInsertId), name, phone_number: phone, tag };
}
