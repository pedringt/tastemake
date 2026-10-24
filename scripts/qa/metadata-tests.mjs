#!/usr/bin/env node
// #103 items 1/2: per-media-type metadata (director/cast, creator/cast, developer/publisher/
// platforms) and graceful omission of missing fields. Free, no network, no browser.
//
//   node scripts/qa/metadata-tests.mjs

import { createSuite } from "./lib/assert.mjs";

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { detailDescription, formatRuntime, renderDetailMeta, renderWhereToGet } = await import("../../src/screens/library.js");
const { compactWatchProviders, fetchAndPersistItemDetail, fetchItemDetail, googleBooksSeriesDetail, tvYearsRun, watchForRegion } = await import("../../src/catalog/providers.mjs");
const { viewerRegion } = await import("../../src/catalog/client.js");

const { check, finish } = createSuite("metadata tests");

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
const openLibraryUrls = [];
const openLibraryFetch = async (url) => {
  openLibraryUrls.push(String(url));
  if (String(url).includes("/search.json")) {
    return { ok: true, json: async () => ({ docs: [{ key: "/works/OL262758W", number_of_pages_median: 1007.4 }] }) };
  }
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
check("book detail uses the Open Library work endpoint", openLibraryUrls.some((url) => url.includes("/works/OL262758W.json")));
check("book page count is a keyed search-index lookup for the same work", openLibraryUrls.some((url) => url.includes("/search.json") && decodeURIComponent(url).includes("key:/works/OL262758W") && url.includes("number_of_pages_median")));
check("Open Library detail returns the median page count as a whole number", bookDetail.pageCount === 1007);

{
  const noPages = await fetchItemDetail(
    { provider: "openlibrary", providerId: "OL1W", type: "book" },
    { env: {}, fetchImpl: async (url) => String(url).includes("/search.json")
      ? { ok: true, json: async () => ({ docs: [{}] }) }
      : { ok: true, json: async () => ({ description: "A book." }) } }
  );
  check("a missing page count is null, and the rest of the book detail survives", noPages.pageCount === null && noPages.description === "A book.");
  const pagesFail = await fetchItemDetail(
    { provider: "openlibrary", providerId: "OL1W", type: "book" },
    { env: {}, fetchImpl: async (url) => { if (String(url).includes("/search.json")) throw new Error("down"); return { ok: true, json: async () => ({ description: "A book." }) }; } }
  );
  check("a failed page-count lookup does not lose the work description", pagesFail.description === "A book." && pagesFail.pageCount === null);
}

// TV run years: an ongoing series must not read as finished.
check("tv still in production reads start–present", tvYearsRun({ first_air_date: "2023-01-15", last_air_date: "2025-05-25", in_production: true }) === "2023–present");
check("ended tv reads start–end", tvYearsRun({ first_air_date: "2011-04-17", last_air_date: "2019-05-19", in_production: false }) === "2011–2019");
check("a one-season ended show reads as one year", tvYearsRun({ first_air_date: "2019-05-06", last_air_date: "2019-06-03", in_production: false }) === "2019");
check("tv with no first air date has no run years", tvYearsRun({ last_air_date: "2019-06-03" }) === null);

// Each media type shows its own extra fields, and only when present.
{
  const movie = renderDetailMeta({ id: "m9", type: "movie" }, { director: "Andrew Lau", runtime: 128 });
  check("movie shows a runtime in hours and minutes", movie.includes("Runtime") && movie.includes("2h 8m"));
  check("movie with no runtime omits the Runtime line", !renderDetailMeta({ id: "m9", type: "movie" }, { director: "X" }).includes("Runtime"));
  check("short runtimes read in minutes", formatRuntime(45) === "45 min" && formatRuntime(120) === "2h" && formatRuntime(0) === "" && formatRuntime(null) === "");
  const tv = renderDetailMeta({ id: "t9", type: "tv" }, { creator: "Neil Druckmann", yearsRun: "2023–present" });
  check("tv shows its run years", tv.includes("Years") && tv.includes("2023–present"));
  check("tv never shows a Runtime or Pages line", !tv.includes("Runtime") && !tv.includes("Pages"));
  const book = renderDetailMeta({ id: "b9", type: "book", by: "Frank Herbert" }, { pageCount: 608 });
  check("book shows Author and Pages", book.includes("Author") && book.includes("Pages") && book.includes("608"));
  check("book with no page count omits Pages", !renderDetailMeta({ id: "b9", type: "book", by: "Frank Herbert" }, { pageCount: null }).includes("Pages"));
}

// Book description: replaces only Open Library's placeholder about, cleaned and checked.
{
  const book = { id: "b10", type: "book", about: "First published 1997." };
  check("a book description replaces the 'First published' placeholder", detailDescription(book, { description: "Harry Potter has never heard of Hogwarts." }) === "Harry Potter has never heard of Hogwarts.");
  check("a book description replaces the 'Book from Open Library.' placeholder", detailDescription({ ...book, about: "Book from Open Library." }, { description: "A real summary." }) === "A real summary.");
  check("a real synopsis already on the item is kept", detailDescription({ ...book, about: "A long-running epic about a desert planet." }, { description: "Other text." }) === null);
  check("no description means no replacement", detailDescription(book, {}) === null && detailDescription(book, { description: null }) === null);
  check("movies and games never take a book description", detailDescription({ id: "m", type: "movie", about: "First published 1997." }, { description: "x" }) === null);
  check("Open Library source notes and markdown links are dropped",
    detailDescription(book, { description: "A boy finds a [wizard school](https://example.com). ---------- Contains: [Book 1][1] [1]: https://openlibrary.org/x" }) === "A boy finds a wizard school.");
  check("Open Library '([source][1])' trailers are dropped", detailDescription(book, { description: "A quiet novel. ([source][1]) [1]: https://x" }) === "A quiet novel.");
  const long = `${"A sentence that goes on for a while. ".repeat(20)}`;
  const clipped = detailDescription(book, { description: long });
  check("a long description is clipped at a sentence end", clipped.length <= 480 && clipped.endsWith("."));
  check("a flagged description is not shown", detailDescription(book, { description: "The story includes a graphic rape scene." }) === null);
}

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

// ---- #10: where to watch / read --------------------------------------------------------------------------
{
  // The shape TMDb's watch/providers returns (results by country).
  const results = {
    US: { link: "https://www.themoviedb.org/movie/329865-arrival/watch?locale=US", flatrate: [{ provider_name: "Paramount Plus" }, { provider_name: "Paramount Plus" }], rent: [{ provider_name: "Apple TV" }, { provider_name: "Amazon Video" }], buy: [{ provider_name: "Apple TV" }] },
    GB: { link: "https://www.themoviedb.org/movie/329865-arrival/watch?locale=GB", free: [{ provider_name: "BBC iPlayer" }] },
    "??": { flatrate: [{ provider_name: "x" }] },
    FR: { link: "https://evil.example/", rent: [{ provider_name: "Canal VOD" }] }
  };
  const watch = compactWatchProviders(results);
  check("names per kind, duplicates dropped", watch.US.stream.join() === "Paramount Plus" && watch.US.rent.join() === "Apple TV,Amazon Video");
  check("bad country codes are skipped", !("??" in watch));
  check("only TMDb's own links are kept", watch.FR.link === null && watch.US.link.startsWith("https://www.themoviedb.org/"));
  check("one country is picked for the viewer", watchForRegion(watch, "gb").free.join() === "BBC iPlayer" && watchForRegion(watch, "gb").region === "GB");
  check("a country with no listing says so", watchForRegion(watch, "DE").none === true);
  check("no data at all stays empty", compactWatchProviders(undefined) === null && watchForRegion(null, "US") === null);

  check("region from the browser language", viewerRegion(["en-GB"]) === "GB" && viewerRegion(["fr-ca", "en"]) === "CA");
  check("region falls back to US", viewerRegion(["en"]) === "US" && viewerRegion([]) === "US");

  const html = renderWhereToGet({ type: "movie" }, { whereToWatch: watchForRegion(watch, "US") });
  check("Where to watch lists stream, rent and buy", /Stream<\/dt><dd>Paramount Plus/.test(html) && /Rent<\/dt><dd>Apple TV, Amazon Video/.test(html) && /Buy/.test(html));
  check("JustWatch is credited with a link to all options", /Availability from JustWatch/.test(html) && /href="https:\/\/www\.themoviedb\.org\/movie\/329865/.test(html));
  check("nothing available reads plainly", /Not available to stream, rent or buy here/.test(renderWhereToGet({ type: "tv" }, { whereToWatch: watchForRegion(watch, "DE") })));
  check("no watch data yet, no block", renderWhereToGet({ type: "movie" }, {}) === "");
  const book = renderWhereToGet({ type: "book", title: "Piranesi", by: "Susanna Clarke", provider: "openlibrary", providerId: "OL20893680W" });
  check("books get a library search and Open Library", /worldcat\.org\/search\?q=Piranesi%20Susanna%20Clarke/.test(book) && /openlibrary\.org\/works\/OL20893680W/.test(book));
  check("games get no extra block (platforms are listed already)", renderWhereToGet({ type: "game", title: "Outer Wilds" }) === "");

  // The TMDb detail call brings watch providers along, and they are served but never stored as facts.
  let asked = "";
  const fetchImpl = async (url) => { asked = String(url); return { ok: true, json: async () => ({ runtime: 116, credits: { crew: [{ job: "Director", name: "Denis Villeneuve" }], cast: [] }, "watch/providers": { results } }) }; };
  const written = [];
  const query = async (text, params) => { written.push({ text, params }); return /^\s*select/i.test(text) ? [{ item_id: 7, factual: {} }] : []; };
  const detail = await fetchAndPersistItemDetail({ provider: "tmdb", providerId: "329865", type: "movie" }, { env: { TASTEMAKE_TMDB_TOKEN: "t" }, fetchImpl, query });
  check("one TMDb call asks for credits and watch providers together", /append_to_response=credits,watch\/providers/.test(asked), asked);
  check("the detail carries watch data for the endpoint", detail.watch?.US?.stream?.[0] === "Paramount Plus");
  check("watch data is never written to the catalog store", written.length > 0 && !written.some((w) => JSON.stringify(w.params ?? []).includes("Paramount")), JSON.stringify(written.map((w) => w.params)).slice(0, 200));
}

finish();
