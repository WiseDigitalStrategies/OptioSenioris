import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { handleChat, publicSettings } from "../lib/chat.js";
import { open, seal } from "../lib/state.js";
import { TEST_SECRET, seedRoster, testConfig, testDb } from "./helpers.js";

const API_KEY = "sk-ant-test-key-that-must-never-leak";
let db, config, env, turnstileOk, calls;

beforeEach(async () => {
  db = testDb();
  await seedRoster(db);
  config = testConfig();
  env = { DB: db, ANTHROPIC_API_KEY: API_KEY, SESSION_SECRET: TEST_SECRET, TURNSTILE_SECRET_KEY: "ts-secret", ANTHROPIC_MODEL: "claude-sonnet-5-5" };
  turnstileOk = true;
  calls = [];
  globalThis.fetch = async (url) => {
    if (String(url).includes("turnstile")) return new Response(JSON.stringify({ success: turnstileOk }));
    return new Response("{}");
  };
});

// A scripted stand-in for the Anthropic client.
function fakeClient(responses) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          const next = responses.shift();
          return typeof next === "function" ? next(params) : next;
        },
      },
    },
  };
}

const text = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

function post(body, ip = "203.0.113.5") {
  return new Request("https://example.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
}

async function chat(body, responses, ip) {
  const res = await handleChat({ request: post(body, ip), env, config, systemPrompt: "SYSTEM PROMPT", client: fakeClient(responses) });
  return { res, data: await res.json() };
}

test("a new conversation needs a passing Turnstile token", async () => {
  turnstileOk = false;
  const { res, data } = await chat({ mode: "family", message: "hi", turnstileToken: "bad" }, [text("hello")]);
  assert.equal(res.status, 403);
  assert.equal(data.error, "verification_failed");
  assert.equal(calls.length, 0, "the model is never called");
});

test("Turnstile fails closed when no secret is configured", async () => {
  delete env.TURNSTILE_SECRET_KEY;
  const { res } = await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [text("hello")]);
  assert.equal(res.status, 403);
});

test("a turn returns a reply and a signed state that carries the conversation", async () => {
  const first = await chat({ mode: "family", message: "I need help for my mother", turnstileToken: "tok" }, [text("I'm sorry to hear that. Where does she live?")]);
  assert.equal(first.res.status, 200);
  assert.match(first.data.reply, /Where does she live/);
  const state = await open(first.data.state, TEST_SECRET);
  assert.equal(state.verified, true);
  assert.equal(state.messages.length, 2);

  const second = await chat({ message: "Venice", state: first.data.state }, [text("Thank you.")]);
  assert.equal(second.res.status, 200);
  assert.equal(calls[1].messages.length, 3);
  assert.equal(calls[1].messages[2].content, "Venice");
});

test("model settings: env model, effort, strict tools, cached facts, refusal fallbacks", async () => {
  env.ANTHROPIC_EFFORT = "low";
  await chat({ mode: "caregiver", message: "hi", turnstileToken: "tok" }, [text("hello")]);
  const p = calls[0];
  assert.equal(p.model, "claude-sonnet-5-5");
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.system[0].text, "SYSTEM PROMPT");
  assert.deepEqual(p.system[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(p.cache_control, { type: "ephemeral" });
  assert.match(p.system[2].text, /caregiver mode/);
  assert.equal(p.tools.length, 5);
  assert.equal(p.thinking, undefined);
});

test("models without server-side fallback get no fallbacks parameter", async () => {
  env.ANTHROPIC_MODEL = "claude-haiku-5-5";
  await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [text("hello")]);
  assert.equal(calls[0].fallbacks, undefined);
});

test("tool calls run on the server and their results go back to the model", async () => {
  const toolTurn = {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu_1", name: "search_caregivers", input: { service: "private_duty_home_care", min_credential: "CNA", skills: ["dementia"], days: ["mon", "tue", "wed", "thu", "fri"], times: ["am"], start_date: "", hours: "", preferred_caregiver: "", preferred_skills: [] } }],
  };
  const { data } = await chat({ mode: "family", message: "weekday mornings, dementia", turnstileToken: "tok" }, [toolTurn, text("I found some options.")]);
  assert.equal(data.reply, "I found some options.");
  const results = calls[1].messages.at(-1).content;
  assert.equal(results[0].type, "tool_result");
  assert.equal(results[0].tool_use_id, "tu_1");
  const parsed = JSON.parse(results[0].content);
  assert.equal(parsed.coverage, "full");
  assert.ok(!results[0].content.includes("_email"));
  assert.equal(data.debug, undefined, "debug output is off unless DEBUG_TOOLS=1");
});

test("a refusal gives a safe reply and drops the declined turn", async () => {
  const { data } = await chat({ mode: "family", message: "something", turnstileToken: "tok" }, [{ stop_reason: "refusal", content: [] }]);
  assert.match(data.reply, /not able to help/);
  const state = await open(data.state, TEST_SECRET);
  assert.equal(state.messages.length, 0);
});

test("the API key never appears in any response", async () => {
  const responses = [
    await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [text("hello")]),
    await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [() => { throw new Error(`boom ${API_KEY}`); }]),
  ];
  for (const { data } of responses) assert.ok(!JSON.stringify(data).includes(API_KEY));
  assert.ok(!JSON.stringify(publicSettings(env, config)).includes(API_KEY));
});

test("tampered or expired state is rejected", async () => {
  const { data } = await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [text("hello")]);
  const [payload, sig] = data.state.split(".");
  const tampered = `${payload.slice(0, -2)}AA.${sig}`;
  const bad = await chat({ message: "hi", state: tampered }, [text("x")]);
  assert.equal(bad.res.status, 400);
  const old = await seal({ sid: "x", mode: "family", created: Date.now() - 25 * 3600_000, verified: true, turns: 0, messages: [] }, TEST_SECRET);
  assert.equal((await chat({ message: "hi", state: old }, [text("x")])).res.status, 400);
});

test("long messages are refused before reaching the model", async () => {
  const { res } = await chat({ mode: "family", message: "x".repeat(config.limits.maxMessageChars + 1), turnstileToken: "tok" }, [text("x")]);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("a flood of requests from one IP is rate limited", async () => {
  const statuses = [];
  for (let i = 0; i < config.limits.perIpPerTenMinutes + 5; i++) {
    const { res } = await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, [text("hello")], "198.51.100.9");
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429));
  assert.ok(calls.length <= config.limits.newSessionsPerIpPerHour, "new conversations per IP are capped too");
});

test("the conversation cap ends the chat politely", async () => {
  const full = await seal({ sid: "cap", mode: "family", created: Date.now(), verified: true, turns: config.limits.maxUserTurns, messages: [] }, TEST_SECRET);
  const { data } = await chat({ message: "one more", state: full }, [text("x")]);
  assert.equal(data.ended, true);
  assert.equal(calls.length, 0);
});

test("the chat reports itself disabled when secrets are missing", async () => {
  delete env.ANTHROPIC_API_KEY;
  assert.equal(publicSettings(env, config).enabled, false);
  const { res } = await chat({ mode: "family", message: "hi", turnstileToken: "tok" }, []);
  assert.equal(res.status, 503);
});
