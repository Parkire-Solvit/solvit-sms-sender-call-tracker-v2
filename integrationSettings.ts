// FIXPASS integrationSettings.ts
import crypto from "node:crypto";
import { DbAdapter, DbTransactionClient } from "./db";
import { HttpError } from "./httpError";
import type { HostPinnacleConfig, HostPinnacleAuthMode } from "./hostPinnacle";

type Q = DbTransactionClient;

export const HOST_PINNACLE = "host_pinnacle";

type FieldType = "boolean" | "enum" | "text" | "secret" | "digits";

interface FieldDef {
  type: FieldType;
  env?: string;
  default?: string;
  options?: string[];
}

/** Provider registry. Adding a provider means adding an entry here; nothing else changes. */
export const INTEGRATIONS: Record<string, { label: string; fields: Record<string, FieldDef> }> = {
  [HOST_PINNACLE]: {
    label: "Host Pinnacle SMS",
    fields: {
      enabled: { type: "boolean", default: "false" }, // database only, never from env
      auth_mode: { type: "enum", options: ["api_key", "user_password"], default: "api_key" },
      api_key: { type: "secret", env: "HOST_PINNACLE_API_KEY" },
      user_id: { type: "text", env: "HOST_PINNACLE_USER_ID" },
      password: { type: "secret", env: "HOST_PINNACLE_PASSWORD" },
      sender_id: { type: "text", env: "HOST_PINNACLE_SENDER_ID" },
      country_code: { type: "digits", env: "HOST_PINNACLE_COUNTRY_CODE", default: "254" },
    },
  },
};

// ---------------------------------------------------------------------------
// Optional encryption at rest (AES-256-GCM). Active only when SETTINGS_ENCRYPTION_KEY is set.
// ---------------------------------------------------------------------------

const ENC_PREFIX = "enc:v1:";

function encryptionKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;
  if (raw.length < 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be at least 32 characters.");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext value
  const key = encryptionKey();
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is required to read stored secrets.");
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface StoredRow {
  setting_key: string;
  setting_value: string | null;
}

async function loadStored(db: Q, integration: string): Promise<Map<string, string>> {
  const rows = await db.queryAll<StoredRow>(
    "SELECT setting_key, setting_value FROM integration_settings WHERE integration = ?",
    [integration]
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.setting_value !== null && r.setting_value !== "") map.set(r.setting_key, r.setting_value);
  return map;
}

export type ValueSource = "database" | "environment" | "default" | null;

interface Resolved {
  value: string | null; // decrypted for secrets, internal use only
  source: ValueSource;
}

function resolveField(def: FieldDef, stored: string | undefined, key: string): Resolved {
  if (stored !== undefined) {
    return { value: def.type === "secret" ? decryptSecret(stored) : stored, source: "database" };
  }
  if (def.env && key !== "enabled") {
    const envValue = process.env[def.env];
    if (envValue !== undefined && envValue.trim() !== "") return { value: envValue.trim(), source: "environment" };
  }
  if (def.default !== undefined) return { value: def.default, source: "default" };
  return { value: null, source: null };
}

export interface PublicField {
  /** Present for non-secret fields. */
  value?: string | boolean | null;
  /** Present for secret fields. The secret itself is never returned. */
  configured?: boolean;
  source: ValueSource;
}

export interface PublicIntegration {
  integration: string;
  label: string;
  ready: boolean; // enabled AND all required credentials present
  missing: string[];
  fields: Record<string, PublicField>;
}

function requiredMissing(values: Record<string, string | null>): string[] {
  const missing: string[] = [];
  if (!values.sender_id) missing.push("sender_id");
  if (!values.country_code) missing.push("country_code");
  if (values.auth_mode === "user_password") {
    if (!values.user_id) missing.push("user_id");
    if (!values.password) missing.push("password");
  } else if (!values.api_key) {
    missing.push("api_key");
  }
  return missing;
}

export async function getIntegrationPublicView(db: Q, integration: string): Promise<PublicIntegration> {
  const reg = INTEGRATIONS[integration];
  if (!reg) throw new HttpError(404, "Unknown integration.");
  const stored = await loadStored(db, integration);
  const fields: Record<string, PublicField> = {};
  const values: Record<string, string | null> = {};
  for (const [key, def] of Object.entries(reg.fields)) {
    const r = resolveField(def, stored.get(key), key);
    values[key] = r.value;
    if (def.type === "secret") fields[key] = { configured: r.value !== null && r.value !== "", source: r.source };
    else if (def.type === "boolean") fields[key] = { value: r.value === "true", source: r.source };
    else fields[key] = { value: r.value, source: r.source };
  }
  const missing = requiredMissing(values);
  return { integration, label: reg.label, ready: values.enabled === "true" && missing.length === 0, missing, fields };
}

export interface ResolvedHostPinnacle {
  enabled: boolean;
  missing: string[];
  config: HostPinnacleConfig | null; // null when credentials are incomplete
}

/** Internal use only. Contains decrypted secrets. Never serialise this to a response or a log. */
export async function getHostPinnacleConfig(db: Q): Promise<ResolvedHostPinnacle> {
  const reg = INTEGRATIONS[HOST_PINNACLE];
  const stored = await loadStored(db, HOST_PINNACLE);
  const v: Record<string, string | null> = {};
  for (const [key, def] of Object.entries(reg.fields)) v[key] = resolveField(def, stored.get(key), key).value;
  const missing = requiredMissing(v);
  const enabled = v.enabled === "true";
  if (missing.length > 0) return { enabled, missing, config: null };
  return {
    enabled,
    missing,
    config: {
      authMode: (v.auth_mode as HostPinnacleAuthMode) || "api_key",
      apiKey: v.api_key ?? undefined,
      userId: v.user_id ?? undefined,
      password: v.password ?? undefined,
      senderId: v.sender_id as string,
      countryCode: v.country_code as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function hasControlChars(s: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(s);
}

/**
 * body: any of enabled, auth_mode, sender_id, country_code, user_id, api_key, password, clear.
 * - A secret sent as an empty string is IGNORED (keeps the stored value). Use clear: ["api_key"] to remove it.
 * - Unknown keys are rejected with 400.
 * - settings_change_log never receives a secret: it records [CONFIGURED] or [CLEARED].
 */
export async function updateIntegrationSettings(
  db: DbAdapter,
  integration: string,
  body: Record<string, unknown>,
  changedBy = "Admin"
): Promise<PublicIntegration> {
  const reg = INTEGRATIONS[integration];
  if (!reg) throw new HttpError(404, "Unknown integration.");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request body.");

  const allowed = new Set([...Object.keys(reg.fields), "clear"]);
  for (const k of Object.keys(body)) if (!allowed.has(k)) throw new HttpError(400, `Unknown setting "${k}".`);

  const clear: string[] = [];
  if (body.clear !== undefined) {
    if (!Array.isArray(body.clear) || body.clear.some((c) => typeof c !== "string")) throw new HttpError(400, "clear must be a list of setting names.");
    for (const c of body.clear as string[]) {
      if (!reg.fields[c] || c === "enabled") throw new HttpError(400, `Cannot clear "${c}".`);
      clear.push(c);
    }
  }

  const sets = new Map<string, string>();
  for (const [key, def] of Object.entries(reg.fields)) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (def.type === "boolean") {
      if (typeof raw !== "boolean") throw new HttpError(400, `${key} must be true or false.`);
      sets.set(key, raw ? "true" : "false");
      continue;
    }
    if (typeof raw !== "string") throw new HttpError(400, `${key} must be text.`);
    const trimmed = raw.trim();
    if (trimmed === "") continue; // blank keeps the stored value, for every text field
    if (hasControlChars(trimmed)) throw new HttpError(400, `${key} contains invalid characters.`);
    if (def.type === "enum" && !def.options!.includes(trimmed)) throw new HttpError(400, `${key} must be one of: ${def.options!.join(", ")}.`);
    if (def.type === "digits" && !/^\d{1,4}$/.test(trimmed)) throw new HttpError(400, `${key} must be 1 to 4 digits with no plus sign.`);
    if (key === "sender_id" && trimmed.length > 20) throw new HttpError(400, "sender_id must be 20 characters or fewer.");
    if (key === "user_id" && trimmed.length > 100) throw new HttpError(400, "user_id must be 100 characters or fewer.");
    if (def.type === "secret" && trimmed.length > 500) throw new HttpError(400, `${key} must be 500 characters or fewer.`);
    sets.set(key, trimmed);
  }
  for (const c of clear) if (sets.has(c)) throw new HttpError(400, `"${c}" cannot be set and cleared in the same request.`);

  if (sets.size === 0 && clear.length === 0) return getIntegrationPublicView(db, integration);

  const before = await getIntegrationPublicView(db, integration);

  await db.transaction(async (tx) => {
    for (const [key, value] of sets) {
      const def = reg.fields[key];
      const isSecret = def.type === "secret";
      const stored = isSecret ? encryptSecret(value) : value;
      const updated = await tx.execute(
        "UPDATE integration_settings SET setting_value = ?, is_secret = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE integration = ? AND setting_key = ?",
        [stored, isSecret, changedBy, integration, key]
      );
      if (!updated.affectedRows) {
        await tx.execute(
          "INSERT INTO integration_settings (integration, setting_key, setting_value, is_secret, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING setting_key", // explicit RETURNING: the adapter would otherwise append RETURNING id, and this table has no id column
          [integration, key, stored, isSecret, changedBy]
        );
      }
      const prior = before.fields[key];
      const oldDisplay = isSecret ? (prior.configured ? "[CONFIGURED]" : "[NOT SET]") : String(prior.value ?? "");
      const newDisplay = isSecret ? "[CONFIGURED]" : value;
      await tx.execute(
        "INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by) VALUES (?, ?, ?, ?)",
        [`integration.${integration}.${key}`, oldDisplay, newDisplay, changedBy]
      );
    }
    for (const key of clear) {
      const def = reg.fields[key];
      await tx.execute("DELETE FROM integration_settings WHERE integration = ? AND setting_key = ?", [integration, key]);
      const prior = before.fields[key];
      const isSecret = def.type === "secret";
      await tx.execute(
        "INSERT INTO settings_change_log (setting_key, old_value, new_value, changed_by) VALUES (?, ?, ?, ?)",
        [`integration.${integration}.${key}`, isSecret ? (prior.configured ? "[CONFIGURED]" : "[NOT SET]") : String(prior.value ?? ""), "[CLEARED]", changedBy]
      );
    }
  });

  return getIntegrationPublicView(db, integration);
}
// FIXPASS END integrationSettings.ts

