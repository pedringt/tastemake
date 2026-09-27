// #135 foundation: canonical-item normalization + upsert into the Tastemake canonical item store
// (items / item_identifiers / item_field_provenance — schema already provisioned, not created here).
//
// Scope for this PR (see #135 for the full architecture):
//   - normalize an already-normalized provider item (tmdbItem()/openLibraryItem()/igdbItem() shape
//     from src/catalog/providers.mjs) into the canonical items.factual shape for its media type;
//   - upsert items + item_identifiers + item_field_provenance;
//   - compute a simple deterministic items.metadata_completeness score.
//
// Explicitly NOT this PR's job: reading candidates back out of the store (that's the "healthier
// candidate retrieval" half of #135), web enrichment, or writing AI-inferred `traits` — this module
// never touches the `traits` column.
//
// Every exported function takes an injectable `query` function ((text, params) => Promise<rows>),
// following the same pattern as `fetchImpl` elsewhere in this codebase, so tests can run fully
// offline against an in-memory fake instead of a real database.

import { query as defaultQuery, isConfigured } from "../server/db.mjs";

const MEDIA_TYPES = new Set(["movie", "tv", "book", "game"]);

// Fields this PR can actually populate at search/related-candidate time (no per-item detail call
// is made from that path today — detail like director/cast is fetched lazily elsewhere). Listing
// them here, per media type, is what "metadata completeness" is a fraction of.
const EXPECTED_FIELDS = {
  movie: ["year", "genres", "collectionId"],
  tv: ["year", "genres", "collectionId"],
  book: ["year", "author", "subjects"],
  game: ["year", "genres", "franchiseId"]
};

// Normalizes a provider item (from providers.mjs) into { mediaType, canonicalTitle, year, factual,
// fields, completeness }. Returns null for a shape this store does not (yet) understand — callers
// should treat that as "nothing to persist", not an error.
export function normalizeCanonicalItem(item) {
  if (!item || !MEDIA_TYPES.has(item.type)) return null;
  const mediaType = item.type;
  const factual = {};
  const fields = [];

  const setField = (name, value) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    factual[name] = value;
    fields.push(name);
  };

  if (mediaType === "book") {
    setField("author", item.by || null);
    setField("subjects", item.genres ?? []);
  } else if (mediaType === "movie" || mediaType === "tv") {
    setField("genres", item.genres ?? []);
    setField("collectionId", item.providerMeta?.collectionId ?? null);
  } else if (mediaType === "game") {
    setField("genres", item.genres ?? []);
    setField("franchiseId", item.providerMeta?.franchiseId ?? null);
  }
  setField("year", item.year || null);

  const expected = EXPECTED_FIELDS[mediaType] ?? [];
  const completeness = expected.length
    ? Math.round((expected.filter((name) => fields.includes(name)).length / expected.length) * 1000) / 1000
    : null;

  return {
    mediaType,
    canonicalTitle: item.title || null,
    year: item.year || null,
    factual,
    fields,
    completeness
  };
}

// Identity resolution is keyed on (namespacedProvider, providerId). The namespace folds in media
// type — e.g. "tmdb:movie" vs "tmdb:tv" — rather than the raw provider name alone, because TMDb
// issues movie ids and TV ids from separate id spaces that can collide numerically. Without this,
// two unrelated items (a movie and a show that happen to share a numeric TMDb id) could resolve to
// the same canonical item, and "same title in a different media type must stay distinct" (an #135
// acceptance criterion) would silently break the other direction too. This is a population
// convention inside this module, not a schema change.
function identifierNamespace(item, mediaType) {
  return `${item.provider}:${mediaType}`;
}

// Upserts one provider item into the canonical store. Resolves an existing canonical item by
// provider identity when known, otherwise inserts a new one. Never writes `traits`. Returns the
// canonical item id, or null when there is nothing to write (unsupported shape, no provider id, or
// no query function available) — it never throws for those "nothing to do" cases. A real query
// error (DB down, bad SQL) does still throw; callers doing write-behind persistence are expected to
// catch it themselves, exactly as they already do around provider fetches.
export async function upsertCanonicalItem(item, { env = process.env, query: queryImpl } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return null;

  const normalized = normalizeCanonicalItem(item);
  if (!normalized) return null;
  if (!item.provider || !item.providerId) return null;

  const provider = identifierNamespace(item, normalized.mediaType);
  const providerId = String(item.providerId);

  const existing = await runQuery(
    "select item_id from item_identifiers where provider = $1 and provider_id = $2",
    [provider, providerId]
  );
  let itemId = existing?.[0]?.item_id ?? null;

  if (!itemId) {
    const inserted = await runQuery(
      `insert into items (media_type, canonical_title, year, factual, metadata_completeness)
       values ($1, $2, $3, $4::jsonb, $5)
       returning id`,
      [normalized.mediaType, normalized.canonicalTitle, normalized.year, JSON.stringify(normalized.factual), normalized.completeness]
    );
    itemId = inserted?.[0]?.id ?? null;
    if (!itemId) return null;
    await runQuery(
      `insert into item_identifiers (item_id, provider, provider_id)
       values ($1, $2, $3)
       on conflict (provider, provider_id) do nothing`,
      [itemId, provider, providerId]
    );
  } else {
    // Merge factual fields (never overwrite traits — this statement never touches that column) and
    // refresh completeness/title/year from the freshest provider fetch.
    await runQuery(
      `update items
         set canonical_title = $2,
             year = coalesce($3, year),
             factual = factual || $4::jsonb,
             metadata_completeness = $5,
             updated_at = now()
       where id = $1`,
      [itemId, normalized.canonicalTitle, normalized.year, JSON.stringify(normalized.factual), normalized.completeness]
    );
  }

  for (const field of normalized.fields) {
    await runQuery(
      `insert into item_field_provenance (item_id, field_name, source, value_type, retrieved_at)
       values ($1, $2, $3, 'provider_supplied', now())
       on conflict (item_id, field_name) do update
         set source = excluded.source, value_type = excluded.value_type, retrieved_at = now()`,
      [itemId, field, item.provider]
    );
  }

  return itemId;
}

// Fire-and-forget write-behind: canonicalizes each item without ever throwing and without adding
// latency to the caller's response path (nothing here is awaited by callers; failures are logged in
// the same sanitized style used elsewhere and swallowed). A no-op when TASTEMAKE_DATABASE_URL isn't
// configured, so catalog search/recommendations behave identically with or without a database.
export function canonicalizeWriteBehind(items, { env = process.env, query: queryImpl } = {}) {
  if (!queryImpl && !isConfigured(env)) return;
  for (const item of items ?? []) {
    Promise.resolve()
      .then(() => upsertCanonicalItem(item, { env, query: queryImpl }))
      .catch((error) => {
        console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "upsert failed" }));
      });
  }
}
