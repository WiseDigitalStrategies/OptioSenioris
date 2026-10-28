#!/usr/bin/env node
// Runs the acceptance conversations against a deployed staging site with the
// real model, plus the key-leak and flood checks.
//
//   STAGING_URL=https://staging.optiosenioris.pages.dev node tests/conversations/run-conversations.mjs
//   add a scenario name fragment as an argument to run just that one
//
// Staging uses Cloudflare's always-pass Turnstile test keys, so any token works.
// Each full run makes roughly 30 model calls.

import scenarios from "./scenarios.mjs";

const BASE = (process.env.STAGING_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("Set STAGING_URL to the staging site, e.g. https://staging.optiosenioris.pages.dev");
  process.exit(1);
}
if (/^https:\/\/(www\.)?optiosenioris\.net/.test(BASE)) {
  console.error("Refusing to run against production. Use the staging URL.");
  process.exit(1);
}

const filter = process.argv[2]?.toLowerCase();
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{10,}/;
let failures = 0;

async function post(body) {
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (KEY_PATTERN.test(text)) throw new Error("API key pattern found in a chat response");
  return { status: res.status, data: JSON.parse(text) };
}

async function runScenario(s) {
  const replies = [];
  const calls = [];
  let state = null;
  for (const message of s.turns) {
    const { status, data } = await post({ mode: s.mode, message, state, turnstileToken: state ? undefined : "XXXX.DUMMY.TOKEN.XXXX" });
    if (status !== 200) throw new Error(`HTTP ${status}: ${data.message || data.error}`);
    if (!data.debug) throw new Error("no debug output: is DEBUG_TOOLS=1 set on staging?");
    replies.push(data.reply);
    calls.push(...data.debug);
    state = data.state;
  }
  const e = s.expect;
  const problems = [];
  for (const re of e.firstReply ?? []) if (!re.test(replies[0])) problems.push(`first reply does not match ${re}`);
  for (const re of e.anyReply ?? []) if (!replies.some((r) => re.test(r))) problems.push(`no reply matches ${re}`);
  for (const re of e.neverReply ?? []) for (const r of replies) if (re.test(r)) problems.push(`a reply matches forbidden ${re}`);
  const used = new Set(calls.map((c) => c.name));
  for (const t of e.tools ?? []) if (!used.has(t)) problems.push(`tool ${t} was not called`);
  for (const t of e.noTools ?? []) if (used.has(t)) problems.push(`tool ${t} should not have been called`);
  for (const c of calls) if (c.result?.error) problems.push(`tool ${c.name} returned an error: ${c.result.error}`);
  const extra = e.check?.(calls, replies);
  if (extra) problems.push(extra);
  return { replies, calls, problems };
}

for (const s of scenarios) {
  if (filter && !s.name.toLowerCase().includes(filter)) continue;
  process.stdout.write(`- ${s.name} ... `);
  try {
    const r = await runScenario(s);
    if (r.problems.length) {
      failures++;
      console.log("FAIL");
      for (const p of r.problems) console.log(`    ${p}`);
      r.replies.forEach((t, i) => console.log(`    reply ${i + 1}: ${t.replace(/\n/g, " ")}`));
      console.log(`    tools: ${r.calls.map((c) => c.name).join(", ") || "none"}`);
    } else console.log("ok");
  } catch (err) {
    failures++;
    console.log(`ERROR ${err.message}`);
  }
}

if (!filter) {
  process.stdout.write("- API key never appears in pages or settings ... ");
  const pages = await Promise.all(["/", "/contact", "/careers", "/js/chat-widget.js", "/api/chat"].map((p) => fetch(BASE + p).then((r) => r.text())));
  if (pages.some((p) => KEY_PATTERN.test(p))) {
    failures++;
    console.log("FAIL");
  } else console.log("ok");

  process.stdout.write("- A flood of new conversations is blocked ... ");
  const statuses = await Promise.all(Array.from({ length: 60 }, () => post({ mode: "family", message: "hi", turnstileToken: "" }).then((r) => r.status)));
  const ok = statuses.filter((s) => s === 200).length;
  if (ok === 0 && statuses.includes(429)) console.log(`ok (${statuses.filter((s) => s === 429).length} rate limited, ${statuses.filter((s) => s === 403).length} failed Turnstile)`);
  else {
    failures++;
    console.log(`FAIL (statuses: ${[...new Set(statuses)].join(", ")})`);
  }
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
