// Every fact the care assistant may state, and every value still waiting on
// Jill or Wise, lives in this file. Anything set to null or [] is a PLACEHOLDER:
// the assistant tells the visitor a team member will follow up instead of
// guessing. Edit, commit and push; the site redeploys on its own.

export default {
  // PLACEHOLDER: bot name and greeting (ask Alec and Jill).
  botName: "Optio Senioris Care Assistant",
  greeting: {
    family:
      "Hello. I'm the Optio Senioris Care Assistant, an AI helper. I can learn a little about the care you're looking for, suggest caregivers who may fit, and pass everything to Jill's team so a real person can call you. How can I help today?",
    caregiver:
      "Hello. I'm the Optio Senioris Care Assistant, an AI helper. If you're a caregiver or nurse interested in working with Optio Senioris, I can take a few details and pass them to Jill's team for review. What role are you interested in?",
  },

  business: {
    name: "Optio Senioris",
    tagline: "Care in a crisis, when you can no longer cope.",
    phone: "(941) 468-9932",
    mailingAddress: "P.O. Box 1503, Nokomis, Florida 34274",
    // Jill asked (Oct 22) for the homepage to say Sarasota, Florida; the
    // engagement letter says Central Florida. Until confirmed, use the site.
    locationLine: "Nokomis, Florida",
  },

  // PLACEHOLDER: service area. When zips or cities are filled in, leads are
  // marked in or out of area. Leave empty to mark every lead "unknown".
  serviceArea: {
    description: null,
    cities: [],
    zips: [],
  },

  // Respite and day care wording. PLACEHOLDER until Jill confirms; the site
  // says 6am to 11pm and one hour's notice, her emails say midnight and
  // "from 3 hours". The assistant uses the site wording below.
  respite: {
    stayLength: "stays from 3 to 30 days",
    dropInHours: "6am to 11pm",
    dropInNotice: "as little as one hour's notice",
    confirmed: false,
  },

  // PLACEHOLDER: facilities the assistant may name when routing to facility
  // care, e.g. { name: "Bayshore Guest Home and Gardens", type: "Memory care and assisted living", area: "Nokomis" }.
  facilities: [],

  // PLACEHOLDER: approved hospice partners, same shape as facilities.
  hospicePartners: [],

  // PLACEHOLDER: may families see a matched caregiver's first name? When
  // false they see only the credential and the reasons.
  showCaregiverFirstNames: false,

  // PLACEHOLDER: approved FAQ answers from Jill, as { question, answer }.
  faq: [],

  // PLACEHOLDER: approved pricing wording. While null the assistant never
  // quotes prices.
  pricingWording: null,

  // PLACEHOLDER: intro call booking. url is a scheduling link (Calendly or
  // Google Calendar appointment page). prefill adds ?name=&email= to the link
  // (Calendly supports this). owner is whose calendar it books, for the README.
  booking: {
    url: null,
    prefill: false,
    owner: null,
  },

  // PLACEHOLDER: email. from must be an address on a domain onboarded to
  // Cloudflare Email Sending. notifyTo receives every lead, applicant and
  // escalation. Confirmation emails to visitors stay off until Alec approves
  // the wording.
  email: {
    from: null,
    fromName: "Optio Senioris Care Assistant",
    notifyTo: [],
    confirmation: {
      enabled: false,
      familySubject: null,
      familyText: null,
      caregiverSubject: null,
      caregiverText: null,
    },
  },

  // PLACEHOLDER: privacy policy page and text shown before the chat starts.
  privacy: {
    policyUrl: null,
    notice:
      "This chat is run by an AI assistant, not a person. We ask for a few details about what you're looking for and how to reach you so that a member of Jill's team can follow up. Please don't share medical records, insurance or Medicaid numbers, Social Security numbers or financial details.",
  },

  // PLACEHOLDER: retention period in days for leads, applicants and
  // conversation summaries. Null means keep until deleted in the admin page.
  retentionDays: null,

  // PLACEHOLDER: verify the Florida Abuse Hotline number before launch and
  // set verified to true. While unverified the assistant names the hotline
  // but gives no number.
  floridaAbuseHotline: { number: null, verified: false },

  // Pages the assistant may link to. Paths only; the widget turns these into
  // links and nothing else.
  sitePages: {
    "/services": "All services",
    "/long-term-care": "Long-Term Care",
    "/respite-day-care": "Respite and Drop-In Day Care",
    "/hospice-palliative-care": "Hospice and Palliative Care",
    "/private-duty-home-care": "Private Duty Home Care",
    "/who-we-care-for": "Who We Care For",
    "/funding": "Funding",
    "/medicaid": "Medicaid",
    "/qualified-income-trust": "Qualified Income Trust",
    "/veterans": "Veterans Grants",
    "/long-term-care-insurance": "Long-Term Care Insurance",
    "/careers": "Careers (resume upload)",
    "/contact": "Contact",
  },

  // Reviewed skill and experience tags. The import script and the assistant
  // may only use these. Add a tag here before using it anywhere else.
  skillTags: [
    "dementia",
    "hospice",
    "hoyer_lift",
    "private_duty",
    "rehab",
    "behavioral_health",
    "two_person_assist",
    "diabetes",
    "wound_care",
    "feeding_tube",
    "catheter_care",
    "oxygen",
    "companionship",
  ],

  // Abuse protection. Message and conversation caps, and per-IP and
  // per-session rate limits.
  limits: {
    maxMessageChars: 1000,
    maxUserTurns: 40,
    perIpPerTenMinutes: 40,
    perSessionPerHour: 60,
    newSessionsPerIpPerHour: 20,
    formsPerIpPerHour: 5,
    maxResumeBytes: 5 * 1024 * 1024,
  },
};
