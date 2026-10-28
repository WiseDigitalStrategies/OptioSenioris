import assert from "node:assert/strict";
import { test } from "node:test";
import { importTab, mergeTabs, OUTPUT_COLUMNS } from "../scripts/import-roster.mjs";
import { rowsToCaregivers, toSql } from "../scripts/load-roster.mjs";
import { parseCsv, toCsv } from "../scripts/csv.mjs";

// Made-up data shaped like Jill's tabs, including the columns that must go.
const HIRED = `Hired staff,,,,,,,,,,,,,,,
Name,SSN,DOB,Age,Level,Pay rate,Interview time,mon,tues,weds,thurs,fri,sat,sun,Why shortlisted,Private comments,Fingerprints
Avery Testperson,123-45-6789,01/02/1970,55,C.N.A,$18/hr,10:30am,am,am/pm,days,always,flexible,no,,"8 years, dementia unit, Hoyer trained","seemed nervous",yes
Blake Sample,987-65-4321,03/04/1980,45,Med Tech,$20,2pm,nights,nights,am/pm/nights,yes,,pm,no,"hospice and memory care, 3 yrs",,no
`;

const PRN = `First name,Last name,Credential,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Notes,Date of birth
Casey,Example,CAN,am,,,,,am,am,"companion care, 2 years",1990-01-01
Avery,Testperson,CNA,am,am,am,am,am,am,am,,
`;

test("sensitive columns are dropped and never written out", () => {
  const r = importTab(HIRED, "hired");
  const out = toCsv([OUTPUT_COLUMNS, ...r.rows.map((x) => OUTPUT_COLUMNS.map((c) => x[c]))]);
  for (const secret of ["123-45-6789", "987-65-4321", "01/02/1970", "1970", "55", "$18", "$20", "10:30am", "seemed nervous", "dementia unit"]) {
    assert.ok(!out.includes(secret), `output must not contain ${secret}`);
  }
  for (const col of ["SSN (sensitive)", "DOB (sensitive)", "Age (sensitive)", "Pay rate (sensitive)", "Interview time (sensitive)"]) assert.ok(r.dropped.includes(col), col);
  assert.ok(r.dropped.includes("Private comments"));
});

test("credentials, availability, tags and years normalize", () => {
  const [avery, blake] = importTab(HIRED, "hired").rows;
  assert.equal(avery.first_name, "Avery");
  assert.equal(avery.last_name, "Testperson");
  assert.equal(avery.credential, "CNA");
  assert.equal(avery.mon, "am");
  assert.equal(avery.tue, "am|pm");
  assert.equal(avery.wed, "am|pm");
  assert.equal(avery.thu, "am|pm|nights");
  assert.equal(avery.fri, "am|pm|nights");
  assert.equal(avery.sat, "none");
  assert.equal(avery.sun, "", "blank stays unknown");
  assert.equal(avery.years_experience, 8);
  assert.equal(avery.tags, "dementia|hoyer_lift");
  assert.equal(avery.status, "hired");
  assert.equal(avery.background_check, "yes");
  assert.match(avery.needs_review, /availability unknown/);
  assert.equal(blake.credential, "Med tech");
  assert.equal(blake.wed, "am|pm|nights");
  assert.equal(blake.thu, "am|pm|nights");
  assert.equal(blake.tags, "dementia|hospice");
  assert.equal(blake.background_check, "no");
});

test("PRN tab people are waitlisted until approved, and hired wins on duplicates", () => {
  const prn = importTab(PRN, "prn");
  assert.ok(prn.dropped.includes("Date of birth (sensitive)"));
  const casey = prn.rows.find((r) => r.first_name === "Casey");
  assert.equal(casey.credential, "CNA");
  assert.equal(casey.status, "waitlist");
  assert.equal(casey.prn, "yes");
  assert.equal(casey.tags, "companionship");
  const merged = mergeTabs([importTab(HIRED, "hired"), prn]);
  assert.equal(merged.filter((r) => r.first_name === "Avery").length, 1);
  assert.equal(merged.find((r) => r.first_name === "Avery").status, "hired");
});

test("the reviewed CSV loads into safe SQL and bad rows are refused", () => {
  const rows = mergeTabs([importTab(HIRED, "hired")]);
  const csv = toCsv([OUTPUT_COLUMNS, ...rows.map((x) => OUTPUT_COLUMNS.map((c) => x[c]))]);
  const caregivers = rowsToCaregivers(csv);
  const avery = caregivers.find((c) => c.first_name === "Avery");
  assert.deepEqual(avery.availability.sat, []);
  assert.equal(avery.availability.sun, undefined);
  const sql = toSql([{ ...avery, last_name: "O'Brien" }]);
  assert.match(sql, /'O''Brien'/);
  assert.match(sql, /ON CONFLICT\(first_name, last_name\) DO UPDATE/);
  const broken = csv.replace(",CNA,", ",Doctor,");
  assert.throws(() => rowsToCaregivers(broken), /credential must be one of/);
});

test("the CSV reader handles quotes, commas and newlines", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n"multi\nline",x,\n'), [["a", "b, c", 'd "e"'], ["multi\nline", "x", ""]]);
});
