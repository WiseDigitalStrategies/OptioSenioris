import { accessUser } from "../lib/access.js";

// Send www.optiosenioris.net to the root domain, keeping the path and query.
// Keep the admin page itself behind a valid Cloudflare Access login too.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.hostname === "www.optiosenioris.net") {
    url.hostname = "optiosenioris.net";
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    if (!(await accessUser(request, env))) {
      return new Response("Sign in through Cloudflare Access to use the admin page.", { status: 403, headers: { "Content-Type": "text/plain" } });
    }
    const res = await next();
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex");
    headers.set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(res.body, { status: res.status, headers });
  }
  return next();
}
