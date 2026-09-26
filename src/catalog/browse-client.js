const browseCache = new Map();
const CACHE_MS = 15 * 60 * 1000;

export async function fetchBrowsePage(domain, genre, page = 1, { signal } = {}) {
  const key = `${domain}:${genre}:${page}`;
  const cached = browseCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const url = `/api/browse?domain=${encodeURIComponent(domain)}&genre=${encodeURIComponent(genre)}&page=${encodeURIComponent(page)}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`browse failed: ${response.status}`);
  const payload = await response.json();
  const value = {
    items: Array.isArray(payload.items) ? payload.items : [],
    hasMore: Boolean(payload.hasMore),
    degraded: Boolean(payload.degraded)
  };
  browseCache.set(key, { at: Date.now(), value });
  return value;
}
