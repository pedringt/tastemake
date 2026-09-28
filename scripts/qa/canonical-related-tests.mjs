#!/usr/bin/env node
// #144: canonical-store-backed related-candidate retrieval. Free, no network, no real database --
// everything here runs against an injected in-memory `query` function, exactly like
// canonical-store-tests.mjs.
//
//   node scripts/qa/canonical-related-tests.mjs

import { relatedCanonicalItems } from "../../src/catalog/canonical-store.mjs";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { openLibraryItem, tmdbItem } from "../../src/catalog/providers.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// ---- fixtures --------------------------------------------------------------------------------

const wayOfKings = openLibraryItem({
  key: "/works/OL262758W", title: "The Way of Kings", author_name: ["Brandon Sanderson"],
  first_publish_year: 2010, cover_i: 1, subject: ["Epic fantasy fiction", "Magic"]
});

const dune = tmdbItem({
  id: 438631, title: "Dune", overview: "A duke's son...", release_date: "2021-10-22",
  poster_path: "/x.jpg", genre_ids: [878, 12], belongs_to_collection: { id: 726871 }
}, "movie");

// A store row for a *different* Open Library book that shares a meaningful subject with wayOfKings.
const stormlightRow = {
  canonical_title: "Words of Radiance",
  year: "2012",
  factual: { author: "Brandon Sanderson", subjects: ["Epic fantasy fiction", "Adventure"] },
  provider: "openlibrary:book",
  provider_id: "OL999W"
};

// A store row with no subject overlap at all.
const unrelatedRow = {
  canonical_title: "Cooking Basics",
  year: "2005",
  factual: { author: "Someone Else", subjects: ["Cookbooks"] },
  provider: "openlibrary:book",
  provider_id: "OL111W"
};

// A store row for the exact same book as the anchor (must be excluded as "self").
const selfRow = {
  canonical_title: "The Way of Kings",
  year: "2010",
  factual: { author: "Brandon Sanderson", subjects: ["Epic fantasy fiction", "Magic"] },
  provider: "openlibrary:book",
  provider_id: "OL262758W"
};

// Simulates the real query's own `factual -> field ?| values` filter (Postgres does this
// server-side; relatedCanonicalItems trusts its query fn to have already applied it, exactly like
// canonical-store-tests.mjs's fake DB simulates the real upsert SQL rather than bypassing it).
function fakeQuery(rows) {
  return async (text, params) => {
    const [, field, values] = params;
    return rows.filter((row) => (row.factual?.[field] ?? []).some((value) => values.includes(value)));
  };
}

// ---- relatedCanonicalItems: matching / nonmatching / self-exclusion --------------------------

{
  const results = await relatedCanonicalItems(wayOfKings, ["Epic fantasy fiction"], {
    query: fakeQuery([stormlightRow, unrelatedRow, selfRow])
  });
  check("matching-subject store row is returned", results.some((r) => r.providerId === "OL999W"));
  check("nonmatching store row is not returned by this call's fixture shape",
    results.length === 1, `got ${results.length}`);
  check("the anchor's own identity is excluded from results", !results.some((r) => r.providerId === "OL262758W"));
  check("returned candidate carries reconstructed provider identity", results[0].provider === "openlibrary" && results[0].type === "book");
}

// ---- anchors with no useful genres/subjects skip the query entirely ---------------------------

{
  let queried = false;
  const results = await relatedCanonicalItems(wayOfKings, [], { query: async () => { queried = true; return []; } });
  check("empty subject list never queries the store", queried === false && results.length === 0);
}

{
  let queried = false;
  const results = await relatedCanonicalItems({ ...dune, genres: [] }, [], { query: async () => { queried = true; return []; } });
  check("anchor with no genres never queries the store", queried === false && results.length === 0);
}

// ---- store query failures degrade to an empty array, never throw ------------------------------

{
  let threw = false;
  let results = null;
  try {
    results = await relatedCanonicalItems(wayOfKings, ["Epic fantasy fiction"], {
      query: async () => { throw new Error("connection reset"); }
    });
  } catch { threw = true; }
  check("a query error is caught, not thrown", threw === false);
  check("a query error resolves to an empty array", Array.isArray(results) && results.length === 0);
}

// ---- retrieveCatalogCandidates: store results merge with, and dedupe against, live results -----

{
  const state = {
    customItems: { [wayOfKings.id]: wayOfKings },
    selectedFavorites: [wayOfKings.id]
  };
  // Live fetch returns nothing new for this subject; the store fixture supplies the only candidate.
  const fetchImpl = async () => ({ ok: true, json: async () => ({ docs: [] }) });
  const candidates = await retrieveCatalogCandidates(state, {
    env: {},
    fetchImpl,
    query: fakeQuery([stormlightRow, unrelatedRow])
  });
  check("a store-only candidate reaches the final candidate pool", candidates.some((c) => c.providerId === "OL999W"));
  check("store-sourced candidates are flagged for observability", candidates.some((c) => c.fromCanonicalStore === true));
  check("an unrelated store row never reaches the final pool", !candidates.some((c) => c.providerId === "OL111W"));
}

{
  // Live fetch returns the *same* book the store also has -- must appear exactly once.
  const state = {
    customItems: { [wayOfKings.id]: wayOfKings },
    selectedFavorites: [wayOfKings.id]
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ docs: [{ key: "/works/OL999W", title: "Words of Radiance", author_name: ["Brandon Sanderson"], subject: ["Epic fantasy fiction"] }] })
  });
  const candidates = await retrieveCatalogCandidates(state, {
    env: {},
    fetchImpl,
    query: fakeQuery([stormlightRow])
  });
  const matches = candidates.filter((c) => c.providerId === "OL999W");
  check("a candidate present in both live and store results appears exactly once", matches.length === 1, `got ${matches.length}`);
}

console.log(`canonical related tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
