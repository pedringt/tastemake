#!/usr/bin/env node
// #103 items 1/2: per-media-type metadata (director/cast, creator/cast, developer/publisher/
// platforms) and graceful omission of missing fields. Free, no network, no browser.
//
//   node scripts/qa/metadata-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { renderDetailMeta } = await import("../../src/screens/library.js");
const { fetchItemDetail, googleBooksSeriesDetail } = await import("../../src/catalog/providers.mjs");

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// Sparse/missing metadata must never render an empty label (item 2).
check(
  "movie with no detail fetched yet renders no Director/Cast lines",
  renderDetailMeta({ id: "m1", type: "movie" }, {}) === ""
);
check(
  "book with no author renders nothing",
  renderDetailMeta({ id: "b1", type: "book" }, {}) === ""
);

// Books already carry author from search (item 1 minimum: title + author).
const bookMeta = renderDetailMeta({ id: "b2", type: "book", by: "Ursula K. Le Guin" }, {});
check("book renders Author when present", bookMeta.includes("Author") && bookMeta.includes("Ursula K. Le Guin"));

// Movies: director + a small cast list, only the fields that exist.
const movieMeta = renderDetailMeta({ id: "m2", type: "movie" }, { director: "Denis Villeneuve" });
check("movie with only a director omits Cast", movieMeta.includes("Director") && !movieMeta.includes("Cast"));

const movieFull = renderDetailMeta({ id: "m3", type: "movie" }, { director: "Bong Joon-ho", cast: ["Song Kang-ho", "Lee Sun-kyun"] });
check("movie with director + cast shows both", movieFull.includes("Director") && movieFull.includes("Cast") && movieFull.includes("Song Kang-ho"));

// TV: creator/showrunner + cast, media-specific (not the movie shape).
const tvMeta = renderDetailMeta({ id: "t1", type: "tv" }, { creator: "Phoebe Waller-Bridge", cast: ["Phoebe Waller-Bridge"] });
check("tv renders Creator, not Director", tvMeta.includes("Creator") && !tvMeta.includes("Director"));

// Games: developer/publisher/platforms, independently omitted when missing.
const gameMeta = renderDetailMeta({ id: "g1", type: "game" }, { developer: "FromSoftware" });
check("game with only a developer omits Publisher/Platforms", gameMeta.includes("Developer") && !gameMeta.includes("Publisher") && !gameMeta.includes("Platforms"));

const gameFull = renderDetailMeta({ id: "g2", type: "game" }, { developer: "ConcernedApe", publisher: "ConcernedApe", platforms: ["PC", "Switch"] });
check("game with all fields shows Developer, Publisher and Platforms", ["Developer", "Publisher", "Platforms", "PC"].every((s) => gameFull.includes(s)));

// fetchItemDetail must degrade to {} rather than throw when a provider call fails (item 2's
// "sparse/missing metadata" case) or when there is nothing to look up.
const failing = async () => { throw new Error("network down"); };
const detailOnFailure = await fetchItemDetail({ provider: "tmdb", providerId: "42", type: "movie" }, { env: { TASTEMAKE_TMDB_TOKEN: "x" }, fetchImpl: failing });
check("fetchItemDetail resolves to {} instead of throwing on a provider failure", JSON.stringify(detailOnFailure) === "{}");

const detailNoId = await fetchItemDetail({ provider: "tmdb", type: "movie" }, { env: {}, fetchImpl: failing });
check("fetchItemDetail resolves to {} when there is no providerId to look up", JSON.stringify(detailNoId) === "{}");

// #135: Open Library work detail is authoritative provider enrichment, not AI inference.
const openLibraryFetch = async (url) => {
  check("book detail uses the Open Library work endpoint", String(url).includes("/works/OL262758W.json"), String(url));
  return {
    ok: true,
    json: async () => ({
      description: { value: "An epic fantasy novel about oaths and war." },
      subjects: ["Epic fantasy", "Magic"],
      series: ["The Stormlight Archive"]
    })
  };
};
const bookDetail = await fetchItemDetail(
  { provider: "openlibrary", providerId: "OL262758W", type: "book" },
  { env: {}, fetchImpl: openLibraryFetch }
);
check("Open Library detail returns description", /epic fantasy novel/.test(bookDetail.description ?? ""));
check("Open Library detail returns subjects without inventing them", bookDetail.subjects?.includes("Epic fantasy"));
check("Open Library detail preserves provider-supplied series when present", bookDetail.seriesKey === "The Stormlight Archive");

console.log(`metadata tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);


// #142: Google Books structured series fallback. This is background-only in production; the unit
// test verifies the exact API shape we consume without making a live network request.
{
  const seen = [];
  const googleFetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes("/volumes?q=")) {
      return { ok: true, json: async () => ({ items: [{ id: "gb-wok" }] }) };
    }
    if (String(url).includes("/volumes/gb-wok?")) {
      return {
        ok: true,
        json: async () => ({
          volumeInfo: {
            seriesInfo: {
              volumeSeries: [{ seriesId: "stormlight-series-123", orderNumber: 1 }]
            }
          }
        })
      };
    }
    throw new Error(`unexpected Google Books URL: ${url}`);
  };
  const series = await googleBooksSeriesDetail(
    {
      provider: "openlibrary",
      providerId: "OL262758W",
      type: "book",
      providerMeta: { isbns: ["9780765326355"] }
    },
    { env: { TASTEMAKE_GOOGLE_BOOKS_API_KEY: "test-key" }, fetchImpl: googleFetch }
  );
  check("Google Books fallback searches by ISBN", decodeURIComponent(seen[0] ?? "").includes("isbn:9780765326355"));
  check("Google Books fallback explicitly requests non-comics series metadata", seen.some((url) => url.includes("includeNonComicsSeries=true")));
  check("Google Books fallback stores a namespaced stable series id", series.seriesKey === "googlebooks:stormlight-series-123");
  check("Google Books fallback retains provider order when present", series.seriesOrder === 1);

  let calledWithoutKey = false;
  const noKey = await googleBooksSeriesDetail(
    { providerMeta: { isbns: ["9780765326355"] } },
    { env: {}, fetchImpl: async () => { calledWithoutKey = true; throw new Error("should not call"); } }
  );
  check("Google Books fallback is a no-op without an API key", JSON.stringify(noKey) === "{}" && !calledWithoutKey);
}
