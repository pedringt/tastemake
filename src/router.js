export const routes = {
  favorites: "/favorites",
  model: "/taste-profile",
  recommendations: "/recommendations",
  library: "/library",
  bookmarks: "/bookmarks",
  look: "/look"
};

export function screenFromPath(pathname = window.location.pathname) {
  const normalized = pathname.replace(/\/$/, "") || "/";
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
