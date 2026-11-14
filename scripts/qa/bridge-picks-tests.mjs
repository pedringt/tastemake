#!/usr/bin/env node
// #252 part 2 (Oct 27): one cross-media "bridge" pick in recommendations. Provider calls are stubbed (no
// network) and the model is never called: prompts are only built, and model answers are written by hand.
// Each section runs on its own, so on code without bridge picks every check reports a failure instead of
// the suite stopping at the first missing export.
//
//   node scripts/qa/bridge-picks-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("bridge picks tests");
const load = async (path) => { try { return await import(path); } catch { return {}; } };
const related = await import("../../src/catalog/related.mjs");
const { chooseCandidates } = await import("../../src/ai/taste-score.js");
const { validatePicks } = await import("../../src/ai/validate.js");
const { buildContext } = await import("../../src/ai/context.js");
const recs = await import("../../api/recommendations.mjs");
const bridges = await load("../../src/catalog/bridges.mjs");

async function section(name, run) {
  try { await run(); } catch (error) { check(`${name} runs`, false, String(error?.message ?? error).slice(0, 200)); }
}

// Realistic fixtures (providers.mjs shapes).
const movie = (id, title, genreIds) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), type: "movie", title, domains: ["movies"], genres: genreIds.map(String), providerMeta: { genreIds, collectionId: null }, about: `${title}.` });
const show = (id, title, genreIds) => ({ id: `tmdb-tv-${id}`, provider: "tmdb", providerId: String(id), type: "tv", title, domains: ["tv"], genres: genreIds.map(String), providerMeta: { genreIds }, about: `${title}.` });
const book = (key, title, subjects, by = "Someone") => ({ id: `openlibrary-book-${key}`, provider: "openlibrary", providerId: key, type: "book", title, domains: ["read"], by, genres: subjects, providerMeta: {}, about: "Book from Open Library." });
const arrival = movie(329865, "Arrival", [878, 18]);
const contact = movie(686, "Contact", [878, 18, 9648]);
const annihilation = movie(300668, "Annihilation", [878, 27, 9648]);
const severance = show(95396, "Severance", [18, 9648, 10765]);
const marriageStory = movie(492188, "Marriage Story", [18]);
const piranesi = book("OL20893680W", "Piranesi", ["Fantasy fiction", "Fiction, mystery & detective, general"], "Susanna Clarke");

const loved = (item) => ({ item, rating: "more", detail: "loved-before", refinements: [] });
const liked = (item) => ({ item, rating: "more", detail: "liked-before", refinements: [] });
function stateWith(feedback, extra = {}) {
  return {
    selectedFavorites: new Set(), customItems: {}, libraryFavorites: new Set(), recommendationSets: [], seenItemIds: [], exclusions: [],
    areas: { movies: true, tv: true, read: true, play: true }, curveball: true, recommendationFilter: "all",
    feedbackByRecommendation: Object.fromEntries(feedback.map((f) => [f.item.id, f])),
    ...extra
  };
}
const screenFan = (extra) => stateWith([loved(arrival), loved(contact), liked(severance)], extra);

// ---- when a bridge is tried ------------------------------------------------------------------------
await section("the conditions", () => {
  const { chooseBridge } = related;
  const anchors = (state) => Object.values(state.feedbackByRecommendation).map((f) => ({ ...f.item, anchorStrength: f.detail === "loved-before" ? 3 : 1 }));
  const pick = (state) => chooseBridge(state, anchors(state));
  const yes = pick(screenFan());
  check("movies Loved, no books: a bridge from a Loved film to books", yes?.targetDomain === "read" && [arrival.id, contact.id].includes(yes.source.id), JSON.stringify(yes && { to: yes.targetDomain, from: yes.source.title }));
  eq("not with Surprise Me off", pick(screenFan({ curveball: false })), null);
  eq("not with the Movies filter", pick(screenFan({ recommendationFilter: "movies" })), null);
  eq("not with Books off (films never bridge to shows)", pick(screenFan({ areas: { movies: true, tv: true, read: false, play: true } })), null);
  eq("not from a single Loved film", pick(stateWith([loved(arrival), liked(contact)])), null);
  eq("not from Loved films with no shelf in books (drama only)", pick(stateWith([loved(marriageStory), loved(movie(1, "Another Drama", [18]))])), null);
  const reader = stateWith([loved(arrival), loved(contact), ...["A", "B", "C"].map((k) => liked(book(`OL${k}W`, `Book ${k}`, ["Science fiction"])))]);
  eq("not when books already have three ratings", pick(reader), null);
  const twoBooks = stateWith([loved(arrival), loved(contact), liked(book("OLAW", "Book A", ["Science fiction"])), liked(book("OLBW", "Book B", ["Science fiction"]))]);
  eq("still with two (few) book ratings", pick(twoBooks)?.targetDomain, "read");
  const bookFan = stateWith([loved(piranesi), loved(book("OLCW", "Jonathan Strange", ["Fantasy fiction", "Magic"])), liked(arrival), liked(contact), liked(annihilation)]);
  eq("books Loved, few shows: a bridge from a book to shows", pick(bookFan)?.targetDomain, "tv");
});

// ---- retrieval -------------------------------------------------------------------------------------
const OL_BOOKS = [
  { key: "/works/OL1W", title: "The Left Hand of Darkness", author_name: ["Ursula K. Le Guin"], first_publish_year: 1969, subject: ["Science fiction"] },
  { key: "/works/OL2W", title: "Arrival", author_name: ["Ted Chiang"], first_publish_year: 2016, subject: ["Science fiction"] },
  { key: "/works/OL3W", title: "Exhalation", author_name: ["Ted Chiang"], first_publish_year: 2019, subject: ["Science fiction", "Short stories"] },
  { key: "/works/OL4W", title: "Roadside Picnic", author_name: ["Arkady Strugatsky"], first_publish_year: 1972, subject: ["Science fiction"] }
];
const TMDB_RECS = [
  { id: 1001, title: "Interstellar", genre_ids: [878, 18, 12], release_date: "2014-11-05", overview: "Space." },
  { id: 1002, title: "Gravity", genre_ids: [878, 53], release_date: "2013-10-03", overview: "Orbit." },
  { id: 1003, title: "Moon", genre_ids: [878, 18], release_date: "2009-06-12", overview: "Moon." }
];
function catalogFetch(calls) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("api.themoviedb.org/3/movie/") && u.includes("/recommendations")) return { ok: true, json: async () => ({ results: TMDB_RECS }) };
    if (u.startsWith("https://openlibrary.org/search.json?subject=science_fiction")) return { ok: true, json: async () => ({ docs: OL_BOOKS }) };
    if (u.includes("api.themoviedb.org/3/tv/") && u.includes("/recommendations")) return { ok: true, json: async () => ({ results: [] }) };
    return { ok: false, json: async () => ({}) };
  };
}
const env = { TASTEMAKE_TMDB_TOKEN: "test-token-not-real" };
const quietly = async (fn) => { const info = console.info; console.info = () => {}; try { return await fn(); } finally { console.info = info; } };

await section("retrieval", async () => {
  const calls = [];
  const out = await quietly(() => related.retrieveCatalogCandidates(screenFan(), { env, fetchImpl: catalogFetch(calls), query: async () => [] }));
  const bridged = out.filter((item) => item.bridge);
  check("asks Browse's Open Library sci-fi shelf", calls.some((u) => u.includes("subject=science_fiction")), calls.join(" "));
  check("adds bridge books", bridged.length >= 1 && bridged.every((item) => item.type === "book"), out.map((i) => i.title).join(" | "));
  check("at most two", bridged.length <= related.MAX_BRIDGE_CANDIDATES && related.MAX_BRIDGE_CANDIDATES === 2);
  check("each marked as found from a Loved film", bridged.every((item) => [arrival.id, contact.id].includes(item.relatedToId) && item.bridge.fromDomain === "movies" && item.bridge.sharedGenres.includes("sci-fi")));
  check("not the book of a film they loved", !bridged.some((item) => item.title === "Arrival"));
  check("the same-medium candidates are still there", out.some((item) => item.title === "Interstellar"));

  const offCalls = [];
  const off = await quietly(() => related.retrieveCatalogCandidates(screenFan({ curveball: false }), { env, fetchImpl: catalogFetch(offCalls), query: async () => [] }));
  check("with Surprise Me off: no bridge and no Open Library call", !off.some((item) => item.bridge) && !offCalls.some((u) => u.includes("openlibrary.org/search.json?subject")), offCalls.join(" "));
  const moviesOnly = await quietly(() => related.retrieveCatalogCandidates(screenFan({ recommendationFilter: "movies" }), { env, fetchImpl: catalogFetch([]), query: async () => [] }));
  check("with the Movies filter: no bridge", !moviesOnly.some((item) => item.bridge));
  const reacted = screenFan();
  reacted.feedbackByRecommendation["openlibrary-book-OL1W"] = { item: book("OL1W", "The Left Hand of Darkness", ["Science fiction"]), rating: "not-tried", detail: "bookmarked" };
  const again = await quietly(() => related.retrieveCatalogCandidates(reacted, { env, fetchImpl: catalogFetch([]), query: async () => [] }));
  check("never a book already reacted to", !again.some((item) => item.id === "openlibrary-book-OL1W"));
  const down = await quietly(() => related.retrieveCatalogCandidates(screenFan(), { env, fetchImpl: async (url) => (String(url).includes("openlibrary") ? Promise.reject(new Error("down")) : catalogFetch([])(url)), query: async () => [] }));
  check("a failed shelf just means no bridge", !down.some((item) => item.bridge) && down.some((item) => item.title === "Interstellar"));
});

// ---- the offer ----------------------------------------------------------------------------------------
const evidenceFor = (state) => buildContext(state, []).evidence;
const bridgeBook = (key, title, from = arrival) => ({ ...book(key, title, ["Science fiction"]), relatedTo: from.title, relatedToId: from.id, bridge: { fromId: from.id, fromDomain: "movies", sharedGenres: ["sci-fi"] } });
const pool = [
  { ...movie(1001, "Interstellar", [878, 18]), relatedTo: "Arrival", relatedToId: arrival.id },
  { ...movie(1002, "Gravity", [878, 53]), relatedTo: "Contact", relatedToId: contact.id },
  { ...movie(1003, "Moon", [878, 18]), relatedTo: "Arrival", relatedToId: arrival.id },
  { ...show(2001, "Dark", [18, 9648, 10765]), relatedTo: "Severance", relatedToId: severance.id },
  { ...show(2002, "Black Mirror", [18, 10765]), relatedTo: "Severance", relatedToId: severance.id },
  { ...movie(1004, "Coherence", [878, 53, 9648]), relatedTo: "Contact", relatedToId: contact.id },
  bridgeBook("OL1W", "The Left Hand of Darkness"),
  bridgeBook("OL3W", "Exhalation"),
  bridgeBook("OL4W", "Roadside Picnic", contact)
];

await section("the offer", () => {
  const records = evidenceFor(screenFan());
  const offered = chooseCandidates(pool, records, { count: 6, mode: "all", curveball: true });
  const bridgesOffered = offered.filter((item) => item.bridge);
  eq("at most one bridge is offered", bridgesOffered.length, 1);
  eq("in the Surprise Me slot (last)", offered.at(-1)?.bridge ? "last" : "elsewhere", "last");
  eq("six are still offered", offered.length, 6);
  check("it isn't also marked as an edge pick", !offered.at(-1).edge);
  const off = chooseCandidates(pool, records, { count: 6, mode: "all", curveball: false });
  eq("with Surprise Me off, none", off.filter((item) => item.bridge).length, 0);
  const plain = pool.filter((item) => !item.bridge);
  eq("with no bridge candidates, the offer is exactly what it was", JSON.stringify(chooseCandidates([...plain, ...pool.filter((i) => i.bridge)], records, { count: 6, mode: "movies", curveball: true }).map((i) => i.id)), JSON.stringify(chooseCandidates(plain, records, { count: 6, mode: "movies", curveball: true }).map((i) => i.id)));
});

// ---- the prompt -----------------------------------------------------------------------------------
await section("the prompt", () => {
  const state = screenFan();
  const ctx = buildContext(state, pool);
  const offered = recs.offeredCandidates(ctx);
  const prompt = recs.buildPickPrompt({ ...ctx, candidates: offered }, offered.length);
  check("has the bridge rule", typeof recs.BRIDGE_RULE === "string" && prompt.includes(recs.BRIDGE_RULE));
  check("the rule says it's a cross-medium test and to name and cite the source", /cross-medium test/.test(recs.BRIDGE_RULE ?? "") && /name the bridgeFrom item, cite it, and say it is a test/.test(recs.BRIDGE_RULE ?? ""));
  const context = JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8));
  const sent = context.candidates.find((c) => c.bridge);
  check("the bridge candidate is sent with bridge:true and its source ref", sent && sent.bridge === true && /^ev:tmdb-movie-/.test(sent.bridgeFrom), JSON.stringify(sent));
  check("and that source is in the evidence the model sees", context.evidence.some((e) => e.ref === sent?.bridgeFrom));
  const plainCtx = buildContext(state, pool.filter((i) => !i.bridge));
  const plainPrompt = recs.buildPickPrompt({ ...plainCtx, candidates: recs.offeredCandidates(plainCtx) }, 6);
  check("without a bridge candidate the prompt never mentions bridges", !/bridge/i.test(plainPrompt));
  const offCtx = buildContext(screenFan({ curveball: false }), pool);
  const offPrompt = recs.buildPickPrompt({ ...offCtx, candidates: recs.offeredCandidates(offCtx) }, 6);
  check("with Surprise Me off the prompt never mentions bridges", !/bridge/i.test(offPrompt));
});

// ---- the validator -------------------------------------------------------------------------------
await section("the validator", () => {
  const state = screenFan();
  const ctx = buildContext(state, pool);
  const good = { itemId: "openlibrary-book-OL1W", why: "A book test: the quiet dread of Arrival, on the page.", cites: [`ev:${arrival.id}`], tests: null, kind: "curveball" };
  const second = { itemId: "openlibrary-book-OL3W", why: "Another book test: Arrival's patience, in stories.", cites: [`ev:${arrival.id}`], tests: null, kind: "pick" };
  const normal = { itemId: "tmdb-movie-1001", why: "Grief and time folding together, like Arrival.", cites: [`ev:${arrival.id}`], tests: null, kind: "pick" };
  const res = validatePicks({ picks: [normal, good, second] }, ctx);
  check("a labeled bridge pick citing its source is accepted", res.accepted.some((p) => p.itemId === good.itemId), JSON.stringify(res.rejected));
  check("a second bridge pick is rejected", res.rejected.some((r) => r.proposal.itemId === second.itemId && r.reasons.includes("more than one cross-medium test")), JSON.stringify(res.rejected));
  check("a normal pick is unaffected", res.accepted.some((p) => p.itemId === normal.itemId));
  const off = validatePicks({ picks: [good] }, { ...ctx, areas: { ...ctx.areas, read: false } });
  check("a bridge pick into an area that's off is rejected", off.rejected.some((r) => r.reasons.includes("cross-medium test into an area that is off")), JSON.stringify(off.rejected));
  const uncited = validatePicks({ picks: [{ ...good, cites: [`ev:${contact.id}`] }] }, ctx);
  check("one not citing the item it was found from is rejected", uncited.rejected.some((r) => r.reasons.includes("cross-medium test does not cite the item it was found from")), JSON.stringify(uncited.rejected));
  const unlabeled = validatePicks({ picks: [{ ...good, why: "The quiet dread of Arrival, on the page." }] }, ctx);
  check("one whose why doesn't say it's a test is rejected", unlabeled.rejected.some((r) => r.reasons.includes("cross-medium test is not labeled as a test")), JSON.stringify(unlabeled.rejected));
});

// ---- the no-AI fallback ------------------------------------------------------------------------------
await section("the fallback", async () => {
  const state = screenFan();
  const rawState = { ...state, selectedFavorites: [], libraryFavorites: [] };
  const payload = await quietly(() => recs.produceRecommendations({ rawState, env: {}, fetchImpl: async () => { throw new Error("no network"); }, retrieve: async () => pool }));
  eq("with live AI off it falls back to catalog picks", payload.source, "catalog");
  const bridged = payload.picks.filter((p) => p.bridge);
  eq("with at most one bridge pick", bridged.length, 1);
  eq("whose reason says it's a test and names only the shared genre", bridged[0]?.reason, "A book test: shares sci-fi with Arrival.");
  eq("and no model call was made", payload.meta.paidCallMade, false);
  eq("the reason without shared genres still says test", recs.bridgeFallbackReason?.({ type: "book", relatedTo: "Arrival", bridge: { sharedGenres: [] } }), "A book test, found from something you loved.");
});

// ---- the card --------------------------------------------------------------------------------------
await section("the card", async () => {
  const { state, resetState } = await import("../../src/state.js");
  const { renderRecommendations } = await import("../../src/screens/recommendations.js");
  resetState();
  state.onboarded = true;
  state.feedbackByRecommendation[arrival.id] = loved(arrival);
  const pick = { ...bridgeBook("OL1W", "The Left Hand of Darkness"), surprise: true, rank: null, reason: "A book test: the quiet dread of Arrival, on the page.", ai: { kind: "curveball", cites: [`ev:${arrival.id}`] } };
  const normal = { ...movie(1001, "Interstellar", [878, 18]), relatedTo: "Arrival", relatedToId: arrival.id, rank: 1, reason: "Grief and time, like Arrival.", ai: { kind: "pick", cites: [`ev:${arrival.id}`] } };
  state.recommendationSets = [[normal, pick]];
  const html = renderRecommendations();
  check("the bridge card shows a Cross-media test tag", html.includes('<span class="rec-bridge-tag">Cross-media test</span>'));
  eq("only on that card", (html.match(/rec-bridge-tag/g) ?? []).length, 1);
  check("its popover is headed Cross-media test", html.includes('<span class="why-kicker">Cross-media test</span>'));
  check("and says what it tests", html.includes("This tests whether what you loved in Arrival carries over to books."));
  check("Found from names the source and how", html.includes("<strong>Found from:</strong> Arrival (loved), through the genres they share."));
  check("the Surprise Me sticker still shows", html.includes("SURPRISE<br />ME"));
});

// ---- the stress profiles mark bridge books the way the code does --------------------------------------
await section("the stress profiles", async () => {
  const { loadProfileSpecs, itemsIndex, candidateItems } = await import("../evals/stress/profiles.mjs");
  const index = itemsIndex();
  const specs = loadProfileSpecs().filter((spec) => spec.bridges);
  check("there are bridge profiles", specs.length === 6);
  for (const spec of specs) {
    const source = index.get(spec.bridges[0].fromId);
    const queries = bridges.bridgeQueriesFor(source, "read");
    const marked = candidateItems(spec, { itemsById: index }).filter((item) => item.bridge);
    const agree = marked.every((item) => queries.some((q) => JSON.stringify(bridges.sharedBridgeLabels(item, source, q)) === JSON.stringify(item.bridge.sharedGenres)));
    check(`${spec.id}: its marks match bridgeQueriesFor and sharedBridgeLabels`, agree, `${source.title}: ${JSON.stringify(queries)} / ${marked.map((m) => `${m.title}=${JSON.stringify(bridges.sharedBridgeLabels(m, source, queries[0]))}`).join(" ")}`);
  }
});

finish();
