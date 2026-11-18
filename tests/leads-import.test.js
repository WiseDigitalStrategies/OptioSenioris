import assert from "node:assert/strict";
import { test } from "node:test";
import { rowsToLeads, toSql } from "../scripts/load-leads.mjs";
import { MIGRATIONS, testDb } from "./helpers.js";

const CSV = `source,status,contact_name,phone,email,care_recipient,referral_date,budget,apfm_advisor,other_email,summary,from_file,needs_review
apfm,new,Pat Example,(941) 555-0100,pat@example.test,Mum Example,2025-07-06,$4000 - $4999 /month,Ann Advisor,,A Place for Mom referral on 2025-07-06.,a.xlsx,
apfm,new,Sam O'Test,(941) 555-0101,,Dad & Aunt,2024-01-02,,,,A Place for Mom referral on 2024-01-02.,a.xlsx,two residents listed
apfm,new,No Contact,,,Someone,,,,,x,a.xlsx,no phone or email
`;

test("the 0002 migration keeps existing leads and their links, and accepts apfm leads", () => {
  const db = testDb(1);
  db.raw.exec(`INSERT INTO leads (ref, source, contact_name) VALUES ('OS-AAAAAA','chat','Pat');
    INSERT INTO escalations (session_id, lead_id, reason) VALUES ('s1', 1, 'no_match');
    INSERT INTO conversations (session_id, mode, lead_id) VALUES ('s1', 'family', 1);`);
  db.raw.exec(MIGRATIONS[1].sql);
  assert.equal(db.raw.prepare("SELECT contact_name FROM leads WHERE id = 1").get().contact_name, "Pat");
  assert.equal(db.raw.prepare("SELECT lead_id FROM escalations").get().lead_id, 1);
  assert.equal(db.raw.prepare("SELECT lead_id FROM conversations").get().lead_id, 1);
  db.raw.exec("INSERT INTO leads (ref, source, contact_name) VALUES ('OS-BBBBBB','apfm','Lee')");
  assert.throws(() => db.raw.exec("INSERT INTO leads (ref, source, contact_name) VALUES ('OS-CCCCCC','spam','X')"));
  assert.deepEqual(db.raw.prepare("SELECT name FROM pragma_index_list('leads') WHERE name = 'leads_created'").all().length, 1);
});

test("APFM leads load as new, not-consented enquiries and are never duplicated", () => {
  const { leads, skipped } = rowsToLeads(CSV);
  assert.equal(leads.length, 2);
  assert.equal(skipped.length, 1);
  const db = testDb();
  db.raw.exec(toSql(leads));
  db.raw.exec(toSql(rowsToLeads(CSV).leads)); // a second run adds nothing
  const rows = db.raw.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "apfm");
  assert.equal(rows[0].status, "new");
  assert.equal(rows[0].consent, 0);
  assert.equal(rows[0].created_at, "2025-07-06 12:00:00");
  assert.match(rows[0].notes, /advisor: Ann Advisor/);
  assert.equal(rows[1].contact_name, "Sam O'Test");
  assert.match(rows[1].notes, /two residents listed/);
});
