#!/usr/bin/env node
// #321: two review fragments, kept apart as two failure classes. Free, no browser, no network, no model call.
//
//   A. wrong-item metadata: a card shows facts from another work with the same title (another media type,
//      year or provider id), so the pitch and the card disagree because they describe different things.
//   B. generated reasoning: the item is right, and the model's sentence is unsupported by, or reads as
//      contradicting, what it was given or what the card shows.
//
// What the review supplied (nothing else exists: no screenshot, card output, ids, dates or payloads):
//   - Crystal Lake: pitched as a "grief-haunted mystery". Version shown: NOT RECORDED.
//   - The Mist: pitch mentioned "isolating supernatural fog"; the card's truncated synopsis mentioned a
//     "family torn apart by a brutal crime". Version shown: NOT RECORDED.
// Rows below are the real TMDb metadata for each same-title version, read from the public TMDb pages on
// Nov 2 2026 (ids, genres, first year, overview). Which one a reviewer saw is inferred in the comments,
// never assumed by a check.
//
//   node scripts/qa/pitch-provenance-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
const { tmdbItem } = await import("../../src/catalog/providers.mjs");
const { buildContext } = await import("../../src/ai/context.js");
const { buildPickPrompt, normalizeModelPicks } = await import("../../api/recommendations.mjs");
const { validatePicks } = await import("../../src/ai/validate.js");
const { fallbackReason } = await import("../../src/catalog/fallback-reasons.mjs");
const { truncateCopy } = await import("../../src/screens/recommendations.js");
const { safeAbout } = await import("../../src/catalog/synopsis.mjs");
const { emptyState, react } = await import("../evals/fixtures.mjs");
const { createSuite } = await import("./lib/assert.mjs");

const { check, eq, finish } = createSuite("pitch provenance tests");

const ROWS = {
  mistSeries: { kind: "tv", row: { id: 68315, name: "The Mist", first_air_date: "2017-01-01", genre_ids: [10765, 9648, 18], overview: "A small town family is torn apart by a brutal crime. As they deal with the fallout an eerie mist rolls in, suddenly cutting them off from the rest of the world, and in some cases, each other." } },
  mistFilm: { kind: "movie", row: { id: 5876, title: "The Mist", release_date: "2007-01-01", genre_ids: [27, 878, 53], overview: "After a violent storm, a dense cloud of mist envelops a small Maine town, trapping David Drayton and his five-year-old son in a local grocery store with other local residents. They soon discover that the mist conceals deadly horrors that threaten their lives, and worse, their sanity." } },
  crystalSeries: { kind: "tv", row: { id: 213562, name: "Crystal Lake", first_air_date: "2026-01-01", genre_ids: [18, 9648], overview: "Single mother Pam Voorhees has been unable to shake her grief after her young, sickly son Jason tragically drowned in the town lake almost a year before. When two strangers arrive at Pam's door digging into her past, a disturbing chain of events is set into motion, leaving the townspeople of Crystal Lake wondering: just who is Pam Voorhees?" } },
  crystalFilm: { kind: "movie", row: { id: 1267470, title: "Crystal Lake", release_date: "2024-01-01", genre_ids: [27], overview: "A group of friends vacation at a house that's connected to a dark past." } }
};
// The month/day above is a placeholder (only the year was read); no check depends on it.
const item = (key) => tmdbItem(ROWS[key].row, ROWS[key].kind);
const mistSeries = item("mistSeries");
const mistFilm = item("mistFilm");
const crystalSeries = item("crystalSeries");
const crystalFilm = item("crystalFilm");
const cardSynopsis = (it) => truncateCopy(safeAbout(it), 90);   // ABOUT_MAX_CHARS on a recommendation card

// ---- A. identity: same title, different works ------------------------------------------------------------
{
  const ids = [mistSeries, mistFilm, crystalSeries, crystalFilm].map((it) => it.id);
  eq("same-title versions keep their own ids (media type + provider id)", ids.join(), "tmdb-tv-68315,tmdb-movie-5876,tmdb-tv-213562,tmdb-movie-1267470");
  eq("and their own years", [mistSeries, mistFilm, crystalSeries, crystalFilm].map((it) => it.year).join(), "2017,2007,2026,2024");
  check("each keeps its own synopsis", /brutal crime/.test(mistSeries.about) && !/brutal crime/.test(mistFilm.about) && /grief/.test(crystalSeries.about) && !/grief/.test(crystalFilm.about));
  // A collision TMDb allows: movie and TV ids are separate id spaces.
  const sameNumber = tmdbItem({ ...ROWS.mistFilm.row, id: 68315 }, "movie");
  check("a movie and a series with the same numeric TMDb id stay distinct", sameNumber.id !== mistSeries.id);
}
{
  // Both Mists as candidates in one request: each prompt row carries its own facts, and a validated pick
  // returns the candidate it named, so the card can only show that item's synopsis.
  const s = emptyState([]);
  s.recommendationSets = [];
  react(s, { id: "tmdb-tv-4607", provider: "tmdb", providerId: "4607", type: "tv", domains: ["tv"], title: "Lost", genres: ["9648", "10759", "18"] }, "loved");
  const ctx = buildContext(s, [mistSeries, mistFilm, crystalSeries, crystalFilm]);
  const prompt = buildPickPrompt(ctx, 2);
  const rows = JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8)).candidates;
  const row = (id) => rows.find((r) => r.id === id);
  check("(setup) all four reach the prompt", [mistSeries, mistFilm, crystalSeries, crystalFilm].every((it) => row(it.id)), rows.map((r) => r.id).join());
  check("the series row carries the series' facts", row(mistSeries.id)?.type === "tv" && row(mistSeries.id)?.year === "2017" && /brutal crime/.test(row(mistSeries.id)?.about));
  check("the film row carries the film's facts", row(mistFilm.id)?.type === "movie" && row(mistFilm.id)?.year === "2007" && /grocery store/.test(row(mistFilm.id)?.about));
  const ref = ctx.evidence.find((r) => r.title === "Lost")?.ref;
  const out = validatePicks(normalizeModelPicks({ picks: [{ itemId: mistSeries.id, why: "Isolating supernatural fog, the same cut-off dread as Lost.", cites: [ref] }], curveballItemId: null }), ctx);
  eq("a validated pick is the exact candidate it named", out.accepted[0]?.item?.id, mistSeries.id);
  check("so its card synopsis is the series', never the film's", /brutal crime/.test(cardSynopsis(out.accepted[0].item)) && !/grocery/.test(cardSynopsis(out.accepted[0].item)));
}

// ---- B. reasoning: right item, sentence vs what was given and what is shown -------------------------------
{
  // The Mist: the card fragment matches only the 2017 series (inferred version). The model is sent up to
  // 220 characters of synopsis; the card shows up to 90, cut at the first sentence. The fog sentence is in
  // what the model saw and not in what the card shows, so a correct pitch reads as describing another work.
  const sent = mistSeries.about.slice(0, 220);
  const shown = cardSynopsis(mistSeries);
  eq("card synopsis: first sentence only", shown, "A small town family is torn apart by a brutal crime.");
  check("the mist is in what the model was sent", /eerie mist/.test(sent) && /cutting them off/.test(sent));
  check("and not in what the card shows (the gap behind the review's mismatch)", !/mist|fog/i.test(shown));
  check("the review's card fragment cannot come from the 2007 film", !/brutal crime/.test(cardSynopsis(mistFilm)));
}
{
  // Crystal Lake: "grief-haunted mystery" matches the 2026 series' TMDb facts (Drama, Mystery; the
  // overview is about Pam Voorhees' grief). TMDb carries no Horror genre for it, so the slasher-prequel
  // premise is not in what Tastemake sends; the 2024 film (Horror) does not fit the pitch at all.
  eq("the series' genres as Tastemake stores them", crystalSeries.genres.join(), "18,9648");
  check("grief is in its synopsis, horror is not in its genres", /grief/.test(crystalSeries.about) && !crystalSeries.genres.includes("27"));
  check("the 2024 film is horror with no grief in its synopsis", crystalFilm.genres.includes("27") && !/grief/.test(crystalFilm.about));
}
{
  // Deterministic fallback (AI paused or rejected): only shared catalog tags, never plot, tone or premise.
  const lost = { id: "tmdb-tv-4607", provider: "tmdb", type: "tv", title: "Lost", genres: ["9648", "10759", "18"] };
  const reasons = [mistSeries, crystalSeries].flatMap((it) => [0, 1, 2, 3, 4].map((index) => fallbackReason({ ...it, relatedTo: "Lost" }, lost, { index })));
  check("fallback reasons name only shared genres", reasons.every((r) => /mystery|drama/.test(r)), reasons.join(" | "));
  check("and never plot or tone words", reasons.every((r) => !/grief|fog|mist|crime|isolat|supernatural|haunt|slasher/i.test(r)), reasons.join(" | "));
  const thin = fallbackReason({ ...tmdbItem({ id: 1, name: "No Tags", genre_ids: [], overview: "" }, "tv"), relatedTo: "Lost" }, lost);
  eq("thin metadata says so instead of inventing", thin, "Found through Lost; it has no tags in common with it to show yet.");
}

finish();
