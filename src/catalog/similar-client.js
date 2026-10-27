// Oct 27: "See similar" (api/similar.mjs). Sends only the item's own catalog fields and the ids already
// reacted to, never the person's ratings themselves.
const ITEM_FIELDS = ["id", "provider", "providerId", "type", "title", "domains", "genres", "providerMeta"];

export async function fetchSimilar(item, exclude = [], { signal } = {}) {
  const sent = Object.fromEntries(ITEM_FIELDS.filter((key) => item?.[key] != null).map((key) => [key, item[key]]));
  const response = await fetch("/api/similar", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ item: sent, exclude: exclude.slice(0, 500) }),
    signal
  });
  if (!response.ok) throw new Error(`similar failed: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}
