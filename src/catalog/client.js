const searchCache = new Map();
const pendingSearches = new Map();
const CLIENT_CACHE_MS = 5 * 60 * 1000;

export async function searchExternalCatalog(query, domain = "all", { signal } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return { items: [], providers: {} };

  const key = `${domain}:${q.toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CLIENT_CACHE_MS) return cached.value;

  let request = pendingSearches.get(key);
  if (!request) {
    const url = `/api/catalog?q=${encodeURIComponent(q)}&domain=${encodeURIComponent(domain)}`;
    request = fetch(url, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`catalog search failed: ${response.status}`);
        const payload = await response.json();
        const value = { items: Array.isArray(payload.items) ? payload.items : [], providers: payload.providers ?? {}, degraded: Boolean(payload.degraded) };
        searchCache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => pendingSearches.delete(key));
    pendingSearches.set(key, request);
  }

  if (!signal) return request;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return Promise.race([
    request,
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
  ]);
}
