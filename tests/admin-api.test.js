// Admin API behaviour with a valid Access token: a real RS256 token is
// signed here with a throwaway key, and the certs endpoint is faked.

import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { handleAdmin } from "../lib/admin.js";
import { runTool } from "../lib/tools.js";
import { fakeBucket, seedRoster, testConfig, testDb } from "./helpers.js";

const TEAM = "team.cloudflareaccess.com";
const AUD = "test-aud";
let keyPair, jwk, token, db, env, config;

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

before(async () => {
  keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "k1" };
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const payload = b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, email: "jill@example.test", exp: Math.floor(Date.now() / 1000) + 600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  token = `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
});

beforeEach(async () => {
  db = testDb();
  await seedRoster(db);
  config = testConfig();
  env = { DB: db, RESUMES: fakeBucket(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  globalThis.fetch = async (url) => (String(url).endsWith("/cdn-cgi/access/certs") ? new Response(JSON.stringify({ keys: [jwk] })) : new Response("{}"));
});

function req(method, path, body, extra = {}) {
  return new Request(`https://example.test/api/admin/${path}`, {
    method,
    headers: { "Cf-Access-Jwt-Assertion": token, Origin: "https://example.test", "X-Admin-Request": "1", "Content-Type": "application/json", ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const call = async (method, path, body, extra) => {
  const res = await handleAdmin({ request: req(method, path, body, extra), env, config, path: path.split("/") });
  return { status: res.status, data: res.headers.get("Content-Type")?.includes("json") ? await res.json() : null };
};

test("a signed-in admin can list leads with matches", async () => {
  const state = { sid: "s", mode: "family", verified: true, turns: 1 };
  const ctx = { env: { DB: db }, db, config, state, actions: [] };
  await runTool("search_caregivers", { service: "private_duty_home_care", min_credential: "CNA", skills: ["dementia"], days: ["mon"], times: ["am"], start_date: "", hours: "", preferred_caregiver: "", preferred_skills: [] }, ctx);
  await runTool("save_family_lead", { visitor_type: "family", contact_name: "Pat", phone: "941-555-0100", email: "", best_time_to_call: "", consent_to_contact: true, relationship: "", organization: "", organization_role: "", care_recipient: "", service: "private_duty_home_care", location: "", daily_living_needs: [], special_needs: "", schedule_days: ["mon"], schedule_times: ["am"], start_timing: "", hours: "", payment: "not_sure", urgency: "routine", summary: "", status_hint: "normal" }, ctx);
  const { status, data } = await call("GET", "leads");
  assert.equal(status, 200);
  assert.equal(data[0].contact_name, "Pat");
  assert.ok(data[0].matches[0].reasons.length > 0);
  assert.equal((await call("GET", "me")).data.email, "jill@example.test");
});

test("lead status can be set to the bereavement statuses, and leads can be deleted", async () => {
  await db.prepare("INSERT INTO leads (ref, source, contact_name, email) VALUES ('OS-TEST01','contact_form','Pat','p@example.test')").run();
  assert.equal((await call("PATCH", "leads/1", { status: "deceased_do_not_contact", notes: "Do not call" })).status, 200);
  const row = await db.prepare("SELECT status, notes FROM leads WHERE id = 1").first();
  assert.deepEqual({ ...row }, { status: "deceased_do_not_contact", notes: "Do not call" });
  assert.equal((await call("PATCH", "leads/1", { status: "sold" })).status, 400);
  assert.equal((await call("DELETE", "leads/1")).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 0);
});

test("roster can be added to and edited, with validation", async () => {
  const add = await call("POST", "roster", { first_name: "Harper", last_name: "New", credential: "RN", status: "hired", availability: { mon: ["am"] }, tags: ["hospice"] });
  assert.equal(add.status, 200);
  assert.equal((await call("PATCH", `roster/${add.data.id}`, { status: "inactive" })).status, 200);
  assert.equal((await db.prepare("SELECT status FROM roster WHERE id = ?1").bind(add.data.id).first()).status, "inactive");
  assert.equal((await call("POST", "roster", { first_name: "X", credential: "Doctor", status: "hired" })).status, 400);
  assert.equal((await call("PATCH", "roster/1", { tags: ["made_up_tag"] })).status, 400);
  assert.equal((await call("POST", "roster", { first_name: "Harper", last_name: "New", credential: "RN", status: "hired" })).status, 400);
});

test("changes from another site are refused", async () => {
  assert.equal((await call("PATCH", "leads/1", { status: "closed" }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await call("PATCH", "leads/1", { status: "closed" }, { "X-Admin-Request": "" })).status, 403);
});

test("deleting an applicant also deletes their resume", async () => {
  await env.RESUMES.put("resumes/a.pdf", new Uint8Array([1]), {});
  await db.prepare("INSERT INTO applicants (ref, source, name, resume_key, resume_name) VALUES ('OSC-TEST01','careers_form','Jordan','resumes/a.pdf','a.pdf')").run();
  const list = await call("GET", "applicants");
  assert.equal(list.data[0].has_resume, true);
  assert.equal(list.data[0].resume_key, undefined, "storage keys are not exposed");
  assert.equal((await call("DELETE", "applicants/1")).status, 200);
  assert.equal(env.RESUMES.store.size, 0);
});
