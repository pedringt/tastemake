const searchCache = new Map();
const pendingSearches = new Map();
const CLIENT_CACHE_MS = 5 * 60 * 1000;

// skipBooks: the fast half of an "All" search (TMDb + IGDB answer in under a second; Open Library can
// take several). The search dialog shows it while the full search, books included, is still coming.
export async function searchExternalCatalog(query, domain = "all", { signal, skipBooks = false } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return { items: [], providers: {} };

  const key = `${domain}${skipBooks ? ":skip-read" : ""}:${q.toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CLIENT_CACHE_MS) return cached.value;

  let request = pendingSearches.get(key);
  if (!request) {
    const url = `/api/catalog?q=${encodeURIComponent(q)}&domain=${encodeURIComponent(domain)}${skipBooks ? "&skip=read" : ""}`;
    request = fetch(url, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`catalog search failed: ${response.status}`);
        const payload = await response.json();
        const providers = payload.providers ?? {};
        // Books timed out or failed: say so, and don't keep this answer, so the next search tries again.
        const booksFailed = providers.openlibrary?.configured === true && providers.openlibrary.available === false;
        const value = { items: Array.isArray(payload.items) ? payload.items : [], providers, degraded: Boolean(payload.degraded), booksFailed };
        if (!booksFailed) searchCache.set(key, { at: Date.now(), value });
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

const detailCache = new Map();

// #10: the country for "where to watch", from the browser's language ("en-GB" -> GB). US when unknown.
export function viewerRegion(languages = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])]) {
  for (const tag of languages) {
    const match = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(tag ?? ""));
    if (match) return match[1].toUpperCase();
  }
  return "US";
}

// #103 item 1/2: fetched once per item, only when a user actually expands it (Library/detail view),
// never as part of bulk search or recommendation retrieval. A miss/error resolves to {} so the caller
// can omit fields gracefully instead of showing an empty label.
export async function fetchCatalogItemDetail(item) {
  if (!item?.provider || !item?.providerId) return {};
  const key = `${item.provider}:${item.type ?? ""}:${item.providerId}`;
  if (detailCache.has(key)) return detailCache.get(key);

  const request = (async () => {
    try {
      const url = `/api/catalog-detail?provider=${encodeURIComponent(item.provider)}&providerId=${encodeURIComponent(item.providerId)}&type=${encodeURIComponent(item.type ?? "")}&region=${viewerRegion()}`;
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) return {};
      const payload = await response.json();
      return payload.detail ?? {};
    } catch {
      return {};
    }
  })();

  detailCache.set(key, request);
  return request;
}


export async function resolveCustomCatalogItem(item) {
  if (!item?.custom || item.provider || !item.title || !item.type) return { status: "skipped", item: null };
  const params = new URLSearchParams({
    title: item.title,
    type: item.type,
    ...(item.by ? { creator: item.by } : {})
  });
  try {
    const response = await fetch(`/api/resolve-item?${params.toString()}`, { headers: { accept: "application/json" } });
    if (!response.ok) return { status: "unavailable", item: null };
    const payload = await response.json();
    return {
      status: payload.status ?? "unavailable",
      item: payload.item ?? null,
      degraded: Boolean(payload.degraded)
    };
  } catch {
    return { status: "unavailable", item: null };
  }
}
