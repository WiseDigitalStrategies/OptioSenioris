#!/usr/bin/env node
// Loads a reviewed roster CSV into D1. Adds new caregivers and updates
// existing ones (matched by first and last name). Never deletes anyone: set a
// caregiver to inactive instead.
//
//   node scripts/load-roster.mjs roster/roster-clean.csv --db staging      (writes roster/load.sql and loads it)
//   node scripts/load-roster.mjs roster/roster-clean.csv --db production
//   add --dry-run to only write roster/load.sql

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import config from "../config/assistant.config.js";
import { CREDENTIALS, DAYS, ROSTER_STATUSES, SLOTS } from "../lib/schedule.js";
import { parseCsv } from "./csv.mjs";

const DATABASES = { staging: ["optio-assistant-staging", "--env", "preview"], production: ["optio-assistant"] };

export function rowsToCaregivers(csvText) {
  const [header, ...rows] = parseCsv(csvText);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const col of ["first_name", "last_name", "credential", ...DAYS, "prn", "years_experience", "tags", "status", "background_check"]) {
    if (!(col in idx)) throw new Error(`missing column ${col}`);
  }
  const errors = [];
  const out = rows.map((r, n) => {
    const line = n + 2;
    const get = (c) => (r[idx[c]] ?? "").trim();
    const fail = (msg) => errors.push(`line ${line}: ${msg}`);
    const first = get("first_name");
    const last = get("last_name");
    if (!/^[\p{L} .'\-]{1,60}$/u.test(first)) fail("first_name is missing or has unexpected characters");
    if (last && !/^[\p{L} .'\-]{1,60}$/u.test(last)) fail("last_name has unexpected characters");
    const credential = get("credential");
    if (!CREDENTIALS.includes(credential)) fail(`credential must be one of ${CREDENTIALS.join(", ")}`);
    const status = get("status");
    if (!ROSTER_STATUSES.includes(status)) fail(`status must be one of ${ROSTER_STATUSES.join(", ")}`);
    const availability = {};
    for (const d of DAYS) {
      const v = get(d);
      if (v === "") continue;
      if (v === "none") availability[d] = [];
      else {
        const slots = v.split("|");
        if (!slots.every((s) => SLOTS.includes(s))) fail(`${d} must be am, pm, nights joined with |, "none", or blank`);
        availability[d] = slots;
      }
    }
    const tags = get("tags") ? get("tags").split("|") : [];
    for (const t of tags) if (!config.skillTags.includes(t)) fail(`unknown tag ${t}; add it to skillTags in the config first`);
    const yearsText = get("years_experience");
    const years = yearsText === "" ? null : Number(yearsText);
    if (years !== null && (!Number.isInteger(years) || years < 0 || years > 70)) fail("years_experience must be a whole number");
    const yn = (c) => {
      const v = get(c).toLowerCase();
      if (!["yes", "no", ""].includes(v)) fail(`${c} must be yes or no`);
      return v === "yes" ? 1 : 0;
    };
    return { first_name: first, last_name: last, credential, status, availability, tags, years_experience: years, prn: yn("prn"), background_check: yn("background_check"), service_zone: get("service_zone") || null };
  });
  if (errors.length) throw new Error(`The roster CSV has problems:\n${errors.join("\n")}`);
  return out;
}

const sql = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function toSql(caregivers) {
  return caregivers
    .map((c) => {
      const vals = [c.first_name, c.last_name, c.credential, JSON.stringify(c.availability), c.prn, JSON.stringify(c.tags), c.years_experience, c.status, c.background_check, c.service_zone].map(sql).join(", ");
      return `INSERT INTO roster (first_name, last_name, credential, availability, prn, tags, years_experience, status, background_check, service_zone) VALUES (${vals})
  ON CONFLICT(first_name, last_name) DO UPDATE SET credential = excluded.credential, availability = excluded.availability, prn = excluded.prn, tags = excluded.tags, years_experience = excluded.years_experience, status = excluded.status, background_check = excluded.background_check, service_zone = excluded.service_zone, updated_at = datetime('now');`;
    })
    .join("\n");
}

function main(argv) {
  const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--db");
  const db = argv[argv.indexOf("--db") + 1];
  if (!file || !DATABASES[db]) {
    console.error("Usage: node scripts/load-roster.mjs roster/roster-clean.csv --db staging|production [--dry-run]");
    process.exit(1);
  }
  const caregivers = rowsToCaregivers(readFileSync(file, "utf8"));
  mkdirSync("roster", { recursive: true });
  writeFileSync("roster/load.sql", toSql(caregivers) + "\n");
  console.log(`Prepared ${caregivers.length} caregivers in roster/load.sql.`);
  if (argv.includes("--dry-run")) return;
  const [name, ...extra] = DATABASES[db];
  execFileSync("npx", ["wrangler", "d1", "execute", name, ...(process.env.ROSTER_LOCAL ? ["--local"] : ["--remote"]), "--file", "roster/load.sql", ...extra], { stdio: "inherit" });
  console.log(`Loaded into ${db}${process.env.ROSTER_LOCAL ? " (local dev copy)" : ""}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
