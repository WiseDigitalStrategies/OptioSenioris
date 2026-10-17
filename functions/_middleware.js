// Send www.optiosenioris.net to the root domain, keeping the path and query.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "www.optiosenioris.net") {
    url.hostname = "optiosenioris.net";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
