// Cloudflare Turnstile server-side check. Fails closed when no secret is set.

export async function verifyTurnstile(token, secret, ip) {
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip && ip !== "unknown") body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
