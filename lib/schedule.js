// Shared vocabulary for credentials and availability, used by matching,
// the tools, the roster import and the admin API.

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const SLOTS = ["am", "pm", "nights"];

// HHA and CNA sit at the same level; skilled nursing needs LPN or above.
export const CREDENTIAL_RANK = { HHA: 1, CNA: 1, "Med tech": 2, LPN: 3, RN: 4, ARNP: 5 };
export const CREDENTIALS = Object.keys(CREDENTIAL_RANK);

export const ACTIVE_STATUSES = ["hired", "prn"];
export const ROSTER_STATUSES = ["to_interview", "waitlist", "prn", "hired", "inactive"];

const CREDENTIAL_ALIASES = new Map([
  ["cna", "CNA"], ["c.n.a", "CNA"], ["c.n.a.", "CNA"], ["can", "CNA"], ["certified nursing assistant", "CNA"],
  ["hha", "HHA"], ["h.h.a", "HHA"], ["h.h.a.", "HHA"], ["home health aide", "HHA"],
  ["med tech", "Med tech"], ["medtech", "Med tech"], ["med-tech", "Med tech"], ["medication technician", "Med tech"], ["medical technician", "Med tech"],
  ["lpn", "LPN"], ["l.p.n", "LPN"], ["l.p.n.", "LPN"], ["licensed practical nurse", "LPN"],
  ["rn", "RN"], ["r.n", "RN"], ["r.n.", "RN"], ["registered nurse", "RN"],
  ["arnp", "ARNP"], ["a.r.n.p", "ARNP"], ["aprn", "ARNP"], ["np", "ARNP"], ["nurse practitioner", "ARNP"],
]);

// Returns a canonical credential, or null when the text is not recognized.
export function normalizeCredential(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (CREDENTIAL_ALIASES.has(key)) return CREDENTIAL_ALIASES.get(key);
  // "CNA/HHA" or "RN, BSN": take the highest credential mentioned.
  let best = null;
  for (const part of key.split(/[\/,;&]| and /)) {
    const c = CREDENTIAL_ALIASES.get(part.trim());
    if (c && (!best || CREDENTIAL_RANK[c] > CREDENTIAL_RANK[best])) best = c;
  }
  return best;
}

// Spreadsheet availability text to a slot list. Returns null for blank,
// which means unknown and never counts as available.
export function normalizeAvailability(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["always", "flexible", "any", "all", "yes", "y", "anytime", "24/7"].includes(v)) return [...SLOTS];
  if (["no", "n", "none", "off", "unavailable", "-"].includes(v)) return [];
  const slots = new Set();
  for (const part of v.split(/[\/,;&+ ]+/)) {
    if (["am", "morning", "mornings", "days", "day"].includes(part)) slots.add("am");
    if (["pm", "afternoon", "afternoons", "evening", "evenings", "days", "day"].includes(part)) slots.add("pm");
    if (["nights", "night", "noc", "overnight", "overnights"].includes(part)) slots.add("nights");
  }
  return SLOTS.filter((s) => slots.has(s));
}

export function slotLabel(slot) {
  return { am: "mornings", pm: "afternoons", nights: "nights" }[slot];
}
