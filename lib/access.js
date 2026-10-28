// Verifies the Cloudflare Access login token on admin requests, so the admin
// API is protected even if the Access policy were misconfigured. Fails closed
// when ACCESS_TEAM_DOMAIN or ACCESS_AUD is not set.

let certCache = { url: null, keys: null, fetched: 0 };

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function signingKeys(teamUrl) {
  if (certCache.url === teamUrl && Date.now() - certCache.fetched < 3600_000) return certCache.keys;
  const res = await fetch(`${teamUrl}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("could not fetch Access certs");
  const { keys } = await res.json();
  certCache = { url: teamUrl, keys, fetched: Date.now() };
  return keys;
}

function tokenFrom(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  return cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? null;
}

// Returns the signed-in email, or null.
export async function accessUser(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = tokenFrom(request);
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (header.alg !== "RS256") return null;
    const teamUrl = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    const jwk = (await signingKeys(teamUrl)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now() / 1000);
    if (!aud.includes(env.ACCESS_AUD) || payload.iss !== teamUrl || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60)) return null;
    return payload.email || payload.sub || "unknown";
  } catch {
    return null;
  }
}
