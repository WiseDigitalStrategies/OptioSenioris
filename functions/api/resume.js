import config from "../../config/assistant.config.js";
import { handleChatResume } from "../../lib/forms.js";

// POST: a resume attached in the chat (multipart: state + resume).
export async function onRequestPost({ request, env }) {
  return handleChatResume({ request, env, config });
}
