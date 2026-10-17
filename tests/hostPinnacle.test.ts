// FIXPASS tests/hostPinnacle.test.ts
import assert from "node:assert/strict";
import {
  toInternationalMobile, messageType, buildRequest, parseResponse, sendSms, HOST_PINNACLE_URL, USER_ID_PARAM,
  HostPinnacleConfig,
} from "../hostPinnacle";
import { createRateLimiter } from "../rateLimit";
import { renderSolverSms, formatNairobiDateTime } from "../solverNotifications";

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => console.log(`PASS ${name}`));
}

const keyCfg: HostPinnacleConfig = { authMode: "api_key", apiKey: "SECRET-API-KEY-123", senderId: "SOLVIT", countryCode: "254" };
const pwCfg: HostPinnacleConfig = { authMode: "user_password", userId: "solvit_user", password: "S3cretPass!", senderId: "SOLVIT", countryCode: "254" };

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => ({ status, text: async () => body })) as unknown as typeof fetch;
}

async function main() {
  await check("mobile: every Kenyan format becomes 254 + last 9 digits", () => {
    for (const raw of ["0712345678", "712345678", "+254712345678", "254712345678", "0712 345 678", "+254 (712) 345-678"]) {
      assert.equal(toInternationalMobile(raw, "254"), "254712345678", raw);
    }
  });
  await check("mobile: too short or empty is rejected", () => {
    assert.equal(toInternationalMobile("12345", "254"), null);
    assert.equal(toInternationalMobile("", "254"), null);
    assert.equal(toInternationalMobile(null, "254"), null);
    assert.equal(toInternationalMobile("0712345678", "+254"), null);
  });
  await check("msgType: ASCII is text, anything else is unicode", () => {
    assert.equal(messageType("Hi John, inspection at Westlands."), "text");
    assert.equal(messageType("Hi, 10:30 \u2013 Westlands"), "unicode");
  });
  await check("request: api key goes in a header and never in the body", () => {
    const { headers, body } = buildRequest(keyCfg, "254712345678", "Hello");
    assert.equal(headers["apikey"], "SECRET-API-KEY-123");
    assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.ok(!body.includes("SECRET-API-KEY-123"));
    const p = new URLSearchParams(body);
    assert.equal(p.get("sendMethod"), "quick");
    assert.equal(p.get("mobile"), "254712345678");
    assert.equal(p.get("msg"), "Hello");
    assert.equal(p.get("senderid"), "SOLVIT");
    assert.equal(p.get("msgType"), "text");
    assert.equal(p.get("output"), "json");
    assert.equal(p.get("password"), null);
  });
  await check("request: user/password mode sends credentials as parameters and no apikey header", () => {
    const { headers, body } = buildRequest(pwCfg, "254712345678", "Hello");
    assert.equal(headers["apikey"], undefined);
    const p = new URLSearchParams(body);
    assert.equal(p.get(USER_ID_PARAM), "solvit_user");
    assert.equal(p.get("password"), "S3cretPass!");
  });
  await check("request: forbidden optional parameters are never sent", () => {
    const { body } = buildRequest(keyCfg, "254712345678", "Hello");
    for (const forbidden of ["duplicatecheck", "scheduleTime", "trackLink", "testMessage"]) {
      assert.ok(!body.includes(forbidden), forbidden);
    }
  });
  await check("response: success", () => {
    const r = parseResponse(200, JSON.stringify({ status: "success", transactionId: 987654, statusCode: "200", reason: "success", invalidMobile: "" }), keyCfg);
    assert.equal(r.ok, true);
    assert.equal(r.transactionId, "987654");
  });
  await check("response: success with an invalid mobile is a failure", () => {
    const r = parseResponse(200, JSON.stringify({ status: "success", invalidMobile: "2547123" }), keyCfg);
    assert.equal(r.ok, false);
  });
  await check("response: provider error reason is surfaced and scrubbed of secrets", () => {
    const r = parseResponse(200, JSON.stringify({ status: "error", reason: "Bad key SECRET-API-KEY-123 supplied" }), keyCfg);
    assert.equal(r.ok, false);
    assert.ok(!r.error!.includes("SECRET-API-KEY-123"));
    assert.ok(r.error!.includes("***"));
  });
  await check("response: HTTP error and unreadable body", () => {
    assert.equal(parseResponse(500, "oops", keyCfg).ok, false);
    const u = parseResponse(200, "<html>", keyCfg);
    assert.equal(u.ok, false);
    assert.equal(u.deliveryUnknown, true);
  });
  await check("send: success path posts to the documented URL", async () => {
    let seenUrl = "";
    const f = (async (url: string) => {
      seenUrl = url;
      return { status: 200, text: async () => JSON.stringify({ status: "success", transactionId: "T1" }) };
    }) as unknown as typeof fetch;
    const r = await sendSms(keyCfg, "0712345678", "Hello", f);
    assert.equal(seenUrl, HOST_PINNACLE_URL);
    assert.equal(r.ok, true);
  });
  await check("send: invalid number or empty message never reaches the network", async () => {
    let called = false;
    const f = (async () => { called = true; return { status: 200, text: async () => "{}" }; }) as unknown as typeof fetch;
    assert.equal((await sendSms(keyCfg, "123", "Hello", f)).ok, false);
    assert.equal((await sendSms(keyCfg, "0712345678", "   ", f)).ok, false);
    assert.equal(called, false);
  });
  await check("send: timeout is reported as delivery unknown", async () => {
    const f = (async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) as unknown as typeof fetch;
    const r = await sendSms(keyCfg, "0712345678", "Hello", f);
    assert.equal(r.ok, false);
    assert.equal(r.deliveryUnknown, true);
  });
  await check("send: network failure is a plain failure and leaks nothing", async () => {
    const f = (async () => { throw new Error("connect ECONNREFUSED SECRET-API-KEY-123"); }) as unknown as typeof fetch;
    const r = await sendSms(keyCfg, "0712345678", "Hello", f);
    assert.equal(r.ok, false);
    assert.equal(r.deliveryUnknown, false);
    assert.ok(!JSON.stringify(r).includes("SECRET-API-KEY-123"));
  });
  await check("rate limiter: allows max, blocks the next, recovers after the window", () => {
    let t = 1000;
    const rl = createRateLimiter({ windowMs: 600_000, max: 3, now: () => t });
    assert.ok(rl.check("a").allowed && rl.check("a").allowed && rl.check("a").allowed);
    const blocked = rl.check("a");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);
    assert.equal(rl.check("b").allowed, true, "keys are independent");
    t += 600_001;
    assert.equal(rl.check("a").allowed, true);
  });
  await check("template: renders known placeholders and leaves unknown ones", () => {
    assert.equal(renderSolverSms("Hi {solver_name} {vehicle_reg} {nope}", { solver_name: "Jo", vehicle_reg: "KAA 1A" }), "Hi Jo KAA 1A {nope}");
  });
  await check("date: Nairobi wall clock format", () => {
    assert.equal(formatNairobiDateTime("2026-10-14T07:30:00.000Z"), "Wed 14 Oct 2026, 10:30 AM");
    assert.equal(formatNairobiDateTime("2026-10-14T19:05:00.000Z"), "Wed 14 Oct 2026, 10:05 PM");
    assert.equal(formatNairobiDateTime(null), "");
    assert.equal(formatNairobiDateTime(new Date("2026-10-14T07:30:00.000Z")), "Wed 14 Oct 2026, 10:30 AM");
  });
  console.log("hostPinnacle tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
// FIXPASS END tests/hostPinnacle.test.ts

