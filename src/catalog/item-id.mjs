// The one place the provider-item id convention is defined. Both providers.mjs (building ids for
// live-fetched items) and canonical-store.mjs (reconstructing the same ids for store-sourced items,
// so a `.id` equality check is what dedupes a store candidate against a live-provider one) need this
// -- deliberately its own tiny module with no other dependencies, since providers.mjs already imports
// canonical-store.mjs (for canonicalizeWriteBehind) and canonical-store.mjs importing back from
// providers.mjs would be a real circular import (confirmed elsewhere in this codebase to actually
// break at runtime with a "Cannot access before initialization" error under some import orderings,
// not just a style concern).
export function buildItemId(provider, mediaType, providerId) {
  if (provider === "openlibrary") return `openlibrary-book-${String(providerId).replace(/[^A-Za-z0-9_-]/g, "")}`;
  if (provider === "tmdb") return `tmdb-${mediaType}-${providerId}`;
  if (provider === "igdb") return `igdb-game-${providerId}`;
  return null;
}
