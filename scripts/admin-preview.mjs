#!/usr/bin/env node
// Serves the admin dashboard with made-up data so its design can be checked
// without Cloudflare Access or a database. Nothing here touches real data.
//
//   node scripts/admin-preview.mjs   then open http://localhost:8790/admin/

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString().replace("T", " ").slice(0, 19);
const week = (slots) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d, i) => [d, slots[i] ?? []]));

const db = {
  leads: [
    { id: 1, ref: "OS-K7P2QM", source: "chat", contact_name: "Pat Lee", phone: "941-555-0142", email: "pat.lee@example.com", best_time: "Mornings", visitor_type: "family", relationship: "Daughter", care_recipient: "Mother, 84, dementia", service: "private_duty_home_care", location: "Venice, FL 34285", in_service_area: "unknown", needs: ["bathing", "dressing", "meals"], special_needs: "Dementia; can be anxious with new people", schedule: { days: ["mon", "tue", "wed", "thu", "fri"], times: ["am"], start: "As soon as possible", hours: "4 hours a day" }, payment: "private_pay", urgency: "soon", summary: "Daughter looking for weekday morning help at home for her mother with dementia. Wants help with bathing, dressing and breakfast.", status: "new", consent: 1, consent_at: ago(2), created_at: ago(2), match_coverage: "full", matches: [{ full_name: "Avery Example", reasons: "CNA, 6 years · dementia experience · free weekday mornings" }, { full_name: "Blake Sample", reasons: "HHA · free Mon, Wed, Fri mornings" }] },
    { id: 2, ref: "OS-4HNW8R", source: "chat", contact_name: "Robin Hart", phone: "941-555-0187", email: "robin@example.com", visitor_type: "family", relationship: "Wife", care_recipient: "Husband", service: "private_duty_home_care", location: "Nokomis 34275", needs: ["toileting", "mobility"], schedule: { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], times: ["overnight"], start: "Next week" }, payment: "private_pay", urgency: "urgent", escalated: 1, summary: "Needs overnight supervision seven nights a week. Husband gets confused at night.", status: "new", consent: 1, consent_at: ago(20), created_at: ago(20), match_coverage: "none", matches: [] },
    { id: 3, ref: "OS-9TQ3VD", source: "contact_form", contact_name: "Jordan Wells", phone: "941-555-0110", email: "jordan@example.com", message: "Looking for respite care for two weeks in December while I travel.", service: "respite_day_care", status: "contacted", notes: "Left a voicemail Tuesday.", consent: 1, consent_at: ago(70), created_at: ago(70) },
    { id: 4, ref: "OS-2MXK6B", source: "chat", contact_name: "Sam Reed", phone: "941-555-0166", visitor_type: "family", service: "hospice_palliative", summary: "Father died last week; mother now on hospice.", status: "bereavement", consent: 1, consent_at: ago(200), created_at: ago(200) },
  ],
  escalations: [
    { id: 1, reason: "no_match", urgency: "urgent", status: "open", summary: "Overnight care 7 nights a week requested; no caregiver covers it.", lead_id: 2, lead_ref: "OS-4HNW8R", contact_name: "Robin Hart", created_at: ago(20) },
    { id: 2, reason: "facility_routing", urgency: "soon", status: "open", summary: "Father discharged from rehab needs 24-hour skilled nursing. Family can't cope at home.", lead_id: null, created_at: ago(30) },
    { id: 3, reason: "bereavement", urgency: "routine", status: "handled", summary: "Father died; mother on hospice.", lead_id: 4, lead_ref: "OS-2MXK6B", contact_name: "Sam Reed", created_at: ago(200) },
  ],
  applicants: [
    { id: 1, ref: "OSC-7RM2KQ", source: "chat", name: "Morgan Diaz", phone: "941-555-0175", email: "morgan@example.com", role: "CNA", credential: "CNA", license_current: 1, years_experience: 6, specialties: "Dementia, hospice", availability: week([["nights"], ["nights"], [], [], ["nights"], ["nights"], []]), prn: 1, travel_area: "Venice to Sarasota or North Port", summary: "CNA with 6 years' experience looking for night shifts.", status: "new", has_resume: false, created_at: ago(5) },
    { id: 2, ref: "OSC-3PL8WN", source: "careers_form", name: "Casey Brown", phone: "941-555-0199", email: "casey@example.com", role: "LPN", message: "LPN with wound care experience, available weekdays.", status: "reviewing", has_resume: true, created_at: ago(50) },
  ],
  caregivers: [
    { id: 1, first_name: "Avery", last_name: "Example", credential: "CNA", status: "hired", years_experience: 6, prn: 0, background_check: 1, availability: week([["am", "pm"], ["am", "pm"], ["am", "pm"], ["am", "pm"], ["am", "pm"], [], []]), tags: ["dementia", "companionship"] },
    { id: 2, first_name: "Blake", last_name: "Sample", credential: "HHA", status: "prn", years_experience: 2, prn: 1, background_check: 1, availability: week([["am"], [], ["am"], [], ["am"], [], []]), tags: ["companionship"] },
    { id: 3, first_name: "Casey", last_name: "Demo", credential: "LPN", status: "hired", years_experience: 12, prn: 0, background_check: 1, availability: week([["am", "pm", "nights"], ["am", "pm", "nights"], [], [], [], ["am", "pm", "nights"], ["am", "pm", "nights"]]), tags: ["wound_care", "feeding_tube", "catheter_care", "hospice"] },
    { id: 4, first_name: "Drew", last_name: "Placeholder", credential: "RN", status: "inactive", years_experience: 20, availability: {}, tags: [] },
  ],
};
const meta = {
  tags: ["dementia", "hospice", "hoyer_lift", "private_duty", "rehab", "behavioral_health", "two_person_assist", "diabetes", "wound_care", "feeding_tube", "catheter_care", "oxygen", "companionship"],
  credentials: ["HHA", "CNA", "Med tech", "LPN", "RN", "ARNP"],
  statuses: ["to_interview", "waitlist", "prn", "hired", "inactive"],
};

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const [resource, idText] = url.pathname.replace(/^\/api\/admin\/?/, "").split("/");
  if (url.pathname.startsWith("/api/admin")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    const id = Number(idText);
    const table = { leads: db.leads, applicants: db.applicants, escalations: db.escalations, roster: db.caregivers }[resource];
    if (resource === "me") return send(res, 200, { email: "preview@example.test" });
    if (resource === "roster" && req.method === "GET") return send(res, 200, { caregivers: db.caregivers, ...meta });
    if (table && req.method === "GET") return send(res, 200, table);
    if (table && req.method === "PATCH") return Object.assign(table.find((r) => r.id === id) ?? {}, input), send(res, 200, { ok: true });
    if (table && req.method === "POST") return table.push({ id: table.length + 10, ...input }), send(res, 200, { ok: true });
    if (table && req.method === "DELETE") return table.splice(table.findIndex((r) => r.id === id), 1), send(res, 200, { ok: true });
    return send(res, 404, { message: "Not found" });
  }
  const path = url.pathname === "/admin/" || url.pathname === "/admin" ? "/admin/index.html" : url.pathname;
  if (!path.startsWith("/admin/")) return res.writeHead(302, { Location: "/admin/" }).end();
  try {
    send(res, 200, await readFile(join(root, path)), types[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}).listen(8790, () => console.log("Admin preview on http://localhost:8790/admin/"));
