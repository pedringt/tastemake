export async function searchExternalCatalog(query, domain = "all", { signal } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return { items: [], providers: {} };
  const url = `/api/catalog?q=${encodeURIComponent(q)}&domain=${encodeURIComponent(domain)}`;
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`catalog search failed: ${response.status}`);
  const payload = await response.json();
  return { items: Array.isArray(payload.items) ? payload.items : [], providers: payload.providers ?? {}, degraded: Boolean(payload.degraded) };
}
