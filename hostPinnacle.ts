// FIXPASS hostPinnacle.ts
// Host Pinnacle SMS client. Pure transport: no database access, no logging of secrets.
//
// Verified from the Host Pinnacle REST documentation: POST form-urlencoded to /SMSApi/send with
// sendMethod=quick, mobile, msg, senderid, msgType, output=json. Authentication is either an `apikey`
// header or userid + password parameters. Success is {status:"success", transactionId, ...}.
//
// NOT VERIFIED (confirm with Host Pinnacle before go-live, see the live-test checklist in the README):
//   - the exact casing of the user id parameter (USER_ID_PARAM below)
//   - whether `mobile` must be 254XXXXXXXXX without a plus sign (assumed)
//   - the shape of error responses (handled defensively)

export const HOST_PINNACLE_URL = "https://smsportal.hostpinnacle.co.ke/SMSApi/send";
export const USER_ID_PARAM = "userid"; // UNVERIFIED casing. Single place to change.
export const REQUEST_TIMEOUT_MS = 10_000;

export type HostPinnacleAuthMode = "api_key" | "user_password";

export interface HostPinnacleConfig {
  authMode: HostPinnacleAuthMode;
  apiKey?: string;
  userId?: string;
  password?: string;
  senderId: string;
  /** Digits only, no plus sign. Default "254". */
  countryCode: string;
}

export interface SmsSendResult {
  ok: boolean;
  transactionId: string | null;
  /** Safe to store and show to users. Never contains credentials. */
  error: string | null;
  /** True when the request may have reached the provider (timeout). The caller must not auto-retry. */
  deliveryUnknown: boolean;
}

/**
 * Last 9 digits of any Kenyan number format, prefixed with the country code.
 * Returns null unless at least 9 digits are present.
 */
export function toInternationalMobile(raw: string | null | undefined, countryCode: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  if (!/^\d{1,4}$/.test(countryCode)) return null;
  return countryCode + digits.slice(-9);
}

/** GSM-safe ASCII goes as "text". Anything else must be sent as "unicode" or it arrives garbled. */
export function messageType(message: string): "text" | "unicode" {
  return /^[\x00-\x7F]*$/.test(message) ? "text" : "unicode";
}

export function buildRequest(
  config: HostPinnacleConfig,
  mobile: string,
  message: string
): { headers: Record<string, string>; body: string } {
  const params = new URLSearchParams();
  params.set("sendMethod", "quick");
  params.set("mobile", mobile);
  params.set("msg", message);
  params.set("senderid", config.senderId);
  params.set("msgType", messageType(message));
  params.set("output", "json");

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.authMode === "api_key") {
    headers["apikey"] = config.apiKey ?? "";
  } else {
    params.set(USER_ID_PARAM, config.userId ?? "");
    params.set("password", config.password ?? "");
  }
  return { headers, body: params.toString() };
}

function scrub(text: string, config: HostPinnacleConfig): string {
  let out = text;
  for (const secret of [config.apiKey, config.password]) {
    if (secret && secret.length >= 4) out = out.split(secret).join("***");
  }
  return out.replace(/[\r\n\t]+/g, " ").slice(0, 200);
}

/** Interprets the provider response. Exported for tests. */
export function parseResponse(httpStatus: number, text: string, config: HostPinnacleConfig): SmsSendResult {
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, transactionId: null, error: `Host Pinnacle returned HTTP ${httpStatus}.`, deliveryUnknown: false };
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, transactionId: null, error: "Host Pinnacle returned an unreadable response.", deliveryUnknown: true };
  }
  const status = String(data?.status ?? "").toLowerCase();
  const invalid = data?.invalidMobile;
  const hasInvalid = Array.isArray(invalid) ? invalid.length > 0 : invalid !== undefined && invalid !== null && String(invalid).trim() !== "";
  if (status === "success" && !hasInvalid) {
    const tx = data?.transactionId;
    return { ok: true, transactionId: tx === undefined || tx === null ? null : String(tx).slice(0, 100), error: null, deliveryUnknown: false };
  }
  if (status === "success" && hasInvalid) {
    return { ok: false, transactionId: null, error: "Host Pinnacle rejected the mobile number as invalid.", deliveryUnknown: false };
  }
  const reason = typeof data?.reason === "string" && data.reason.trim() ? data.reason : "Host Pinnacle rejected the request.";
  return { ok: false, transactionId: null, error: scrub(reason, config), deliveryUnknown: false };
}

export async function sendSms(
  config: HostPinnacleConfig,
  rawNumber: string,
  message: string,
  fetchImpl: typeof fetch = fetch
): Promise<SmsSendResult> {
  const mobile = toInternationalMobile(rawNumber, config.countryCode);
  if (!mobile) {
    return { ok: false, transactionId: null, error: "The phone number is not valid.", deliveryUnknown: false };
  }
  if (!message || !message.trim()) {
    return { ok: false, transactionId: null, error: "The message is empty.", deliveryUnknown: false };
  }
  const { headers, body } = buildRequest(config, mobile, message);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(HOST_PINNACLE_URL, { method: "POST", headers, body, signal: controller.signal });
    const text = await res.text();
    return parseResponse(res.status, text, config);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return {
        ok: false,
        transactionId: null,
        error: "Delivery unknown: the request to Host Pinnacle timed out. Check the Host Pinnacle portal before resending.",
        deliveryUnknown: true,
      };
    }
    return { ok: false, transactionId: null, error: "Could not reach Host Pinnacle.", deliveryUnknown: false };
  } finally {
    clearTimeout(timer);
  }
}
// FIXPASS END hostPinnacle.ts

