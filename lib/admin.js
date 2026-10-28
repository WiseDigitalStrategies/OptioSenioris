// Admin API behind Cloudflare Access: leads, applicants, escalations and the
// caregiver roster. Routes (all under /api/admin/):
//   GET    leads | applicants | escalations | roster
//   PATCH  leads/:id {status, notes} | applicants/:id {status} | escalations/:id {status}
//   DELETE leads/:id | applicants/:id
//   POST   roster {caregiver}       PATCH roster/:id {fields}
//   GET    applicants/:id/resume

import { accessUser } from "./access.js";
import { json } from "./chat.js";
import { parseRosterRow } from "./db.js";
import { CREDENTIALS, DAYS, ROSTER_STATUSES, SLOTS } from "./schedule.js";
import { ValidationError, int, listOf, oneOf, text } from "./validate.js";

export const LEAD_STATUSES = ["new", "contacted", "intro_call_booked", "placed", "closed", "bereavement", "deceased_do_not_contact"];
const APPLICANT_STATUSES = ["new", "reviewing", "interview", "hired", "declined", "withdrawn"];

function parseJsonFields(row, fields) {
  const out = { ...row };
  for (const f of fields) {
    try {
      out[f] = row[f] ? JSON.parse(row[f]) : null;
    } catch {
      out[f] = null;
    }
  }
  return out;
}

function rosterInput(body, config, { partial }) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has("first_name")) out.first_name = text(body.first_name, "first_name", { max: 60, required: true });
  if (!partial || has("last_name")) out.last_name = text(body.last_name, "last_name", { max: 60 }) ?? "";
  if (!partial || has("credential")) out.credential = oneOf(body.credential, "credential", CREDENTIALS, { required: true });
  if (!partial || has("status")) out.status = oneOf(body.status, "status", ROSTER_STATUSES, { required: true });
  if (has("availability")) {
    if (typeof body.availability !== "object" || body.availability === null) throw new ValidationError("availability must be an object");
    const a = {};
    for (const d of DAYS) if (body.availability[d] !== undefined && body.availability[d] !== null) a[d] = listOf(body.availability[d], d, SLOTS, { max: 3 });
    out.availability = JSON.stringify(a);
  }
  if (has("tags")) out.tags = JSON.stringify(listOf(body.tags, "tags", config.skillTags));
  if (has("years_experience")) out.years_experience = int(body.years_experience, "years_experience", { min: 0, max: 70 });
  if (has("prn")) out.prn = body.prn ? 1 : 0;
  if (has("background_check")) out.background_check = body.background_check ? 1 : 0;
  if (has("service_zone")) out.service_zone = text(body.service_zone, "service_zone", { max: 60 });
  return out;
}

export async function handleAdmin({ request, env, config, path }) {
  const user = await accessUser(request, env);
  if (!user) return json({ error: "forbidden", message: "Sign in through Cloudflare Access to use the admin page." }, 403);

  const method = request.method;
  // Cross-site request protection for changes: same origin and a custom header.
  if (method !== "GET") {
    const origin = request.headers.get("Origin");
    if (origin !== new URL(request.url).origin || request.headers.get("X-Admin-Request") !== "1") return json({ error: "forbidden" }, 403);
  }

  const db = env.DB;
  const [resource, rawId, sub] = path;
  const id = rawId === undefined ? null : Number(rawId);
  if (rawId !== undefined && !Number.isInteger(id)) return json({ error: "not_found" }, 404);
  const body = ["POST", "PATCH"].includes(method) ? await request.json().catch(() => ({})) : null;

  try {
    if (resource === "me" && method === "GET") return json({ email: user });

    if (resource === "leads") {
      if (method === "GET" && id === null) {
        const { results } = await db.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 500").all();
        return json(results.map((r) => parseJsonFields(r, ["needs", "schedule", "matches"])));
      }
      if (method === "PATCH" && id !== null) {
        const status = oneOf(body.status, "status", LEAD_STATUSES);
        const notes = body.notes === undefined ? undefined : text(body.notes, "notes", { max: 4000 });
        await db
          .prepare("UPDATE leads SET status = COALESCE(?1, status), notes = CASE WHEN ?2 THEN ?3 ELSE notes END, updated_at = datetime('now') WHERE id = ?4")
          .bind(status, notes !== undefined ? 1 : 0, notes ?? null, id)
          .run();
        return json({ ok: true });
      }
      if (method === "DELETE" && id !== null) {
        await db.batch([
          db.prepare("UPDATE conversations SET lead_id = NULL, summary = NULL WHERE lead_id = ?1").bind(id),
          db.prepare("DELETE FROM escalations WHERE lead_id = ?1").bind(id),
          db.prepare("DELETE FROM leads WHERE id = ?1").bind(id),
        ]);
        return json({ ok: true });
      }
    }

    if (resource === "applicants") {
      if (method === "GET" && id === null) {
        const { results } = await db.prepare("SELECT * FROM applicants ORDER BY created_at DESC LIMIT 500").all();
        return json(results.map((r) => ({ ...parseJsonFields(r, ["specialties", "availability"]), has_resume: Boolean(r.resume_key), resume_key: undefined })));
      }
      if (method === "GET" && id !== null && sub === "resume") {
        const row = await db.prepare("SELECT resume_key, resume_name FROM applicants WHERE id = ?1").bind(id).first();
        if (!row?.resume_key) return json({ error: "not_found" }, 404);
        const obj = await env.RESUMES.get(row.resume_key);
        if (!obj) return json({ error: "not_found" }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${(row.resume_name || "resume").replace(/"/g, "")}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "PATCH" && id !== null) {
        const status = oneOf(body.status, "status", APPLICANT_STATUSES, { required: true });
        await db.prepare("UPDATE applicants SET status = ?1, updated_at = datetime('now') WHERE id = ?2").bind(status, id).run();
        return json({ ok: true });
      }
      if (method === "DELETE" && id !== null) {
        const row = await db.prepare("SELECT resume_key FROM applicants WHERE id = ?1").bind(id).first();
        if (row?.resume_key) await env.RESUMES.delete(row.resume_key);
        await db.batch([
          db.prepare("UPDATE conversations SET applicant_id = NULL, summary = NULL WHERE applicant_id = ?1").bind(id),
          db.prepare("DELETE FROM applicants WHERE id = ?1").bind(id),
        ]);
        return json({ ok: true });
      }
    }

    if (resource === "escalations") {
      if (method === "GET" && id === null) {
        const { results } = await db
          .prepare("SELECT e.*, l.ref AS lead_ref, l.contact_name FROM escalations e LEFT JOIN leads l ON l.id = e.lead_id ORDER BY e.created_at DESC LIMIT 500")
          .all();
        return json(results);
      }
      if (method === "PATCH" && id !== null) {
        const status = oneOf(body.status, "status", ["open", "handled"], { required: true });
        await db.prepare("UPDATE escalations SET status = ?1 WHERE id = ?2").bind(status, id).run();
        return json({ ok: true });
      }
    }

    if (resource === "roster") {
      if (method === "GET" && id === null) {
        const { results } = await db.prepare("SELECT * FROM roster ORDER BY status = 'inactive', last_name, first_name").all();
        return json({ caregivers: results.map(parseRosterRow), tags: config.skillTags, credentials: CREDENTIALS, statuses: ROSTER_STATUSES });
      }
      if (method === "POST" && id === null) {
        const c = rosterInput(body, config, { partial: false });
        const cols = Object.keys(c);
        const row = await db
          .prepare(`INSERT INTO roster (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")}) RETURNING id`)
          .bind(...cols.map((k) => c[k]))
          .first();
        return json({ ok: true, id: row.id });
      }
      if (method === "PATCH" && id !== null) {
        const c = rosterInput(body, config, { partial: true });
        const cols = Object.keys(c);
        if (!cols.length) return json({ ok: true });
        await db
          .prepare(`UPDATE roster SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(", ")}, updated_at = datetime('now') WHERE id = ?${cols.length + 1}`)
          .bind(...cols.map((k) => c[k]), id)
          .run();
        return json({ ok: true });
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: "invalid", message: err.message }, 400);
    if (String(err?.message).includes("UNIQUE")) return json({ error: "invalid", message: "A caregiver with that name is already on the roster." }, 400);
    throw err;
  }
  return json({ error: "not_found" }, 404);
}
