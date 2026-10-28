import config from "../../../config/assistant.config.js";
import { handleCareersForm } from "../../../lib/forms.js";

export async function onRequestPost({ request, env }) {
  return handleCareersForm({ request, env, config });
}
