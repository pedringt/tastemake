#!/usr/bin/env node
// Oct 27: "See similar" from a liked item. Provider calls are stubbed (no network); no model call.
//
//   node scripts/qa/similar-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("similar tests");
const { similarToItem } = await import("../../src/catalog/related.mjs");
const { default: handler } = await import("../../api/similar.mjs");

const env = { TASTEMAKE_TMDB_TOKEN: "t" };
const arrival = { id: "tmdb-movie-329865", provider: "tmdb", providerId: "329865", type: "movie", title: "Arrival", domains: ["movies"], genres: ["878", "18"] };
const tmdbRows = [
  { id: 1001, title: "Contact", genre_ids: [878, 18], release_date: "1997-07-11", overview: "A scientist hears a signal.", popularity: 30 },
  { id: 1002, title: "Annihilation", genre_ids: [878, 27], release_date: "2018-02-22", overview: "A team enters the Shimmer.", popularity: 40 },
  { id: 329865, title: "Arrival", genre_ids: [878], release_date: "2016-11-10", overview: "Itself.", popularity: 50 },
  { id: 1003, title: "Already Rated Film", genre_ids: [878], release_date: "2015-01-01", overview: "Seen.", popularity: 20 }
];
let asked = [];
const fetchImpl = async (url) => {
  asked.push(String(url));
  if (String(url).includes("/movie/329865/recommendations")) return { ok: true, json: async () => ({ results: tmdbRows }) };
  throw new Error(`unexpected ${url}`);
};

{
  const out = await similarToItem(arrival, { env, fetchImpl, exclude: ["tmdb-movie-1003"] });
  const titles = out.map((i) => i.title);
  check("asks TMDb for this item's recommendations", asked.some((u) => u.includes("/movie/329865/recommendations")));
  check("returns related movies", titles.includes("Contact") && titles.includes("Annihilation"), titles.join(", "));
  check("never the item itself", !titles.includes("Arrival"));
  check("never something already reacted to", !titles.includes("Already Rated Film"));
  check("every result is the same type", out.every((i) => i.type === "movie"));
  check("each knows what it was found from", out.every((i) => i.relatedToId === arrival.id && i.relatedTo === "Arrival"));
}

// Oct 27 smoke test: "Books like Piranesi" listed Frieren vol. 12. Later volumes are left out, as in recommendations.
{
  const frieren = { id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", type: "book", title: "Frieren: Beyond Journey's End, Vol. 1", domains: ["read"], genres: ["Fantasy fiction", "Magic"] };
  const docs = [
    { key: "/works/OL2W", title: "Witch Hat Atelier, Vol. 2", author_name: ["Kamome Shirahama"], subject: ["Fantasy fiction", "Magic"] },
    { key: "/works/OL3W", title: "Frieren: Beyond Journey's End, Vol. 12", author_name: ["Kanehito Yamada"], subject: ["Fantasy fiction", "Magic"] },
    { key: "/works/OL4W", title: "Witch Hat Atelier, Vol. 1", author_name: ["Kamome Shirahama"], subject: ["Fantasy fiction", "Magic"] },
    { key: "/works/OL5W", title: "Ascendance of a Bookworm: Fanbook 3", author_name: ["Miya Kazuki"], subject: ["Fantasy fiction", "Magic"] }
  ];
  const bookFetch = async () => ({ ok: true, json: async () => ({ docs }) });
  const titles = (await similarToItem(frieren, { env: {}, fetchImpl: bookFetch, query: async () => [] })).map((i) => i.title);
  check("a series' first volume can be suggested", titles.includes("Witch Hat Atelier, Vol. 1"), titles.join(" | "));
  check("later volumes are not", !titles.some((t) => /Vol\. (2|12)$/.test(t)), titles.join(" | "));
  check("nor fan books", !titles.some((t) => /Fanbook/.test(t)), titles.join(" | "));
}

eq("an item without provider ids finds nothing (no guessing)", (await similarToItem({ title: "Custom", type: "book" }, { env, fetchImpl })).length, 0);
eq("a provider failure is an empty list, not an error", (await similarToItem(arrival, { env, fetchImpl: async () => { throw new Error("down"); } })).length, 0);

// The endpoint
{
  const makeRes = () => ({ headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const call = async (req) => { const res = makeRes(); await handler({ headers: {}, ...req }, res); return res; };
  eq("GET is refused", (await call({ method: "GET" })).code, 405);
  eq("invalid JSON is a 400", (await call({ method: "POST", body: "{nope" })).code, 400);
  eq("an unknown provider is a 400", (await call({ method: "POST", body: { item: { ...arrival, provider: "nope" } } })).code, 400);
  eq("a missing type is a 400", (await call({ method: "POST", body: { item: { ...arrival, type: undefined } } })).code, 400);

  const realFetch = globalThis.fetch, realToken = process.env.TASTEMAKE_TMDB_TOKEN;
  globalThis.fetch = fetchImpl;
  process.env.TASTEMAKE_TMDB_TOKEN = "t";
  try {
    const res = await call({ method: "POST", body: { item: arrival, exclude: ["tmdb-movie-1003"] } });
    check("answers with similar items", res.code === 200 && res.body.items.length >= 2, JSON.stringify(res.body).slice(0, 200));
    check("each with a reason naming the item it's like", res.body.items.every((i) => typeof i.reason === "string" && i.reason.length > 0 && /Arrival/.test(i.reason)), res.body.items.map((i) => i.reason).join(" / "));
    eq("never cached (it depends on what you've rated)", res.headers["cache-control"], "no-store");
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.TASTEMAKE_TMDB_TOKEN; else process.env.TASTEMAKE_TMDB_TOKEN = realToken;
  }
}

// The screens
{
  const { resetState, state } = await import("../../src/state.js");
  const { renderLibrary } = await import("../../src/screens/library.js");
  const { renderBrowse } = await import("../../src/screens/browse.js");
  resetState();
  state.onboarded = true;
  state.libraryView = "tried";
  const book = { id: "openlibrary-book-OLSIMW", provider: "openlibrary", providerId: "OLSIMW", type: "book", title: "Piranesi", domains: ["read"], genres: ["Fantasy fiction"] };
  const custom = { id: "custom-book-x", custom: true, type: "book", title: "Hand Added", domains: ["read"] };
  state.feedbackByRecommendation[book.id] = { item: book, rating: "more", detail: "liked-before" };
  state.feedbackByRecommendation[custom.id] = { item: custom, rating: "more", detail: "loved-before" };
  const html = renderLibrary();
  check("a liked item in Tried offers See similar books", html.includes(`data-see-similar="${book.id}">See similar books →`));
  check("an item with no catalog match doesn't", !html.includes(`data-see-similar="${custom.id}"`));

  state.screen = "browse";
  state.browseSimilar = { id: book.id, title: "Piranesi", type: "book" };
  state.browseItems = [{ id: "openlibrary-book-OLX", provider: "openlibrary", providerId: "OLX", type: "book", title: "Jonathan Strange", domains: ["read"], reason: "Shares fantasy with Piranesi." }];
  let out = renderBrowse();
  check("Browse shows the results as Books like Piranesi", out.includes("Books like Piranesi") && out.includes("data-browse-similar-close"));
  check("with each result's reason", out.includes('class="browse-why">Shares fantasy with Piranesi.'));
  check("and no genre controls or Show more", !out.includes("data-browse-genre") && !out.includes("data-browse-more"));
  state.browseItems = [];
  state.browseLoading = true;
  check("while loading it says what it's looking for", renderBrowse().includes("Finding things like Piranesi…"));
  state.browseLoading = false;
  check("nothing found says why it may be", renderBrowse().includes("You may have rated the close matches already."));
}

finish();
