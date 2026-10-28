import config from "../../../config/assistant.config.js";
import { handleContactForm } from "../../../lib/forms.js";

export async function onRequestPost({ request, env }) {
  return handleContactForm({ request, env, config });
}
