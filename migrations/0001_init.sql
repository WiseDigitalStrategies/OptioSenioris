-- Care assistant storage. No SSNs, dates of birth, ages, pay, interview times
-- or private comments are stored anywhere in this schema.

-- Caregiver roster, loaded from the reviewed CSV and edited in /admin.
-- Only status 'hired' or 'prn' (an approved PRN caregiver) is matched.
CREATE TABLE roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  credential TEXT NOT NULL CHECK (credential IN ('HHA','CNA','Med tech','LPN','RN','ARNP')),
  -- JSON object: {"mon":["am","pm"],"tue":[],...}. A missing day is unknown.
  availability TEXT NOT NULL DEFAULT '{}',
  prn INTEGER NOT NULL DEFAULT 0 CHECK (prn IN (0,1)),
  tags TEXT NOT NULL DEFAULT '[]',
  years_experience INTEGER CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70),
  status TEXT NOT NULL DEFAULT 'to_interview'
    CHECK (status IN ('to_interview','waitlist','prn','hired','inactive')),
  background_check INTEGER NOT NULL DEFAULT 0 CHECK (background_check IN (0,1)),
  -- PLACEHOLDER: service zone, unused for ranking until zones are defined.
  service_zone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (first_name, last_name)
);

-- Families and referral partners, from the chat or the contact forms.
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  session_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('chat','contact_form')),
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
CREATE INDEX leads_created ON leads (created_at DESC);

-- Caregiver applicants. Never written into the roster automatically.
CREATE TABLE applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  session_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('chat','careers_form')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','reviewing','interview','hired','declined','withdrawn')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT,
  credential TEXT,
  license_current INTEGER,
  years_experience INTEGER,
  specialties TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT '{}',
  prn INTEGER,
  travel_area TEXT,
  summary TEXT,
  message TEXT,
  resume_key TEXT,
  resume_name TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX applicants_created ON applicants (created_at DESC);

-- Conversations flagged for Jill (emergencies, bereavement, routing, etc).
CREATE TABLE escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine','soon','urgent')),
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One short structured summary per conversation, never the transcript.
CREATE TABLE conversations (
  session_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  user_turns INTEGER NOT NULL DEFAULT 0,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  applicant_id INTEGER REFERENCES applicants(id) ON DELETE SET NULL,
  escalated INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fixed-window counters for rate limiting.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
