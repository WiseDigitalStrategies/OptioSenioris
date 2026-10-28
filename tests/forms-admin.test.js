import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { handleAdmin } from "../lib/admin.js";
import { handleCareersForm, handleContactForm } from "../lib/forms.js";
import { fakeBucket, seedRoster, testConfig, testDb } from "./helpers.js";

let db, env, config;
beforeEach(async () => {
  db = testDb();
  await seedRoster(db);
  config = testConfig();
  env = { DB: db, RESUMES: fakeBucket() };
  globalThis.fetch = async () => new Response("{}");
});

function form(path, fields, ip = "203.0.113.20") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`https://example.test${path}`, { method: "POST", body, headers: { "CF-Connecting-IP": ip, Referer: "https://example.test/contact" } });
}

const contact = { name: "Pat Daughter", phone: "941-555-0100", email: "pat@example.test", message: "Mum needs help at home.", consent: "yes" };

test("the contact form saves a lead and redirects to the thank-you page", async () => {
  const res = await handleContactForm({ request: form("/api/forms/contact", contact), env, config });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/thanks");
  const lead = await db.prepare("SELECT * FROM leads").first();
  assert.equal(lead.source, "contact_form");
  assert.equal(lead.message, "Mum needs help at home.");
  assert.equal(lead.consent, 1);
});

test("the contact form needs consent and escapes what it echoes back", async () => {
  const res = await handleContactForm({ request: form("/api/forms/contact", { ...contact, consent: "" }), env, config });
  assert.equal(res.status, 400);
  const bad = await handleContactForm({ request: form("/api/forms/contact", { ...contact, email: "<script>" }), env, config });
  assert.ok(!(await bad.text()).includes("<script>"));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 0);
});

test("the honeypot silently drops bots", async () => {
  const res = await handleContactForm({ request: form("/api/forms/contact", { ...contact, website: "spam.example" }), env, config });
  assert.equal(res.status, 303);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 0);
});

test("forms are rate limited per IP", async () => {
  const statuses = [];
  for (let i = 0; i < config.limits.formsPerIpPerHour + 2; i++) statuses.push((await handleContactForm({ request: form("/api/forms/contact", contact, "198.51.100.30"), env, config })).status);
  assert.ok(statuses.includes(400));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, config.limits.formsPerIpPerHour);
});

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "My Resume.pdf", { type: "application/pdf" });
const careers = () => ({ name: "Jordan Nightshift", phone: "941-555-0199", email: "jordan@example.test", role: "Certified Nursing Assistant / Caregiver", message: "Nights please", consent: "yes", resume: pdf() });

test("the careers form stores the resume privately and creates an applicant", async () => {
  const res = await handleCareersForm({ request: form("/api/forms/careers", careers()), env, config });
  assert.equal(res.status, 303);
  const a = await db.prepare("SELECT * FROM applicants").first();
  assert.equal(a.status, "new");
  assert.match(a.resume_key, /^resumes\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(a.resume_name, "My Resume.pdf");
  assert.ok(env.RESUMES.store.has(a.resume_key));
});

test("the careers form refuses files that are not really PDF or Word", async () => {
  const fake = new File([new TextEncoder().encode("<html>")], "resume.pdf");
  const res = await handleCareersForm({ request: form("/api/forms/careers", { ...careers(), resume: fake }), env, config });
  assert.equal(res.status, 400);
  assert.equal(env.RESUMES.store.size, 0);
});

test("the admin API refuses requests without a Cloudflare Access login", async () => {
  const res = await handleAdmin({ request: new Request("https://example.test/api/admin/leads"), env, config, path: ["leads"] });
  assert.equal(res.status, 403);
  env.ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
  env.ACCESS_AUD = "aud";
  const forged = new Request("https://example.test/api/admin/leads", { headers: { "Cf-Access-Jwt-Assertion": "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFAYi5jIn0.x" } });
  assert.equal((await handleAdmin({ request: forged, env, config, path: ["leads"] })).status, 403);
});
