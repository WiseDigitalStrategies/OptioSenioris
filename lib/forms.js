// Handlers for the plain contact and careers forms, so enquiries still reach
// Jill when JavaScript is off.

import { getLead, insertApplicant, insertLead, newRef } from "./db.js";
import { applicantEmail, leadEmail, sendEmail } from "./email.js";
import { allow, clientIp } from "./ratelimit.js";
import { ValidationError, containsSensitiveNumber, email, oneOf, phone, text } from "./validate.js";

export const CAREER_ROLES = [
  "Registered Nurse (RN)",
  "Certified Nursing Assistant / Caregiver",
  "Medical Technician",
  "Business Development Manager",
];

const RESUME_TYPES = {
  pdf: { type: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  doc: { type: "application/msword", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b, 0x03, 0x04] },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function problemPage(message, back) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Please check your details | Optio Senioris</title><link rel="stylesheet" href="/css/styles.css"></head>
<body><main id="main" class="section"><div class="container"><h1>Please check your details</h1><p>${escapeHtml(message)}</p><p><a class="btn" href="${escapeHtml(back)}">Go back</a></p></div></main></body></html>`;
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function redirect(path) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

// Only same-site paths are accepted as the page to return to.
function backPath(request, fallback) {
  const ref = request.headers.get("Referer");
  try {
    const url = new URL(ref);
    if (url.origin === new URL(request.url).origin) return url.pathname;
  } catch {}
  return fallback;
}

function noSensitive(fields) {
  for (const [name, v] of Object.entries(fields)) {
    if (containsSensitiveNumber(v)) throw new ValidationError(`Please remove any Social Security or ID numbers from the ${name}. We never need them on this form.`);
  }
}

export async function handleContactForm({ request, env, config }) {
  const back = backPath(request, "/contact");
  if (!(await allow(env.DB, `form:${clientIp(request)}`, config.limits.formsPerIpPerHour, 3600))) {
    return problemPage(`You've sent several messages in a short time. Please call us on ${config.business.phone}.`, back);
  }
  const form = await request.formData();
  // Honeypot: real visitors never see or fill this field.
  if (form.get("website")) return redirect("/thanks");
  try {
    if (form.get("consent") !== "yes") throw new ValidationError("Please tick the box to let us contact you about your enquiry.");
    const lead = {
      contact_name: text(form.get("name"), "name", { max: 100, required: true }),
      phone: phone(form.get("phone")),
      email: email(form.get("email"), "email", { required: true }),
      message: text(form.get("message"), "message", { max: 2000, required: true }),
    };
    noSensitive({ message: lead.message });
    const ref = newRef("OS");
    const id = await insertLead(env.DB, { ...lead, ref, source: "contact_form", consent: 1, consent_at: new Date().toISOString(), in_service_area: "unknown" });
    const saved = await getLead(env.DB, id);
    await sendEmail(env, config, { to: config.email.notifyTo, ...leadEmail(env, saved) });
    return redirect("/thanks");
  } catch (err) {
    if (err instanceof ValidationError) return problemPage(err.message, back);
    throw err;
  }
}

async function readResume(file, maxBytes) {
  if (!file || typeof file === "string" || file.size === 0) throw new ValidationError("Please attach your resume as a PDF or Word file.");
  if (file.size > maxBytes) throw new ValidationError(`Your resume must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const ext = String(file.name).toLowerCase().split(".").pop();
  const kind = RESUME_TYPES[ext];
  if (!kind) throw new ValidationError("Your resume must be a PDF or Word (.doc or .docx) file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!kind.magic.every((b, i) => bytes[i] === b)) throw new ValidationError("That file doesn't look like a PDF or Word document. Please try another copy.");
  const name = String(file.name).replace(/[^\w.\- ]+/g, "_").slice(0, 100);
  return { bytes, ext, type: kind.type, name };
}

export async function handleCareersForm({ request, env, config }) {
  const back = backPath(request, "/careers");
  if (!(await allow(env.DB, `form:${clientIp(request)}`, config.limits.formsPerIpPerHour, 3600))) {
    return problemPage(`You've sent several applications in a short time. Please call us on ${config.business.phone}.`, back);
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > config.limits.maxResumeBytes + 100_000) return problemPage("Your resume is too large. Please send a file under 5 MB.", back);
  const form = await request.formData();
  if (form.get("website")) return redirect("/thanks?type=application");
  try {
    if (form.get("consent") !== "yes") throw new ValidationError("Please tick the box to let us contact you about your application.");
    const a = {
      name: text(form.get("name"), "name", { max: 100, required: true }),
      phone: phone(form.get("phone"), "phone", { required: true }),
      email: email(form.get("email"), "email", { required: true }),
      role: oneOf(form.get("role"), "role", CAREER_ROLES, { required: true }),
      message: text(form.get("message"), "message", { max: 2000 }),
    };
    noSensitive({ message: a.message });
    const resume = await readResume(form.get("resume"), config.limits.maxResumeBytes);
    const key = `resumes/${crypto.randomUUID()}.${resume.ext}`;
    await env.RESUMES.put(key, resume.bytes, { httpMetadata: { contentType: resume.type } });
    const ref = newRef("OSC");
    const id = await insertApplicant(env.DB, { ...a, ref, source: "careers_form", status: "new", resume_key: key, resume_name: resume.name, consent: 1 });
    await sendEmail(env, config, { to: config.email.notifyTo, ...applicantEmail(env, { ...a, id, ref, resume_key: key }) });
    return redirect("/thanks?type=application");
  } catch (err) {
    if (err instanceof ValidationError) return problemPage(err.message, back);
    throw err;
  }
}
