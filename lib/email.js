// Notification emails through the Cloudflare Email Sending REST API.
// Bodies stay minimal: who, how to reach them, what they want, and a link to
// /admin for the rest. No health detail beyond the service requested.

const SERVICE_LABELS = {
  long_term_care: "Long-Term Care",
  respite_day_care: "Respite / Drop-In Day Care",
  hospice_palliative: "Hospice & Palliative Care",
  private_duty_home_care: "Private Duty Home Care",
  not_sure: "Not sure yet",
};

const REASON_LABELS = {
  urgent_placement: "Urgent placement",
  end_of_life: "End of life",
  bereavement: "Bereavement",
  complaint: "Complaint",
  complex_clinical: "Complex clinical needs",
  asked_for_person: "Visitor asked for a person",
  emergency: "Emergency reported (visitor told to call 911)",
  self_harm: "Self-harm mentioned (visitor given 911 and 988)",
  safeguarding: "Possible abuse or neglect reported",
  facility_routing: "May need facility care",
  hospice_routing: "Hospice interest",
  no_match: "No caregiver match",
};

export function serviceLabel(s) {
  return SERVICE_LABELS[s] ?? s ?? "Not given";
}

export function reasonLabel(r) {
  return REASON_LABELS[r] ?? r;
}

export async function sendEmail(env, config, { to, subject, text }) {
  const from = config.email.from;
  const recipients = (to ?? []).filter(Boolean);
  if (!env.EMAIL_API_TOKEN || !env.CF_ACCOUNT_ID || !from || recipients.length === 0) return "skipped";
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { address: from, name: config.email.fromName },
        to: recipients,
        subject,
        text,
        html: textToHtml(text),
      }),
    });
    if (!res.ok) {
      // Log the status only: never the token, never the message body.
      console.error(`email send failed: HTTP ${res.status}`);
      return "failed";
    }
    return "sent";
  } catch {
    console.error("email send failed: network error");
    return "failed";
  }
}

function adminLink(env, path) {
  return `${env.SITE_URL || "https://optiosenioris.net"}/admin/${path}`;
}

export function leadEmail(env, lead) {
  const urgent = lead.urgency === "urgent";
  const subject = `${urgent ? "URGENT: " : ""}New ${lead.source === "chat" ? "chat" : "website"} enquiry ${lead.ref}: ${lead.contact_name}`;
  const lines = [
    `New enquiry ${lead.ref}${lead.status === "bereavement" ? " (BEREAVEMENT: follow up only on request)" : ""}`,
    "",
    `Name: ${lead.contact_name}`,
    `Phone: ${lead.phone ?? "not given"}`,
    `Email: ${lead.email ?? "not given"}`,
    `Best time to call: ${lead.best_time ?? "not given"}`,
  ];
  if (lead.visitor_type === "referral_partner") lines.push(`Referral partner: ${[lead.organization_role, lead.organization].filter(Boolean).join(", ") || "yes"}`);
  lines.push(
    `Service: ${serviceLabel(lead.service)}`,
    `Timing: ${lead.start_timing ?? "not given"}`,
    `Urgency: ${lead.urgency ?? "not given"}`,
  );
  if (lead.match_coverage) lines.push(`Caregiver matches: ${lead.match_coverage}`);
  lines.push("", `Full details, matches and status: ${adminLink(env, `#lead-${lead.id}`)}`);
  return { subject, text: lines.join("\n") };
}

export function applicantEmail(env, a) {
  return {
    subject: `New caregiver applicant ${a.ref}: ${a.name}`,
    text: [
      `New caregiver applicant ${a.ref}`,
      "",
      `Name: ${a.name}`,
      `Phone: ${a.phone ?? "not given"}`,
      `Email: ${a.email ?? "not given"}`,
      `Credential or role: ${a.credential ?? a.role ?? "not given"}`,
      a.resume_key ? "Resume: uploaded (download it from the admin page)" : null,
      "",
      `Full details: ${adminLink(env, `#applicant-${a.id}`)}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
}

export function escalationEmail(env, e, lead) {
  const urgent = e.urgency === "urgent";
  return {
    subject: `${urgent ? "URGENT: " : ""}Chat flagged for you: ${reasonLabel(e.reason)}`,
    text: [
      `A care assistant conversation was flagged for you.`,
      "",
      `Reason: ${reasonLabel(e.reason)}`,
      `Urgency: ${e.urgency}`,
      lead ? `Enquiry: ${lead.ref} (${lead.contact_name}, ${lead.phone ?? lead.email ?? "no contact details"})` : "No contact details were given yet.",
      "",
      `Details: ${adminLink(env, `#escalation-${e.id}`)}`,
    ].join("\n"),
  };
}

function textToHtml(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${esc.replace(/\n/g, "<br>")}</div>`;
}
