// #334: a "Not me" correction changes which titles are shortlisted, for live AI and the catalog fallback
// alike. Paige's rules (Nov 13): "Not me" strongly down-ranks matching titles (not an exclusion); "matters a
// little" changes nothing yet (#323); a set whose Surprise candidates all conflict has no Surprise. Nov 15: a
// Partly's unticked areas are a "Not me" in those areas only, and its kept areas guard like a Yes.
// Free: no network, no model (the live path runs against a stubbed Anthropic response).
import { createSuite } from "./lib/assert.mjs";
import { buildPickPrompt, offeredCandidates, produceRecommendations } from "../../api/recommendations.mjs";
import { buildContext } from "../../src/ai/context.js";
import { correctionKinds, notMeConflict, partlyAreasReachPicks, rejectsSomewhere } from "../../src/ai/corrections.js";
import { serializeAiState } from "../../src/ai/live-client.js";
import { hydrateState } from "../../src/server/request-state.mjs";
import { ROUNDS, loadCases, wireRecords } from "../evals/corrections/fixtures.mjs";
import { withAnchors } from "../evals/corrections/rank.mjs";
import { scenariosFor } from "../evals/corrections/run.mjs";
import { compare } from "../evals/corrections/shortlist-334.mjs";

const { check, eq, finish } = createSuite("shortlist-corrections");

const quietly = async (fn) => {
  const { info, warn, error } = console;
  console.info = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { info, warn, error }); }
};

// ---- fixture: horror and science fiction films --------------------------------------------------------
const HORROR = 27, SCIFI = 878;
// Distinct one-word titles, so the one-title-per-franchise rule never applies.
const NAMES = ["Ash", "Birch", "Cedar", "Dune", "Elm", "Fern", "Glen", "Hazel", "Iris", "Juniper", "Kestrel", "Larch", "Moss", "Nettle", "Oak", "Pine", "Quill", "Rowan", "Sage"];
let named = 0;
const movie = (n, genre, relatedToId = null) => ({
  id: `tmdb-movie-${n}`, provider: "tmdb", providerId: String(n), type: "movie", domains: ["movies"],
  title: NAMES[named++], genres: [genre], ...(relatedToId ? { relatedToId } : {})
});
const rated = {
  h1: movie(1, HORROR), h2: movie(2, HORROR), h3: movie(3, HORROR),
  s1: movie(11, SCIFI), s2: movie(12, SCIFI), s3: movie(13, SCIFI),
  likedHorror: movie(21, HORROR), likedSciFi: movie(22, SCIFI)
};
const loved = ["h1", "h2", "h3", "s1", "s2", "s3"];
const patterns = [
  { id: "ai-horror-films", title: "Horror films", domains: ["movies"], supports: ["h1", "h2", "h3"].map((k) => `ev:${rated[k].id}`) },
  { id: "ai-sci-fi-films", title: "Science fiction films", domains: ["movies"], supports: ["s1", "s2", "s3"].map((k) => `ev:${rated[k].id}`) }
];
const say = (id, fields) => ({ hypothesisId: id, label: id, says: null, weight: null, context: null, authority: "user-confirmed", ...fields });

function browserState({ statements = [], curveball = false, hypotheses = patterns } = {}) {
  const feedbackByRecommendation = {};
  for (const [key, item] of Object.entries(rated)) {
    feedbackByRecommendation[item.id] = { item, rating: "more", detail: loved.includes(key) ? "loved-before" : "liked-before" };
  }
  return {
    selectedFavorites: new Set(), libraryFavorites: new Set(), customItems: {}, feedbackByRecommendation,
    recommendationSets: [], seenItemIds: [], blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
    areas: { movies: true, tv: true, read: true, play: true }, curveball, recommendationFilter: "all",
    modelHypotheses: hypotheses, patternStatements: statements
  };
}
const wire = (opts) => JSON.parse(JSON.stringify(serializeAiState(browserState(opts))));
const contextFor = (opts, pool) => buildContext(hydrateState(wire(opts)), pool);

// Retrieval order puts horror first, so without a correction horror leads the set.
const horrorPool = [101, 102, 103, 104].map((n) => movie(n, HORROR, rated.h1.id));
const sciFiPool = [111, 112, 113].map((n) => movie(n, SCIFI, rated.s1.id));
const edgeHorror = movie(121, HORROR, rated.likedHorror.id);
const edgeSciFi = movie(122, SCIFI, rated.likedSciFi.id);
const pool = [...horrorPool, ...sciFiPool, edgeHorror, edgeSciFi];
const isHorror = (item) => item.genres.includes(HORROR);
const key = (list) => list.map((c) => `${c.id}:${c.tasteScore}:${c.edge ? 1 : 0}`).join("|");
const notMeHorror = [say("ai-horror-films", { says: "not-me" })];

// ---- what a "Not me" pattern matches ------------------------------------------------------------------
{
  const kinds = correctionKinds(hydrateState(wire({ statements: notMeHorror })));
  eq("the rejected pattern's kind comes from its supports' labels", kinds?.rejected.map((p) => p.labels.join(",")).join(";"), "horror");
  const conflicts = notMeConflict(hydrateState(wire({ statements: notMeHorror })));
  check("a horror film conflicts with 'Not me: Horror films'", conflicts(horrorPool[0]));
  check("a science fiction film does not", !conflicts(sciFiPool[0]));
  check("a horror book does not: the pattern covers films only", !conflicts({ ...horrorPool[0], id: "openlibrary-book-X", provider: "openlibrary", type: "book", domains: ["read"], genres: ["Horror"] }));
  check("a title with no labels never conflicts", !conflicts({ ...horrorPool[0], genres: [18] }));
  check("nothing conflicts without a 'Not me'", notMeConflict(hydrateState(wire())) === null);
  const guarded = notMeConflict(hydrateState(wire({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "accurate" })] })));
  check("a horror sci-fi film also matching a confirmed pattern does not conflict", !guarded({ ...horrorPool[0], genres: [HORROR, SCIFI] }));
}

// ---- rule 1: "Not me" strongly down-ranks, but never excludes ------------------------------------------
{
  const before = offeredCandidates(contextFor({}, pool), 6);
  const after = offeredCandidates(contextFor({ statements: notMeHorror }, pool), 6);
  const horrorBefore = before.filter(isHorror).length;
  const horrorAfter = after.filter(isHorror).length;
  check("without a correction, horror leads the set", isHorror(before[0]), before.map((c) => c.title).join(", "));
  check("'Not me' offers fewer horror titles", horrorAfter < horrorBefore, `${horrorBefore} -> ${horrorAfter}`);
  eq("every title that doesn't conflict is offered first", after.slice(0, 4).every((c) => !isHorror(c)), true);
  eq("a down-rank, not an exclusion: horror still fills the set when nothing else is left", horrorAfter, 2);
  const onlyHorror = offeredCandidates(contextFor({ statements: notMeHorror }, horrorPool), 6);
  eq("a pool of only conflicting titles is still offered in full", onlyHorror.length, horrorPool.length);
}

// ---- rule 2: "matters a little", Partly without unticked areas (and the other answers) change nothing -----
{
  const base = key(offeredCandidates(contextFor({ curveball: true }, pool), 6));
  for (const [label, statements] of [
    ["Partly", [say("ai-horror-films", { says: "partial" })]],
    ["Partly, not in books (an area the pattern doesn't cover)", [say("ai-horror-films", { says: "partial", excludedDomains: ["read"] })]],
    ["Partly, depends on context", [say("ai-horror-films", { says: "partial", context: "some" })]],
    ["matters a little", [say("ai-horror-films", { says: "accurate", weight: "little" })]],
    ["matters a lot", [say("ai-horror-films", { says: "accurate", weight: "lot" })]],
    ["Not sure", [say("ai-horror-films", { says: "unsure" })]],
    ["Yes", [say("ai-horror-films", { says: "accurate" })]]
  ]) {
    eq(`${label} leaves the shortlist unchanged`, key(offeredCandidates(contextFor({ curveball: true, statements }, pool), 6)), base);
  }
  const plain = key(offeredCandidates(contextFor({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "accurate" })] }, pool), 6));
  for (const weight of ["little", "lot"]) {
    eq(`with a 'Not me', how much another pattern matters (${weight}) changes nothing`,
      key(offeredCandidates(contextFor({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "accurate", weight })] }, pool), 6)), plain);
  }
  eq("with a 'Not me', a Partly elsewhere changes nothing for titles it doesn't also match",
    key(offeredCandidates(contextFor({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "partial" })] }, pool), 6)),
    key(offeredCandidates(contextFor({ statements: notMeHorror }, pool), 6)));
}

// ---- Partly's unticked areas (Nov 15): "Not me" in those areas only ---------------------------------------
{
  const partlyNoMovies = [say("ai-horror-films", { says: "partial", excludedDomains: ["movies"] })];
  for (const curveball of [false, true]) {
    eq(`Partly, not in movies: the same shortlist as 'Not me' on a films-only pattern (curveball ${curveball})`,
      key(offeredCandidates(contextFor({ curveball, statements: partlyNoMovies }, pool), 6)),
      key(offeredCandidates(contextFor({ curveball, statements: notMeHorror }, pool), 6)));
  }
  const outcome = {};
  offeredCandidates(contextFor({ curveball: true, statements: partlyNoMovies }, [...horrorPool, ...sciFiPool, edgeHorror]), 6, null, outcome);
  eq("Partly, not in movies: a Surprise that conflicts there is dropped, as with 'Not me'", outcome.surpriseDropped, true);

  // A horror pattern across films and books: unticking films leaves books alone.
  const twoMedia = [{ ...patterns[0], domains: ["movies", "read"] }, patterns[1]];
  const horrorBook = { ...horrorPool[0], id: "openlibrary-book-X", provider: "openlibrary", type: "book", domains: ["read"], genres: ["Horror"] };
  const conflicts = notMeConflict(hydrateState(JSON.parse(JSON.stringify(serializeAiState(browserState({ statements: partlyNoMovies, hypotheses: twoMedia }))))));
  check("films and books, films unticked: a horror film conflicts", conflicts(horrorPool[0]));
  check("…a horror book does not: books are kept", !conflicts(horrorBook));
  check("…a science fiction film does not", !conflicts(sciFiPool[0]));
  const notMeBoth = notMeConflict(hydrateState(JSON.parse(JSON.stringify(serializeAiState(browserState({ statements: notMeHorror, hypotheses: twoMedia }))))));
  check("…whereas 'Not me' on the same pattern does match the book", notMeBoth(horrorBook));

  // Decision 3: a Partly guards like a Yes in the areas it keeps, and not in the areas it unticks.
  const horrorSciFi = { ...horrorPool[0], genres: [HORROR, SCIFI] };
  const guardedByPartly = notMeConflict(hydrateState(wire({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "partial" })] })));
  check("a Partly pattern guards a title that also matches it, like a Yes", !guardedByPartly(horrorSciFi));
  const notGuarded = notMeConflict(hydrateState(wire({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "partial", excludedDomains: ["movies"] })] })));
  check("…but not in an area it unticked", notGuarded(horrorSciFi));

  // Decision 4: a pattern whose kind can't be read from its supports changes nothing, and the page promises nothing.
  const mixed = [{ id: "ai-mixed-films", title: "Films I like", domains: ["movies"], supports: [`ev:${rated.h1.id}`, `ev:${rated.s1.id}`] }, ...patterns];
  const partlyMixed = [say("ai-mixed-films", { says: "partial", excludedDomains: ["movies"] })];
  eq("a pattern with no distinctive label: Partly's unticked area changes nothing",
    key(offeredCandidates(buildContext(hydrateState(JSON.parse(JSON.stringify(serializeAiState(browserState({ statements: partlyMixed, hypotheses: mixed }))))), pool), 6)),
    key(offeredCandidates(contextFor({}, pool), 6)));
  eq("…and the page is told it doesn't reach picks", partlyAreasReachPicks(browserState({ statements: partlyMixed, hypotheses: mixed }), "ai-mixed-films"), false);
  eq("a readable pattern with an unticked area does reach picks", partlyAreasReachPicks(browserState({ statements: partlyNoMovies }), "ai-horror-films"), true);
  eq("Partly with nothing unticked doesn't reach picks", partlyAreasReachPicks(browserState({ statements: [say("ai-horror-films", { says: "partial" })] }), "ai-horror-films"), false);

  const fallback = await quietly(() => produceRecommendations({ rawState: wire({ curveball: true, statements: partlyNoMovies }), env: {}, fetchImpl: async () => { throw new Error("no network"); }, retrieve: async () => pool }));
  eq("fallback: Partly, not in movies offers the same six as the shortlist", fallback.picks.map((p) => p.id).join(","), offeredCandidates(contextFor({ curveball: true, statements: partlyNoMovies }, pool), 6).map((c) => c.id).join(","));
}

// ---- rule 3: Surprise ------------------------------------------------------------------------------------
{
  const allConflict = [...horrorPool, ...sciFiPool, edgeHorror];
  const plain = {};
  const before = offeredCandidates(contextFor({ curveball: true }, allConflict), 6, null, plain);
  check("without a correction, the horror Surprise candidate takes the slot", before.at(-1)?.id === edgeHorror.id && before.at(-1)?.edge === true);
  eq("without a correction, nothing is dropped", plain.surpriseDropped, false);

  const outcome = {};
  const after = offeredCandidates(contextFor({ curveball: true, statements: notMeHorror }, allConflict), 6, null, outcome);
  eq("every Surprise candidate conflicts: the Surprise is dropped", outcome.surpriseDropped, true);
  check("…and no title is marked as the Surprise", !after.some((c) => c.edge));
  eq("…and the set is still full", after.length, 6);

  const mixed = {};
  const withOther = offeredCandidates(contextFor({ curveball: true, statements: notMeHorror }, pool), 6, null, mixed);
  eq("a Surprise candidate that doesn't conflict takes the slot instead", withOther.at(-1)?.id, edgeSciFi.id);
  eq("…so nothing is dropped", mixed.surpriseDropped, false);

  const none = {};
  offeredCandidates(contextFor({ curveball: true, statements: notMeHorror }, [...horrorPool, ...sciFiPool]), 6, null, none);
  eq("no Surprise candidate at all is not a drop (unchanged from before #334)", none.surpriseDropped, false);
}

// ---- the catalog fallback obeys the same rules -----------------------------------------------------------
{
  const fallback = (opts, items) => quietly(() => produceRecommendations({ rawState: wire(opts), env: {}, fetchImpl: async () => { throw new Error("no network"); }, retrieve: async () => items }));
  const plain = await fallback({ curveball: true }, pool);
  const corrected = await fallback({ curveball: true, statements: notMeHorror }, pool);
  eq("fallback: source is the catalog", corrected.source, "catalog");
  eq("fallback: the same six the shortlist offers", corrected.picks.map((p) => p.id).join(","), offeredCandidates(contextFor({ curveball: true, statements: notMeHorror }, pool), 6).map((c) => c.id).join(","));
  check("fallback: fewer horror titles than without the correction", corrected.picks.filter(isHorror).length < plain.picks.filter(isHorror).length);
  eq("fallback: its Surprise is the one that doesn't conflict", corrected.picks.find((p) => p.surprise)?.id, edgeSciFi.id);

  const dropped = await fallback({ curveball: true, statements: notMeHorror }, [...horrorPool, ...sciFiPool, edgeHorror]);
  check("fallback: every Surprise candidate conflicts, so no pick is a Surprise", !dropped.picks.some((p) => p.surprise));
  check("fallback: every pick has a rank when the Surprise is dropped", dropped.picks.every((p) => p.rank != null));

  const noEdges = [...sciFiPool.slice(0, 2), ...horrorPool];
  const plainLast = await fallback({ curveball: true }, noEdges);
  check("fallback without a correction: the last pick is the Surprise (unchanged)", plainLast.picks.at(-1)?.surprise === true);
  const conflictLast = await fallback({ curveball: true, statements: notMeHorror }, noEdges);
  check("fallback: a conflicting last pick is offered but not as the Surprise", isHorror(conflictLast.picks.at(-1)) && !conflictLast.picks.some((p) => p.surprise));
}

// ---- live AI: same shortlist, no prompt change -----------------------------------------------------------
{
  const AI_ENV = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", VERCEL_ENV: "preview" };
  const live = async (opts, items, answer) => {
    const sent = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      const prompt = JSON.stringify(body.messages);
      const ids = [...prompt.matchAll(/tmdb-movie-\d+/g)].map((m) => m[0]).filter((id, i, all) => all.indexOf(id) === i && !Object.values(rated).some((r) => r.id === id));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer(ids)) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) };
    };
    const result = await quietly(() => produceRecommendations({ rawState: wire(opts), env: AI_ENV, fetchImpl, retrieve: async () => items }));
    return { result, sent };
  };
  const pickAll = (curveballId) => (ids) => ({
    picks: ids.map((itemId) => ({ itemId, why: `Shares the tense mood of ${rated.h1.title}.`, cites: [`ev:${rated.h1.id}`] })),
    curveballItemId: curveballId ? curveballId(ids) : null
  });

  const { result, sent } = await live({ curveball: true, statements: notMeHorror }, pool, pickAll(() => horrorPool[0].id));
  eq("live: the model's picks are accepted", result.source, "model");
  eq("live: the model is offered the corrected shortlist", result.picks.map((p) => p.id).sort().join(","), offeredCandidates(contextFor({ curveball: true, statements: notMeHorror }, pool), 6).map((c) => c.id).sort().join(","));
  const conflictPick = result.picks.find((p) => p.id === horrorPool[0].id);
  check("live: a model Surprise on a conflicting title is kept as a regular pick", conflictPick && !conflictPick.surprise && conflictPick.rank != null && conflictPick.ai?.kind === "pick");
  const kept = await live({ curveball: true, statements: notMeHorror }, pool, pickAll(() => edgeSciFi.id));
  check("live: a model Surprise that doesn't conflict stays the Surprise", kept.result.picks.find((p) => p.id === edgeSciFi.id)?.surprise === true);
  check("live: the prompt never mentions the correction matcher", !JSON.stringify(sent).includes("correctionConflict"));

  const dropped = await live({ curveball: true, statements: notMeHorror }, [...horrorPool, ...sciFiPool, edgeHorror], pickAll(null));
  check("live: when the Surprise is dropped the model is told curveball is off", JSON.stringify(dropped.sent).includes('\\"curveball\\":false'));
  check("live: …and no pick is a Surprise", !dropped.result.picks.some((p) => p.surprise));

  // No prompt change: with the shortlist held fixed, the prompt is byte-identical with or without the matcher.
  const ctx = contextFor({ curveball: true, statements: notMeHorror }, pool);
  const offered = { ...ctx, candidates: offeredCandidates(ctx, 6) };
  eq("the pick prompt is the same text with or without the correction matcher", buildPickPrompt(offered, 6), buildPickPrompt({ ...offered, correctionConflict: null }, 6));
}

// ---- wire payload ----------------------------------------------------------------------------------------
{
  check("no 'Not me': the request carries no pattern scopes (payload unchanged)", !("correctionPatterns" in wire({ statements: [say("ai-horror-films", { says: "partial" })] })));
  const sent = wire({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "accurate" })] }).correctionPatterns;
  eq("with a 'Not me': the rejected and confirmed patterns' areas and supports are sent", JSON.stringify(sent), JSON.stringify(patterns.map(({ id, domains, supports }) => ({ id, domains, supports }))));
  const partlyOther = wire({ statements: [...notMeHorror, say("ai-sci-fi-films", { says: "partial" })] }).correctionPatterns;
  eq("with a 'Not me', a Partly pattern is sent too (it guards its kept areas)", partlyOther.map((p) => p.id).join(","), "ai-horror-films,ai-sci-fi-films");
  const partlyOnly = wire({ statements: [say("ai-horror-films", { says: "partial", excludedDomains: ["movies"] })] }).correctionPatterns;
  eq("a Partly with an unticked area is enough to send pattern scopes", partlyOnly?.map((p) => p.id).join(","), "ai-horror-films");
}

// ---- correction-eval fixtures: no-op gate and effect -----------------------------------------------------
{
  const cases = loadCases();
  let noopDiffs = 0, noopSets = 0, before = 0, after = 0, active = 0, mediaLost = 0, conflictingSurprise = 0;
  const partly = { active: 0, before: 0, after: 0, mediaLost: 0, conflictingSurprise: 0 };
  for (const kase of cases) {
    const casePool = withAnchors(kase.pool, wireRecords(kase.state(0)));
    for (const scenario of scenariosFor(kase)) {
      const notMe = scenario.statements.some((s) => s.says === "not-me");
      const rejecting = scenario.statements.some(rejectsSomewhere);
      for (let round = 0; round < (rejecting ? ROUNDS : 1); round += 1) {
        const r = compare(kase, round, scenario.statements, casePool);
        if (!rejecting) {
          noopSets += 1;
          if (r.active || r.before.titles.join("|") !== r.after.titles.join("|")) noopDiffs += 1;
          continue;
        }
        if (!r.active) continue;
        if (!notMe) {
          partly.active += 1;
          partly.before += r.before.conflicting;
          partly.after += r.after.conflicting;
          if (r.after.media < r.before.media) partly.mediaLost += 1;
          if (r.after.surpriseConflicts) partly.conflictingSurprise += 1;
          continue;
        }
        active += 1;
        before += r.before.conflicting;
        after += r.after.conflicting;
        if (r.after.media < r.before.media) mediaLost += 1;
        if (r.after.surpriseConflicts) conflictingSurprise += 1;
      }
    }
  }
  check("fixtures: there are answers with no 'Not me' or unticked area to compare", noopSets > 100, String(noopSets));
  eq("fixtures: with no 'Not me' or unticked area, every shortlist is identical to before (no-op gate)", noopDiffs, 0);
  check("fixtures: a 'Not me' reaches some sets", active > 100, String(active));
  check("fixtures: 'Not me' titles offered fall by at least a third", after <= before * 2 / 3, `${before} -> ${after}`);
  eq("fixtures: no set loses a medium", mediaLost, 0);
  eq("fixtures: no Surprise is a 'Not me' title", conflictingSurprise, 0);
  console.info(`fixtures, Partly with an unticked area: ${partly.active} sets changed; titles there ${partly.before} -> ${partly.after}; media lost ${partly.mediaLost}`);
  check("fixtures: a Partly's unticked area reaches some sets", partly.active > 0, String(partly.active));
  check("fixtures: titles in an unticked area fall by at least a third", partly.after <= partly.before * 2 / 3, `${partly.before} -> ${partly.after}`);
  eq("fixtures: an unticked area never costs a set a medium", partly.mediaLost, 0);
  eq("fixtures: no Surprise is a title from an unticked area", partly.conflictingSurprise, 0);
}

finish();
