import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCaregivers, publicMatches } from "../lib/matching.js";
import { normalizeAvailability, normalizeCredential } from "../lib/schedule.js";
import { rosterRows } from "./helpers.js";

const weekdays = ["mon", "tue", "wed", "thu", "fri"];
const req = (over) => ({ service: "private_duty_home_care", min_credential: "CNA", skills: [], preferred_skills: [], days: weekdays, times: ["am"], preferred_caregiver: null, ...over });

test("weekday mornings with dementia ranks the dementia-experienced caregiver first", () => {
  const { coverage, matches } = matchCaregivers(rosterRows(), req({ skills: ["dementia"] }));
  assert.equal(coverage, "full");
  assert.ok(matches.length <= 3);
  assert.equal(matches[0].first_name, "Avery");
  assert.match(matches[0].reasons, /^CNA, available weekday mornings, dementia experience, 8 years' experience$/);
  // Blake covers the schedule but has no dementia tag: still listed, with an honest reason.
  const blake = matches.find((m) => m.first_name === "Blake");
  assert.match(blake.reasons, /no dementia experience listed/);
});

test("inactive and waitlisted caregivers are never matched", () => {
  const all = matchCaregivers(rosterRows(), req({ days: ["sat", "sun"], times: ["am", "pm", "nights"] }));
  assert.ok(!all.matches.some((m) => ["Emery", "Finley"].includes(m.first_name)));
});

test("skilled nursing needs LPN or above", () => {
  const { matches } = matchCaregivers(rosterRows(), req({ min_credential: "LPN" }));
  assert.deepEqual(matches.map((m) => m.credential), ["LPN"]);
});

test("overnight seven days a week with nobody covering returns no full match", () => {
  const { coverage, matches } = matchCaregivers(rosterRows(), req({ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], times: ["overnight"] }));
  assert.notEqual(coverage, "full");
  assert.ok(matches.every((m) => !m.full_coverage));
});

test("partial matches cover at least half and say how much", () => {
  const { coverage, matches } = matchCaregivers(rosterRows(), req({ days: ["mon", "tue", "wed", "thu"], times: ["nights"] }));
  assert.equal(coverage, "partial");
  assert.match(matches[0].reasons, /covers 3 of 4 requested shifts/);
});

test("nobody at all returns coverage none", () => {
  const { coverage, matches } = matchCaregivers(rosterRows(), req({ days: ["sat", "sun"], times: ["am"] }));
  assert.equal(coverage, "none");
  assert.equal(matches.length, 0);
});

test("a requested caregiver comes first when available (continuity)", () => {
  const { matches } = matchCaregivers(rosterRows(), req({ days: ["mon", "tue", "wed"], preferred_caregiver: "casey" }));
  assert.equal(matches[0].first_name, "Casey");
  assert.match(matches[0].reasons, /the caregiver you asked for/);
});

test("blank availability is unknown and never counts as available", () => {
  const rows = rosterRows().map((r) => (r.first_name === "Avery" ? { ...r, availability: { mon: ["am"] } } : r));
  const { matches } = matchCaregivers(rows, req({ days: ["tue"] }));
  assert.ok(!matches.some((m) => m.first_name === "Avery"));
});

test("public matches never expose ids, last names or contact details", () => {
  const { matches } = matchCaregivers(rosterRows(), req({ skills: ["dementia"] }));
  const hidden = publicMatches(matches, { showNames: false });
  const text = JSON.stringify(hidden);
  for (const forbidden of ["Testperson", "Avery", "roster_id", "phone", "email"]) assert.ok(!text.includes(forbidden), forbidden);
  const named = publicMatches(matches, { showNames: true });
  assert.equal(named[0].first_name, "Avery");
  assert.ok(!JSON.stringify(named).includes("Testperson"));
});

test("credential spellings normalize", () => {
  assert.equal(normalizeCredential("C.N.A"), "CNA");
  assert.equal(normalizeCredential("CAN"), "CNA");
  assert.equal(normalizeCredential("Med Tech"), "Med tech");
  assert.equal(normalizeCredential("rn"), "RN");
  assert.equal(normalizeCredential("CNA/HHA"), "CNA");
  assert.equal(normalizeCredential("LPN, CNA"), "LPN");
  assert.equal(normalizeCredential("dog walker"), null);
});

test("availability values normalize to am/pm/nights", () => {
  assert.deepEqual(normalizeAvailability("days"), ["am", "pm"]);
  assert.deepEqual(normalizeAvailability("am"), ["am"]);
  assert.deepEqual(normalizeAvailability("PM"), ["pm"]);
  assert.deepEqual(normalizeAvailability("nights"), ["nights"]);
  assert.deepEqual(normalizeAvailability("am/pm"), ["am", "pm"]);
  assert.deepEqual(normalizeAvailability("am/pm/nights"), ["am", "pm", "nights"]);
  assert.deepEqual(normalizeAvailability("always"), ["am", "pm", "nights"]);
  assert.deepEqual(normalizeAvailability("Flexible"), ["am", "pm", "nights"]);
  assert.deepEqual(normalizeAvailability("yes"), ["am", "pm", "nights"]);
  assert.deepEqual(normalizeAvailability("no"), []);
  assert.equal(normalizeAvailability(""), null);
  assert.equal(normalizeAvailability(undefined), null);
});
