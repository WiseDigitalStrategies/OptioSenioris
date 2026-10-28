// Rule-based caregiver matching. The model gathers the request and calls
// search_caregivers; everything here is deterministic so the model can never
// invent a caregiver or availability.

import { ACTIVE_STATUSES, CREDENTIAL_RANK, DAYS, slotLabel } from "./schedule.js";

const MAX_RESULTS = 3;
// A caregiver who covers at least half of the requested slots is offered as
// a partial match when not enough caregivers cover all of them.
const PARTIAL_THRESHOLD = 0.5;

const TAG_LABELS = {
  dementia: "dementia experience",
  hospice: "hospice experience",
  hoyer_lift: "Hoyer lift trained",
  private_duty: "private duty experience",
  rehab: "rehab experience",
  behavioral_health: "behavioral health experience",
  two_person_assist: "two-person assist experience",
  diabetes: "diabetes care experience",
  wound_care: "wound care experience",
  feeding_tube: "feeding tube experience",
  catheter_care: "catheter care experience",
  oxygen: "oxygen experience",
  companionship: "companionship experience",
};

// roster: rows with availability and tags already parsed.
// request: { min_credential, days, times, skills, preferred_skills, preferred_caregiver }
// Returns { coverage, matches } where each match keeps internal fields
// (roster_id, full_name) that are stripped before the model sees them.
export function matchCaregivers(roster, request) {
  const minRank = CREDENTIAL_RANK[request.min_credential] ?? 1;
  const days = request.days;
  const slots = [...new Set(request.times.map((t) => (t === "overnight" ? "nights" : t)))];
  const wanted = days.flatMap((d) => slots.map((s) => [d, s]));
  const skills = request.skills ?? [];
  const preferredSkills = request.preferred_skills ?? [];
  const preferredName = normalizeName(request.preferred_caregiver);

  const scored = [];
  for (const c of roster) {
    if (!ACTIVE_STATUSES.includes(c.status)) continue;
    if ((CREDENTIAL_RANK[c.credential] ?? 0) < minRank) continue;

    const covered = wanted.filter(([d, s]) => (c.availability[d] ?? []).includes(s)).length;
    const overlap = wanted.length ? covered / wanted.length : 0;
    if (overlap < PARTIAL_THRESHOLD) continue;

    const tags = new Set(c.tags);
    const skillHits = skills.filter((t) => tags.has(t));
    const prefHits = preferredSkills.filter((t) => tags.has(t));
    const requested = preferredName && preferredName === normalizeName(c.first_name);

    scored.push({ c, covered, overlap, skillHits, prefHits, requested });
  }

  scored.sort(
    (a, b) =>
      // Continuity: a caregiver the family asked for comes first when they cover the schedule.
      Number(b.requested && b.overlap === 1) - Number(a.requested && a.overlap === 1) ||
      b.overlap - a.overlap ||
      b.skillHits.length - a.skillHits.length ||
      (b.c.years_experience ?? 0) - (a.c.years_experience ?? 0) ||
      b.prefHits.length - a.prefHits.length ||
      Number(b.requested) - Number(a.requested) ||
      a.c.id - b.c.id,
  );

  const top = scored.slice(0, MAX_RESULTS);
  const coverage = top.some((s) => s.overlap === 1) ? "full" : top.length ? "partial" : "none";

  const matches = top.map((s) => ({
    roster_id: s.c.id,
    full_name: `${s.c.first_name} ${s.c.last_name}`.trim(),
    first_name: s.c.first_name,
    credential: s.c.credential,
    full_coverage: s.overlap === 1,
    requested_caregiver: Boolean(s.requested),
    reasons: reasonsFor(s, { days, slots, wantedCount: wanted.length, skills }),
  }));

  return { coverage, matches };
}

function reasonsFor(s, { days, slots, wantedCount, skills }) {
  const parts = [s.c.credential];
  if (s.overlap === 1) {
    parts.push(`available ${describeSchedule(days, slots)}`);
  } else {
    parts.push(`covers ${s.covered} of ${wantedCount} requested shifts`);
  }
  for (const t of s.skillHits) parts.push(TAG_LABELS[t] ?? t.replace(/_/g, " "));
  const missing = skills.filter((t) => !s.skillHits.includes(t));
  for (const t of missing) parts.push(`no ${TAG_LABELS[t] ?? t.replace(/_/g, " ")} listed`);
  if (s.c.years_experience) parts.push(`${s.c.years_experience} years' experience`);
  for (const t of s.prefHits) if (!s.skillHits.includes(t)) parts.push(TAG_LABELS[t] ?? t.replace(/_/g, " "));
  if (s.requested) parts.push("the caregiver you asked for");
  if (s.c.status === "prn") parts.push("on call (PRN)");
  return parts.join(", ");
}

function describeSchedule(days, slots) {
  const times = slots.map(slotLabel).join(" and ");
  const set = new Set(days);
  if (set.size === 7) return `${times} every day`;
  const weekdays = ["mon", "tue", "wed", "thu", "fri"];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return `weekday ${times}`;
  if (set.size === 2 && set.has("sat") && set.has("sun")) return `weekend ${times}`;
  const names = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  return `${times} on ${DAYS.filter((d) => set.has(d)).map((d) => names[d]).join(", ")}`;
}

function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase().split(/\s+/)[0] || null;
}

// What the model sees: no roster id, no last name, and a first name only
// when Jill has approved showing names.
export function publicMatches(matches, { showNames }) {
  return matches.map((m, i) => ({
    option: i + 1,
    ...(showNames ? { first_name: m.first_name } : {}),
    credential: m.credential,
    covers_full_schedule: m.full_coverage,
    reasons: showNames ? m.reasons : m.reasons.replace(", the caregiver you asked for", ""),
  }));
}
