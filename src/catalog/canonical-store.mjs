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
  movie: ["year", "genres", "collectionId", "director", "cast", "runtime"],
  tv: ["year", "genres", "creator", "cast", "yearsRun"],
  book: ["year", "author", "subjects", "seriesKey", "isbns", "description"],
  game: ["year", "genres", "franchiseId", "developer", "publisher", "platforms"]
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
    setField("seriesKey", item.providerMeta?.seriesKey ?? item.seriesKey ?? null);
    setField("isbns", item.providerMeta?.isbns ?? item.isbns ?? []);
    setField("description", item.description ?? null);
  } else if (mediaType === "movie") {
    setField("genres", item.genres ?? []);
    setField("collectionId", item.providerMeta?.collectionId ?? null);
    setField("director", item.director ?? null);
    setField("cast", item.cast ?? null);
    setField("runtime", item.runtime ?? null);
  } else if (mediaType === "tv") {
    setField("genres", item.genres ?? []);
    setField("creator", item.creator ?? null);
    setField("cast", item.cast ?? null);
    setField("yearsRun", item.yearsRun ?? null);
  } else if (mediaType === "game") {
    setField("genres", item.genres ?? []);
    setField("franchiseId", item.providerMeta?.franchiseId ?? null);
    setField("developer", item.developer ?? null);
    setField("publisher", item.publisher ?? null);
    setField("platforms", item.platforms ?? null);
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

function stableIdentifiers(item, normalized) {
  const identifiers = [{
    provider: identifierNamespace(item, normalized.mediaType),
    providerId: String(item.providerId)
  }];
  if (normalized.mediaType === "book") {
    for (const isbn of normalized.factual.isbns ?? []) {
      const value = String(isbn ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
      if (value.length === 10 || value.length === 13) identifiers.push({ provider: "isbn:book", providerId: value });
    }
  }
  const seen = new Set();
  return identifiers.filter((entry) => {
    const key = `${entry.provider}::${entry.providerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// #135 lazy enrichment: merge provider-backed detail facts into an existing canonical item
// without requiring the caller to send the whole display item again. This is used by on-demand
// detail fetches and background anchor enrichment. It never creates an identity from partial data;
// if the provider identity is not yet canonicalized, the caller's normal write-behind path will do
// that separately. Traits are never touched.
export async function mergeCanonicalFacts(item, facts, { env = process.env, query: queryImpl, source } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return false;
  if (!item?.provider || !item?.providerId || !MEDIA_TYPES.has(item.type)) return false;

  const cleanFacts = {};
  for (const [field, value] of Object.entries(facts ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleanFacts[field] = value;
  }
  const fields = Object.keys(cleanFacts);
  if (!fields.length) return false;

  const provider = identifierNamespace(item, item.type);
  const providerId = String(item.providerId);
  const rows = await runQuery(
    `select ii.item_id, i.factual
       from item_identifiers ii
       join items i on i.id = ii.item_id
      where ii.provider = $1 and ii.provider_id = $2
      limit 1`,
    [provider, providerId]
  );
  const itemId = rows?.[0]?.item_id;
  if (!itemId) return false;

  const mergedFactual = { ...(rows?.[0]?.factual ?? {}), ...cleanFacts };
  const expected = EXPECTED_FIELDS[item.type] ?? [];
  const completeness = expected.length
    ? Math.round((expected.filter((name) => {
        const value = mergedFactual[name];
        return value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
      }).length / expected.length) * 1000) / 1000
    : null;

  await runQuery(
    `update items
        set factual = factual || $2::jsonb,
            metadata_completeness = $3,
            updated_at = now()
      where id = $1`,
    [itemId, JSON.stringify(cleanFacts), completeness]
  );

  const provenanceSource = source || item.provider;
  await Promise.all(fields.map((field) => runQuery(
    `insert into item_field_provenance (item_id, field_name, source, value_type, retrieved_at)
     values ($1, $2, $3, 'provider_supplied', now())
     on conflict (item_id, field_name) do update
       set source = excluded.source, value_type = excluded.value_type, retrieved_at = now()`,
    [itemId, field, provenanceSource]
  )));
  return true;
}

// #135 "prefer anchors with richer metadata": a best-effort batch lookup of previously-stored
// metadata_completeness for a set of provider items, used only to prefer richer ANCHORS during
// candidate retrieval (src/catalog/related.mjs) -- it never returns candidates and is not the
// "read candidates from the canonical store" swap that #135 explicitly scopes to later work.
// Injectable/mockable the same way as upsertCanonicalItem/canonicalizeWriteBehind above. Must
// degrade gracefully and add no meaningful latency: unconfigured, empty, slow or erroring all
// resolve to an empty Map rather than throwing, so a caller can always treat "no data" the same
// as "no preference" and never block retrieval on this.
export async function lookupCanonicalAnchorMetadata(items, { env = process.env, query: queryImpl, timeoutMs = 250 } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return new Map();

  const identifiers = (items ?? [])
    .filter((entry) => entry?.id && entry?.provider && entry?.providerId && MEDIA_TYPES.has(entry.type))
    .map((entry) => ({ id: entry.id, provider: identifierNamespace(entry, entry.type), providerId: String(entry.providerId) }));
  if (!identifiers.length) return new Map();

  try {
    const rows = await Promise.race([
      runQuery(
        `select ii.provider, ii.provider_id, i.metadata_completeness, i.factual
           from item_identifiers ii
           join items i on i.id = ii.item_id
          where (ii.provider, ii.provider_id) in (${identifiers.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ")})`,
        identifiers.flatMap((entry) => [entry.provider, entry.providerId])
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("canonical anchor metadata lookup timed out")), timeoutMs))
    ]);
    const result = new Map();
    for (const entry of identifiers) {
      const row = (rows ?? []).find((candidate) => candidate.provider === entry.provider && candidate.provider_id === entry.providerId);
      if (!row) continue;
      result.set(entry.id, {
        completeness: row.metadata_completeness == null ? null : Number(row.metadata_completeness),
        factual: row.factual ?? {}
      });
    }
    return result;
  } catch (error) {
    console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "anchor metadata lookup failed" }));
    return new Map();
  }
}

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

  const identities = stableIdentifiers(item, normalized);
  const provider = identities[0].provider;
  const providerId = identities[0].providerId;

  // Resolve against every stable identity we know. This lets a second source attach to an existing
  // book through a shared ISBN without title matching or AI inference.
  const identityRows = await runQuery(
    `select provider, provider_id, item_id
       from item_identifiers
      where (provider, provider_id) in (${identities.map((_, index) => `(${index * 2 + 1}, ${index * 2 + 2})`).join(", ")})`,
    identities.flatMap((entry) => [entry.provider, entry.providerId])
  );
  const resolvedIds = [...new Set((identityRows ?? []).map((row) => row.item_id).filter(Boolean))];
  if (resolvedIds.length > 1) {
    console.info("[tastemake-canonical]", JSON.stringify({ error: "identity conflict", provider, providerId }));
    return null;
  }
  let itemId = resolvedIds[0] ?? null;

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
    // Verified against the real Neon database (2026-09-28): real concurrent write-behind traffic
    // produces exactly the orphan-row pattern this comment predicts (multiple items rows created in
    // the same millisecond with no item_identifiers row pointing to them -- the losing side of a real
    // race), while item_identifiers itself never has more than one row per (provider, provider_id).
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

  // Attach any additional stable aliases (currently ISBNs for books) to the resolved canonical item.
  // ON CONFLICT is intentionally non-destructive: if an alias is already owned by another item we do
  // not silently re-point it; the next read will surface that as an identity conflict instead.
  for (const identity of identities) {
    await runQuery(
      `insert into item_identifiers (item_id, provider, provider_id)
       values ($1, $2, $3)
       on conflict (provider, provider_id) do nothing`,
      [itemId, identity.provider, identity.providerId]
    );
  }

  // QA sweep finding: each field's provenance row is independent (a distinct (item_id, field_name)
  // key, idempotent via ON CONFLICT) with no ordering dependency between iterations, so awaiting them
  // one at a time inside this write-behind task (which runs inside a waitUntil-extended lifetime
  // Vercel bills/caps) just adds round trips for nothing. Not a correctness bug, just needless
  // serialization -- fired in parallel instead.
  await Promise.all(normalized.fields.map((field) => runQuery(
    `insert into item_field_provenance (item_id, field_name, source, value_type, retrieved_at)
     values ($1, $2, $3, 'provider_supplied', now())
     on conflict (item_id, field_name) do update
       set source = excluded.source, value_type = excluded.value_type, retrieved_at = now()`,
    [itemId, field, item.provider]
  )));

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
export async function relatedCanonicalItems(anchor, subjects, { env = process.env, query: queryImpl, timeoutMs = 750 } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return [];

  const mediaType = anchor?.type;
  if (!mediaType || !MEDIA_TYPES.has(mediaType)) return [];
  const field = FIELD_BY_MEDIA_TYPE[mediaType];
  const values = [...new Set((subjects ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!values.length) return [];

  const anchorProvider = anchor.provider ? identifierNamespace(anchor, mediaType) : null;
  const anchorProviderId = anchor.providerId != null ? String(anchor.providerId) : null;
  const startedAt = Date.now();

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
          and i.factual -> $2 ?| $3::text[]
        order by i.metadata_completeness desc nulls last, i.updated_at desc
        limit 60`,
      [mediaType, field, values]
    ));

    const seen = new Set();
    const results = [];
    for (const row of rows ?? []) {
      if (row.provider === anchorProvider && row.provider_id === anchorProviderId) continue;
      const provider = row.provider?.split(":")[0] ?? null;
      if (!["tmdb", "openlibrary", "igdb"].includes(provider)) continue;
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
        factual: row.factual ?? {},
        fromCanonicalStore: true
      });
    }
    return results;
  } catch (error) {
    console.info("[tastemake-canonical]", JSON.stringify({
      operation: "related-read",
      ms: Date.now() - startedAt,
      timeoutMs,
      error: error?.message || "related lookup failed"
    }));
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
// QA sweep efficiency finding (Paige's call, 2026-09-28): a batch of up to ~20 related-candidate
// items used to call upsertCanonicalItem once per item -- each doing its own identity SELECT, its
// own UPDATE or atomic-insert CTE, and its own per-field provenance INSERTs -- up to ~100+ sequential
// DB round trips for one write-behind fan-out. Real-DB verification (2026-09-28, against the real
// isolated Neon project): a tuple-IN batched lookup (`where (provider, provider_id) in (...)`) works
// exactly as the existing lookupMetadataCompleteness already relies on. The multi-row UPDATE-via-VALUES
// and provenance-INSERT-via-VALUES below are standard Postgres idioms but were NOT live-tested against
// the real database (a direct write test was correctly refused as a shared-resource mutation outside
// this code's own tested path) -- covered by an extended offline fake-DB test instead. Verify these
// specifically against real traffic before fully trusting them, same discipline as the CTE fix above.
//
// Identity resolution for genuinely NEW items still runs one at a time via the same atomic CTE
// upsertCanonicalItem uses (correctness-critical, already real-DB verified) -- only the already-known
// lookup, the already-known UPDATE, and the field-provenance writes are batched across the whole call.
export async function upsertManyCanonicalItems(items, { env = process.env, query: queryImpl } = {}) {
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  if (!queryImpl && !isConfigured(env)) return [];

  const entries = [];
  const seen = new Set();
  for (const item of items ?? []) {
    const normalized = normalizeCanonicalItem(item);
    if (!normalized || !item.provider || !item.providerId) continue;
    const provider = identifierNamespace(item, normalized.mediaType);
    const providerId = String(item.providerId);
    const key = `${provider}::${providerId}`;
    if (seen.has(key)) continue; // same real item related to two different anchors in one batch
    seen.add(key);
    entries.push({ item, normalized, provider, providerId, key });
  }
  if (!entries.length) return [];

  // 1. One batched lookup for the whole batch instead of one SELECT per item.
  const existingRows = await runQuery(
    `select ii.provider, ii.provider_id, ii.item_id
       from item_identifiers ii
      where (ii.provider, ii.provider_id) in (${entries.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`,
    entries.flatMap((e) => [e.provider, e.providerId])
  );
  const itemIdByKey = new Map((existingRows ?? []).map((r) => [`${r.provider}::${r.provider_id}`, r.item_id]));

  const known = entries.filter((e) => itemIdByKey.has(e.key));
  const unknown = entries.filter((e) => !itemIdByKey.has(e.key));

  // 2. One batched UPDATE for every already-known item -- no race concern here (identity is already
  // resolved), just different fresh values per row.
  if (known.length) {
    const valuesSql = known.map((_, i) => `($${i * 5 + 1}::uuid, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::jsonb, $${i * 5 + 5}::real)`).join(", ");
    await runQuery(
      `update items as i
          set canonical_title = v.canonical_title,
              year = coalesce(v.year, i.year),
              factual = i.factual || v.factual,
              metadata_completeness = v.completeness,
              updated_at = now()
         from (values ${valuesSql}) as v(id, canonical_title, year, factual, completeness)
        where i.id = v.id`,
      known.flatMap((e) => [itemIdByKey.get(e.key), e.normalized.canonicalTitle, e.normalized.year, JSON.stringify(e.normalized.factual), e.normalized.completeness])
    );
  }

  // 3. Genuinely new items: same atomic CTE as upsertCanonicalItem, per item (real-DB verified).
  for (const entry of unknown) {
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
      [entry.normalized.mediaType, entry.normalized.canonicalTitle, entry.normalized.year, JSON.stringify(entry.normalized.factual), entry.normalized.completeness, entry.provider, entry.providerId]
    );
    const row = resolved?.[0];
    if (!row?.item_id) continue;
    itemIdByKey.set(entry.key, row.item_id);
    if (!row.is_new) {
      await runQuery(
        `update items
            set canonical_title = $2, year = coalesce($3, year), factual = factual || $4::jsonb,
                metadata_completeness = $5, updated_at = now()
          where id = $1`,
        [row.item_id, entry.normalized.canonicalTitle, entry.normalized.year, JSON.stringify(entry.normalized.factual), entry.normalized.completeness]
      );
    }
  }

  // 4. One batched multi-row insert for every field-provenance row across the whole batch (up to
  // ~4 fields x ~20 items = ~80 individual inserts before this, collapsed to one query).
  const provenanceRows = [];
  for (const entry of entries) {
    const itemId = itemIdByKey.get(entry.key);
    if (!itemId) continue;
    for (const field of entry.normalized.fields) provenanceRows.push([itemId, field, entry.item.provider]);
  }
  if (provenanceRows.length) {
    const valuesSql = provenanceRows.map((_, i) => `($${i * 3 + 1}::uuid, $${i * 3 + 2}, $${i * 3 + 3}, 'provider_supplied', now())`).join(", ");
    await runQuery(
      `insert into item_field_provenance (item_id, field_name, source, value_type, retrieved_at)
       values ${valuesSql}
       on conflict (item_id, field_name) do update
         set source = excluded.source, value_type = excluded.value_type, retrieved_at = now()`,
      provenanceRows.flat()
    );
  }

  return (items ?? []).map((item) => {
    const normalized = normalizeCanonicalItem(item);
    if (!normalized || !item.provider || !item.providerId) return null;
    const provider = identifierNamespace(item, normalized.mediaType);
    const key = `${provider}::${String(item.providerId)}`;
    return itemIdByKey.get(key) ?? null;
  });
}

export function canonicalizeWriteBehind(items, { env = process.env, query: queryImpl } = {}) {
  if (!queryImpl && !isConfigured(env)) return;
  const task = Promise.resolve()
    .then(() => upsertManyCanonicalItems(items, { env, query: queryImpl }))
    .catch((error) => {
      console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "batch upsert failed" }));
    });
  waitUntil(task);
}
