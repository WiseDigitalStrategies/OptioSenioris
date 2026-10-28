#!/usr/bin/env node
// Turns Jill's staff spreadsheet into a clean roster CSV for review.
//
// Export each spreadsheet tab as CSV (File > Save As > CSV), then run:
//   node scripts/import-roster.mjs --hired Hired.csv --prn PRN.csv --to-interview "to interview.csv" --out roster/roster-clean.csv
//
// Only allowlisted columns are read. Social Security numbers, dates of
// birth, ages, pay, interview times and comments are never written out:
// notes columns are read only to pick tags from the reviewed tag list, and
// their text is discarded. Run this on your own machine; never paste the raw
// spreadsheet into an AI chat.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import config from "../config/assistant.config.js";
import { DAYS, normalizeAvailability, normalizeCredential } from "../lib/schedule.js";
import { parseCsv, toCsv } from "./csv.mjs";

export const OUTPUT_COLUMNS = [
  "first_name", "last_name", "credential", ...DAYS, "prn", "years_experience", "tags",
  "status", "background_check", "service_zone", "needs_review",
];

const TAB_STATUS = { hired: "hired", prn: "waitlist", to_interview: "to_interview" };
const STATUS_PRIORITY = { hired: 3, waitlist: 2, to_interview: 1 };

const DAY_HEADERS = {
  mon: ["mon", "monday"],
  tue: ["tue", "tues", "tuesday"],
  wed: ["wed", "weds", "wednesday"],
  thu: ["thu", "thur", "thurs", "thursday"],
  fri: ["fri", "friday"],
  sat: ["sat", "saturday"],
  sun: ["sun", "sunday"],
};

// Header text that is dropped and named in the report so the reviewer knows.
const SENSITIVE_HEADER = /ssn|social|security|dob|birth|^age$|pay|rate|salary|wage|interview|time|date/;

const TAG_PATTERNS = {
  dementia: /dementia|alzheimer|memory/,
  hospice: /hospice|end of life|palliative/,
  hoyer_lift: /hoyer|mechanical lift|lift trained/,
  private_duty: /private[\s-]?duty|in[\s-]home|home care/,
  rehab: /rehab/,
  behavioral_health: /behavio|psych|mental health/,
  two_person_assist: /two[\s-]person|2[\s-]person/,
  diabetes: /diabet|insulin/,
  wound_care: /wound/,
  feeding_tube: /\bpeg\b|feeding tube|g[\s-]?tube|tube feed/,
  catheter_care: /catheter|foley/,
  oxygen: /oxygen|nebuli|trach/,
  companionship: /companion/,
};

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");

function classify(header) {
  const h = norm(header);
  if (!h) return null;
  if (/^first(name)?$|^firstname$|^forename$/.test(h)) return { kind: "first" };
  if (/^(last|sur)(name)?$|^surname$/.test(h)) return { kind: "last" };
  if (/^(full)?name$|^employee$|^candidate$|^caregiver$/.test(h)) return { kind: "name" };
  if (/^(level|credential|credentials|position|role|title|cert|certification|license|licence|type|qualification)$/.test(h)) return { kind: "credential" };
  for (const [day, names] of Object.entries(DAY_HEADERS)) if (names.includes(h)) return { kind: "day", day };
  if (/^prn$|^oncall$/.test(h)) return { kind: "prn" };
  if (/^(years|yrs|yearsexperience|yearsofexperience|experienceyears|yearsexp)$/.test(h)) return { kind: "years" };
  if (/background|fingerprint|bgcheck|level2/.test(h)) return { kind: "background" };
  if (/whyshortlisted|^notes?$|^comments?$|experience|specialt|skills/.test(h)) return { kind: "notes" };
  return null;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const kinds = rows[i].map((h) => classify(h)?.kind);
    if (kinds.some((k) => k === "name" || k === "first")) return i;
  }
  throw new Error("could not find a header row with a name column in the first 10 rows");
}

function yesNo(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(no|n|none|pending|not yet|-)$/.test(s)) return false;
  return true;
}

function tagsFrom(text) {
  const t = text.toLowerCase();
  return config.skillTags.filter((tag) => TAG_PATTERNS[tag]?.test(t));
}

function yearsFrom(text) {
  let best = null;
  for (const m of text.toLowerCase().matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g)) {
    const n = Number(m[1]);
    if (n <= 60 && (best === null || n > best)) best = n;
  }
  return best;
}

// Returns { rows: [...clean objects], dropped: [header names] } for one tab.
export function importTab(csvText, tab) {
  const status = TAB_STATUS[tab];
  if (!status) throw new Error(`unknown tab ${tab}`);
  const rows = parseCsv(csvText);
  if (!rows.length) return { rows: [], dropped: [] };
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex];
  const columns = headers.map(classify);
  const dropped = headers.filter((h, i) => h.trim() && !columns[i]).map((h) => (SENSITIVE_HEADER.test(norm(h)) ? `${h.trim()} (sensitive)` : h.trim()));

  const out = [];
  for (const raw of rows.slice(headerIndex + 1)) {
    const rec = { first_name: "", last_name: "", credential: "", prn: tab === "prn", years: null, background: null, notes: "", days: {}, review: [] };
    let credentialRaw = "";
    raw.forEach((value, i) => {
      const col = columns[i];
      if (!col) return;
      const v = String(value ?? "").trim();
      if (col.kind === "first") rec.first_name = v;
      else if (col.kind === "last") rec.last_name = v;
      else if (col.kind === "name" && v) {
        const parts = v.split(/\s+/);
        rec.first_name ||= parts[0];
        rec.last_name ||= parts.slice(1).join(" ");
      } else if (col.kind === "credential") credentialRaw = v;
      else if (col.kind === "day") rec.days[col.day] = normalizeAvailability(v);
      else if (col.kind === "prn") rec.prn = rec.prn || yesNo(v) === true;
      else if (col.kind === "years") rec.years = yearsFrom(`${v} years`) ?? rec.years;
      else if (col.kind === "background") rec.background = yesNo(v);
      else if (col.kind === "notes") rec.notes += ` ${v}`;
    });
    if (!rec.first_name) continue;
    rec.first_name = rec.first_name.replace(/[^\p{L} .'\-]/gu, "").trim();
    rec.last_name = rec.last_name.replace(/[^\p{L} .'\-]/gu, "").trim();
    rec.credential = normalizeCredential(credentialRaw) ?? "";
    if (!rec.credential) rec.review.push(credentialRaw ? "credential not recognized" : "no credential");
    if (DAYS.some((d) => rec.days[d] === null || rec.days[d] === undefined)) rec.review.push("availability unknown for some days");
    const years = rec.years ?? yearsFrom(rec.notes);
    out.push({
      first_name: rec.first_name,
      last_name: rec.last_name,
      credential: rec.credential,
      ...Object.fromEntries(DAYS.map((d) => [d, rec.days[d] === null || rec.days[d] === undefined ? "" : rec.days[d].length ? rec.days[d].join("|") : "none"])),
      prn: rec.prn ? "yes" : "no",
      years_experience: years ?? "",
      tags: tagsFrom(rec.notes).join("|"),
      status,
      background_check: rec.background ? "yes" : "no",
      service_zone: "",
      needs_review: rec.review.join("; "),
    });
  }
  return { rows: out, dropped };
}

export function mergeTabs(results) {
  const byName = new Map();
  for (const r of results.flatMap((x) => x.rows)) {
    const key = `${r.first_name} ${r.last_name}`.toLowerCase();
    const prev = byName.get(key);
    if (!prev || STATUS_PRIORITY[r.status] > STATUS_PRIORITY[prev.status]) byName.set(key, r);
  }
  return [...byName.values()].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  const tabs = { hired: args.hired, prn: args.prn, to_interview: args["to-interview"] };
  if (!Object.values(tabs).some(Boolean) || !args.out) {
    console.error('Usage: node scripts/import-roster.mjs [--hired Hired.csv] [--prn PRN.csv] [--to-interview "to interview.csv"] --out roster/roster-clean.csv');
    process.exit(1);
  }
  const results = [];
  for (const [tab, file] of Object.entries(tabs)) {
    if (!file) continue;
    const r = importTab(readFileSync(file, "utf8"), tab);
    console.log(`${tab}: ${r.rows.length} people. Columns dropped: ${r.dropped.length ? r.dropped.join(", ") : "none"}`);
    results.push(r);
  }
  const rows = mergeTabs(results);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, toCsv([OUTPUT_COLUMNS, ...rows.map((r) => OUTPUT_COLUMNS.map((c) => r[c]))]));
  const review = rows.filter((r) => r.needs_review).length;
  console.log(`Wrote ${rows.length} caregivers to ${args.out}. ${review} need review (see the needs_review column).`);
  console.log("PRN-tab caregivers are marked 'waitlist'. Change status to 'prn' for each one Jill approves, and to 'inactive' for anyone who should not be matched.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
