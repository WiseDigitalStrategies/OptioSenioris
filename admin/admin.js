// Admin dashboard. Builds every element with textContent, never innerHTML, so
// nothing a visitor typed can run as code here.
(() => {
  const view = document.getElementById("view");
  const main = document.getElementById("main");
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const SLOTS = ["am", "pm", "nights"];
  const SLOT_NAMES = { am: "Morning", pm: "Afternoon", nights: "Night", overnight: "Overnight" };

  const LEAD_STATUSES = {
    new: ["New", "new"],
    contacted: ["Contacted", "warn"],
    intro_call_booked: ["Intro call booked", "warn"],
    placed: ["Placed", "good"],
    closed: ["Closed", ""],
    bereavement: ["Bereavement: follow up only on request", "", "Bereavement"],
    deceased_do_not_contact: ["Deceased: do not contact", "urgent", "Do not contact"],
  };
  const APPLICANT_STATUSES = {
    new: ["New", "new"],
    reviewing: ["Reviewing", "warn"],
    interview: ["Interview", "warn"],
    hired: ["Hired", "good"],
    declined: ["Declined", ""],
    withdrawn: ["Withdrawn", ""],
  };
  const ROSTER_STATUSES = {
    hired: ["Hired", "good"],
    prn: ["On call (PRN)", "good"],
    to_interview: ["To interview", "warn"],
    waitlist: ["Waitlist", "warn"],
    inactive: ["Inactive", ""],
  };
  const REASONS = {
    urgent_placement: "Urgent placement",
    end_of_life: "End of life",
    bereavement: "Bereavement",
    complaint: "Complaint",
    complex_clinical: "Complex clinical needs",
    asked_for_person: "Asked to speak to a person",
    emergency: "Emergency",
    self_harm: "Self-harm risk",
    safeguarding: "Possible abuse or neglect",
    facility_routing: "May need a care facility",
    hospice_routing: "Hospice enquiry",
    no_match: "No caregiver available",
  };
  const LABELS = {
    long_term_care: "Long-term care",
    respite_day_care: "Respite or day care",
    hospice_palliative: "Hospice and palliative care",
    private_duty_home_care: "Private duty home care",
    not_sure: "Not sure yet",
    private_pay: "Private pay",
    ltc_insurance: "Long-term care insurance",
    veterans_benefits: "Veterans benefits",
    medicaid: "Medicaid",
    not_given: "Not given",
    referral_partner: "Referral partner",
    family: "Family",
    medication_reminders: "Medication reminders",
  };
  const human = (v) => (v === null || v === undefined || v === "" ? "" : LABELS[v] ?? String(v).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));

  const data = { leads: [], escalations: [], applicants: [], roster: { caregivers: [], tags: [], credentials: [], statuses: [] } };
  const ui = { leadFilter: "all", leadSearch: "", appFilter: "all", appSearch: "", escFilter: "open", rosterFilter: "active", rosterSearch: "" };

  // ---------- helpers ----------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false && c !== "") node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin/${path}`, {
      ...options,
      headers: { "X-Admin-Request": "1", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
    return body;
  }

  let toastTimer;
  function toast(msg, error = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 3500);
  }

  function parseDate(s) {
    return s ? new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z")) : null;
  }
  function shortDate(s) {
    const d = parseDate(s);
    if (!d) return "";
    const today = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return `Today ${time}`;
    if (d.toDateString() === new Date(today - 864e5).toDateString()) return `Yesterday ${time}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  }
  function longDate(s) {
    const d = parseDate(s);
    return d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  }

  const badge = (map, value) => el("span", { class: `badge ${map[value]?.[1] ?? ""}`, text: map[value]?.[2] ?? map[value]?.[0] ?? human(value) });
  const urgentBadge = () => el("span", { class: "badge urgent", text: "Urgent" });

  function facts(pairs) {
    const shown = pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
    if (!shown.length) return null;
    return el("dl", { class: "facts" }, shown.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { text: Array.isArray(v) ? v.map(human).join(", ") : String(v) }))));
  }
  function block(title, ...content) {
    const inner = content.flat().filter(Boolean);
    return inner.length ? el("section", { class: "block" }, el("h3", { text: title }), inner) : null;
  }
  function pageHead(title, subtitle, ...extra) {
    return el("header", { class: "page-head" }, el("div", {}, el("h1", { text: title }), subtitle ? el("p", { text: subtitle }) : null), extra);
  }
  function chips(options, current, onPick) {
    return el(
      "div",
      { class: "chips", role: "group", "aria-label": "Filter" },
      Object.entries(options).map(([value, label]) => el("button", { type: "button", class: "chip", "aria-pressed": String(value === current), text: label, onclick: () => onPick(value) })),
    );
  }
  function searchBox(value, placeholder, onInput) {
    const input = el("input", { type: "search", class: "search", placeholder, "aria-label": placeholder, value });
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }
  const matchesSearch = (q, ...fields) => !q || fields.some((f) => f && String(f).toLowerCase().includes(q.toLowerCase()));

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  async function loadAll() {
    const [leads, escalations, applicants, roster] = await Promise.all([api("leads"), api("escalations"), api("applicants"), api("roster")]);
    Object.assign(data, { leads, escalations, applicants, roster });
    const set = (key, n) => (document.querySelector(`[data-count="${key}"]`).textContent = n ? String(n) : "");
    set("leads", leads.filter((l) => l.status === "new").length);
    set("escalations", escalations.filter((e) => e.status === "open").length);
    set("applicants", applicants.filter((a) => a.status === "new").length);
  }

  async function deleteRecord(path, what, after) {
    if (!confirm(`Delete this ${what} permanently? This cannot be undone.`)) return;
    try {
      await api(path, { method: "DELETE" });
      toast(`${what[0].toUpperCase() + what.slice(1)} deleted`);
      await loadAll();
      go(after);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------- overview ----------

  function showOverview() {
    const newLeads = data.leads.filter((l) => l.status === "new");
    const open = data.escalations.filter((e) => e.status === "open");
    const urgentOpen = open.filter((e) => e.urgency === "urgent");
    const newApps = data.applicants.filter((a) => a.status === "new");
    const active = data.roster.caregivers.filter((c) => c.status === "hired" || c.status === "prn");
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    const stat = (num, label, hash, alert) => el("a", { class: `card stat${alert ? " alert" : ""}`, href: hash }, el("div", { class: "num", text: String(num) }), el("div", { class: "label", text: label }));

    const attention = [
      ...open.sort((a, b) => (b.urgency === "urgent") - (a.urgency === "urgent")).map((e) => ({
        hash: `#escalation-${e.id}`,
        title: REASONS[e.reason] ?? human(e.reason),
        sub: e.contact_name ? `${e.contact_name} · ${e.summary || ""}` : e.summary || "Flagged chat",
        badge: e.urgency === "urgent" ? urgentBadge() : el("span", { class: "badge open", text: "Flagged" }),
        date: e.created_at,
        urgent: e.urgency === "urgent",
      })),
      ...newLeads.map((l) => ({
        hash: `#lead-${l.id}`,
        title: l.contact_name,
        sub: [human(l.service), l.location].filter(Boolean).join(" · ") || "New enquiry",
        badge: el("span", { class: "badge new", text: "New enquiry" }),
        date: l.created_at,
        urgent: l.urgency === "urgent",
      })),
    ].slice(0, 8);

    const row = (r) => el("li", {}, el("a", { class: "item", href: r.hash }, el("span", { class: `dot${r.urgent ? " on" : ""}`, "aria-hidden": "true" }), el("span", { class: "body" }, el("span", { class: "title", text: r.title }), el("span", { class: "sub", text: r.sub })), el("span", { class: "side-info" }, r.badge, el("span", { class: "date", text: shortDate(r.date) }))));

    view.replaceChildren(
      pageHead(greeting, new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })),
      el(
        "div",
        { class: "stats" },
        stat(newLeads.length, newLeads.length === 1 ? "New enquiry" : "New enquiries", "#enquiries"),
        stat(open.length, urgentOpen.length ? `Flagged chats (${urgentOpen.length} urgent)` : "Flagged chats to review", "#flagged", urgentOpen.length > 0),
        stat(newApps.length, newApps.length === 1 ? "New applicant" : "New applicants", "#applicants"),
        stat(active.length, "Active caregivers", "#caregivers"),
      ),
      el(
        "div",
        { class: "grid-2" },
        el("section", {}, el("h2", { class: "section-title", text: "Needs your attention" }), el("div", { class: "card" }, attention.length ? el("ul", { class: "list" }, attention.map(row)) : el("p", { class: "empty", text: "You're all caught up." }))),
        el(
          "section",
          {},
          el("h2", { class: "section-title", text: "Latest applicants" }),
          el(
            "div",
            { class: "card" },
            data.applicants.length
              ? el("ul", { class: "list" }, data.applicants.slice(0, 5).map((a) => row({ hash: `#applicant-${a.id}`, title: a.name, sub: [a.credential || a.role, a.travel_area].filter(Boolean).join(" · ") || "Applicant", badge: badge(APPLICANT_STATUSES, a.status), date: a.created_at })))
              : el("p", { class: "empty", text: "No applicants yet." }),
          ),
        ),
      ),
    );
  }

  // ---------- split view (enquiries and applicants) ----------

  function splitView({ head, toolbar, items, selectedId, renderItem, renderDetail, emptyText, baseHash }) {
    const selected = items.find((i) => i.id === selectedId) ?? null;
    const list = items.length
      ? el("ul", { class: "list" }, items.map((i) => el("li", {}, renderItem(i, i.id === selectedId))))
      : el("p", { class: "empty", text: emptyText });
    const detail = selected
      ? el("div", { class: "card detail-card detail" }, el("a", { class: "btn light back", href: baseHash, text: "← Back to list" }), renderDetail(selected))
      : el("div", { class: "card detail-card" }, el("p", { class: "empty", text: items.length ? "Select one from the list to see the details." : "" }));
    view.replaceChildren(head, toolbar, el("div", { class: `split${selected ? " showing-detail" : ""}` }, el("div", { class: "card list-card" }, list), detail));
  }

  function listItem(hash, current, { title, sub, badgeEl, date, urgent }) {
    return el(
      "a",
      { class: "item", href: hash, "aria-current": current ? "true" : null },
      el("span", { class: `dot${urgent ? " on" : ""}`, "aria-hidden": "true" }),
      el("span", { class: "body" }, el("span", { class: "title", text: title }), el("span", { class: "sub", text: sub })),
      el("span", { class: "side-info" }, badgeEl, el("span", { class: "date", text: shortDate(date) })),
    );
  }

  // ---------- enquiries ----------

  function showLeads(selectedId) {
    const filters = { all: "All", new: "New", contacted: "Contacted", intro_call_booked: "Intro call booked", placed: "Placed", closed: "Closed", bereavement: "Bereavement" };
    const items = data.leads.filter(
      (l) =>
        (ui.leadFilter === "all" || l.status === ui.leadFilter || (ui.leadFilter === "bereavement" && l.status === "deceased_do_not_contact")) &&
        matchesSearch(ui.leadSearch, l.contact_name, l.ref, l.phone, l.email, l.location),
    );
    const rerender = () => showLeads(selectedId);
    splitView({
      head: pageHead("Enquiries", "Families and referral partners who asked for help, from the chat and the contact form."),
      toolbar: el(
        "div",
        { class: "toolbar" },
        searchBox(ui.leadSearch, "Search name, phone, email or ref", (v) => {
          ui.leadSearch = v;
          rerender();
          view.querySelector(".search").focus();
        }),
        chips(filters, ui.leadFilter, (v) => ((ui.leadFilter = v), rerender())),
      ),
      items,
      selectedId,
      baseHash: "#enquiries",
      emptyText: data.leads.length ? "No enquiries match." : "No enquiries yet. They appear here as soon as someone gets in touch.",
      renderItem: (l, current) =>
        listItem(`#lead-${l.id}`, current, {
          title: l.contact_name,
          sub: [human(l.service), l.location].filter(Boolean).join(" · ") || (l.source === "chat" ? "From the chat" : "From the contact form"),
          badgeEl: badge(LEAD_STATUSES, l.status),
          date: l.created_at,
          urgent: l.urgency === "urgent" || l.escalated,
        }),
      renderDetail: leadDetail,
    });
  }

  function leadDetail(l) {
    const schedule = l.schedule || {};
    const statusSel = el("select", { id: "lead-status" }, Object.entries(LEAD_STATUSES).map(([v, [t]]) => el("option", { value: v, selected: v === l.status, text: t })));
    const notes = el("textarea", { id: "lead-notes", placeholder: "Calls made, next steps, anything the team should know" });
    notes.value = l.notes || "";
    const quiet = l.status === "bereavement" || l.status === "deceased_do_not_contact";
    return el(
      "div",
      {},
      el(
        "div",
        { class: "detail-head" },
        el("div", {}, el("h2", { text: l.contact_name }), el("div", { class: "meta", text: `${l.ref} · ${l.source === "chat" ? "Chat" : "Contact form"} · ${longDate(l.created_at)}` })),
        el(
          "div",
          { class: "quick" },
          l.phone && !quiet ? el("a", { class: "btn", href: `tel:${l.phone.replace(/[^\d+]/g, "")}`, text: `Call ${l.phone}` }) : null,
          l.email && !quiet ? el("a", { class: "btn light", href: `mailto:${l.email}`, text: "Email" }) : null,
        ),
      ),
      l.status === "deceased_do_not_contact" ? el("p", { class: "callout red", text: "The person cared for has died. Do not contact this family." }) : null,
      l.status === "bereavement" ? el("p", { class: "callout", text: "This family is bereaved. Follow up only if they ask." }) : null,
      l.urgency === "urgent" && !quiet ? el("p", { class: "callout red", text: "Marked urgent. Please call as soon as you can." }) : null,
      block(
        "Contact",
        facts([
          ["Phone", l.phone],
          ["Email", l.email],
          ["Best time to call", l.best_time],
          ["Type", l.visitor_type === "referral_partner" ? `Referral partner${l.organization ? `, ${l.organization}` : ""}${l.organization_role ? ` (${l.organization_role})` : ""}` : null],
          ["Relationship", l.relationship],
          ["OK to contact", l.consent ? `Yes, given ${shortDate(l.consent_at)}` : "No"],
        ]),
      ),
      block(
        "Care needed",
        facts([
          ["Care for", l.care_recipient],
          ["Service", human(l.service)],
          ["Location", l.location ? `${l.location}${l.in_service_area && l.in_service_area !== "unknown" ? ` (${l.in_service_area === "yes" ? "in" : "outside"} service area)` : ""}` : null],
          ["Help with", l.needs],
          ["Other needs", l.special_needs],
          ["Payment", human(l.payment)],
        ]),
      ),
      block(
        "Schedule",
        facts([
          ["Days", (schedule.days || []).map((d) => DAY_NAMES[d] ?? d).join(", ")],
          ["Times", (schedule.times || []).map((t) => SLOT_NAMES[t] ?? t).join(", ")],
          ["Start", schedule.start],
          ["Hours", schedule.hours],
        ]),
      ),
      l.summary ? block("Summary", el("p", { class: "note", text: l.summary })) : null,
      l.message ? block("Their message", el("p", { class: "note", text: l.message })) : null,
      l.match_coverage
        ? block(
            `Suggested caregivers · ${l.match_coverage === "full" ? "full cover" : l.match_coverage === "partial" ? "partial cover" : "no cover"}`,
            l.matches?.length
              ? l.matches.map((m, i) => el("div", { class: "match" }, el("span", { class: "n", text: String(i + 1) }), el("div", {}, el("strong", { text: m.full_name }), el("div", { class: "sub", text: m.reasons }))))
              : el("p", { class: "note", text: "No caregiver on the roster covers this request." }),
          )
        : null,
      block("Status and notes", el("div", { class: "form-row" }, el("div", { class: "field" }, el("label", { for: "lead-status", text: "Status" }), statusSel)), el("div", { class: "field" }, el("label", { for: "lead-notes", text: "Notes" }), notes)),
      el(
        "div",
        { class: "actions" },
        el("button", {
          class: "btn",
          type: "button",
          text: "Save changes",
          onclick: async () => {
            try {
              await api(`leads/${l.id}`, { method: "PATCH", body: JSON.stringify({ status: statusSel.value, notes: notes.value }) });
              toast(`Saved ${l.ref}`);
              await loadAll();
              route();
            } catch (e) {
              toast(e.message, true);
            }
          },
        }),
        el("button", { class: "btn danger", type: "button", text: "Delete enquiry", onclick: () => deleteRecord(`leads/${l.id}`, "enquiry", "#enquiries") }),
      ),
    );
  }

  // ---------- flagged chats ----------

  function showEscalations(highlightId) {
    const items = data.escalations.filter((e) => ui.escFilter === "all" || e.status === ui.escFilter).sort((a, b) => (a.status === "open" && b.status === "open" ? (b.urgency === "urgent") - (a.urgency === "urgent") : 0));
    const rerender = () => showEscalations(highlightId);
    view.replaceChildren(
      pageHead("Flagged chats", "Conversations the assistant passed to the team: emergencies, end of life, facility or hospice questions, and families with no caregiver match."),
      el("div", { class: "toolbar" }, chips({ open: "To review", handled: "Handled", all: "All" }, ui.escFilter, (v) => ((ui.escFilter = v), rerender()))),
      items.length
        ? el(
            "div",
            { class: "card" },
            el(
              "ul",
              { class: "list" },
              items.map((e) =>
                el(
                  "li",
                  { id: `escalation-${e.id}`, tabindex: "-1" },
                  el(
                    "div",
                    { class: `item${e.id === highlightId ? " highlight" : ""}` },
                    el("span", { class: `dot${e.urgency === "urgent" && e.status === "open" ? " on" : ""}`, "aria-hidden": "true" }),
                    el(
                      "span",
                      { class: "body" },
                      el("span", { class: "badges" }, el("strong", { text: REASONS[e.reason] ?? human(e.reason) }), e.urgency === "urgent" ? urgentBadge() : null, e.status === "handled" ? el("span", { class: "badge good", text: "Handled" }) : null),
                      el("span", { class: "note esc-summary", text: e.summary || "No summary." }),
                      el(
                        "span",
                        { class: "sub esc-meta" },
                        `${longDate(e.created_at)} · `,
                        e.lead_id ? el("a", { href: `#lead-${e.lead_id}`, text: `Open enquiry ${e.lead_ref} (${e.contact_name})` }) : "No contact details were given",
                      ),
                    ),
                    el("button", {
                      class: `btn ${e.status === "open" ? "" : "light"}`,
                      type: "button",
                      text: e.status === "open" ? "Mark handled" : "Reopen",
                      onclick: async () => {
                        try {
                          await api(`escalations/${e.id}`, { method: "PATCH", body: JSON.stringify({ status: e.status === "open" ? "handled" : "open" }) });
                          toast(e.status === "open" ? "Marked as handled" : "Reopened");
                          await loadAll();
                          rerender();
                        } catch (err) {
                          toast(err.message, true);
                        }
                      },
                    }),
                  ),
                ),
              ),
            ),
          )
        : el("div", { class: "card" }, el("p", { class: "empty", text: ui.escFilter === "open" ? "Nothing to review. You're all caught up." : "No flagged chats here." })),
    );
    if (highlightId) document.getElementById(`escalation-${highlightId}`)?.scrollIntoView({ block: "center" });
  }

  // ---------- applicants ----------

  function availabilityList(a) {
    if (!a || !Object.keys(a).length) return null;
    const days = DAYS.filter((d) => a[d]?.length).map((d) => `${DAY_NAMES[d]}: ${a[d].map((s) => SLOT_NAMES[s] ?? s).join(", ")}`);
    return days.length ? days.join("\n") : "Not available on any day given";
  }

  function showApplicants(selectedId) {
    const filters = { all: "All", ...Object.fromEntries(Object.entries(APPLICANT_STATUSES).map(([k, [t]]) => [k, t])) };
    const items = data.applicants.filter((a) => (ui.appFilter === "all" || a.status === ui.appFilter) && matchesSearch(ui.appSearch, a.name, a.ref, a.phone, a.email, a.credential));
    const rerender = () => showApplicants(selectedId);
    splitView({
      head: pageHead("Applicants", "Caregivers and nurses who want to work with Optio Senioris."),
      toolbar: el(
        "div",
        { class: "toolbar" },
        searchBox(ui.appSearch, "Search name, phone, email or ref", (v) => {
          ui.appSearch = v;
          rerender();
          view.querySelector(".search").focus();
        }),
        chips(filters, ui.appFilter, (v) => ((ui.appFilter = v), rerender())),
      ),
      items,
      selectedId,
      baseHash: "#applicants",
      emptyText: data.applicants.length ? "No applicants match." : "No applicants yet.",
      renderItem: (a, current) => listItem(`#applicant-${a.id}`, current, { title: a.name, sub: [a.credential || a.role, a.travel_area].filter(Boolean).join(" · ") || (a.source === "chat" ? "From the chat" : "From the careers form"), badgeEl: badge(APPLICANT_STATUSES, a.status), date: a.created_at }),
      renderDetail: applicantDetail,
    });
  }

  function applicantDetail(a) {
    const statusSel = el("select", { id: "app-status" }, Object.entries(APPLICANT_STATUSES).map(([v, [t]]) => el("option", { value: v, selected: v === a.status, text: t })));
    return el(
      "div",
      {},
      el(
        "div",
        { class: "detail-head" },
        el("div", {}, el("h2", { text: a.name }), el("div", { class: "meta", text: `${a.ref} · ${a.source === "chat" ? "Chat" : "Careers form"} · ${longDate(a.created_at)}` })),
        el(
          "div",
          { class: "quick" },
          a.phone ? el("a", { class: "btn", href: `tel:${a.phone.replace(/[^\d+]/g, "")}`, text: `Call ${a.phone}` }) : null,
          a.email ? el("a", { class: "btn light", href: `mailto:${a.email}`, text: "Email" }) : null,
          a.has_resume ? el("a", { class: "btn light", href: `/api/admin/applicants/${a.id}/resume`, text: "Download résumé" }) : null,
        ),
      ),
      block("Contact", facts([["Phone", a.phone], ["Email", a.email], ["Travel area", a.travel_area]])),
      block(
        "Experience",
        facts([
          ["Role", a.role],
          ["Credential", a.credential],
          ["License current", a.license_current === null ? null : a.license_current ? "Yes" : "No"],
          ["Experience", a.years_experience === null ? null : `${a.years_experience} years`],
          ["Specialties", a.specialties],
          ["Wants on-call (PRN)", a.prn === null ? null : a.prn ? "Yes" : "No"],
        ]),
      ),
      block("Availability", facts([["When they can work", availabilityList(a.availability)]])),
      a.summary ? block("Summary", el("p", { class: "note", text: a.summary })) : null,
      a.message ? block("Their message", el("p", { class: "note", text: a.message })) : null,
      el("p", { class: "callout", text: "Applicants are never added to the caregiver list automatically. Once approved, add them under Caregivers." }),
      block("Status", el("div", { class: "form-row" }, el("div", { class: "field" }, el("label", { for: "app-status", text: "Status" }), statusSel))),
      el(
        "div",
        { class: "actions" },
        el("button", {
          class: "btn",
          type: "button",
          text: "Save changes",
          onclick: async () => {
            try {
              await api(`applicants/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: statusSel.value }) });
              toast(`Saved ${a.ref}`);
              await loadAll();
              route();
            } catch (e) {
              toast(e.message, true);
            }
          },
        }),
        el("button", { class: "btn danger", type: "button", text: "Delete applicant", onclick: () => deleteRecord(`applicants/${a.id}`, "applicant", "#applicants") }),
      ),
    );
  }

  // ---------- caregivers ----------

  function weekStrip(avail = {}) {
    const label = DAYS.map((d) => `${DAY_NAMES[d]}: ${avail[d]?.length ? avail[d].map((s) => SLOT_NAMES[s]).join(", ") : avail[d] ? "off" : "unknown"}`).join("; ");
    return el("div", { class: "week", role: "img", "aria-label": label, title: label }, DAYS.map((d) => el("span", { class: avail[d]?.length === SLOTS.length ? "on" : avail[d]?.length ? "part" : "" })));
  }

  function showRoster() {
    const meta = data.roster;
    const filters = { active: "Active", all: "All", ...Object.fromEntries(Object.entries(ROSTER_STATUSES).map(([k, [t]]) => [k, t])) };
    const items = meta.caregivers.filter(
      (c) => (ui.rosterFilter === "all" || (ui.rosterFilter === "active" ? c.status === "hired" || c.status === "prn" : c.status === ui.rosterFilter)) && matchesSearch(ui.rosterSearch, `${c.first_name} ${c.last_name}`, c.credential),
    );
    view.replaceChildren(
      pageHead("Caregivers", "Only hired and on-call caregivers are suggested to families.", el("button", { class: "btn", type: "button", text: "+ Add caregiver", onclick: () => openCaregiver({}) })),
      el(
        "div",
        { class: "toolbar" },
        searchBox(ui.rosterSearch, "Search by name or credential", (v) => {
          ui.rosterSearch = v;
          showRoster();
          view.querySelector(".search").focus();
        }),
        chips(filters, ui.rosterFilter, (v) => ((ui.rosterFilter = v), showRoster())),
      ),
      items.length
        ? el(
            "div",
            { class: "card table-card" },
            el(
              "table",
              { class: "roster" },
              el("thead", {}, el("tr", {}, el("th", { text: "Name" }), el("th", { text: "Credential" }), el("th", { text: "Status" }), el("th", { text: "Week (Mon–Sun)" }), el("th", { class: "hide-sm", text: "Skills" }))),
              el(
                "tbody",
                {},
                items.map((c) =>
                  el(
                    "tr",
                    { class: c.status === "inactive" ? "inactive" : null, onclick: (ev) => ev.target.tagName !== "BUTTON" && openCaregiver(c) },
                    el("td", {}, el("button", { type: "button", class: "link-btn", text: `${c.first_name} ${c.last_name || ""}`.trim(), onclick: () => openCaregiver(c) })),
                    el("td", { text: c.credential }),
                    el("td", {}, badge(ROSTER_STATUSES, c.status)),
                    el("td", {}, weekStrip(c.availability)),
                    el("td", { class: "hide-sm sub", text: (c.tags || []).map(human).join(", ") }),
                  ),
                ),
              ),
            ),
          )
        : el("div", { class: "card" }, el("p", { class: "empty", text: meta.caregivers.length ? "No caregivers match." : "No caregivers yet. Add one, or import the staff spreadsheet (see the README)." })),
    );
  }

  function openCaregiver(c) {
    const meta = data.roster;
    const opener = document.activeElement;
    const field = (id, label, input) => el("div", { class: "field" }, el("label", { for: id, text: label }), input);
    const first = el("input", { type: "text", id: "cg-first", value: c.first_name || "", autocomplete: "off" });
    const last = el("input", { type: "text", id: "cg-last", value: c.last_name || "", autocomplete: "off" });
    const cred = el("select", { id: "cg-cred" }, meta.credentials.map((x) => el("option", { value: x, selected: x === c.credential, text: x })));
    const st = el("select", { id: "cg-status" }, meta.statuses.map((x) => el("option", { value: x, selected: x === (c.status || "hired"), text: ROSTER_STATUSES[x]?.[0] ?? human(x) })));
    const years = el("input", { type: "number", id: "cg-years", min: 0, max: 70, value: c.years_experience ?? "" });
    const prn = el("input", { type: "checkbox", id: "cg-prn", checked: Boolean(c.prn) });
    const bg = el("input", { type: "checkbox", id: "cg-bg", checked: Boolean(c.background_check) });
    const avail = c.availability || {};
    const grid = el(
      "table",
      { class: "avail" },
      el("caption", { class: "label avail-caption", text: "When they can work (tap to switch on or off)" }),
      el("tr", {}, el("th", { text: "" }), DAYS.map((d) => el("th", { scope: "col", text: DAY_NAMES[d] }))),
      SLOTS.map((s) => el("tr", {}, el("th", { scope: "row", text: SLOT_NAMES[s] }), DAYS.map((d) => el("td", {}, el("label", {}, el("input", { type: "checkbox", "aria-label": `${DAY_NAMES[d]} ${SLOT_NAMES[s]}`, "data-day": d, "data-slot": s, checked: (avail[d] || []).includes(s) }), el("span", { text: "✓" })))))),
    );
    const tags = el("div", { class: "tag-grid" }, meta.tags.map((t) => el("label", {}, el("input", { type: "checkbox", value: t, checked: (c.tags || []).includes(t) }), human(t))));

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
    const onKey = (e) => e.key === "Escape" && close();
    const save = async () => {
      const availability = {};
      for (const d of DAYS) availability[d] = [...grid.querySelectorAll(`input[data-day="${d}"]:checked`)].map((i) => i.dataset.slot);
      const body = {
        first_name: first.value,
        last_name: last.value,
        credential: cred.value,
        status: st.value,
        years_experience: years.value === "" ? null : Number(years.value),
        prn: prn.checked,
        background_check: bg.checked,
        availability,
        tags: [...tags.querySelectorAll("input:checked")].map((i) => i.value),
      };
      try {
        await api(c.id ? `roster/${c.id}` : "roster", { method: c.id ? "PATCH" : "POST", body: JSON.stringify(body) });
        toast(c.id ? "Caregiver saved" : "Caregiver added");
        close();
        await loadAll();
        showRoster();
      } catch (e) {
        toast(e.message, true);
      }
    };

    const drawer = el(
      "div",
      { class: "drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "cg-title" },
      el("div", { class: "detail-head" }, el("h2", { id: "cg-title", text: c.id ? `${c.first_name} ${c.last_name || ""}`.trim() : "Add a caregiver" }), el("button", { class: "btn light", type: "button", text: "Close", onclick: close })),
      el("div", { class: "form-row" }, field("cg-first", "First name", first), field("cg-last", "Last name", last)),
      el("div", { class: "form-row" }, field("cg-cred", "Credential", cred), field("cg-status", "Status", st), field("cg-years", "Years of experience", years)),
      el("div", { class: "form-row" }, el("label", { class: "check" }, prn, "Available on call (PRN)"), el("label", { class: "check" }, bg, "Background check done")),
      el("section", { class: "block" }, grid),
      el("section", { class: "block" }, el("h3", { text: "Skills and experience" }), tags),
      el("div", { class: "actions" }, el("button", { class: "btn", type: "button", text: c.id ? "Save changes" : "Add caregiver", onclick: save }), el("button", { class: "btn light", type: "button", text: "Cancel", onclick: close })),
    );
    const overlay = el("div", { class: "overlay", onclick: (e) => e.target === overlay && close() }, drawer);
    document.body.append(overlay);
    document.addEventListener("keydown", onKey);
    first.focus();
  }

  // ---------- routing ----------

  function route() {
    const hash = location.hash.slice(1) || "overview";
    const [kind, idText] = hash.split("-");
    const id = idText ? Number(idText) : null;
    const viewName = { overview: "overview", enquiries: "leads", lead: "leads", flagged: "escalations", escalation: "escalations", applicants: "applicants", applicant: "applicants", caregivers: "roster" }[kind] ?? "overview";
    for (const a of document.querySelectorAll(".nav a")) {
      if (a.dataset.view === viewName) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    if (viewName === "leads") showLeads(id);
    else if (viewName === "escalations") showEscalations(id);
    else if (viewName === "applicants") showApplicants(id);
    else if (viewName === "roster") showRoster();
    else showOverview();
  }

  window.addEventListener("hashchange", () => {
    route();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  api("me").then((m) => (document.getElementById("who").textContent = `Signed in as ${m.email}`)).catch(() => {});
  view.replaceChildren(el("p", { class: "loading", text: "Loading..." }));
  loadAll()
    .then(route)
    .catch((e) => view.replaceChildren(el("div", { class: "card" }, el("p", { class: "empty", text: `Couldn't load the dashboard: ${e.message}` }))));
})();
