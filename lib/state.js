// The working conversation lives in the visitor's browser, signed with
// SESSION_SECRET so it cannot be altered. The server keeps only a short
// summary per conversation, never the transcript.

const MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_STATE_BYTES = 400_000;

const encoder = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function seal(state, secret) {
  const payload = toBase64Url(encoder.encode(JSON.stringify(state)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload)));
  return `${payload}.${toBase64Url(sig)}`;
}

// Returns the state, or null if the token is missing, altered, too big or expired.
export async function open(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > MAX_STATE_BYTES) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await key(secret), fromBase64Url(sig), encoder.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  const state = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  if (!state.created || now - state.created > MAX_AGE_SECONDS * 1000) return null;
  return state;
}

export function newSessionId() {
  return crypto.randomUUID();
}

export function stateTooLarge(token) {
  return token.length > MAX_STATE_BYTES;
}
