// POST /api/chat: one visitor message in, one assistant reply out.
// The Anthropic API is only ever called from here, with the key from the
// ANTHROPIC_API_KEY secret. The key never reaches the browser or the logs.

import Anthropic from "@anthropic-ai/sdk";
import { buildFacts } from "./facts.js";
import { upsertConversation } from "./db.js";
import { allow, clientIp } from "./ratelimit.js";
import { newSessionId, open, seal } from "./state.js";
import { runTool, toolDefinitions } from "./tools.js";
import { verifyTurnstile } from "./turnstile.js";
import { ValidationError, text } from "./validate.js";

const MAX_TOOL_ROUNDS = 6;
const MAX_BODY_BYTES = 450_000;
// Models that accept server-side refusal fallbacks with fallbacks: "default".
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function chatEnabled(env) {
  return Boolean(env.ANTHROPIC_API_KEY && env.SESSION_SECRET && env.DB);
}

export function publicSettings(env, config) {
  return {
    enabled: chatEnabled(env),
    botName: config.botName,
    greeting: config.greeting,
    notice: config.privacy.notice,
    policyUrl: config.privacy.policyUrl,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    sitePages: Object.keys(config.sitePages),
    phone: config.business.phone,
    maxMessageChars: config.limits.maxMessageChars,
  };
}

function modeNote(state, config) {
  const greeting = config.greeting[state.mode];
  return `# This conversation\nThe visitor opened the chat in ${state.mode} mode, and the website has already shown them this greeting from you: "${greeting}" Do not greet them again. If they turn out to be a ${state.mode === "family" ? "caregiver looking for work" : "family looking for care"}, switch to that intake.`;
}

export async function handleChat({ request, env, config, systemPrompt, client }) {
  const phoneMsg = `Please call us on ${config.business.phone} and a member of our team will help.`;
  const limits = config.limits;
  const ip = clientIp(request);
  const db = env.DB;

  if (!chatEnabled(env)) return json({ error: "unavailable", message: `The chat is not available right now. ${phoneMsg}` }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large", message: "That conversation is too long to continue here. " + phoneMsg }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (!(await allow(db, `ip:${ip}`, limits.perIpPerTenMinutes, 600))) {
    return json({ error: "rate_limited", message: "You're sending messages very quickly. Please wait a few minutes and try again, or " + phoneMsg.toLowerCase() }, 429);
  }

  let message;
  try {
    message = text(body.message, "message", { max: limits.maxMessageChars, required: true });
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: "invalid_message", message: `Please keep messages under ${limits.maxMessageChars} characters.` }, 400);
    throw err;
  }

  let state;
  if (!body.state) {
    const mode = body.mode === "caregiver" ? "caregiver" : "family";
    if (!(await allow(db, `new:${ip}`, limits.newSessionsPerIpPerHour, 3600))) {
      return json({ error: "rate_limited", message: "Too many new conversations from this connection. " + phoneMsg }, 429);
    }
    if (!(await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip))) {
      return json({ error: "verification_failed", message: "We couldn't confirm you're not a bot. Please reload the page and try again, or " + phoneMsg.toLowerCase() }, 403);
    }
    state = { sid: newSessionId(), mode, created: Date.now(), verified: true, turns: 0, messages: [] };
  } else {
    state = await open(body.state, env.SESSION_SECRET);
    if (!state) return json({ error: "session_expired", message: "This conversation has expired. Please start a new one." }, 400);
  }

  if (!(await allow(db, `sid:${state.sid}`, limits.perSessionPerHour, 3600))) {
    return json({ error: "rate_limited", message: "Please wait a little before sending more messages, or " + phoneMsg.toLowerCase() }, 429);
  }
  if (state.turns >= limits.maxUserTurns) {
    return json({ reply: `We've covered a lot in this chat. To keep going, ${phoneMsg.charAt(0).toLowerCase() + phoneMsg.slice(1)}`, actions: [], ended: true, state: body.state });
  }

  const anthropic = client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const model = env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const system = [
    { type: "text", text: systemPrompt },
    { type: "text", text: buildFacts(config), cache_control: { type: "ephemeral" } },
    { type: "text", text: modeNote(state, config) },
  ];
  const tools = toolDefinitions(config);
  const messages = [...state.messages, { role: "user", content: message }];
  const actions = [];
  const debug = [];
  const replies = [];
  const ctx = { env, db, config, state, actions };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const params = {
        model,
        max_tokens: 4000,
        system,
        tools,
        messages,
        output_config: { effort: env.ANTHROPIC_EFFORT || "low" },
        // Caches the conversation so far; each turn and tool round rereads it cheaply.
        cache_control: { type: "ephemeral" },
      };
      if (FALLBACK_MODELS.test(model)) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
      }
      const response = await anthropic.beta.messages.create(params);

      if (response.stop_reason === "refusal") {
        // Drop the declined turn so the conversation can carry on.
        return json({ reply: `I'm not able to help with that here. ${phoneMsg}`, actions: [], state: await seal(state, env.SESSION_SECRET) });
      }

      messages.push({ role: "assistant", content: response.content });
      for (const block of response.content) if (block.type === "text" && block.text.trim()) replies.push(block.text.trim());

      if (response.stop_reason !== "tool_use") break;

      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = await runTool(block.name, block.input, ctx);
        if (env.DEBUG_TOOLS === "1") debug.push({ name: block.name, input: block.input, result });
        const forModel = Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith("_")));
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(forModel), ...(result.error ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (round === MAX_TOOL_ROUNDS - 1) replies.push(`I've passed your details to our team. ${phoneMsg}`);
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error(`anthropic error: HTTP ${err.status ?? "network"}`);
    else console.error(`chat failed: ${err?.name ?? "error"}`);
    return json({ error: "upstream", message: `Sorry, I'm having trouble right now. ${phoneMsg}` }, 503);
  }

  state.messages = messages;
  state.turns += 1;
  if (!state.leadId && !state.applicantId && !state.escalations?.length) {
    await upsertConversation(db, { session_id: state.sid, mode: state.mode, user_turns: state.turns });
  }

  const reply = replies.join("\n\n") || `Thank you. ${phoneMsg}`;
  const out = { reply, actions, state: await seal(state, env.SESSION_SECRET) };
  if (env.DEBUG_TOOLS === "1") out.debug = debug;
  return json(out);
}
