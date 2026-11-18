-- Adds 'apfm' (A Place for Mom referrals) as a lead source. SQLite can't change
-- a CHECK constraint, so the leads table is rebuilt. Links from escalations and
-- conversations are saved first and restored after, in case dropping the old
-- table clears them (ON DELETE SET NULL).

PRAGMA defer_foreign_keys = true;

CREATE TABLE _lead_links (kind TEXT NOT NULL, key TEXT NOT NULL, lead_id INTEGER NOT NULL);
INSERT INTO _lead_links SELECT 'escalation', CAST(id AS TEXT), lead_id FROM escalations WHERE lead_id IS NOT NULL;
INSERT INTO _lead_links SELECT 'conversation', session_id, lead_id FROM conversations WHERE lead_id IS NOT NULL;

CREATE TABLE leads_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  session_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('chat','contact_form','apfm')),
  visitor_type TEXT NOT NULL DEFAULT 'family' CHECK (visitor_type IN ('family','referral_partner')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','contacted','intro_call_booked','placed','closed',
    'bereavement','deceased_do_not_contact')),
  contact_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  best_time TEXT,
  consent INTEGER NOT NULL DEFAULT 0 CHECK (consent IN (0,1)),
  consent_at TEXT,
  relationship TEXT,
  organization TEXT,
  organization_role TEXT,
  care_recipient TEXT,
  service TEXT,
  location TEXT,
  in_service_area TEXT CHECK (in_service_area IN ('yes','no','unknown')),
  needs TEXT NOT NULL DEFAULT '[]',
  special_needs TEXT,
  schedule TEXT NOT NULL DEFAULT '{}',
  payment TEXT,
  urgency TEXT CHECK (urgency IN ('routine','soon','urgent')),
  summary TEXT,
  message TEXT,
  matches TEXT NOT NULL DEFAULT '[]',
  match_coverage TEXT CHECK (match_coverage IN ('full','partial','none')),
  escalated INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO leads_new SELECT * FROM leads;
DROP TABLE leads;
ALTER TABLE leads_new RENAME TO leads;
CREATE INDEX leads_created ON leads (created_at DESC);

UPDATE escalations SET lead_id = (SELECT lead_id FROM _lead_links WHERE kind = 'escalation' AND key = CAST(escalations.id AS TEXT))
  WHERE CAST(id AS TEXT) IN (SELECT key FROM _lead_links WHERE kind = 'escalation');
UPDATE conversations SET lead_id = (SELECT lead_id FROM _lead_links WHERE kind = 'conversation' AND key = conversations.session_id)
  WHERE session_id IN (SELECT key FROM _lead_links WHERE kind = 'conversation');
DROP TABLE _lead_links;
