#!/usr/bin/env node
// #252 part 2 (Oct 27): "with these vibes" across media. Provider calls are stubbed (no network); no model call.
// Each section runs on its own, so on code without bridges every check reports a failure instead of the
// suite stopping at the first missing import.
//
//   node scripts/qa/bridges-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("bridges tests");
const load = async (path) => { try { return await import(path); } catch { return {}; } };
const bridges = await load("../../src/catalog/bridges.mjs");
const { bridgeCandidates } = await load("../../src/catalog/bridge-candidates.mjs");
const { bridgeReason } = await load("../../src/catalog/fallback-reasons.mjs");
const { default: handler } = await import("../../api/similar.mjs");

async function section(name, run) {
  try { await run(); } catch (error) { check(`${name} runs`, false, String(error?.message ?? error).slice(0, 160)); }
}

// Realistic fixtures, shaped the way providers.mjs builds them.
const arrival = { id: "tmdb-movie-329865", provider: "tmdb", providerId: "329865", type: "movie", title: "Arrival", domains: ["movies"], genres: ["878", "18"], providerMeta: { genreIds: [878, 18], collectionId: null } };
const severance = { id: "tmdb-tv-95396", provider: "tmdb", providerId: "95396", type: "tv", title: "Severance", domains: ["tv"], genres: ["18", "9648", "10765"], providerMeta: { genreIds: [18, 9648, 10765] } };
const piranesi = { id: "openlibrary-book-OL20893680W", provider: "openlibrary", providerId: "OL20893680W", type: "book", title: "Piranesi", by: "Susanna Clarke", domains: ["read"],
  genres: ["Fantasy fiction", "Labyrinths", "Amnesia", "Fiction, fantasy, general", "Fiction, mystery & detective, general", "Fiction, literary"], providerMeta: {} };
const hades = { id: "igdb-game-113112", provider: "igdb", providerId: "113112", type: "game", title: "Hades", domains: ["play"],
  genres: ["Role-playing (RPG)", "Hack and slash/Beat 'em up", "Indie"], providerMeta: { genreIds: [12, 25, 32], themes: ["Action", "Fantasy"] } };
const marriageStory = { id: "tmdb-movie-492188", provider: "tmdb", providerId: "492188", type: "movie", title: "Marriage Story", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] } };
const plainBook = { id: "openlibrary-book-OLPLAINW", provider: "openlibrary", providerId: "OLPLAINW", type: "book", title: "A Plain Novel", domains: ["read"], genres: ["Fiction", "Large type books"] };

const shelves = (queries) => (queries ?? []).map((q) => `${q.domain}:${q.genreId}:${q.labels.join("+")}`).join(" | ");

await section("the mapping", () => {
  const { bridgeQueriesFor, bridgeLabelsOf } = bridges;
  eq("movie to books: Arrival's sci-fi goes to the Sci-fi book shelf (drama has no book shelf)", shelves(bridgeQueriesFor(arrival, "read")), "read:sci-fi:sci-fi");
  eq("TV to books: Severance's mystery goes to Mystery / Thriller", shelves(bridgeQueriesFor(severance, "read")), "read:mystery-thriller:mystery");
  check("TMDb TV's combined Sci-Fi & Fantasy is not read as either one", !bridgeLabelsOf(severance).includes("sci-fi") && !bridgeLabelsOf(severance).includes("fantasy"), bridgeLabelsOf(severance).join(","));
  eq("book to movies and shows: Piranesi's fantasy and mystery, on both", shelves(bridgeQueriesFor(piranesi, "screen")),
    "movies:fantasy:fantasy | movies:thriller:mystery | tv:fantasy:fantasy | tv:thriller:mystery");
  eq("book to movies only", shelves(bridgeQueriesFor(piranesi, "movies")), "movies:fantasy:fantasy | movies:thriller:mystery");
  eq("game to books: Hades' Fantasy theme", shelves(bridgeQueriesFor(hades, "read")), "read:fantasy:fantasy");
  eq("never the item's own medium", bridgeQueriesFor(arrival, "movies").length, 0);
  eq("a drama-only film has nothing to bridge to books", bridgeQueriesFor(marriageStory, "read").length, 0);
  eq("a book with only broad subjects has nothing to bridge", bridgeQueriesFor(plainBook, "screen").length, 0);
  eq("an unknown target has nothing", bridgeQueriesFor(arrival, "podcasts").length, 0);
  eq("an item with no genres has nothing", bridgeQueriesFor({ ...arrival, genres: [], providerMeta: {} }, "read").length, 0);
  const thriller = { ...arrival, genres: ["53", "9648", "80"], providerMeta: { genreIds: [53, 9648, 80] } };
  eq("mystery and thriller share one book shelf, queried once", shelves(bridgeQueriesFor(thriller, "read")), "read:mystery-thriller:thriller+mystery");
  check("every shelf named is one Browse really has", ["read", "screen"].every((t) => [arrival, severance, piranesi, hades].every((item) => (bridgeQueriesFor(item, t) ?? []).every((q) => q.genreId))));
});

await section("the button rules", () => {
  const { bridgeTargetFor } = bridges;
  eq("a movie offers books", bridgeTargetFor(arrival, {}), "read");
  eq("a show offers books", bridgeTargetFor(severance, {}), "read");
  eq("a game offers books", bridgeTargetFor(hades, {}), "read");
  eq("a book offers movies and shows", bridgeTargetFor(piranesi, {}), "screen");
  eq("with TV off, a book offers movies", bridgeTargetFor(piranesi, { tv: false }), "movies");
  eq("with both off, nothing", bridgeTargetFor(piranesi, { tv: false, movies: false }), null);
  eq("with Books off, a movie offers nothing", bridgeTargetFor(arrival, { read: false }), null);
  eq("no mapping, no button", bridgeTargetFor(marriageStory, {}), null);
  eq("no catalog ids, no button", bridgeTargetFor({ ...arrival, provider: null }, {}), null);
});

// Browse shelves stubbed per domain and genre.
const ol = (key, title, subject, extra = {}) => ({ id: `openlibrary-book-${key}`, provider: "openlibrary", providerId: key, type: "book", title, domains: ["read"], genres: subject, by: extra.by ?? "Someone", providerMeta: extra.providerMeta ?? {}, about: "Book from Open Library." });
const movie = (id, title, genreIds) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), type: "movie", title, domains: ["movies"], genres: genreIds.map(String), providerMeta: { genreIds } });
const show = (id, title, genreIds) => ({ id: `tmdb-tv-${id}`, provider: "tmdb", providerId: String(id), type: "tv", title, domains: ["tv"], genres: genreIds.map(String), providerMeta: { genreIds } });
const SHELVES = {
  "read:sci-fi": [
    ol("OL1W", "The Left Hand of Darkness", ["Science fiction", "Gender identity"], { by: "Ursula K. Le Guin" }),
    ol("OL2W", "Arrival", ["Science fiction", "Linguistics"], { by: "Ted Chiang" }),
    ol("OL3W", "Dune Messiah (Dune, Book 2)", ["Science fiction"], { by: "Frank Herbert", providerMeta: { seriesPosition: 2 } }),
    ol("OL4W", "SparkNotes: Ender's Game", ["Science fiction", "Study guides"], { by: "SparkNotes" }),
    ol("OL5W", "Already Rated Book", ["Science fiction"]),
    ol("OL6W", "Explicit Stars", ["Science fiction", "Erotica"]),
    ol("OL7W", "Story of Your Life and Others", ["Science fiction", "Short stories"], { by: "Ted Chiang" })
  ],
  "read:mystery-thriller": [ol("OL8W", "The Secret History", ["Mystery fiction", "College students"], { by: "Donna Tartt" })],
  "read:fantasy": [ol("OL9W", "Circe", ["Fantasy fiction", "Greek mythology"], { by: "Madeline Miller" })],
  "movies:fantasy": [movie(1001, "Pan's Labyrinth", [14, 18, 10752]), movie(1002, "Spirited Away", [16, 10751, 14])],
  "movies:thriller": [movie(1003, "Heat", [80, 18, 53]), movie(1004, "Shutter Island", [18, 53, 9648])],
  "tv:fantasy": [show(2001, "The Leftovers", [18, 9648, 10765])],
  "tv:thriller": [show(2002, "True Detective", [18, 9648, 80])]
};
// Oct 27: results now go through the series lookups too (Open Library editions, then Wikidata). They are
// stubbed to answer nothing, which leaves positions unknown (the lookups fail open).
const noSeries = async () => ({ ok: false, json: async () => ({}) });
const calls = [];
const browse = async ({ domain, genreId }) => { calls.push(`${domain}:${genreId}`); return { items: SHELVES[`${domain}:${genreId}`] ?? [], hasMore: false, degraded: false }; };

await section("the gates", async () => {
  calls.length = 0;
  const out = await bridgeCandidates(arrival, "read", { browse, fetchImpl: noSeries, exclude: ["openlibrary-book-OL5W"] });
  const titles = out.map((i) => i.title);
  eq("asks only the shelves the mapping names", calls.join(","), "read:sci-fi");
  check("finds books from the Sci-fi shelf", titles.includes("The Left Hand of Darkness") && titles.includes("Story of Your Life and Others"), titles.join(" | "));
  check("not one already reacted to", !titles.includes("Already Rated Book"));
  check("not the book of the film (novelty guard)", !titles.includes("Arrival"), titles.join(" | "));
  check("not a later series entry", !titles.some((t) => /Dune Messiah/.test(t)));
  check("not a companion book", !titles.some((t) => /SparkNotes/.test(t)));
  check("not an adult-tagged book from a non-adult item", !titles.includes("Explicit Stars"));
  check("every result is a book", out.every((i) => i.type === "book"));
  check("every result is marked as a bridge from Arrival", out.every((i) => i.bridge?.fromId === arrival.id && i.bridge?.fromDomain === "movies" && i.relatedToId === arrival.id && i.relatedTo === "Arrival"));
  check("with only the genres both share", out.every((i) => i.bridge.sharedGenres.join() === "sci-fi"), out.map((i) => i.bridge?.sharedGenres?.join("+")).join(" | "));

  calls.length = 0;
  const screen = await bridgeCandidates(piranesi, "screen", { browse, fetchImpl: noSeries });
  const screenTitles = screen.map((i) => i.title);
  eq("a book asks four screen shelves", calls.length, 4);
  check("a thriller film with no mystery tag is not offered for Piranesi", !screenTitles.includes("Heat"), screenTitles.join(" | "));
  // Oct 27: mystery alone is too broad to count as a vibe; it needs a second shared genre.
  check("a film sharing only mystery is not offered for Piranesi", !screenTitles.includes("Shutter Island"), screenTitles.join(" | "));
  check("nor a show sharing only mystery", !screenTitles.includes("True Detective"), screenTitles.join(" | "));
  check("shows come from TMDb TV shelves", screenTitles.includes("The Leftovers"), screenTitles.join(" | "));
  eq("a show found on the fantasy shelf that is also a mystery shares both, so it comes first", screen[0]?.title, "The Leftovers");
  check("no book comes back for a book", screen.every((i) => i.type !== "book"));

  eq("no mapping means no provider call and no results", (await bridgeCandidates(marriageStory, "read", { browse: async () => { throw new Error("should not be called"); } })).length, 0);
  eq("a provider failure is an empty list, not an error", (await bridgeCandidates(arrival, "read", { browse: async () => { throw new Error("down"); } })).length, 0);
});

await section("through the real browse calls", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("https://openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs: [
      { key: "/works/OL1W", title: "The Left Hand of Darkness", author_name: ["Ursula K. Le Guin"], first_publish_year: 1969, subject: ["Science fiction"] },
      { key: "/works/OL4W", title: "SparkNotes: Ender's Game", author_name: ["SparkNotes"], subject: ["Science fiction"] }
    ] }) };
    if (/openlibrary\.org\/works\/.*editions\.json|query\.wikidata\.org/.test(String(url))) return { ok: false, json: async () => ({}) };
    throw new Error(`unexpected ${url}`);
  };
  const out = await bridgeCandidates(arrival, "read", { env: {}, fetchImpl });
  const searches = urls.filter((u) => u.includes("/search.json"));
  check("uses Browse's Open Library subject search", searches.length === 1 && searches[0].includes("subject=science_fiction"), urls.join(" "));
  check("and checks series positions with Open Library editions and Wikidata only", urls.every((u) => u.startsWith("https://openlibrary.org/") || u.startsWith("https://query.wikidata.org/")), urls.join(" "));
  eq("and its filters", out.map((i) => i.title).join(" | "), "The Left Hand of Darkness");
});

// Oct 27 smoke test on production: Arrival's books included Agatha Christie and the Hardy Boys on mystery
// alone, two Asimov Robot novels in a row, and book 2s (The Naked Sun, The Fall of Hyperion); Circe's
// films were the first two Harry Potters.
await section("match quality (Oct 27)", async () => {
  const arrivalMystery = { ...arrival, genres: ["878", "18", "9648"], providerMeta: { genreIds: [878, 18, 9648], collectionId: null } };
  const shelves = {
    "read:sci-fi": [
      ol("OL40W", "The Caves of Steel", ["Science fiction", "Mystery fiction"], { by: "Isaac Asimov" }),
      ol("OL41W", "The Naked Sun", ["Science fiction", "Mystery fiction"], { by: "Isaac Asimov" }),
      ol("OL42W", "Hyperion", ["Science fiction"], { by: "Dan Simmons" }),
      ol("OL43W", "The Fall of Hyperion", ["Science fiction"], { by: "Dan Simmons" })
    ],
    "read:mystery-thriller": [
      ol("OL44W", "Peril at End House", ["Mystery fiction", "Detectives"], { by: "Agatha Christie" }),
      ol("OL45W", "The Hidden Staircase", ["Mystery fiction"], { by: "Leslie McFarlane" })
    ]
  };
  const shelfBrowse = async ({ domain, genreId }) => ({ items: shelves[`${domain}:${genreId}`] ?? [], hasMore: false, degraded: false });
  // Wikidata knows the second books' places in their series (P179 with a P1545 ordinal).
  const ordinals = { OL41W: "2", OL43W: "2", OL40W: "1", OL42W: "1" };
  const asked = [];
  const wikidata = async (url) => {
    const u = decodeURIComponent(String(url));
    asked.push(u.slice(0, 60));
    if (!u.startsWith("https://query.wikidata.org/")) return { ok: false, json: async () => ({}) };
    const ids = [...u.matchAll(/"(OL\d+W)"/g)].map((m) => m[1]).filter((id) => ordinals[id]);
    return { ok: true, json: async () => ({ results: { bindings: ids.map((id) => ({ olid: { value: id }, ordinal: { value: ordinals[id] } })) } }) };
  };

  const titles = (await bridgeCandidates(arrivalMystery, "read", { browse: shelfBrowse, fetchImpl: wikidata })).map((i) => i.title);
  check("a book sharing only mystery isn't offered for Arrival", !titles.includes("Peril at End House") && !titles.includes("The Hidden Staircase"), titles.join(" | "));
  check("a book sharing sci-fi and mystery is", titles.includes("The Caves of Steel"), titles.join(" | "));
  check("a book 2 that Wikidata knows about is left out", !titles.includes("The Naked Sun") && !titles.includes("The Fall of Hyperion"), titles.join(" | "));
  check("its series' first book stays", titles.includes("Hyperion"), titles.join(" | "));
  check("the series lookup only asked Open Library editions and Wikidata", asked.every((u) => u.startsWith("https://openlibrary.org/") || u.startsWith("https://query.wikidata.org/")), asked.join(" "));

  // One per author even when both are first books, and the lookup failing never drops anything.
  const down = async () => { throw new Error("down"); };
  const sameAuthor = (await bridgeCandidates(arrivalMystery, "read", { browse: async () => ({ items: [
    ol("OL50W", "The Caves of Steel", ["Science fiction", "Mystery fiction"], { by: "Isaac Asimov" }),
    ol("OL51W", "Foundation", ["Science fiction"], { by: "Isaac Asimov" }),
    ol("OL52W", "Kindred", ["Science fiction"], { by: "Octavia E. Butler" })
  ], hasMore: false, degraded: false }), fetchImpl: down })).map((i) => i.title);
  eq("one book per author, the closer match first", sameAuthor.join(" | "), "The Caves of Steel | Kindred");

  // One per franchise on screen: the first two Harry Potter films for Circe.
  const circe = { id: "openlibrary-book-OL18012166W", provider: "openlibrary", providerId: "OL18012166W", type: "book", title: "Circe", by: "Madeline Miller", domains: ["read"], genres: ["Fantasy fiction", "Greek mythology"] };
  const films = (await bridgeCandidates(circe, "movies", { browse: async ({ genreId }) => ({ items: genreId === "fantasy" ? [
    movie(3001, "Harry Potter and the Philosopher's Stone", [12, 14]),
    movie(3002, "Harry Potter and the Chamber of Secrets", [12, 14]),
    movie(3003, "The Lord of the Rings: The Fellowship of the Ring", [12, 14])
  ] : [], hasMore: false, degraded: false }), fetchImpl: down })).map((i) => i.title);
  check("one film per franchise", films.filter((t) => /Harry Potter/.test(t)).length === 1 && films.includes("The Lord of the Rings: The Fellowship of the Ring"), films.join(" | "));
});

await section("the reason wording", () => {
  const base = { relatedTo: "Piranesi" };
  eq("one shared genre", bridgeReason({ ...base, bridge: { sharedGenres: ["fantasy"] } }), "Shares fantasy with Piranesi.");
  eq("two shared genres", bridgeReason({ ...base, bridge: { sharedGenres: ["fantasy", "mystery"] } }), "Shares fantasy and mystery with Piranesi.");
  eq("varies by position", bridgeReason({ ...base, bridge: { sharedGenres: ["sci-fi"] } }, { index: 1 }), "Also sci-fi, like Piranesi.");
  eq("no shared genre, no reason", bridgeReason({ ...base, bridge: { sharedGenres: [] } }), null);
  const words = ["horror", "sci-fi", "fantasy", "mystery", "thriller", "comedy", "romance", "historical", "drama", "crime", "animation"];
  const named = (text) => words.filter((w) => new RegExp(`\\b${w}\\b`).test(text));
  return (async () => {
    const all = [...await bridgeCandidates(piranesi, "screen", { browse, fetchImpl: noSeries }), ...await bridgeCandidates(arrival, "read", { browse, fetchImpl: noSeries })];
    check("every reason names only genres the result shares", all.every((item, index) => {
      const text = bridgeReason(item, { index });
      return text && named(text).every((w) => item.bridge.sharedGenres.includes(w));
    }), all.map((item, i) => bridgeReason(item, { index: i })).join(" / "));
    check("so Pan's Labyrinth is never called a drama pick", !all.filter((i) => i.title === "Pan's Labyrinth").some((i, n) => /drama|war/.test(bridgeReason(i, { index: n }))));
  })();
});

await section("the endpoint", async () => {
  const makeRes = () => ({ headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const call = async (req) => { const res = makeRes(); await handler({ headers: {}, ...req }, res); return res; };
  const bad = await call({ method: "POST", body: { item: arrival, targetDomain: "podcasts" } });
  eq("an unknown targetDomain is a 400", bad.code, 400);
  eq("and a failure is never cached", bad.headers["cache-control"], "no-store");
  eq("a movie can't ask for movies", (await call({ method: "POST", body: { item: arrival, targetDomain: "movies" } })).code, 400);
  eq("a book can't ask for books", (await call({ method: "POST", body: { item: piranesi, targetDomain: "read" } })).code, 400);
  eq("a movie can't ask for the screen", (await call({ method: "POST", body: { item: arrival, targetDomain: "screen" } })).code, 400);
  eq("a non-string targetDomain is a 400", (await call({ method: "POST", body: { item: arrival, targetDomain: { read: true } } })).code, 400);
  eq("a missing item is still a 400, with no-store", (await call({ method: "POST", body: { targetDomain: "read" } })).headers["cache-control"], "no-store");

  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("https://openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs: [
      { key: "/works/OL1W", title: "The Left Hand of Darkness", author_name: ["Ursula K. Le Guin"], first_publish_year: 2001, subject: ["Science fiction"] },
      { key: "/works/OL7W", title: "Exhalation", author_name: ["Ted Chiang"], first_publish_year: 2019, subject: ["Science fiction", "Short stories"] }
    ] }) };
    return { ok: false, json: async () => ({}) };
  };
  try {
    const res = await call({ method: "POST", body: { item: arrival, targetDomain: "read", exclude: ["openlibrary-book-OL7W"] } });
    eq("Arrival to books answers", res.code, 200);
    eq("with books, minus the excluded one", res.body.items.map((i) => i.title).join(" | "), "The Left Hand of Darkness");
    check("each marked as a bridge with a reason naming only sci-fi", res.body.items.every((i) => i.bridge?.fromId === arrival.id && i.reason === "Shares sci-fi with Arrival."), JSON.stringify(res.body.items.map((i) => i.reason)));
    eq("never cached (it depends on what you've rated)", res.headers["cache-control"], "no-store");
    check("no call to anything but Open Library and Wikidata (series positions)", urls.every((u) => u.startsWith("https://openlibrary.org/") || u.startsWith("https://query.wikidata.org/")), urls.join(" "));
    const empty = await call({ method: "POST", body: { item: marriageStory, targetDomain: "read" } });
    check("nothing to bridge is an empty answer, not an error", empty.code === 200 && empty.body.items.length === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await section("the screens", async () => {
  const { resetState, state } = await import("../../src/state.js");
  const { renderLibrary } = await import("../../src/screens/library.js");
  const { renderBrowse } = await import("../../src/screens/browse.js");
  resetState();
  state.onboarded = true;
  state.libraryView = "tried";
  for (const item of [arrival, severance, piranesi, hades, marriageStory]) state.feedbackByRecommendation[item.id] = { item, rating: "more", detail: "loved-before" };
  let html = renderLibrary();
  const card = (id) => html.slice(html.indexOf(`data-library-id="${id}"`), html.indexOf("</details>", html.indexOf(`data-library-id="${id}"`) + 1) + 400);
  check("Arrival offers Books with these vibes", html.includes(`data-see-similar="${arrival.id}" data-similar-target="read">Books with these vibes →`));
  check("Severance does too", html.includes(`data-see-similar="${severance.id}" data-similar-target="read">Books with these vibes →`));
  check("Hades does too", html.includes(`data-see-similar="${hades.id}" data-similar-target="read">Books with these vibes →`));
  check("Piranesi offers Movies and shows with these vibes", html.includes(`data-see-similar="${piranesi.id}" data-similar-target="screen">Movies and shows with these vibes →`));
  check("a drama-only film keeps See similar but has no vibes button", html.includes(`data-see-similar="${marriageStory.id}">See similar movies →`) && !html.includes(`data-see-similar="${marriageStory.id}" data-similar-target`));
  check("at most two such buttons on a card", [arrival, piranesi, hades].every((item) => (card(item.id).match(/data-see-similar=/g) ?? []).length <= 2));
  state.areas = { ...state.areas, read: false };
  html = renderLibrary();
  check("with Books off, no Books with these vibes", !html.includes("Books with these vibes"));
  state.areas = { ...state.areas, read: true, tv: false };
  html = renderLibrary();
  check("with TV off, a book offers Movies with these vibes", html.includes(`data-similar-target="movies">Movies with these vibes →`));

  state.screen = "browse";
  state.browseSimilar = { id: arrival.id, title: "Arrival", type: "movie", targetDomain: "read" };
  state.browseItems = [{ id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", type: "book", title: "The Left Hand of Darkness", domains: ["read"], reason: "Shares sci-fi with Arrival." }];
  let out = renderBrowse();
  check("Browse heads it Books with the vibes of Arrival", out.includes("Books with the vibes of Arrival") && out.includes("data-browse-similar-close"), out.match(/<h2>[^<]*<\/h2>/)?.[0]);
  check("with each result's reason", out.includes('class="browse-why">Shares sci-fi with Arrival.'));
  state.browseItems = [];
  state.browseLoading = true;
  check("while loading it says what it's looking for", renderBrowse().includes("Finding books with the vibes of Arrival…"));
  state.browseLoading = false;
  out = renderBrowse();
  check("nothing found says so plainly", out.includes("Nothing close turned up for this one.") && out.includes("Try browsing by genre."));
  state.browseSimilar = { id: piranesi.id, title: "Piranesi", type: "book", targetDomain: "screen" };
  check("a book's heading", renderBrowse().includes("Movies and shows with the vibes of Piranesi"));
  state.browseSimilar = { id: piranesi.id, title: "Piranesi", type: "book" };
  check("See similar keeps its own heading", renderBrowse().includes("Books like Piranesi"));
});

finish();
