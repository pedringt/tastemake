export const routes = {
  favorites: "/favorites",
  model: "/taste-profile",
  recommendations: "/recommendations",
  library: "/library",
  look: "/look",
  setup: "/setup",
  mine: "/my-tastemake"
};

// #94: Library absorbed the old separate "Try Next" screen as its Saved tab. Old links/bookmarks to
// /try-next or /bookmarks still land on Library (Saved is the default view there anyway), so nothing
// that was bookmarked externally breaks.
const LEGACY_SAVED_PATHS = new Set(["/bookmarks", "/try-next"]);

export function screenFromPath(pathname = window.location.pathname) {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (normalized === "/") return "look";
  if (LEGACY_SAVED_PATHS.has(normalized)) return "library";
  const entry = Object.entries(routes).find(([, path]) => path === normalized);
  return entry ? entry[0] : "favorites";
}

export function pathForScreen(screen) {
  return routes[screen] || routes.favorites;
}

export function writeRoute(screen, { replace = false } = {}) {
  const path = pathForScreen(screen);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ screen }, "", path);
}
