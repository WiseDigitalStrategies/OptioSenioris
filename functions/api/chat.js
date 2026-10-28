import config from "../../config/assistant.config.js";
import systemPrompt from "../../prompts/system-prompt.txt";
import { handleChat, json, publicSettings } from "../../lib/chat.js";

// GET: settings the widget needs (no secrets). POST: one chat turn.
export async function onRequestGet({ env }) {
  return json(publicSettings(env, config));
}

export async function onRequestPost({ request, env }) {
  return handleChat({ request, env, config, systemPrompt });
}
