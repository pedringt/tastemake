#!/usr/bin/env node
// #135 foundation: DB client mocking, canonical-item normalization/upsert, and graceful
// degradation when TASTEMAKE_DATABASE_URL isn't configured. Free, no network, no real database —
// everything here runs against an injected in-memory query function.
//
//   node scripts/qa/canonical-store-tests.mjs

import {
  normalizeCanonicalItem,
  upsertCanonicalItem,
  canonicalizeWriteBehind
} from "../../src/catalog/canonical-store.mjs";
import { isConfigured, query } from "../../src/server/db.mjs";
import { tmdbItem, openLibraryItem, igdbItem } from "../../src/catalog/providers.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// ---- fixtures --------------------------------------------------------------------------------

const dune = tmdbItem({
  id: 438631, title: "Dune", overview: "A duke's son...", release_date: "2021-10-22",
  poster_path: "/x.jpg", genre_ids: [878, 12], belongs_to_collection: { id: 726871 }
}, "movie");

const dunePart2 = tmdbItem({
  id: 693134, title: "Dune: Part Two", overview: "...", release_date: "2024-03-01",
  poster_path: "/y.jpg", genre_ids: [878, 12], belongs_to_collection: { id: 726871 }
}, "movie");

const severance = tmdbItem({
  id: 438631, name: "Severance", overview: "A show...", first_air_date: "2022-02-18",
  poster_path: null, genre_ids: [18]
}, "tv"); // same numeric provider id as `dune`, on purpose, to test cross-media-type distinctness

const wayOfKings = openLibraryItem({
  key: "/works/OL262758W", title: "The Way of Kings", author_name: ["Brandon Sanderson"],
  first_publish_year: 2010, cover_i: 1, subject: ["Epic fantasy fiction", "Magic"]
});

const hades = igdbItem({
  id: 113112, name: "Hades", summary: "A roguelike...", first_release_date: 1600000000,
  url: "https://igdb.com/hades", cover: { image_id: "abc" },
  genres: [{ id: 5, name: "Shooter" }], franchises: [{ id: 42 }]
});

// ---- in-memory fake query function -----------------------------------------------------------
// Simulates the three provisioned tables (items / item_identifiers / item_field_provenance) well
// enough to exercise upsertCanonicalItem's real logic, without touching a real database.

function makeFakeDb() {
  const items = new Map(); // id -> row
  const identifiers = new Map(); // `${provider}::${providerId}` -> item_id
  const provenance = new Map(); // `${item_id}::${field_name}` -> row
  let nextId = 1;

  const query = async (text, params = []) => {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.startsWith("select item_id from item_identifiers where provider = $1 and provider_id = $2")) {
      const [provider, providerId] = params;
      const itemId = identifiers.get(`${provider}::${providerId}`);
      return itemId ? [{ item_id: itemId }] : [];
    }
    // Simulates the atomic "resolve identity" CTE in upsertCanonicalItem's not-found branch: always
    // creates a speculative items row, then only actually claims the (provider, provider_id)
    // identifier if nobody else already holds it -- an unclaimed speculative row is simply left as
    // an orphan (matching real Postgres's ON CONFLICT DO NOTHING semantics), never returned.
    if (sql.startsWith("with new_item as (")) {
      const [mediaType, canonicalTitle, year, factualJson, completeness, provider, providerId] = params;
      const id = String(nextId++);
      items.set(id, { id, media_type: mediaType, canonical_title: canonicalTitle, year, factual: JSON.parse(factualJson), metadata_completeness: completeness, traits: {} });
      const key = `${provider}::${providerId}`;
      if (identifiers.has(key)) return [{ item_id: identifiers.get(key), is_new: false }];
      identifiers.set(key, id);
      return [{ item_id: id, is_new: true }];
    }
    if (sql.startsWith("insert into items")) {
      const [mediaType, canonicalTitle, year, factualJson, completeness] = params;
      const id = String(nextId++);
      items.set(id, { id, media_type: mediaType, canonical_title: canonicalTitle, year, factual: JSON.parse(factualJson), metadata_completeness: completeness, traits: {} });
      return [{ id }];
    }
    if (sql.startsWith("insert into item_identifiers")) {
      const [itemId, provider, providerId] = params;
      identifiers.set(`${provider}::${providerId}`, itemId);
      return [];
    }
    if (sql.startsWith("update items")) {
      const [itemId, canonicalTitle, year, factualJson, completeness] = params;
      const row = items.get(itemId);
      row.canonical_title = canonicalTitle;
      row.year = year ?? row.year;
      row.factual = { ...row.factual, ...JSON.parse(factualJson) };
      row.metadata_completeness = completeness;
      return [];
    }
    if (sql.startsWith("insert into item_field_provenance")) {
      const [itemId, fieldName, source] = params;
      provenance.set(`${itemId}::${fieldName}`, { item_id: itemId, field_name: fieldName, source, value_type: "provider_supplied" });
      return [];
    }
    throw new Error(`unhandled fake query: ${sql}`);
  };

  return { query, items, identifiers, provenance };
}

// ---- normalizeCanonicalItem --------------------------------------------------------------------

const normalizedBook = normalizeCanonicalItem(wayOfKings);
check("book normalizes to media type book", normalizedBook.mediaType === "book");
check("book factual carries author", normalizedBook.factual.author === "Brandon Sanderson");
check("book factual carries subjects, not genres", Array.isArray(normalizedBook.factual.subjects) && !("genres" in normalizedBook.factual));
check("book normalization never writes traits", !("traits" in normalizedBook));
check("book completeness is between 0 and 1", normalizedBook.completeness > 0 && normalizedBook.completeness <= 1);

const normalizedMovie = normalizeCanonicalItem(dune);
check("movie factual carries genres + collectionId", Array.isArray(normalizedMovie.factual.genres) && normalizedMovie.factual.collectionId === 726871);

const normalizedGame = normalizeCanonicalItem(hades);
check("game factual carries franchiseId", normalizedGame.factual.franchiseId === 42);

check("unsupported item shape normalizes to null", normalizeCanonicalItem({ type: "podcast" }) === null);
check("null item normalizes to null", normalizeCanonicalItem(null) === null);

// ---- upsertCanonicalItem: insert path -----------------------------------------------------------

{
  const db = makeFakeDb();
  const itemId = await upsertCanonicalItem(dune, { query: db.query });
  check("upsert of a new movie returns an item id", Boolean(itemId));
  check("exactly one items row was inserted", db.items.size === 1);
  const row = db.items.get(itemId);
  check("inserted row has the right media_type", row.media_type === "movie");
  check("inserted row's traits stay empty (this PR never writes traits)", Object.keys(row.traits).length === 0);
  check("field provenance was written for genres", db.provenance.has(`${itemId}::genres`));
  check("provenance source records the raw provider name", db.provenance.get(`${itemId}::genres`).source === "tmdb");
}

// ---- upsertCanonicalItem: re-upsert (update) path -----------------------------------------------

{
  const db = makeFakeDb();
  const firstId = await upsertCanonicalItem(dune, { query: db.query });
  const secondId = await upsertCanonicalItem(dune, { query: db.query });
  check("re-upserting the same provider item resolves to the same canonical item", firstId === secondId);
  check("re-upsert does not create a second items row", db.items.size === 1);
}

// ---- QA sweep real bug: two concurrent first-time upserts of the same new item must converge -----
// on one canonical item, not create two. Fires both calls before either resolves (Promise.all),
// simulating two evidence anchors in one request both surfacing the same brand-new movie.

{
  const db = makeFakeDb();
  const [raceIdA, raceIdB] = await Promise.all([
    upsertCanonicalItem(dune, { query: db.query }),
    upsertCanonicalItem(dune, { query: db.query })
  ]);
  check("two concurrent first-time upserts of the same item converge on one canonical id", raceIdA === raceIdB, `${raceIdA} vs ${raceIdB}`);
  check("both concurrent callers' item_identifiers ends up pointing at the same row", db.identifiers.get("tmdb:movie::438631") === raceIdA);
}

// ---- same-title-different-media-type must stay distinct -----------------------------------------

{
  const db = makeFakeDb();
  const movieId = await upsertCanonicalItem(dune, { query: db.query });
  const tvId = await upsertCanonicalItem(severance, { query: db.query });
  check(
    "a movie and a tv item that share a numeric provider id resolve to distinct canonical items",
    movieId !== tvId && db.items.size === 2
  );
}

// ---- multiple provider items, franchise relationship preserved in factual, traits untouched -----

{
  const db = makeFakeDb();
  await upsertCanonicalItem(dune, { query: db.query });
  await upsertCanonicalItem(dunePart2, { query: db.query });
  check("two distinct movies in the same collection produce two distinct canonical items", db.items.size === 2);
  for (const row of db.items.values()) {
    check(`item ${row.id} traits remain untouched`, JSON.stringify(row.traits) === "{}");
  }
}

// ---- upsertCanonicalItem: nothing-to-do cases return null, never throw --------------------------

{
  const db = makeFakeDb();
  const noProviderId = await upsertCanonicalItem({ ...dune, providerId: undefined }, { query: db.query });
  check("an item with no providerId upserts to null instead of throwing", noProviderId === null);

  const unsupported = await upsertCanonicalItem({ type: "podcast", provider: "x", providerId: "1" }, { query: db.query });
  check("an unsupported media type upserts to null instead of throwing", unsupported === null);
}

// ---- graceful degradation when TASTEMAKE_DATABASE_URL is unset (this sandbox's exact condition) -

{
  const unsetEnv = { ...process.env };
  delete unsetEnv.TASTEMAKE_DATABASE_URL;

  check("db.isConfigured() is false when TASTEMAKE_DATABASE_URL is unset", isConfigured(unsetEnv) === false);

  let threw = false;
  try { await query("select 1", [], { env: unsetEnv }); } catch { threw = true; }
  check("db.query() throws (rather than hanging) when unconfigured, for callers that want that", threw === true);

  const withoutQuery = await upsertCanonicalItem(dune, { env: unsetEnv });
  check("upsertCanonicalItem no-ops (null, no throw) with no query fn and no DB configured", withoutQuery === null);

  let writeBehindThrew = false;
  try { canonicalizeWriteBehind([dune, wayOfKings, hades], { env: unsetEnv }); } catch { writeBehindThrew = true; }
  check("canonicalizeWriteBehind never throws synchronously when unconfigured", writeBehindThrew === false);
}

// ---- write-behind actually exercises the upsert logic when a query fn IS injected ---------------

{
  const db = makeFakeDb();
  canonicalizeWriteBehind([dune, wayOfKings, hades], { query: db.query });
  // canonicalizeWriteBehind is fire-and-forget by design (never awaited by callers in
  // providers.mjs/related.mjs); give its internal microtasks a tick to actually run so this test
  // can assert it really writes, not just that it doesn't throw.
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("write-behind eventually persists all three fixture items", db.items.size === 3);
}

// ---- QA sweep efficiency fix: a duplicate item in one write-behind batch is only upserted once ----
// The same real item commonly appears twice in one batch (e.g. related to two different anchors);
// this must never fire two independent upserts for it.

{
  const db = makeFakeDb();
  canonicalizeWriteBehind([dune, dune, wayOfKings], { query: db.query });
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("a duplicate item in the same batch is upserted only once", db.items.size === 2, `got ${db.items.size}`);
}

// ---- searchCatalog / retrieveCatalogCandidates keep working with no DB configured ----------------

{
  const { searchCatalog } = await import("../../src/catalog/providers.mjs");
  const unsetEnv = { ...process.env, TASTEMAKE_TMDB_TOKEN: "token" };
  delete unsetEnv.TASTEMAKE_DATABASE_URL;
  const fetchImpl = async (url) => {
    if (url.includes("search/movie")) return { ok: true, json: async () => ({ results: [{ id: 1, title: "Dune", release_date: "2021-01-01", genre_ids: [878] }] }) };
    if (url.includes("search/tv")) return { ok: true, json: async () => ({ results: [] }) };
    return { ok: false, status: 404 };
  };
  const result = await searchCatalog("dune", { domain: "movies", env: unsetEnv, fetchImpl });
  check("searchCatalog still returns real results with no database configured", result.items.length === 1 && result.items[0].title === "Dune");
  check("searchCatalog is not marked degraded just because there's no database", result.degraded === false);
}

// ---- db.mjs's real call convention against the driver (not just the injected-query mock above) --
// The tests above all mock at the canonical-store level (an injected `query` function), which never
// actually exercises db.mjs's own call against the driver -- and that's exactly how a real bug
// shipped: db.mjs called `sql.query(text, params)`, but neon()'s returned client is itself the
// callable query function with no `.query()` method, so every real write-behind was throwing
// "sql.query is not a function", silently swallowed by the caller's own catch handler. This fakes
// the driver's actual shape (a plain callable, not an object with a method) to catch that class of
// interface-mismatch bug offline, without needing real database credentials.
{
  const { query } = await import("../../src/server/db.mjs");
  let calledWith = null;
  const fakeDriverCallable = async (text, params) => { calledWith = { text, params }; return [{ id: "1" }]; };
  const rows = await query("select 1", ["a"], { sqlImpl: fakeDriverCallable });
  check("query() calls the driver as a plain callable, not a .query() method", calledWith?.text === "select 1" && Array.isArray(calledWith?.params));
  check("query() returns the driver's rows unchanged", Array.isArray(rows) && rows[0]?.id === "1");

  // A driver client shaped like neon()'s real return value: callable, but with no .query method --
  // if db.mjs ever regresses back to calling `.query(...)`, this fails with the same real error
  // ("sql.query is not a function") instead of passing against a too-permissive mock.
  const realShapedFake = Object.assign(async (text, params) => [{ ok: true, text, params }], { /* no .query */ });
  check("query() works against a driver shaped exactly like the real neon() client (callable, no .query method)",
    (await query("select 2", [], { sqlImpl: realShapedFake }))[0]?.ok === true);
}

console.log(`canonical store tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
