// Turns the config into the facts section of the system prompt, so the
// assistant only states what Jill has confirmed and defers on the rest.

const UNCONFIRMED = "Not confirmed yet. Say a team member will confirm.";

export function buildFacts(config) {
  const lines = [];
  const b = config.business;

  lines.push("# Business facts");
  lines.push(`- Assistant name: ${config.botName}`);
  lines.push(`- Business: ${b.name}, based in ${b.locationLine}. Tagline: "${b.tagline}"`);
  lines.push(`- Phone: ${b.phone}`);
  lines.push(`- Mailing address: ${b.mailingAddress}`);

  const area = config.serviceArea;
  if (area.description || area.cities.length || area.zips.length) {
    const parts = [area.description, area.cities.length && `cities: ${area.cities.join(", ")}`, area.zips.length && `zip codes: ${area.zips.join(", ")}`].filter(Boolean);
    lines.push(`- Service area: ${parts.join("; ")}`);
  } else {
    lines.push(`- Service area: ${UNCONFIRMED} Still ask where care is needed.`);
  }

  const hotline = config.floridaAbuseHotline;
  lines.push(
    hotline.verified && hotline.number
      ? `- Florida Abuse Hotline: ${hotline.number}`
      : "- Florida Abuse Hotline: number not confirmed yet. Name the hotline but give no number.",
  );
  lines.push(`- Prices: ${config.pricingWording || "Never quote prices. Say a team member will talk through costs."}`);
  lines.push(`- Booking an intro call: ${config.booking.url ? "available through book_intro_call" : "not set up yet. Say a team member will call to arrange a time."}`);

  lines.push("");
  lines.push("# Services (site wording)");
  lines.push("- Long-Term Care: placement with award-winning, 5-star senior living partner communities: assisted living, memory care, hospice and specialized nursing care in a warm, family-focused environment. Over 20 years of experience. Accepts residents with mobility, behavioral and clinical or nursing needs, with help for all activities of daily living. Page: /long-term-care");
  lines.push(
    `- Respite and Drop-In Day Care: respite ${config.respite.stayLength}; drop-in day care from ${config.respite.dropInHours} with ${config.respite.dropInNotice}. A safe, engaging place to socialize, enjoy activities and get personalized support.${config.respite.confirmed ? "" : " (Hours and minimum booking are being confirmed: use this wording and say a team member will confirm details.)"} Page: /respite-day-care`,
  );
  lines.push("- Hospice and Palliative Care: both focus on comfort, easing pain, symptom relief and emotional, social and spiritual support for serious and terminal illness, for the patient and family, at home or in a facility. Hospice avoids aggressive treatment and focuses on comfort, dignity and quality of life at the end of life, typically when curative treatment is no longer being pursued. Page: /hospice-palliative-care");
  lines.push("- Private Duty Home Care: in-home care by Optio Seniorists, elite geriatric and dementia caregivers (the \"Rolls-Royce\" of geriatric caregivers), mostly CNAs: help with bathing, dressing, grooming, toileting, mobility and transfers, cooking and nutrition, laundry, charting and clinical milestone tracking. Royal blue uniforms with the OS badge. Page: /private-duty-home-care");
  lines.push("- Who We Care For: complex physical, behavioral and clinical needs, including Hoyer lifts, bedridden patients, two- or three-person assists, feeding tubes, catheters, oxygen and challenging behaviors. Page: /who-we-care-for");
  lines.push("- Funding pages (general information only, never advice): /funding, /medicaid, /qualified-income-trust, /veterans, /long-term-care-insurance");

  lines.push("");
  lines.push("# Approved facilities");
  lines.push(config.facilities.length ? config.facilities.map(formatPartner).join("\n") : "None listed yet. Do not name any facility.");
  lines.push("");
  lines.push("# Approved hospice partners");
  lines.push(config.hospicePartners.length ? config.hospicePartners.map(formatPartner).join("\n") : "None listed yet. Do not name any hospice provider.");

  if (config.faq.length) {
    lines.push("");
    lines.push("# Approved answers to common questions");
    for (const { question, answer } of config.faq) lines.push(`- Q: ${question}\n  A: ${answer}`);
  }

  lines.push("");
  lines.push("# Site pages");
  for (const [path, label] of Object.entries(config.sitePages)) lines.push(`- ${path}: ${label}`);

  lines.push("");
  lines.push(`# Caregiver names\n${config.showCaregiverFirstNames ? "You may use a matched caregiver's first name as the search tool returns it." : "Refer to matched caregivers only by credential and reasons, never by name."}`);

  return lines.join("\n");
}

function formatPartner(p) {
  return `- ${p.name}${p.type ? `: ${p.type}` : ""}${p.area ? ` (${p.area})` : ""}`;
}
