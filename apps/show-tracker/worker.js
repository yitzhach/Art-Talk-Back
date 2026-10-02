// The Show Tracker's Worker: static files from tracker/, and the studio API
// on the same origin (D-039). Nothing else happens here.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/')) return env.API.fetch(request);
    if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    return env.ASSETS.fetch(request);
  }
};
