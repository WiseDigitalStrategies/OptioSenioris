// Test helpers: an in-memory D1 stand-in built on node:sqlite with the real
// migration, a fixture roster of made-up caregivers, and a fake R2 bucket.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import baseConfig from "../config/assistant.config.js";

const MIGRATION = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

function statement(db, sql, args) {
  const clean = () => args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a));
  return {
    bind: (...next) => statement(db, sql, next),
    first: async () => db.prepare(sql).get(...clean()) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...clean()) }),
    run: async () => db.prepare(sql).run(...clean()),
  };
}

export function testDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  return {
    raw: db,
    prepare: (sql) => statement(db, sql, []),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

const ALL = ["am", "pm", "nights"];
const WEEKDAY_AM = { mon: ["am"], tue: ["am"], wed: ["am"], thu: ["am"], fri: ["am"] };

// Made-up people only. Never put real roster data in tests.
export const FIXTURE_ROSTER = [
  { first_name: "Avery", last_name: "Testperson", credential: "CNA", status: "hired", years_experience: 8, tags: ["dementia", "hoyer_lift"], availability: { ...WEEKDAY_AM, sat: [] } },
  { first_name: "Blake", last_name: "Sample", credential: "HHA", status: "hired", years_experience: 12, tags: ["companionship"], availability: { mon: ["am", "pm"], tue: ["am", "pm"], wed: ["am", "pm"], thu: ["am", "pm"], fri: ["am", "pm"] } },
  { first_name: "Casey", last_name: "Example", credential: "CNA", status: "prn", prn: 1, years_experience: 3, tags: ["dementia"], availability: { mon: ["am"], tue: ["am"], wed: ["am"] } },
  { first_name: "Drew", last_name: "Placeholder", credential: "LPN", status: "hired", years_experience: 15, tags: ["wound_care", "feeding_tube"], availability: { mon: ALL, tue: ALL, wed: ALL, thu: ["am", "pm"], fri: ["am", "pm"] } },
  { first_name: "Emery", last_name: "Inactive", credential: "RN", status: "inactive", years_experience: 20, tags: ["dementia"], availability: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, ALL])) },
  { first_name: "Finley", last_name: "Waitlist", credential: "CNA", status: "waitlist", years_experience: 2, tags: [], availability: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, ALL])) },
  { first_name: "Gray", last_name: "Nights", credential: "CNA", status: "hired", years_experience: 6, tags: [], availability: { fri: ["nights"], sat: ["nights"], sun: ["nights"] } },
];

export function rosterRows() {
  return FIXTURE_ROSTER.map((c, i) => ({ id: i + 1, prn: 0, background_check: 1, ...c }));
}

export async function seedRoster(db) {
  for (const c of FIXTURE_ROSTER) {
    await db
      .prepare("INSERT INTO roster (first_name, last_name, credential, status, years_experience, tags, availability, prn) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(c.first_name, c.last_name, c.credential, c.status, c.years_experience, JSON.stringify(c.tags), JSON.stringify(c.availability), c.prn ?? 0)
      .run();
  }
}

export function testConfig(overrides = {}) {
  return structuredClone({ ...baseConfig, ...overrides, email: { ...baseConfig.email, ...(overrides.email ?? {}) }, booking: { ...baseConfig.booking, ...(overrides.booking ?? {}) } });
}

export function fakeBucket() {
  const store = new Map();
  return {
    store,
    put: async (key, bytes, opts) => store.set(key, { bytes, opts }),
    get: async (key) => (store.has(key) ? { body: store.get(key).bytes, httpMetadata: store.get(key).opts?.httpMetadata } : null),
    delete: async (key) => store.delete(key),
  };
}

export const TEST_SECRET = "test-session-secret-0123456789abcdef";
