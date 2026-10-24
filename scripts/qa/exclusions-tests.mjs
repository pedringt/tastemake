#!/usr/bin/env node
// #48: "never recommend" boundaries. Matching per medium, the card menu's options, that blocked
// candidates never reach a pick (live AI or fallback), and that a boundary is never taste evidence.
// Free, no network, no model call.
//
//   node scripts/qa/exclusions-tests.mjs

import { addExclusion, creatorsOf, dropExcludedFromActiveSet, excludedBy, exclusionOptions, genresOf, makeExclusion, removeExclusion } from "../../src/model/exclusions.js";
import { buildContext } from "../../src/ai/context.js";
import { serializeAiState } from "../../src/ai/live-client.js";
import { hydrateState } from "../../src/server/request-state.mjs";
import { emptyState, react } from "../evals/fixtures.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("exclusions tests");

const book = (id, title, by, genres = [], meta = {}) => ({ id: `openlibrary-book-${id}`, provider: "openlibrary", providerId: id, type: "book", domains: ["read"], title, by, genres, providerMeta: meta });
const movie = (id, title, genres = [], meta = {}) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), type: "movie", domains: ["movies"], title, genres: genres.map(String), providerMeta: meta });
const show = (id, title, genres = []) => ({ id: `tmdb-tv-${id}`, provider: "tmdb", providerId: String(id), type: "tv", domains: ["tv"], title, genres: genres.map(String), providerMeta: {} });
const game = (id, title, genres = [], themes = [], meta = {}) => ({ id: `igdb-game-${id}`, provider: "igdb", providerId: String(id), type: "game", domains: ["play"], title, genres, providerMeta: { themes, ...meta } });

const it = book("OL1W", "It", "Stephen King", ["Horror tales", "Fiction"]);
const shining = book("OL2W", "The Shining", "Stephen King, Jack Torrance", ["Psychological fiction"]);
const dune = book("OL3W", "Dune", "Frank Herbert", ["Science fiction"], { seriesKey: "OL9S", seriesKeys: ["OL9S"], seriesNames: ["dune"] });
const messiah = book("OL4W", "Dune Messiah", "Frank Herbert", ["Science fiction"], { seriesKeys: ["OL9S"] });
const conjuring = movie(138843, "The Conjuring", [27, 53], { collectionId: 313086 });
const conjuring2 = movie(259693, "The Conjuring 2", [27], { collectionId: 313086 });
const arrival = movie(329865, "Arrival", [18, 878, 9648]);
const haunting = show(72844, "The Haunting of Hill House", [18, 9648]);
const reVillage = game(1, "Resident Evil Village", ["Shooter", "Adventure"], ["Action", "Horror"]);
const outerWilds = game(2, "Outer Wilds", ["Puzzle", "Adventure"], ["Science fiction"]);

// ---- matching per medium ------------------------------------------------------------------------------
eq("book genres read from subjects", genresOf(it).join(), "horror");
eq("movie genres read from TMDb ids", genresOf(conjuring).join(), "horror");
eq("game horror is an IGDB theme", genresOf(reVillage).join(), "horror");
eq("TV has no horror label in TMDb, so nothing is claimed", genresOf(haunting).join(), "");
eq("creators: every listed author, normalized", creatorsOf(shining).map((c) => c.key).join("|"), "stephen king|jack torrance");
eq("creators: a director counts once Tastemake knows it", creatorsOf({ ...arrival, director: "Denis Villeneuve" }).map((c) => c.label).join(), "Denis Villeneuve");

{
  const blocks = [makeExclusion("genre", "horror"), makeExclusion("creator", "stephen king", it), makeExclusion("series", dune.id, dune)];
  eq("genre block catches a horror movie", excludedBy(conjuring, blocks)?.id, "genre:horror");
  eq("genre block catches a horror game", excludedBy(reVillage, blocks)?.id, "genre:horror");
  eq("creator block catches another book by them", excludedBy(shining, blocks)?.id, "creator:stephen king");
  eq("series block catches a later book", excludedBy(messiah, blocks)?.id, `series:${dune.id}`);
  check("unrelated titles are kept", [arrival, outerWilds, haunting].every((item) => !excludedBy(item, blocks)));
  const movieSeries = makeExclusion("series", conjuring.id, conjuring);
  eq("series block on a film catches the sequel by collection", excludedBy(conjuring2, [movieSeries])?.id, `series:${conjuring.id}`);
  check("a series block survives the wire (ref kept)", hydrateState(JSON.parse(JSON.stringify(serializeAiState({ ...emptyState(), exclusions: [movieSeries] })))).exclusions[0].ref?.providerMeta?.collectionId === 313086);
  eq("a creator typed by name matches regardless of case and accents", excludedBy(book("OL5W", "X", "STEPHEN KÍNG"), [makeExclusion("creator", "Stephen King")])?.kind, "creator");
  eq("a name under three letters is refused", makeExclusion("creator", "Al"), null);
}

// ---- the card menu only offers what is known ----------------------------------------------------------
eq("a horror book by a known author", exclusionOptions(it).map((o) => o.kind).join(), "creator,genre");
eq("a book in a series", exclusionOptions(dune).map((o) => o.kind).join(), "creator,series");
eq("a movie with no known creator, series or blockable genre offers nothing", exclusionOptions(arrival).length, 0);
check("labels read as plain English", exclusionOptions(conjuring).map((o) => o.label).join(" / ") === "The Conjuring and its series / All horror", exclusionOptions(conjuring).map((o) => o.label).join(" / "));

// ---- adding, removing, and the set on screen ---------------------------------------------------------
{
  const s = emptyState();
  addExclusion(s, makeExclusion("genre", "horror"));
  addExclusion(s, makeExclusion("genre", "horror"));
  eq("adding the same block twice keeps one", s.exclusions.length, 1);
  check("removing it works", removeExclusion(s, "genre:horror") && s.exclusions.length === 0);

  s.recommendationSets = [[conjuring, arrival, reVillage, outerWilds]];
  react(s, reVillage, "liked");
  const removed = dropExcludedFromActiveSet(s, makeExclusion("genre", "horror"));
  eq("unrated matching picks leave the set on screen", s.recommendationSets[0].map((i) => i.title).join(), "Arrival,Resident Evil Village,Outer Wilds");
  eq("a pick already reacted to stays (its reaction is the person's)", removed, 1);
  check("nothing is recorded about the removed pick", !s.feedbackByRecommendation[conjuring.id]);
}

// ---- never taste evidence ------------------------------------------------------------------------------
{
  const s = emptyState();
  react(s, arrival, "loved");
  react(s, it, "loved");
  const before = JSON.stringify(buildContext(s).evidence);
  addExclusion(s, makeExclusion("creator", "stephen king", it));
  addExclusion(s, makeExclusion("genre", "horror"));
  eq("blocks do not change the evidence the model sees", JSON.stringify(buildContext(s).evidence), before);
  check("a loved Stephen King book still counts as loved", buildContext(s).evidence.some((r) => r.itemId === it.id && r.polarity > 0));
}

// ---- server: blocked candidates never reach a pick ------------------------------------------------------
{
  const { produceRecommendations } = await import("../../api/recommendations.mjs");
  const s = emptyState();
  react(s, arrival, "loved");
  const pool = [conjuring, conjuring2, it, shining, outerWilds, movie(1, "Moon", [878]), movie(2, "Contact", [878, 18]), book("OL6W", "Hyperion", "Dan Simmons", ["Science fiction"])];
  const rawState = JSON.parse(JSON.stringify({ ...serializeAiState(s), exclusions: [makeExclusion("genre", "horror"), makeExclusion("creator", "stephen king", it)] }));
  const out = await produceRecommendations({ rawState, env: {}, retrieve: async () => pool });
  const titles = out.picks.map((p) => p.title);
  check("fallback picks skip blocked genres and creators", !titles.some((t) => ["The Conjuring", "The Conjuring 2", "It", "The Shining"].includes(t)), titles.join(", "));
  check("and still offer the rest", titles.includes("Moon") && titles.includes("Outer Wilds"), titles.join(", "));
  const none = await produceRecommendations({ rawState: JSON.parse(JSON.stringify(serializeAiState(s))), env: {}, retrieve: async () => pool });
  check("without blocks the same pool is offered as before", none.picks.some((p) => p.title === "The Conjuring"), none.picks.map((p) => p.title).join(", "));
}

finish();
