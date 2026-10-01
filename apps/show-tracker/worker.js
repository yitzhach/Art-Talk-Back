// The tracker's Worker: serves the app's files and forwards /v1/* to
// studio-api through a service binding, so the browser only ever talks to its
// own origin (D-034: the session cookie is SameSite=Lax and the API sends no
// CORS). Everything else is a static file, served by the assets binding.
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/v1/")) return env.API.fetch(request);
    // The bare address opens the ledger (assets run with html_handling "none", see wrangler.jsonc).
    if (pathname === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    return env.ASSETS.fetch(request);
  },
};
