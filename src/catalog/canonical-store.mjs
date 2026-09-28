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
import { waitUntil } from "@vercel/functions";
import { buildItemId } from "./item-id.mjs";

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

// #135 "prefer anchors with richer metadata": a best-effort batch lookup of previously-stored
// metadata_completeness for a set of provider items, used only to prefer richer ANCHORS during
// candidate retrieval (src/catalog/related.mjs) -- it never returns candidates and is not the
// "read candidates from the canonical store" swap that #135 explicitly scopes to later work.
// Injectable/mockable the same way as upsertCanonicalItem/canonicalizeWriteBehind above. Must
// degrade gracefully and add no meaningful latency: unconfigured, empty, slow or erroring all
// resolve to an empty Map rather than throwing, so a caller can always treat "no data" the same
// as "no preference" and never block retrieval on this.
export async function lookupMetadataCompleteness(items, { env = process.env, query: queryImpl, timeoutMs = 250 } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return new Map();

  const identifiers = (items ?? [])
    .filter((entry) => entry?.id && entry?.provider && entry?.providerId && MEDIA_TYPES.has(entry.type))
    .map((entry) => ({ id: entry.id, provider: identifierNamespace(entry, entry.type), providerId: String(entry.providerId) }));
  if (!identifiers.length) return new Map();

  try {
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("metadata-completeness lookup timed out")), timeoutMs))
    ]);
    const rows = await withTimeout(runQuery(
      `select ii.provider, ii.provider_id, i.metadata_completeness
         from item_identifiers ii
         join items i on i.id = ii.item_id
        where (ii.provider, ii.provider_id) in (${identifiers.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ")})`,
      identifiers.flatMap((entry) => [entry.provider, entry.providerId])
    ));
    const result = new Map();
    for (const entry of identifiers) {
      const row = (rows ?? []).find((candidate) => candidate.provider === entry.provider && candidate.provider_id === entry.providerId);
      if (row?.metadata_completeness != null) result.set(entry.id, Number(row.metadata_completeness));
    }
    return result;
  } catch (error) {
    console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "completeness lookup failed" }));
    return new Map();
  }
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

  // Common path first, unchanged: a cheap SELECT against the already-known-item case (the large
  // majority of real calls -- the same popular items get re-upserted on every write-behind pass
  // that encounters them), no speculative row ever created here.
  const existing = await runQuery(
    "select item_id from item_identifiers where provider = $1 and provider_id = $2",
    [provider, providerId]
  );
  let itemId = existing?.[0]?.item_id ?? null;

  if (itemId) {
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
  } else {
    // Real bug (QA sweep, 2026-09-28), fixed here: the SELECT above found nothing, meaning this
    // item is new to us -- but two concurrent write-behind calls for the same not-yet-canonicalized
    // item (e.g. two evidence anchors in one request both surfacing the same new movie) could both
    // reach this exact branch and both INSERT into items, producing two canonical rows for one real
    // item, with the second item_identifiers insert silently no-opping on conflict and permanently
    // orphaning one row. This CTE makes identity resolution atomic from here on: it speculatively
    // inserts a candidate items row, but only ONE concurrent caller's item_identifiers insert can
    // win the (provider, provider_id) unique constraint -- the loser's own new row is simply never
    // referenced by any identifier (an orphan row, wasted storage, not a correctness bug), and
    // coalesce() always resolves to the single winning item_id, so both callers converge on the same
    // canonical item. Deliberately only reached in this "not found yet" branch, not on every
    // re-upsert of an already-known item, so the common path stays exactly as cheap as before.
    // NOT YET VERIFIED against a real Postgres database (no TASTEMAKE_DATABASE_URL in this sandbox)
    // -- covered by an updated fake-DB offline test, but this needs a real-DB check before being
    // trusted, per this session's own standing rule for infra changes.
    const resolved = await runQuery(
      `with new_item as (
         insert into items (media_type, canonical_title, year, factual, metadata_completeness)
         values ($1, $2, $3, $4::jsonb, $5)
         returning id
       ), ident as (
         insert into item_identifiers (item_id, provider, provider_id)
         select id, $6, $7 from new_item
         on conflict (provider, provider_id) do nothing
         returning item_id
       )
       select
         coalesce(
           (select item_id from ident),
           (select item_id from item_identifiers where provider = $6 and provider_id = $7)
         ) as item_id,
         (select item_id from ident) is not null as is_new`,
      [normalized.mediaType, normalized.canonicalTitle, normalized.year, JSON.stringify(normalized.factual), normalized.completeness, provider, providerId]
    );
    itemId = resolved?.[0]?.item_id ?? null;
    if (!itemId) return null;

    // Lost the race: another concurrent caller's insert won identity resolution first. Our own
    // values are still real/freshly-fetched data, so merge them into the winning row the same way
    // the common re-upsert path above does, rather than discarding them.
    if (!resolved[0].is_new) {
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

const FIELD_BY_MEDIA_TYPE = { book: "subjects", movie: "genres", tv: "genres", game: "genres" };
const DOMAIN_BY_MEDIA_TYPE = { movie: ["movies"], tv: ["tv"], book: ["read"], game: ["play"] };


// #144: expands a related-candidate pool with items Tastemake has already canonicalized (from any
// past search/related call, not just this one), matched by genre/subject overlap with the anchor.
// Same injectable-query pattern as lookupMetadataCompleteness/upsertCanonicalItem above -- degrades
// to an empty array (never throws) on missing config, no useful anchor genres/subjects, a query
// error, or a timeout, so a store outage or thin anchor never breaks the live-provider retrieval
// path this only ever augments.
export async function relatedCanonicalItems(anchor, subjects, { env = process.env, query: queryImpl, timeoutMs = 250 } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return [];

  const mediaType = anchor?.type;
  if (!mediaType || !MEDIA_TYPES.has(mediaType)) return [];
  const field = FIELD_BY_MEDIA_TYPE[mediaType];
  const values = [...new Set((subjects ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!values.length) return [];

  const anchorProvider = anchor.provider ? identifierNamespace(anchor, mediaType) : null;
  const anchorProviderId = anchor.providerId != null ? String(anchor.providerId) : null;

  try {
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("related canonical items lookup timed out")), timeoutMs))
    ]);
    const rows = await withTimeout(runQuery(
      `select i.canonical_title, i.year, i.factual, ii.provider, ii.provider_id
         from items i
         join item_identifiers ii on ii.item_id = i.id
        where i.media_type = $1
          and i.factual -> $2 ?| $3::text[]`,
      [mediaType, field, values]
    ));

    const seen = new Set();
    const results = [];
    for (const row of rows ?? []) {
      if (row.provider === anchorProvider && row.provider_id === anchorProviderId) continue;
      const provider = row.provider?.split(":")[0] ?? null;
      const id = buildItemId(provider, mediaType, row.provider_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const matched = row.factual?.[field] ?? [];
      results.push({
        id,
        provider,
        providerId: row.provider_id,
        title: row.canonical_title,
        type: mediaType,
        domains: DOMAIN_BY_MEDIA_TYPE[mediaType] ?? [],
        year: row.year,
        by: row.factual?.author ?? null,
        genres: matched,
        subject: matched,
        fromCanonicalStore: true
      });
    }
    return results;
  } catch (error) {
    console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "related lookup failed" }));
    return [];
  }
}

// Fire-and-forget write-behind: canonicalizes each item without ever throwing and without adding
// latency to the caller's response path (nothing here is awaited by callers; failures are logged in
// the same sanitized style used elsewhere and swallowed). A no-op when TASTEMAKE_DATABASE_URL isn't
// configured, so catalog search/recommendations behave identically with or without a database.
//
// Verified live on production after the first version of this shipped: zero rows had actually
// landed in Neon despite real requests succeeding. Root cause -- a Vercel serverless function's
// execution environment can be frozen the instant its HTTP response is sent; an un-awaited promise
// has no guarantee of ever resuming after that point. `waitUntil` (already a dependency via
// @vercel/functions, used elsewhere for the runtime cache) is exactly Vercel's API for extending a
// function's lifetime for background work like this. Outside an actual Vercel request context (this
// sandbox, local scripts, the test suite) it safely no-ops rather than throwing, so nothing here
// needed to change for tests.
// QA sweep efficiency finding (Paige's call, 2026-09-28): full cross-item query batching (a single
// multi-row insert/update covering the whole write-behind batch) was considered but not done here --
// it would require reshaping upsertCanonicalItem's contract (currently directly tested and just
// fixed for a real race condition), and can't be verified against a real Postgres database from this
// sandbox. Deduping the batch first is the safe slice of the same fix: the same real item commonly
// appears twice in one write-behind call (e.g. related to two different anchors in the same
// request), which previously fired two fully independent upserts -- each internally safe after the
// race-condition fix, but still double the real work for one real item. Keyed on the same provider
// identity upsertCanonicalItem itself resolves by, so this never changes which items get written,
// only how many times the identical (provider, providerId) is processed in one batch.
export function canonicalizeWriteBehind(items, { env = process.env, query: queryImpl } = {}) {
  if (!queryImpl && !isConfigured(env)) return;
  const seen = new Set();
  for (const item of items ?? []) {
    const key = item?.provider && item?.providerId != null ? `${item.provider}::${item.providerId}` : null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const task = Promise.resolve()
      .then(() => upsertCanonicalItem(item, { env, query: queryImpl }))
      .catch((error) => {
        console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "upsert failed" }));
      });
    waitUntil(task);
  }
}
