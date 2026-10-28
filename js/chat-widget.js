// Optio Senioris care assistant widget. No framework, no build step, no
// analytics. Loaded with one script tag on every page. If the assistant is
// not available, it does nothing and every button keeps its normal link.
(() => {
  "use strict";

  const API = "/api/chat";
  const STORE = "osc-chat";
  const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  let settings = null;
  let mode = "family";
  let opener = null;
  let busy = false;
  let turnstileToken = null;
  let turnstileWidget = null;
  // { mode, state, log: [{who, text, actions}] }
  let convo = load();

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(STORE)) || null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      if (convo) sessionStorage.setItem(STORE, JSON.stringify(convo));
      else sessionStorage.removeItem(STORE);
    } catch {}
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  // Plain text with only known site paths turned into links.
  function renderText(text) {
    const frag = document.createDocumentFragment();
    const paths = (settings?.sitePages || []).slice().sort((a, b) => b.length - a.length);
    if (!paths.length) {
      frag.append(text);
      return frag;
    }
    const escaped = paths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(?:https?://(?:www\\.)?optiosenioris\\.net)?(${escaped.join("|")})(?![\\w-])`, "g");
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index));
      frag.append(el("a", { href: m[1], text: m[0] }));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  // ---------- DOM ----------
  const launcher = el(
    "button",
    { type: "button", class: "osc-launcher", "aria-haspopup": "dialog", hidden: true },
    svgIcon(),
    el("span", { text: "Chat with us" }),
  );
  const title = el("h2", { id: "osc-title" });
  const subtitle = el("p", { text: "AI assistant. A real person follows up." });
  const closeBtn = el("button", { type: "button", class: "osc-close", "aria-label": "Close chat", text: "×" });
  const body = el("div", { class: "osc-body" });
  const log = el("ol", { class: "osc-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const input = el("textarea", { id: "osc-input", rows: 1, autocomplete: "off" });
  const sendBtn = el("button", { type: "submit", class: "osc-btn", text: "Send" });
  const form = el(
    "form",
    { class: "osc-form", hidden: true },
    el("label", { for: "osc-input", class: "osc-sr", text: "Your message" }),
    input,
    sendBtn,
  );
  const panel = el(
    "div",
    { class: "osc-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "osc-title", hidden: true },
    el("div", { class: "osc-head" }, el("div", {}, title, subtitle), closeBtn),
    body,
    form,
  );

  function svgIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 6v2h2V9H7zm4 0v2h2V9h-2zm4 0v2h2V9h-2z");
    svg.append(path);
    return svg;
  }

  // ---------- Views ----------
  function showIntro() {
    title.textContent = settings.botName;
    form.hidden = true;
    const other = mode === "family" ? "caregiver" : "family";
    const startBtn = el("button", { type: "button", class: "osc-btn", text: "Start chat", disabled: true });
    const tsBox = el("div", { class: "osc-turnstile" });
    const policy = settings.policyUrl ? el("a", { href: settings.policyUrl, text: "Read our privacy policy" }) : null;
    body.replaceChildren(
      el(
        "div",
        { class: "osc-intro" },
        el("p", { text: mode === "family" ? "Looking for care for someone you love? I can help you get started." : "Interested in working with Optio Senioris? I can take your details for Jill's team." }),
        el("p", { class: "osc-small", text: settings.notice }),
        policy ? el("p", { class: "osc-small" }, policy) : null,
        el("p", { class: "osc-small", text: "By starting the chat you agree that we may use what you tell us to follow up with you. You can also call us on " + settings.phone + "." }),
        el("p", { class: "osc-small" }, el("button", {
          type: "button",
          class: "osc-switch",
          text: other === "caregiver" ? "I'm a caregiver looking for work" : "I'm looking for care",
          onclick: () => {
            mode = other;
            showIntro();
          },
        })),
        tsBox,
        startBtn,
      ),
    );
    startBtn.addEventListener("click", () => startChat());
    turnstileToken = null;
    renderTurnstile(tsBox, () => (startBtn.disabled = false));
    startBtn.focus();
  }

  function renderTurnstile(box, onReady) {
    if (turnstileWidget !== null && window.turnstile) {
      try {
        window.turnstile.remove(turnstileWidget);
      } catch {}
      turnstileWidget = null;
    }
    if (!settings.turnstileSiteKey) {
      box.append(el("p", { class: "osc-small", text: "The chat can't start right now. Please call us on " + settings.phone + "." }));
      return;
    }
    loadTurnstile().then(
      () => {
        turnstileWidget = window.turnstile.render(box, {
          sitekey: settings.turnstileSiteKey,
          action: "chat",
          callback: (t) => {
            turnstileToken = t;
            onReady();
          },
          "expired-callback": () => (turnstileToken = null),
        });
      },
      () => box.append(el("p", { class: "osc-small", text: "We couldn't load the security check. Please reload the page, or call us on " + settings.phone + "." })),
    );
  }

  let turnstilePromise = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    turnstilePromise ??= new Promise((resolve, reject) => {
      const s = el("script", { src: TURNSTILE_SRC, async: true });
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    return turnstilePromise;
  }

  function startChat() {
    if (!turnstileToken) return;
    convo = { mode, state: null, log: [{ who: "bot", text: settings.greeting[mode] }] };
    save();
    showConversation();
  }

  function showConversation() {
    title.textContent = settings.botName;
    body.replaceChildren(log);
    log.replaceChildren(...convo.log.map(renderEntry));
    form.hidden = false;
    input.maxLength = settings.maxMessageChars;
    input.focus();
    scrollDown();
  }

  function renderEntry(entry) {
    const who = { bot: "osc-msg--bot", me: "osc-msg--me", note: "osc-msg--note" }[entry.who];
    const label = { bot: `${settings.botName} said:`, me: "You said:", note: "" }[entry.who];
    const li = el("li", { class: `osc-msg ${who}` }, label ? el("span", { class: "osc-sr", text: label + " " }) : null, el("p", {}, renderText(entry.text)));
    if (entry.actions?.length) {
      li.append(
        el(
          "div",
          { class: "osc-actions" },
          entry.actions
            .filter((a) => a.type === "link" && /^https:\/\//.test(a.url))
            .map((a) => el("a", { class: "osc-btn", href: a.url, target: "_blank", rel: "noopener noreferrer", text: a.label })),
        ),
      );
    }
    return li;
  }

  function addEntry(entry) {
    convo.log.push(entry);
    save();
    log.append(renderEntry(entry));
    scrollDown();
  }

  function scrollDown() {
    body.scrollTop = body.scrollHeight;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    sendBtn.disabled = true;
    addEntry({ who: "me", text });
    input.value = "";
    const typing = el("li", { class: "osc-msg osc-msg--note osc-typing", text: "The assistant is typing..." });
    log.append(typing);
    scrollDown();
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: convo.mode, message: text, state: convo.state, turnstileToken: convo.state ? undefined : turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (res.ok) {
        convo.state = data.state;
        addEntry({ who: "bot", text: data.reply, actions: data.actions });
        if (data.ended) form.hidden = true;
      } else if (data.error === "session_expired" || data.error === "verification_failed" || data.error === "too_large") {
        addEntry({ who: "note", text: data.message });
        restartOffer();
      } else {
        addEntry({ who: "note", text: data.message || `Something went wrong. Please call us on ${settings.phone}.` });
      }
    } catch {
      typing.remove();
      addEntry({ who: "note", text: `We couldn't reach the assistant. Please check your connection, or call us on ${settings.phone}.` });
    } finally {
      busy = false;
      sendBtn.disabled = false;
      if (!form.hidden) input.focus();
    }
  }

  function restartOffer() {
    form.hidden = true;
    convo = null;
    save();
    log.append(el("li", { class: "osc-msg osc-msg--note" }, el("button", { type: "button", class: "osc-btn", text: "Start a new chat", onclick: () => showIntro() })));
  }

  // ---------- Open and close ----------
  function openPanel(requestedMode, from) {
    opener = from || document.activeElement;
    panel.hidden = false;
    launcher.hidden = true;
    if (convo) {
      mode = convo.mode;
      showConversation();
    } else {
      mode = requestedMode || mode;
      showIntro();
    }
  }

  function closePanel() {
    panel.hidden = true;
    launcher.hidden = false;
    if (turnstileWidget !== null && window.turnstile && !convo) {
      window.turnstile.remove(turnstileWidget);
      turnstileWidget = null;
    }
    (opener && document.contains(opener) ? opener : launcher).focus();
  }

  // The site's enquiry and careers buttons open the chat in the right mode.
  function modeFor(link) {
    if (link.dataset.chatMode) return link.dataset.chatMode;
    const href = link.getAttribute("href") || "";
    if (!link.classList.contains("btn")) return null;
    if (/(^|\/)contact(\.html)?([?#]|$)/.test(href) || href === "#enquiry") return "family";
    if (/(^|\/)careers(\.html)?([?#]|$)/.test(href) && !/(^|\/)careers(\.html)?$/.test(location.pathname)) return "caregiver";
    return null;
  }

  function wire() {
    launcher.addEventListener("click", () => openPanel(document.body.dataset.chatMode || (/(^|\/)careers/.test(location.pathname) ? "caregiver" : "family"), launcher));
    closeBtn.addEventListener("click", closePanel);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      send(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(input.value);
      }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    document.addEventListener("click", (e) => {
      const link = e.target.closest && e.target.closest("a[href]");
      if (!link || panel.contains(link) || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const m = modeFor(link);
      if (!m) return;
      e.preventDefault();
      openPanel(m, link);
    });
  }

  async function init() {
    try {
      const res = await fetch(API, { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      settings = await res.json();
    } catch {
      return;
    }
    if (!settings.enabled) return;
    const css = el("link", { rel: "stylesheet", href: "/css/chat-widget.css" });
    document.head.append(css);
    document.body.append(launcher, panel);
    launcher.hidden = false;
    wire();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
