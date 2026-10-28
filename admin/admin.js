// Admin page. Builds every element with textContent, never innerHTML, so
// nothing a visitor typed can run as code here.
(() => {
  const view = document.getElementById("view");
  const status = document.getElementById("status");
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const SLOTS = ["am", "pm", "nights"];
  const LEAD_STATUSES = {
    new: "New",
    contacted: "Contacted",
    intro_call_booked: "Intro call booked",
    placed: "Placed",
    closed: "Closed",
    bereavement: "Bereavement: follow up only on request",
    deceased_do_not_contact: "Deceased: do not contact",
  };
  const APPLICANT_STATUSES = ["new", "reviewing", "interview", "hired", "declined", "withdrawn"];

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin/${path}`, {
      ...options,
      headers: { "X-Admin-Request": "1", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  function say(msg) {
    status.textContent = msg;
  }

  function details(pairs) {
    return el("dl", {}, pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: Array.isArray(v) ? v.join(", ") : String(v) })]));
  }

  function when(s) {
    return s ? new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z")).toLocaleString() : "";
  }

  function select(options, value, label, id) {
    return [
      el("label", { for: id, text: label }),
      el("select", { id }, Object.entries(options).map(([v, t]) => el("option", { value: v, selected: v === value, text: t }))),
    ];
  }

  async function deleteRecord(path, what, reload) {
    if (!confirm(`Delete this ${what} permanently? This cannot be undone.`)) return;
    try {
      await api(path, { method: "DELETE" });
      say(`${what[0].toUpperCase() + what.slice(1)} deleted.`);
      reload();
    } catch (e) {
      say(e.message);
    }
  }

  async function showLeads() {
    const leads = await api("leads");
    view.replaceChildren(
      leads.length ? "" : el("p", { text: "No enquiries yet." }),
      ...leads.map((l) => {
        const idSel = `lead-status-${l.id}`;
        const notes = el("textarea", { id: `lead-notes-${l.id}` });
        notes.value = l.notes || "";
        const schedule = l.schedule || {};
        const quiet = l.status === "bereavement" || l.status === "deceased_do_not_contact";
        return el(
          "article",
          { class: `card${l.urgency === "urgent" || l.escalated ? " flag" : ""}${quiet ? " quiet" : ""}`, id: `lead-${l.id}` },
          el("h2", {}, `${l.contact_name} `, el("span", { class: "pill", text: l.ref }), l.urgency === "urgent" ? el("span", { class: "pill urgent", text: "Urgent" }) : null, quiet ? el("span", { class: "pill", text: LEAD_STATUSES[l.status] }) : null),
          el("p", { class: "muted", text: `${l.source === "chat" ? "Chat" : "Contact form"}, ${when(l.created_at)}` }),
          details([
            ["Phone", l.phone],
            ["Email", l.email],
            ["Best time", l.best_time],
            ["Type", l.visitor_type === "referral_partner" ? `Referral partner${l.organization ? `, ${l.organization}` : ""}${l.organization_role ? ` (${l.organization_role})` : ""}` : null],
            ["Relationship", l.relationship],
            ["Care for", l.care_recipient],
            ["Service", l.service],
            ["Location", l.location ? `${l.location} (in service area: ${l.in_service_area || "unknown"})` : null],
            ["Help needed", l.needs],
            ["Special needs", l.special_needs],
            ["Days", schedule.days],
            ["Times", schedule.times],
            ["Start", schedule.start],
            ["Hours", schedule.hours],
            ["Payment", l.payment],
            ["Summary", l.summary],
            ["Message", l.message],
            ["Contact consent", l.consent ? `Yes (${when(l.consent_at)})` : "No"],
          ]),
          l.match_coverage
            ? el("div", {}, el("strong", { text: `Suggested caregivers (${l.match_coverage} coverage)` }), l.matches?.length ? el("ol", { class: "matches" }, l.matches.map((m) => el("li", { text: `${m.full_name}: ${m.reasons}` }))) : el("p", { text: "No caregiver on the roster covers this request." }))
            : null,
          el("div", { class: "row" }, ...select(LEAD_STATUSES, l.status, "Status", idSel)),
          el("label", { for: `lead-notes-${l.id}`, text: "Notes" }),
          notes,
          el(
            "div",
            { class: "row" },
            el("button", {
              class: "act",
              type: "button",
              text: "Save",
              onclick: async () => {
                try {
                  await api(`leads/${l.id}`, { method: "PATCH", body: JSON.stringify({ status: document.getElementById(idSel).value, notes: notes.value }) });
                  say(`Saved ${l.ref}.`);
                } catch (e) {
                  say(e.message);
                }
              },
            }),
            el("button", { class: "act danger", type: "button", text: "Delete", onclick: () => deleteRecord(`leads/${l.id}`, "enquiry", showLeads) }),
          ),
        );
      }),
    );
  }

  async function showEscalations() {
    const rows = await api("escalations");
    view.replaceChildren(
      rows.length ? "" : el("p", { text: "No flagged chats." }),
      ...rows.map((e) =>
        el(
          "article",
          { class: `card${e.status === "open" && e.urgency === "urgent" ? " flag" : ""}${e.status === "handled" ? " quiet" : ""}`, id: `escalation-${e.id}` },
          el("h2", {}, e.reason.replace(/_/g, " "), e.urgency === "urgent" ? el("span", { class: "pill urgent", text: "Urgent" }) : null, el("span", { class: "pill", text: e.status })),
          el("p", { class: "muted", text: when(e.created_at) }),
          details([
            ["Summary", e.summary],
            ["Enquiry", e.lead_ref ? `${e.lead_ref} (${e.contact_name})` : "No contact details given"],
          ]),
          el("button", {
            class: "act secondary",
            type: "button",
            text: e.status === "open" ? "Mark handled" : "Reopen",
            onclick: async () => {
              try {
                await api(`escalations/${e.id}`, { method: "PATCH", body: JSON.stringify({ status: e.status === "open" ? "handled" : "open" }) });
                showEscalations();
              } catch (err) {
                say(err.message);
              }
            },
          }),
        ),
      ),
    );
  }

  function availabilityText(a) {
    if (!a) return null;
    return DAYS.map((d) => `${d}: ${a[d] === undefined ? "?" : a[d].length ? a[d].join("/") : "no"}`).join("  ");
  }

  async function showApplicants() {
    const rows = await api("applicants");
    view.replaceChildren(
      rows.length ? "" : el("p", { text: "No applicants yet." }),
      ...rows.map((a) => {
        const idSel = `app-status-${a.id}`;
        return el(
          "article",
          { class: "card", id: `applicant-${a.id}` },
          el("h2", {}, `${a.name} `, el("span", { class: "pill", text: a.ref })),
          el("p", { class: "muted", text: `${a.source === "chat" ? "Chat" : "Careers form"}, ${when(a.created_at)}` }),
          details([
            ["Phone", a.phone],
            ["Email", a.email],
            ["Role", a.role],
            ["Credential", a.credential],
            ["License current", a.license_current === null ? null : a.license_current ? "Yes" : "No"],
            ["Experience", a.years_experience === null ? null : `${a.years_experience} years`],
            ["Specialties", a.specialties],
            ["Availability", availabilityText(a.availability && Object.keys(a.availability).length ? a.availability : null)],
            ["Wants PRN", a.prn === null ? null : a.prn ? "Yes" : "No"],
            ["Travel area", a.travel_area],
            ["Summary", a.summary],
            ["Message", a.message],
          ]),
          a.has_resume ? el("p", {}, el("a", { href: `/api/admin/applicants/${a.id}/resume`, text: "Download resume" })) : null,
          el("p", { class: "muted", text: "Applicants are never added to the roster automatically. Add them under Caregiver roster once approved." }),
          el("div", { class: "row" }, ...select(Object.fromEntries(APPLICANT_STATUSES.map((s) => [s, s])), a.status, "Status", idSel)),
          el(
            "div",
            { class: "row" },
            el("button", {
              class: "act",
              type: "button",
              text: "Save",
              onclick: async () => {
                try {
                  await api(`applicants/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: document.getElementById(idSel).value }) });
                  say(`Saved ${a.ref}.`);
                } catch (e) {
                  say(e.message);
                }
              },
            }),
            el("button", { class: "act danger", type: "button", text: "Delete", onclick: () => deleteRecord(`applicants/${a.id}`, "applicant", showApplicants) }),
          ),
        );
      }),
    );
  }

  function caregiverForm(c, meta, onSave) {
    const p = `cg-${c.id ?? "new"}`;
    const field = (name, label, input) => el("div", {}, el("label", { for: `${p}-${name}`, text: label }), " ", input);
    const first = el("input", { type: "text", id: `${p}-first`, value: c.first_name || "", required: true });
    const last = el("input", { type: "text", id: `${p}-last`, value: c.last_name || "" });
    const cred = el("select", { id: `${p}-cred` }, meta.credentials.map((x) => el("option", { value: x, selected: x === c.credential, text: x })));
    const st = el("select", { id: `${p}-status` }, meta.statuses.map((x) => el("option", { value: x, selected: x === (c.status || "hired"), text: x })));
    const years = el("input", { type: "number", id: `${p}-years`, min: 0, max: 70, value: c.years_experience ?? "" });
    const prn = el("input", { type: "checkbox", id: `${p}-prn`, checked: c.prn });
    const bg = el("input", { type: "checkbox", id: `${p}-bg`, checked: c.background_check });
    const avail = c.availability || {};
    const grid = el(
      "table",
      { class: "avail" },
      el("caption", { class: "muted", text: "Availability (ticked = available)" }),
      el("tr", {}, el("th", { text: "" }), DAYS.map((d) => el("th", { scope: "col", text: d }))),
      SLOTS.map((s) => el("tr", {}, el("th", { scope: "row", text: s }), DAYS.map((d) => el("td", {}, el("input", { type: "checkbox", "aria-label": `${d} ${s}`, "data-day": d, "data-slot": s, checked: (avail[d] || []).includes(s) }))))),
    );
    const tagBoxes = el("fieldset", {}, el("legend", { text: "Skills and experience" }), el("div", { class: "tags" }, meta.tags.map((t) => el("label", {}, el("input", { type: "checkbox", value: t, checked: (c.tags || []).includes(t) }), ` ${t.replace(/_/g, " ")}`))));
    return el(
      "div",
      {},
      el("div", { class: "row" }, field("first", "First name", first), field("last", "Last name", last), field("cred", "Credential", cred), field("status", "Status", st), field("years", "Years", years)),
      el("div", { class: "row" }, el("label", {}, prn, " On call (PRN)"), el("label", {}, bg, " Background check done")),
      grid,
      tagBoxes,
      el("button", {
        class: "act",
        type: "button",
        text: c.id ? "Save caregiver" : "Add caregiver",
        onclick: () => {
          const availability = {};
          for (const d of DAYS) availability[d] = [...grid.querySelectorAll(`input[data-day="${d}"]:checked`)].map((i) => i.dataset.slot);
          onSave({
            first_name: first.value,
            last_name: last.value,
            credential: cred.value,
            status: st.value,
            years_experience: years.value === "" ? null : Number(years.value),
            prn: prn.checked,
            background_check: bg.checked,
            availability,
            tags: [...tagBoxes.querySelectorAll("input:checked")].map((i) => i.value),
          });
        },
      }),
    );
  }

  async function showRoster() {
    const meta = await api("roster");
    const save = (path, method) => async (body) => {
      try {
        await api(path, { method, body: JSON.stringify(body) });
        say("Roster saved.");
        showRoster();
      } catch (e) {
        say(e.message);
      }
    };
    view.replaceChildren(
      el("p", { class: "muted", text: "Only caregivers with status hired or prn (approved on-call) are suggested to families. Set a caregiver to inactive to stop matching them." }),
      el("details", { class: "card" }, el("summary", { text: "Add a caregiver" }), caregiverForm({}, meta, save("roster", "POST"))),
      ...meta.caregivers.map((c) =>
        el(
          "details",
          { class: `card${c.status === "inactive" ? " quiet" : ""}` },
          el("summary", {}, `${c.first_name} ${c.last_name} `, el("span", { class: "pill", text: c.credential }), el("span", { class: "pill", text: c.status })),
          caregiverForm(c, meta, save(`roster/${c.id}`, "PATCH")),
        ),
      ),
    );
  }

  const views = { leads: showLeads, escalations: showEscalations, applicants: showApplicants, roster: showRoster };
  async function open(tab) {
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    say("Loading...");
    try {
      await views[tab]();
      say("");
    } catch (e) {
      say(e.message);
    }
  }
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => open(b.dataset.tab));

  api("me").then((m) => (document.getElementById("who").textContent = `Signed in as ${m.email}`)).catch(() => {});
  const hash = location.hash.slice(1);
  const start = hash.startsWith("applicant") ? "applicants" : hash.startsWith("escalation") ? "escalations" : "leads";
  open(start).then(() => hash && document.getElementById(hash)?.scrollIntoView());
})();
