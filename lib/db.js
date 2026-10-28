// D1 access. All queries are parameterized.

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newRef(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function parseRosterRow(r) {
  return { ...r, availability: parseJson(r.availability, {}), tags: parseJson(r.tags, []), prn: Boolean(r.prn), background_check: Boolean(r.background_check) };
}

export async function activeRoster(db) {
  const { results } = await db.prepare("SELECT * FROM roster WHERE status IN ('hired','prn') ORDER BY id").all();
  return results.map(parseRosterRow);
}

const LEAD_FIELDS = [
  "visitor_type", "status", "contact_name", "phone", "email", "best_time", "consent", "consent_at",
  "relationship", "organization", "organization_role", "care_recipient", "service", "location",
  "in_service_area", "needs", "special_needs", "schedule", "payment", "urgency", "summary", "message",
  "matches", "match_coverage", "escalated",
];

export async function insertLead(db, lead) {
  const cols = ["ref", "session_id", "source", ...LEAD_FIELDS.filter((f) => lead[f] !== undefined)];
  const row = await db
    .prepare(`INSERT INTO leads (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")}) RETURNING id`)
    .bind(...cols.map((c) => lead[c] ?? null))
    .first();
  return row.id;
}

export async function updateLead(db, id, fields) {
  const cols = LEAD_FIELDS.filter((f) => fields[f] !== undefined);
  if (!cols.length) return;
  await db
    .prepare(`UPDATE leads SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")}, updated_at = datetime('now') WHERE id = ?${cols.length + 1}`)
    .bind(...cols.map((c) => fields[c] ?? null), id)
    .run();
}

export async function getLead(db, id) {
  return db.prepare("SELECT * FROM leads WHERE id = ?1").bind(id).first();
}

const APPLICANT_FIELDS = [
  "status", "name", "phone", "email", "role", "credential", "license_current", "years_experience",
  "specialties", "availability", "prn", "travel_area", "summary", "message", "resume_key", "resume_name", "consent",
];

export async function insertApplicant(db, a) {
  const cols = ["ref", "session_id", "source", ...APPLICANT_FIELDS.filter((f) => a[f] !== undefined)];
  const row = await db
    .prepare(`INSERT INTO applicants (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")}) RETURNING id`)
    .bind(...cols.map((c) => a[c] ?? null))
    .first();
  return row.id;
}

export async function updateApplicant(db, id, fields) {
  const cols = APPLICANT_FIELDS.filter((f) => fields[f] !== undefined);
  if (!cols.length) return;
  await db
    .prepare(`UPDATE applicants SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")}, updated_at = datetime('now') WHERE id = ?${cols.length + 1}`)
    .bind(...cols.map((c) => fields[c] ?? null), id)
    .run();
}

export async function insertEscalation(db, e) {
  const row = await db
    .prepare("INSERT INTO escalations (session_id, lead_id, reason, urgency, summary) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id")
    .bind(e.session_id, e.lead_id ?? null, e.reason, e.urgency, e.summary ?? null)
    .first();
  return row.id;
}

export async function linkEscalationsToLead(db, sessionId, leadId) {
  await db.prepare("UPDATE escalations SET lead_id = ?1 WHERE session_id = ?2 AND lead_id IS NULL").bind(leadId, sessionId).run();
}

export async function upsertConversation(db, c) {
  await db
    .prepare(
      `INSERT INTO conversations (session_id, mode, user_turns, lead_id, applicant_id, escalated, summary)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(session_id) DO UPDATE SET
         user_turns = excluded.user_turns,
         lead_id = COALESCE(excluded.lead_id, lead_id),
         applicant_id = COALESCE(excluded.applicant_id, applicant_id),
         escalated = MAX(escalated, excluded.escalated),
         summary = COALESCE(excluded.summary, summary),
         updated_at = datetime('now')`,
    )
    .bind(c.session_id, c.mode, c.user_turns, c.lead_id ?? null, c.applicant_id ?? null, c.escalated ? 1 : 0, c.summary ?? null)
    .run();
}
