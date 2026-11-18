#!/usr/bin/env node
// Loads the cleaned A Place for Mom leads CSV (from scripts/clean-apfm-leads.py)
// into the Enquiries list. Skips anyone already in the database with the same
// email or phone, so it is safe to run again with a newer export. Never deletes.
//
//   node scripts/load-leads.mjs leads/apfm-leads-clean.csv --db staging
//   node scripts/load-leads.mjs leads/apfm-leads-clean.csv --db production
//   add --dry-run to only write leads/load.sql
//
// The CSV holds families' contact details: keep it on your own computer.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { newRef } from "../lib/db.js";
import { parseCsv } from "./csv.mjs";

const DATABASES = { staging: ["optio-assistant-staging", "--env", "preview"], production: ["optio-assistant"] };
const REQUIRED = ["contact_name", "phone", "email", "care_recipient", "referral_date", "apfm_advisor", "other_email", "summary", "needs_review"];

const digits = (s) => s.replace(/\D/g, "");

export function rowsToLeads(csvText) {
  const [header, ...rows] = parseCsv(csvText).filter((r) => r.some((c) => c.trim()));
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const col of REQUIRED) if (!(col in idx)) throw new Error(`missing column ${col}`);
  const leads = [];
  const skipped = [];
  rows.forEach((r, n) => {
    const get = (c) => (r[idx[c]] ?? "").trim();
    const phone = get("phone");
    const email = get("email").toLowerCase();
    if (!phone && !email) return skipped.push(`line ${n + 2}: no phone or email`);
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return skipped.push(`line ${n + 2}: email doesn't look valid`);
    if (phone && digits(phone).length !== 10) return skipped.push(`line ${n + 2}: phone isn't 10 digits`);
    const date = get("referral_date");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return skipped.push(`line ${n + 2}: referral_date isn't YYYY-MM-DD`);
    const notes = [
      get("apfm_advisor") && `A Place for Mom advisor: ${get("apfm_advisor")}.`,
      get("other_email") && `Other email: ${get("other_email")}.`,
      get("needs_review") && `Check on import: ${get("needs_review")}.`,
    ].filter(Boolean);
    leads.push({
      ref: newRef("OS"),
      contact_name: (get("contact_name") || get("care_recipient") || "Name not given").slice(0, 100),
      phone: phone || null,
      email: email || null,
      care_recipient: get("care_recipient").slice(0, 200) || null,
      summary: get("summary").slice(0, 600) || null,
      notes: notes.join("\n") || null,
      created_at: date ? `${date} 12:00:00` : null,
    });
  });
  return { leads, skipped };
}

const sql = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

export function toSql(leads) {
  return leads
    .map((l) => {
      const dupe = [l.email && `email = ${sql(l.email)}`, l.phone && `phone = ${sql(l.phone)}`].filter(Boolean).join(" OR ");
      return `INSERT INTO leads (ref, source, visitor_type, status, contact_name, phone, email, consent, care_recipient, in_service_area, summary, notes, created_at)
  SELECT ${sql(l.ref)}, 'apfm', 'family', 'new', ${sql(l.contact_name)}, ${sql(l.phone)}, ${sql(l.email)}, 0, ${sql(l.care_recipient)}, 'unknown', ${sql(l.summary)}, ${sql(l.notes)}, ${l.created_at ? sql(l.created_at) : "datetime('now')"}
  WHERE NOT EXISTS (SELECT 1 FROM leads WHERE ${dupe});`;
    })
    .join("\n");
}

function main(argv) {
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--db");
  const db = argv[argv.indexOf("--db") + 1];
  if (!file || !DATABASES[db]) {
    console.error("Usage: node scripts/load-leads.mjs leads/apfm-leads-clean.csv --db staging|production [--dry-run]");
    process.exit(1);
  }
  const { leads, skipped } = rowsToLeads(readFileSync(file, "utf8"));
  mkdirSync("leads", { recursive: true });
  writeFileSync("leads/load.sql", toSql(leads) + "\n");
  console.log(`Prepared ${leads.length} leads in leads/load.sql.${skipped.length ? ` Skipped ${skipped.length}:\n  ${skipped.join("\n  ")}` : ""}`);
  if (argv.includes("--dry-run")) return;
  const [name, ...extra] = DATABASES[db];
  execFileSync("npx", ["wrangler", "d1", "execute", name, ...(process.env.LEADS_LOCAL ? ["--local"] : ["--remote"]), "--file", "leads/load.sql", ...extra], { stdio: "inherit" });
  console.log(`Loaded into ${db}${process.env.LEADS_LOCAL ? " (local dev copy)" : ""}. Leads already in the database (same email or phone) were left as they were.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
