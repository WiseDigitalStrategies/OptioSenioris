import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { runTool, toolDefinitions } from "../lib/tools.js";
import { seedRoster, testConfig, testDb } from "./helpers.js";

let db, config, state, actions, ctx, sent;
const env = () => ({ DB: db, SITE_URL: "https://example.test", EMAIL_API_TOKEN: "tok", CF_ACCOUNT_ID: "acct" });

beforeEach(async () => {
  db = testDb();
  await seedRoster(db);
  config = testConfig({ email: { from: "assistant@example.test", notifyTo: ["jill@example.test"] } });
  state = { sid: "s-1", mode: "family", verified: true, turns: 1, messages: [] };
  actions = [];
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  ctx = { env: env(), db, config, state, actions };
});

const lead = (over = {}) => ({
  visitor_type: "family", contact_name: "Pat Daughter", phone: "941-555-0100", email: "pat@example.test", best_time_to_call: "mornings",
  consent_to_contact: true, relationship: "daughter", organization: "", organization_role: "", care_recipient: "mother",
  service: "private_duty_home_care", location: "Venice, FL 34285", daily_living_needs: ["bathing", "dressing"], special_needs: "dementia",
  schedule_days: ["mon", "tue", "wed", "thu", "fri"], schedule_times: ["am"], start_timing: "next week", hours: "4 hours a day",
  payment: "private_pay", urgency: "soon", summary: "Daughter wants weekday morning help for her mother with dementia.", status_hint: "normal", ...over,
});

const search = { service: "private_duty_home_care", min_credential: "CNA", skills: ["dementia"], days: ["mon", "tue", "wed", "thu", "fri"], times: ["am"], start_date: "", hours: "", preferred_caregiver: "", preferred_skills: [] };

test("tool definitions are strict, closed and fully required", () => {
  for (const t of toolDefinitions(config)) {
    assert.equal(t.strict, true, t.name);
    const check = (schema) => {
      if (schema.type !== "object") return;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(check);
    };
    check(t.input_schema);
  }
});

test("search returns up to 3 matches without personal fields and remembers them", async () => {
  const r = await runTool("search_caregivers", search, ctx);
  assert.equal(r.coverage, "full");
  assert.ok(r.matches.length >= 1 && r.matches.length <= 3);
  assert.ok(!JSON.stringify(r).match(/Testperson|Avery|phone|email|roster_id/));
  assert.equal(state.lastSearch.matches[0].full_name, "Avery Testperson");
});

test("search rejects values outside the schema", async () => {
  const r = await runTool("search_caregivers", { ...search, days: ["someday"] }, ctx);
  assert.match(r.error, /days contains an unknown value/);
  const r2 = await runTool("search_caregivers", { ...search, days: [] }, ctx);
  assert.match(r2.error, /days needs at least 1/);
});

test("saving a lead stores the matches, emails Jill once and returns a reference", async () => {
  await runTool("search_caregivers", search, ctx);
  const r = await runTool("save_family_lead", lead(), ctx);
  assert.equal(r.saved, true);
  assert.match(r.reference, /^OS-[2-9A-Z]{6}$/);
  const row = await db.prepare("SELECT * FROM leads").first();
  assert.equal(row.contact_name, "Pat Daughter");
  assert.equal(row.match_coverage, "full");
  assert.equal(JSON.parse(row.matches)[0].full_name, "Avery Testperson");
  assert.equal(row.consent, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["jill@example.test"]);
  assert.ok(!sent[0].body.text.includes("dementia"), "health detail stays out of the email");

  // A second save updates the same lead and does not email again.
  const again = await runTool("save_family_lead", lead({ best_time_to_call: "after 3pm" }), ctx);
  assert.equal(again.reference, r.reference);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 1);
  assert.equal(sent.length, 1);
});

test("a lead needs consent, contact details and a verified conversation", async () => {
  assert.match((await runTool("save_family_lead", lead({ consent_to_contact: false }), ctx)).error, /not agreed/);
  assert.match((await runTool("save_family_lead", lead({ phone: "", email: "" }), ctx)).error, /phone number or email/);
  state.verified = false;
  assert.match((await runTool("save_family_lead", lead(), ctx)).error, /bot check/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 0);
});

test("SSNs typed into free text are refused, never stored", async () => {
  const r = await runTool("save_family_lead", lead({ summary: "Her SSN is 123-45-6789" }), ctx);
  assert.match(r.error, /Social Security/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leads").first()).n, 0);
});

test("bereavement escalation marks the lead and is never duplicated", async () => {
  const e = await runTool("escalate_to_human", { reason: "bereavement", urgency: "routine", summary: "Father died last week; mother is on hospice." }, ctx);
  assert.equal(e.escalated, true);
  await runTool("escalate_to_human", { reason: "bereavement", urgency: "routine", summary: "again" }, ctx);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM escalations").first()).n, 1);
  await runTool("save_family_lead", lead({ status_hint: "normal" }), ctx);
  const row = await db.prepare("SELECT status, escalated, id FROM leads").first();
  assert.equal(row.status, "bereavement");
  assert.equal(row.escalated, 1);
  const esc = await db.prepare("SELECT lead_id FROM escalations").first();
  assert.equal(esc.lead_id, row.id, "earlier escalation is linked to the lead");
});

test("emergencies are always urgent", async () => {
  await runTool("escalate_to_human", { reason: "emergency", urgency: "routine", summary: "Visitor said mother is not breathing properly." }, ctx);
  assert.equal((await db.prepare("SELECT urgency FROM escalations").first()).urgency, "urgent");
  assert.match(sent[0].body.subject, /^URGENT/);
});

test("caregiver applicants are saved as new and the roster is unchanged", async () => {
  const before = (await db.prepare("SELECT * FROM roster ORDER BY id").all()).results;
  const r = await runTool(
    "save_caregiver_applicant",
    {
      name: "Jordan Nightshift", phone: "(941) 555-0199", email: "jordan@example.test", credential: "CNA", license_current: "yes",
      years_experience: 4, specialties: ["dementia"], availability: { mon: ["nights"], tue: ["nights"], wed: [], thu: [], fri: ["nights"], sat: ["nights"], sun: [] },
      prn: "yes", travel_area: "Venice and Nokomis", consent_to_contact: true, summary: "CNA wanting night shifts.",
    },
    { ...ctx, state: { ...state, mode: "caregiver" } },
  );
  assert.equal(r.saved, true);
  assert.match(r.reference, /^OSC-/);
  const a = await db.prepare("SELECT * FROM applicants").first();
  assert.equal(a.status, "new");
  assert.equal(a.prn, 1);
  assert.deepEqual(JSON.parse(a.availability).mon, ["nights"]);
  assert.deepEqual((await db.prepare("SELECT * FROM roster ORDER BY id").all()).results, before);
});

test("booking without a configured link says a team member will call", async () => {
  const r = await runTool("book_intro_call", { name: "Pat", email: "pat@example.test" }, ctx);
  assert.equal(r.available, false);
  assert.equal(actions.length, 0);
});

test("booking with a link adds a button, prefilled when supported", async () => {
  ctx.config = testConfig({ booking: { url: "https://calendly.com/example/intro", prefill: true } });
  const r = await runTool("book_intro_call", { name: "Pat D", email: "pat@example.test" }, ctx);
  assert.equal(r.available, true);
  assert.equal(actions[0].url, "https://calendly.com/example/intro?name=Pat+D&email=pat%40example.test");
});

test("unknown tools and malformed input return errors, not exceptions", async () => {
  assert.match((await runTool("delete_everything", {}, ctx)).error, /Unknown tool/);
  assert.match((await runTool("escalate_to_human", null, ctx)).error, /object/);
});

test("emails are skipped, not failed, when email is not configured", async () => {
  ctx.env = { DB: db };
  const r = await runTool("save_family_lead", lead(), ctx);
  assert.equal(r._email, "skipped");
  assert.equal(sent.length, 0);
});
