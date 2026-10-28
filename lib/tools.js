// The five tools Claude can call, with strict schemas, and the server-side
// handlers that validate every input before touching data.
//
// Strict schemas cannot express optional fields cheaply, so every field is
// required and the model sends "" (or an empty list, or "not_given") when it
// does not know a value. The handlers turn those into nulls.

import { activeRoster, getLead, insertApplicant, insertEscalation, insertLead, linkEscalationsToLead, newRef, updateApplicant, updateLead, upsertConversation } from "./db.js";
import { applicantEmail, escalationEmail, leadEmail, sendEmail } from "./email.js";
import { matchCaregivers, publicMatches } from "./matching.js";
import { CREDENTIALS, DAYS, SLOTS } from "./schedule.js";
import { ValidationError, bool, containsSensitiveNumber, email, int, listOf, oneOf, phone, text } from "./validate.js";

export const SERVICES = ["long_term_care", "respite_day_care", "hospice_palliative", "private_duty_home_care", "not_sure"];
const TIMES = ["am", "pm", "nights", "overnight"];
const NEEDS = ["bathing", "dressing", "toileting", "meals", "medication_reminders", "mobility", "transfers", "companionship", "housekeeping", "other"];
const PAYMENT = ["private_pay", "ltc_insurance", "veterans_benefits", "medicaid", "not_sure", "not_given"];
const URGENCY = ["routine", "soon", "urgent"];
export const ESCALATION_REASONS = [
  "urgent_placement", "end_of_life", "bereavement", "complaint", "complex_clinical", "asked_for_person",
  "emergency", "self_harm", "safeguarding", "facility_routing", "hospice_routing", "no_match",
];
const YES_NO = ["yes", "no", "not_given"];

const str = (description) => ({ type: "string", description });
const enumOf = (values, description) => ({ type: "string", enum: values, description });
const arrayOf = (values, description) => ({ type: "array", items: { type: "string", enum: values }, description });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export function toolDefinitions(config) {
  const tags = config.skillTags;
  return [
    {
      name: "search_caregivers",
      description:
        "Find up to 3 caregivers on Optio Senioris's reviewed roster who fit a family's request. Matching is rule based: active caregivers only, credential at or above min_credential, and availability covering the requested days and times. Returns ranked options with plain-language reasons, and a coverage value: full (someone covers the whole schedule), partial (only part of it) or none. Never returns contact details. Call it once you know the days, times and type of help needed.",
      strict: true,
      input_schema: object({
        service: enumOf(SERVICES, "Service the family is interested in."),
        min_credential: enumOf(CREDENTIALS, "Lowest credential that can do the work. Companion care and help with daily living: CNA. Medication administration: Med tech. Skilled nursing tasks (injections, wound care, feeding tubes, catheters): LPN."),
        skills: arrayOf(tags, "Experience the care requires, e.g. dementia for a person with dementia. Empty list if none."),
        days: arrayOf(DAYS, "Days of the week care is needed. At least one."),
        times: arrayOf(TIMES, "Times of day: am (morning), pm (afternoon/evening), nights, overnight. At least one."),
        start_date: str("When care should start, in the visitor's words (e.g. 'next Monday', 'as soon as possible'). Under 60 characters. Empty string if not known."),
        hours: str("How many hours per visit or per week, in the visitor's words. Under 60 characters. Empty string if not known."),
        preferred_caregiver: str("First name of a caregiver the family already works with and asks for. Empty string if none."),
        preferred_skills: arrayOf(tags, "Nice-to-have experience the family mentioned. Empty list if none."),
      }),
    },
    {
      name: "save_family_lead",
      description:
        "Save a family's or referral partner's enquiry with the latest search results, notify Jill, and return a reference number. Only call when you have a name, a phone number or email, and the visitor has said yes to being contacted. Call again later in the same conversation to add details; it updates the same enquiry. Keep health detail general. Use \"\" for unknown text, [] for unknown lists, not_given for unknown choices.",
      strict: true,
      input_schema: object({
        visitor_type: enumOf(["family", "referral_partner"], "referral_partner for discharge planners, social workers and similar professionals."),
        contact_name: str("Visitor's name. Under 100 characters."),
        phone: str("Phone number, or \"\"."),
        email: str("Email address, or \"\"."),
        best_time_to_call: str("Best time to call, or \"\". Under 100 characters."),
        consent_to_contact: { type: "boolean", description: "True only if the visitor said yes to being contacted by the Optio Senioris team." },
        relationship: str("Visitor's relationship to the person needing care (e.g. daughter, self, spouse), or \"\"."),
        organization: str("Referral partner's organization, or \"\"."),
        organization_role: str("Referral partner's role, or \"\"."),
        care_recipient: str("Who needs care, in general terms such as 'mother' or 'husband'. No ages or names. Or \"\"."),
        service: enumOf(SERVICES, "Service of interest."),
        location: str("City or zip code where care is needed, or \"\"."),
        daily_living_needs: arrayOf(NEEDS, "Help needed with daily living."),
        special_needs: str("General special needs only (e.g. 'dementia, uses a Hoyer lift'). No diagnoses in detail, medications or ID numbers. Under 300 characters, or \"\"."),
        schedule_days: arrayOf(DAYS, "Days care is needed."),
        schedule_times: arrayOf(TIMES, "Times of day care is needed."),
        start_timing: str("How soon care should start, or \"\". Under 100 characters."),
        hours: str("Hours needed, or \"\". Under 100 characters."),
        payment: enumOf(PAYMENT, "How they expect to pay, at a general level."),
        urgency: enumOf(URGENCY, "urgent: needs care within days (e.g. hospital discharge). soon: within a few weeks. routine: otherwise."),
        summary: str("Two or three plain sentences for Jill summarizing the situation and what the family wants. No sensitive detail. Under 600 characters."),
        status_hint: enumOf(["normal", "bereavement"], "bereavement if someone in this conversation has died."),
      }),
    },
    {
      name: "save_caregiver_applicant",
      description:
        "Save a caregiver or nurse who wants to work with Optio Senioris as a new applicant for Jill to review. It never changes the live roster. Only call when you have a name, a phone number or email, and their consent to be contacted. Never collect SSNs, license numbers, dates of birth or ID documents. Use \"\", [], -1 or not_given for unknowns.",
      strict: true,
      input_schema: object({
        name: str("Applicant's name. Under 100 characters."),
        phone: str("Phone number, or \"\"."),
        email: str("Email address, or \"\"."),
        credential: enumOf([...CREDENTIALS, "other", "not_given"], "Credential level."),
        license_current: enumOf(YES_NO, "Whether their license or certificate is current."),
        years_experience: { type: "integer", description: "Years of caregiving experience, 0 to 60. -1 if not given." },
        specialties: arrayOf(config.skillTags, "Specialties and experience."),
        availability: object(Object.fromEntries(DAYS.map((d) => [d, arrayOf(SLOTS, `Times available on ${d}: am, pm, nights. Empty if not available or unknown.`)]))),
        prn: enumOf(YES_NO, "Whether they want PRN (on call) shifts."),
        travel_area: str("General area they can travel to, or \"\". Under 150 characters."),
        consent_to_contact: { type: "boolean", description: "True only if they said yes to being contacted." },
        summary: str("Two or three plain sentences for Jill. Under 600 characters."),
      }),
    },
    {
      name: "book_intro_call",
      description: "Show the visitor a button to book an introductory call with the Optio Senioris team. Returns whether booking is available. If it is not, tell them a team member will call to arrange a time.",
      strict: true,
      input_schema: object({
        name: str("Visitor's name if known, or \"\"."),
        email: str("Visitor's email if known, or \"\"."),
      }),
    },
    {
      name: "escalate_to_human",
      description: "Flag this conversation for Jill and email her. Use for urgent placement, end of life, bereavement, complaints, complex clinical needs, a request for a person, emergencies, self-harm, suspected abuse or neglect, facility or hospice routing, or no caregiver match. Call once per reason.",
      strict: true,
      input_schema: object({
        reason: enumOf(ESCALATION_REASONS, "Why Jill should look at this conversation."),
        urgency: enumOf(URGENCY, "urgent for emergencies, safeguarding, self-harm or placement needed within days."),
        summary: str("One to three plain sentences for Jill. No sensitive detail. Under 400 characters."),
      }),
    },
  ];
}

// Turn "" into null so validators treat it as not given.
const blank = (v) => (v === "" ? null : v);

// ctx: { env, db, config, state, actions }
export async function runTool(name, input, ctx) {
  try {
    if (typeof input !== "object" || input === null) throw new ValidationError("input must be an object");
    switch (name) {
      case "search_caregivers":
        return await searchCaregivers(input, ctx);
      case "save_family_lead":
        return await saveFamilyLead(input, ctx);
      case "save_caregiver_applicant":
        return await saveCaregiverApplicant(input, ctx);
      case "book_intro_call":
        return bookIntroCall(input, ctx);
      case "escalate_to_human":
        return await escalateToHuman(input, ctx);
      default:
        return { error: `Unknown tool ${String(name).slice(0, 40)}` };
    }
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    console.error(`tool ${name} failed: ${err?.name ?? "error"}`);
    return { error: "This step failed on our side. Apologize, give the phone number, and say a team member will follow up." };
  }
}

async function searchCaregivers(input, { db, config, state }) {
  const request = {
    service: oneOf(input.service, "service", SERVICES, { required: true }),
    min_credential: oneOf(input.min_credential, "min_credential", CREDENTIALS, { required: true }),
    skills: listOf(input.skills, "skills", config.skillTags),
    days: listOf(input.days, "days", DAYS, { min: 1, max: 7 }),
    times: listOf(input.times, "times", TIMES, { min: 1, max: 4 }),
    start_date: text(blank(input.start_date), "start_date", { max: 60 }),
    hours: text(blank(input.hours), "hours", { max: 60 }),
    preferred_caregiver: text(blank(input.preferred_caregiver), "preferred_caregiver", { max: 40 }),
    preferred_skills: listOf(input.preferred_skills, "preferred_skills", config.skillTags),
  };
  const { coverage, matches } = matchCaregivers(await activeRoster(db), request);
  // Kept in the signed state so save_family_lead attaches the real results.
  state.lastSearch = { request, coverage, matches };
  return {
    coverage,
    matches: publicMatches(matches, { showNames: config.showCaregiverFirstNames }),
    note:
      coverage === "none"
        ? "No active caregiver covers this schedule. Say so honestly, save the enquiry, escalate with reason no_match, and tell them Jill will call."
        : "These are suggestions for Jill to review, not assignments. Do not promise any caregiver.",
  };
}

function serviceAreaCheck(location, config) {
  const { zips, cities } = config.serviceArea;
  if (!location || (!zips.length && !cities.length)) return "unknown";
  const zip = location.match(/\b(\d{5})\b/)?.[1];
  if (zip && zips.length) return zips.includes(zip) ? "yes" : "no";
  const loc = location.toLowerCase();
  if (cities.some((c) => loc.includes(c.toLowerCase()))) return "yes";
  return "unknown";
}

function rejectSensitive(fields) {
  for (const [field, value] of Object.entries(fields)) {
    if (containsSensitiveNumber(value)) throw new ValidationError(`${field} looks like it contains a Social Security number or ID. Remove it; never store ID numbers.`);
  }
}

async function saveFamilyLead(input, { env, db, config, state }) {
  if (!state.verified) throw new ValidationError("This conversation has not passed the bot check, so it cannot be saved. Ask the visitor to call instead.");
  if (bool(input.consent_to_contact, "consent_to_contact", { required: true }) !== true) {
    throw new ValidationError("The visitor has not agreed to be contacted. Ask them first, and only save if they say yes.");
  }
  const lead = {
    visitor_type: oneOf(input.visitor_type, "visitor_type", ["family", "referral_partner"], { required: true }),
    contact_name: text(input.contact_name, "contact_name", { max: 100, required: true }),
    phone: phone(blank(input.phone)),
    email: email(blank(input.email)),
    best_time: text(blank(input.best_time_to_call), "best_time_to_call", { max: 100 }),
    relationship: text(blank(input.relationship), "relationship", { max: 60 }),
    organization: text(blank(input.organization), "organization", { max: 120 }),
    organization_role: text(blank(input.organization_role), "organization_role", { max: 80 }),
    care_recipient: text(blank(input.care_recipient), "care_recipient", { max: 60 }),
    service: oneOf(input.service, "service", SERVICES, { required: true }),
    location: text(blank(input.location), "location", { max: 100 }),
    special_needs: text(blank(input.special_needs), "special_needs", { max: 300 }),
    payment: oneOf(input.payment, "payment", PAYMENT, { required: true }),
    urgency: oneOf(input.urgency, "urgency", URGENCY, { required: true }),
    summary: text(blank(input.summary), "summary", { max: 600 }),
  };
  if (!lead.phone && !lead.email) throw new ValidationError("A phone number or email is needed so the team can follow up.");
  rejectSensitive({ special_needs: lead.special_needs, summary: lead.summary, best_time_to_call: lead.best_time, location: lead.location });
  const needs = listOf(input.daily_living_needs, "daily_living_needs", NEEDS);
  const schedule = {
    days: listOf(input.schedule_days, "schedule_days", DAYS, { max: 7 }),
    times: listOf(input.schedule_times, "schedule_times", TIMES, { max: 4 }),
    start: text(blank(input.start_timing), "start_timing", { max: 100 }),
    hours: text(blank(input.hours), "hours", { max: 100 }),
  };
  const bereavement = oneOf(input.status_hint, "status_hint", ["normal", "bereavement"], { required: true }) === "bereavement" || state.bereavement;
  if (bereavement) state.bereavement = true;

  const search = state.lastSearch;
  const row = {
    ...lead,
    needs: JSON.stringify(needs),
    schedule: JSON.stringify(schedule),
    in_service_area: serviceAreaCheck(lead.location, config),
    consent: 1,
    consent_at: new Date().toISOString(),
    matches: JSON.stringify(search?.matches ?? []),
    match_coverage: search?.coverage ?? null,
    escalated: state.escalations?.length ? 1 : 0,
    ...(bereavement ? { status: "bereavement" } : {}),
  };

  let id = state.leadId;
  let ref = state.leadRef;
  let emailStatus = "not_sent_update";
  if (id) {
    await updateLead(db, id, row);
  } else {
    ref = newRef("OS");
    id = await insertLead(db, { ...row, ref, session_id: state.sid, source: "chat" });
    state.leadId = id;
    state.leadRef = ref;
    await linkEscalationsToLead(db, state.sid, id);
    const saved = await getLead(db, id);
    emailStatus = await sendEmail(env, config, { to: config.email.notifyTo, ...leadEmail(env, { ...saved, start_timing: schedule.start }) });
    await sendConfirmation(env, config, lead.email, "family");
  }
  await upsertConversation(db, { session_id: state.sid, mode: state.mode, user_turns: state.turns, lead_id: id, escalated: Boolean(state.escalations?.length), summary: lead.summary });

  return {
    saved: true,
    reference: ref,
    in_service_area: row.in_service_area,
    matches_attached: search?.matches.length ?? 0,
    status: bereavement ? "bereavement (the team will only follow up when the family is ready)" : "new",
    _email: emailStatus,
  };
}

async function saveCaregiverApplicant(input, { env, db, config, state }) {
  if (!state.verified) throw new ValidationError("This conversation has not passed the bot check, so it cannot be saved. Ask them to apply through /careers instead.");
  if (bool(input.consent_to_contact, "consent_to_contact", { required: true }) !== true) {
    throw new ValidationError("The applicant has not agreed to be contacted. Ask them first.");
  }
  const credential = oneOf(input.credential, "credential", [...CREDENTIALS, "other", "not_given"], { required: true });
  const yesNo = (v, f) => ({ yes: 1, no: 0, not_given: null })[oneOf(v, f, YES_NO, { required: true })];
  const years = int(input.years_experience === -1 ? null : input.years_experience, "years_experience", { min: 0, max: 60 });
  const availability = {};
  if (typeof input.availability !== "object" || input.availability === null) throw new ValidationError("availability must be an object");
  for (const d of DAYS) availability[d] = listOf(input.availability[d], `availability.${d}`, SLOTS, { max: 3 });

  const a = {
    name: text(input.name, "name", { max: 100, required: true }),
    phone: phone(blank(input.phone)),
    email: email(blank(input.email)),
    credential: credential === "not_given" ? null : credential,
    license_current: yesNo(input.license_current, "license_current"),
    years_experience: years,
    specialties: JSON.stringify(listOf(input.specialties, "specialties", config.skillTags)),
    availability: JSON.stringify(availability),
    prn: yesNo(input.prn, "prn"),
    travel_area: text(blank(input.travel_area), "travel_area", { max: 150 }),
    summary: text(blank(input.summary), "summary", { max: 600 }),
    consent: 1,
  };
  if (!a.phone && !a.email) throw new ValidationError("A phone number or email is needed so the team can follow up.");
  rejectSensitive({ summary: a.summary, travel_area: a.travel_area, name: a.name });

  let emailStatus = "not_sent_update";
  if (state.applicantId) {
    await updateApplicant(db, state.applicantId, a);
  } else {
    const ref = newRef("OSC");
    const id = await insertApplicant(db, { ...a, ref, session_id: state.sid, source: "chat", status: "new" });
    state.applicantId = id;
    state.applicantRef = ref;
    emailStatus = await sendEmail(env, config, { to: config.email.notifyTo, ...applicantEmail(env, { ...a, id, ref }) });
    await sendConfirmation(env, config, a.email, "caregiver");
  }
  await upsertConversation(db, { session_id: state.sid, mode: state.mode, user_turns: state.turns, applicant_id: state.applicantId, summary: a.summary });

  return { saved: true, reference: state.applicantRef, status: "new (for Jill's review; this does not add them to the schedule)", resume_upload_page: "/careers", _email: emailStatus };
}

function bookIntroCall(input, { config, actions }) {
  const name = text(blank(input.name), "name", { max: 100 });
  const mail = email(blank(input.email));
  if (!config.booking.url) {
    return { available: false, message: "Online booking is not set up yet. Tell the visitor a team member will call to arrange a time." };
  }
  const url = new URL(config.booking.url);
  if (config.booking.prefill) {
    if (name) url.searchParams.set("name", name);
    if (mail) url.searchParams.set("email", mail);
  }
  actions.push({ type: "link", label: "Book an introductory call", url: url.toString() });
  return { available: true, message: "A booking button is now showing under your message. Tell the visitor they can use it to pick a time." };
}

async function escalateToHuman(input, { env, db, config, state }) {
  const reason = oneOf(input.reason, "reason", ESCALATION_REASONS, { required: true });
  let urgency = oneOf(input.urgency, "urgency", URGENCY, { required: true });
  if (["emergency", "self_harm", "safeguarding"].includes(reason)) urgency = "urgent";
  const summary = text(blank(input.summary), "summary", { max: 400 });
  rejectSensitive({ summary });

  state.escalations ??= [];
  if (state.escalations.includes(reason)) return { escalated: true, note: "Already flagged for this reason." };
  state.escalations.push(reason);
  if (reason === "bereavement") state.bereavement = true;

  const id = await insertEscalation(db, { session_id: state.sid, lead_id: state.leadId, reason, urgency, summary });
  let lead = null;
  if (state.leadId) {
    await updateLead(db, state.leadId, { escalated: 1, ...(reason === "bereavement" ? { status: "bereavement" } : {}) });
    lead = await getLead(db, state.leadId);
  }
  await upsertConversation(db, { session_id: state.sid, mode: state.mode, user_turns: state.turns, lead_id: state.leadId, escalated: true, summary });
  const emailStatus = await sendEmail(env, config, { to: config.email.notifyTo, ...escalationEmail(env, { id, reason, urgency }, lead) });
  return { escalated: true, message: "Jill's team has been alerted.", _email: emailStatus };
}

async function sendConfirmation(env, config, to, kind) {
  const c = config.email.confirmation;
  const subject = kind === "family" ? c.familySubject : c.caregiverSubject;
  const body = kind === "family" ? c.familyText : c.caregiverText;
  if (!c.enabled || !to || !subject || !body) return "skipped";
  return sendEmail(env, config, { to: [to], subject, text: body });
}
