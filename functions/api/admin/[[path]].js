import config from "../../../config/assistant.config.js";
import { handleAdmin } from "../../../lib/admin.js";

export async function onRequest({ request, env, params }) {
  const path = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  return handleAdmin({ request, env, config, path });
}
