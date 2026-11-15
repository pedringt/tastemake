#!/usr/bin/env node
// #326 Design A: the refresh that only places new ratings (docs/proposals/326-refresh-options.md, section 4, with
// Paige's Nov 14 decisions in section 10). Every rule is checked with canned model answers: the ledger and what
// counts as new (first run, cap of 30, changed and removed ratings), the answer check (one valid placement per
// item, polarity, areas, new patterns from 2+ unexplained or pooled items, the validator and redundancy), how
// software applies it (levels, the 2-counter rules, confirmed patterns never reworded or dropped, history, the
// #364 filing, the pool, failures), the message, and the browser and endpoint paths behind both flags.
// Free: no network, no browser, no model call (every model answer is canned).
//
//   node scripts/qa/placement-refresh-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { PLACEMENT_REFRESH, refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { FAILURES_BEFORE_POOL, MAX_ITEMS_PER_CALL, fingerprint, ledgerAfterFullRefresh, readLedger, refreshQueue } = await import("../../src/model/refresh-ledger.js");
const { NOTHING_NEW_MESSAGE, applyPlacementResult } = await import("../../src/model/placement-apply.js");
const { buildPlacementRequest, checkPlacementAnswer, placeNewItems, redundancy } = await import("../../src/ai/placement.js");
const { NEEDS_REVIEW, canReconfirm, needsReviewText, reconfirmPattern } = await import("../../src/model/statements.js");
const { buildContext } = await import("../../src/ai/context.js");
const { checkStateShape } = await import("../../src/model/state-shape.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { producePlacement, placementConfig } = await import("../../api/hypotheses.mjs");
const { emptyState, react } = await import("../evals/fixtures.mjs");
const { REFRESH_A_FIXTURES } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("placement refresh tests");

// ---- a small profile ----------------------------------------------------------------------------------------
const TYPE = { movies: "movie", tv: "tv", read: "book", play: "game" };
const item = (id, title, domains, genres = []) => ({ id, title, type: TYPE[domains[0]], domains, genres, provider: "fx", providerId: id, year: "2000" });
const ref = (it) => `ev:${it.id}`;
const SLOW = [item("slow-1", "The Witch", ["movies"], ["27"]), item("slow-2", "Hereditary", ["movies"], ["27"]), item("slow-3", "The Others", ["movies"], ["27"])];
const GAMES = [item("game-1", "Outer Wilds", ["play"], ["Puzzle"]), item("game-2", "The Witness", ["play"], ["Puzzle"])];
const COMEDY = [item("tv-1", "Detroiters", ["tv"], ["35"])];
const HEIST = [item("heist-1", "Ocean's Eleven", ["movies"], ["80"]), item("heist-2", "The Sting", ["movies"], ["80"]), item("heist-3", "Inside Man", ["movies"], ["80"]), item("heist-4", "Logan Lucky", ["movies"], ["80"])];
const SCARY_MISS = [item("miss-1", "It Comes at Night", ["movies"], ["27"]), item("miss-2", "The Lodge", ["movies"], ["27"]), item("miss-3", "Relic", ["movies"], ["27"]), item("miss-4", "Saint Maud", ["movies"], ["27"])];
const GAME_MISS = [item("gmiss-1", "Myst", ["play"], ["Puzzle"]), item("gmiss-2", "Riven", ["play"], ["Puzzle"]), item("gmiss-3", "Obduction", ["play"], ["Puzzle"])];

const P_SLOW = { id: "ai-slow-horror", title: "Uncanny slow-burn horror on screen", claim: "Drawn to slow, uncanny horror films that build dread through atmosphere rather than shocks.", supports: SLOW.map(ref), counters: [], domains: ["movies"], strength: "strong", status: "strong", crossDomain: "untested", evidence: "", aiGenerated: true };
const P_PUZZLE = { id: "ai-puzzles", title: "Exploration-heavy games with puzzles", claim: "Enjoys games built around exploring a space and working out its puzzles at their own pace.", supports: GAMES.map(ref), counters: [], domains: ["play"], strength: "supported", status: "supported", crossDomain: "untested", evidence: "", aiGenerated: true };
const P_COMEDY = { id: "ai-comedy", title: "Quirky character-driven comedy", claim: "Enjoys comedies driven by awkward, specific characters rather than setups and punchlines.", supports: COMEDY.map(ref), counters: [], domains: ["tv"], strength: "supported", status: "supported", crossDomain: "untested", evidence: "", aiGenerated: true };
const CONFIRM_PUZZLE = { hypothesisId: "ai-puzzles", label: P_PUZZLE.title, says: "accurate", weight: null, context: null, authority: "user-confirmed" };

function profile({ ledger = true } = {}) {
  const s = { ...emptyState([]), recommendationSets: [], hypothesisHistory: [], hypothesisAiStatus: "idle", hypothesisAiKey: null, hypothesisAiChecked: null, hypothesisAiMessage: null };
  [...SLOW, ...GAMES].forEach((it) => react(s, it, "loved"));
  COMEDY.forEach((it) => react(s, it, "liked"));
  s.modelHypotheses = [P_SLOW, P_PUZZLE, P_COMEDY].map((p) => ({ ...p, supports: [...p.supports], counters: [...p.counters] }));
  s.patternStatements = [{ ...CONFIRM_PUZZLE }];
  if (ledger) s.profileLedger = { ...ledgerAfterFullRefresh(s), pool: [] };
  return s;
}
const pattern = (s, id) => (s.modelHypotheses ?? []).find((p) => p.id === id);
const placed = (placements, extra = {}) => ({ placements, invalid: [], newPatterns: [], notSent: [], ...extra });
const put = (it, place, patternId = null) => ({ ref: ref(it), place, patternId });
const shortId = (request, r) => [...request.items, ...request.pool].find(([, x]) => x === r)?.[0];

// ---- 1. the ledger: what counts as new ----------------------------------------------------------------------
{
  const row = { kind: "experienced-positive", refinements: [{ id: "pacing:slow" }] };
  check("fingerprint: kind and reasons both count", fingerprint(row) !== fingerprint({ ...row, kind: "experienced-negative" }) && fingerprint(row) !== fingerprint({ ...row, refinements: [] }));
  eq("fingerprint: reason order doesn't matter", fingerprint({ kind: "k", refinements: [{ id: "b" }, { id: "a" }] }), fingerprint({ kind: "k", refinements: [{ id: "a" }, { id: "b" }] }));

  const s = profile({ ledger: false });
  HEIST.slice(0, 2).forEach((it) => react(s, it, "liked"));
  const q = refreshQueue(s);
  check("first run (no ledger): flagged as a first run", q.firstRun);
  eq("first run: new = every tried item no stored pattern cites", q.items.sort().join(","), HEIST.slice(0, 2).map(ref).sort().join(","));

  const many = profile({ ledger: false });
  const extra = Array.from({ length: MAX_ITEMS_PER_CALL + 5 }, (_, i) => item(`extra-${i}`, `Extra ${i}`, ["read"], ["Fiction"]));
  extra.forEach((it) => react(many, it, "liked"));
  const first = refreshQueue(many);
  eq("first run: capped at 30 items per call", first.items.length, 30);
  eq("first run: the other 5 wait", first.waiting, 5);
  eq("first run: oldest first, so none waits forever", first.items[0], ref(extra[0]));
  applyPlacementResult(many, first, placed(first.items.map((r) => ({ ref: r, place: "not-taste", patternId: null }))));
  const second = refreshQueue(many);
  eq("next refresh: exactly the 5 that waited are new", second.items.join(","), extra.slice(30).map(ref).join(","));
  check("next refresh: no longer a first run", !second.firstRun);
  check("the first run recorded the cited items as seen", ref(SLOW[0]) in many.profileLedger.items);

  const t = profile();
  eq("with a ledger: nothing new", refreshQueue(t).items.length, 0);
  react(t, SLOW[0], "disliked");
  const changed = refreshQueue(t);
  eq("liked then disliked: the item is new again", changed.items.join(","), ref(SLOW[0]));
  check("…and listed as changed, with its old fingerprint", changed.changed[0]?.ref === ref(SLOW[0]) && changed.changed[0].was.startsWith("experienced-strong-positive"));
  delete t.feedbackByRecommendation[COMEDY[0].id];
  eq("a removed rating is listed as removed", refreshQueue(t).removed.join(","), ref(COMEDY[0]));

  eq("an unusable ledger is a first run: wrong version", readLedger({ version: 9, items: {} }), null);
  eq("…or not an object", readLedger("x"), null);
  eq("…entries that aren't refs or fingerprints are dropped", Object.keys(readLedger({ version: 1, items: { "ev:a": "k|", b: "k|", "ev:c": 3 }, pool: ["ev:a", "ev:zz", 4] }).items).join(","), "ev:a");
  eq("…and the pool keeps only ledger items", readLedger({ version: 1, items: { "ev:a": "k|" }, pool: ["ev:a", "ev:zz"] }).pool.join(","), "ev:a");
  check("state shape: a ledger object is kept", !checkStateShape({ profileLedger: { version: 1, items: {} } }).dropped.length);
  check("state shape: a ledger that isn't an object is dropped", checkStateShape({ profileLedger: [1] }).dropped.includes("profileLedger"));
}

// ---- 2. saved state: migration and the flag ------------------------------------------------------------------
{
  eq("the browser flag is on (Paige turned A on, Nov 14)", PLACEMENT_REFRESH, true);
  const { state: fresh } = await import("../../src/state.js");
  stored.clear();
  persistState(fresh);
  check("a fresh profile saves no ledger field until a refresh runs", !String(stored.get("tastemake:test-state:v1")).includes("profileLedger"));
  const s = profile();
  stored.clear();
  persistState(s);
  const back = loadPersistedState();
  eq("a ledger survives a reload", JSON.stringify(back.profileLedger), JSON.stringify(s.profileLedger));
  stored.clear();
  localStorage.setItem("tastemake:test-state:v1", JSON.stringify({ version: 1, state: { modelHypotheses: s.modelHypotheses } }));
  const old = loadPersistedState();
  check("state saved before Design A loads with no ledger (the first-run rule applies)", old.profileLedger === undefined && Array.isArray(old.modelHypotheses));
}

// ---- 3. the request and the answer check ---------------------------------------------------------------------
{
  const s = profile();
  s.patternStatements.push({ hypothesisId: "ai-comedy", label: P_COMEDY.title, says: "not-me", weight: null, context: null, authority: "user-confirmed" });
  HEIST.slice(0, 2).forEach((it) => react(s, it, "liked"));
  react(s, SCARY_MISS[0], "disliked");
  const q = refreshQueue(s);
  const ctx = buildContext(s);
  const { prompt, request } = buildPlacementRequest(ctx, s.modelHypotheses, { items: q.items, pool: [ref(GAMES[0])] });
  const context = JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8));
  eq("request: only the new items are sent as new", context.new.map((r) => r.t).sort().join(","), ["It Comes at Night", "Ocean's Eleven", "The Sting"].join(","));
  check("request: patterns are names and claims, with no evidence lists to copy", context.patterns.every((p) => p.name && p.claim && !("evidence" in p) && !("supports" in p)));
  check("request: a confirmed pattern is marked read-only context", context.patterns.find((p) => p.name === P_PUZZLE.title)?.confirmed === 1);
  check("request: a 'not me' pattern isn't a placement target", !context.patterns.some((p) => p.name === P_COMEDY.title));
  check("request: example titles, at most three", context.patterns.every((p) => p.examples.length <= 3));
  eq("request: pooled items go in pool", context.pool.map((r) => r.t).join(","), "Outer Wilds");

  const slowId = [...request.patterns].find(([, p]) => p.id === "ai-slow-horror")[0];
  const n = (it) => shortId(request, ref(it));
  const answer = {
    placements: [
      { item: n(HEIST[0]), place: "unexplained", pattern: null },
      { item: n(HEIST[1]), place: "unexplained", pattern: null },
      { item: n(SCARY_MISS[0]), place: "counter", pattern: slowId }
    ],
    newPatterns: []
  };
  const ok = checkPlacementAnswer(answer, request, ctx);
  eq("check: three valid placements", ok.placements.length, 3);
  eq("check: none invalid", ok.invalid.length, 0);

  const variants = [
    ["a missing placement", { placements: answer.placements.slice(1) }, HEIST[0]],
    ["two placements for one item", { placements: [...answer.placements, { item: n(HEIST[0]), place: "not-taste", pattern: null }] }, HEIST[0]],
    ["a pattern id that doesn't exist", { placements: [answer.placements[0], answer.placements[1], { item: n(SCARY_MISS[0]), place: "counter", pattern: "p99" }] }, SCARY_MISS[0]],
    ["a liked item as a counter", { placements: [{ item: n(HEIST[0]), place: "counter", pattern: slowId }, answer.placements[1], answer.placements[2]] }, HEIST[0]],
    ["a disliked item as support", { placements: [answer.placements[0], answer.placements[1], { item: n(SCARY_MISS[0]), place: "supports", pattern: slowId }] }, SCARY_MISS[0]],
    ["support outside the pattern's areas", { placements: [{ item: n(HEIST[0]), place: "supports", pattern: [...request.patterns].find(([, p]) => p.id === "ai-puzzles")[0] }, answer.placements[1], answer.placements[2]] }, HEIST[0]],
    ["an unknown place", { placements: [{ item: n(HEIST[0]), place: "maybe", pattern: null }, answer.placements[1], answer.placements[2]] }, HEIST[0]],
    ["a 'not me' pattern", { placements: [answer.placements[0], answer.placements[1], { item: n(SCARY_MISS[0]), place: "counter", pattern: "ai-comedy" }] }, SCARY_MISS[0]]
  ];
  for (const [name, bad, it] of variants) {
    const got = checkPlacementAnswer(bad, request, ctx);
    check(`check: ${name} leaves that item new, the rest apply`, got.invalid.includes(ref(it)) && got.placements.length === 2, JSON.stringify(got.invalid));
  }
  eq("check: a placement for an item that wasn't sent is ignored", checkPlacementAnswer({ placements: [...answer.placements, { item: "n42", place: "not-taste", pattern: null }] }, request, ctx).placements.length, 3);
  eq("check: no answer at all leaves every item new", checkPlacementAnswer(null, request, ctx).invalid.length, 3);

  const proposal = (evidence, extra = {}) => ({ ...answer, newPatterns: [{ label: "Clever heist and con capers", claim: "Enjoys films about a crew planning and pulling off an elaborate, clever con or heist.", evidence, domains: ["movies"], conditional: false, ...extra }] });
  const two = checkPlacementAnswer(proposal([n(HEIST[0]), n(HEIST[1])]), request, ctx);
  eq("new pattern from 2 unexplained items: accepted", two.newPatterns.length, 1);
  eq("…citing the real refs", two.newPatterns[0]?.evidence.sort().join(","), HEIST.slice(0, 2).map(ref).sort().join(","));
  const one = checkPlacementAnswer(proposal([n(HEIST[0])]), request, ctx);
  check("new pattern from 1 item: rejected", !one.newPatterns.length && /at least 2/.test(one.rejectedPatterns[0]?.reasons.join(" ")));
  const withPool = checkPlacementAnswer(proposal([n(HEIST[0]), shortId(request, ref(GAMES[0]))], { domains: ["movies", "play"] }), request, ctx);
  eq("new pattern from 1 unexplained + 1 pooled: allowed by count (the validator decides the rest)", withPool.rejectedPatterns.some((r) => /at least 2|wasn't placed/.test(r.reasons.join(" "))), false);
  const placedItem = checkPlacementAnswer({ ...proposal([n(HEIST[0]), n(SCARY_MISS[0])]) }, request, ctx);
  check("new pattern citing an item placed elsewhere: rejected", !placedItem.newPatterns.length);
  const generic = checkPlacementAnswer(proposal([n(HEIST[0]), n(HEIST[1])], { claim: "Likes crime movies." }), request, ctx);
  check("new pattern the validator rejects (too generic): rejected", !generic.newPatterns.length && /generic/.test(generic.rejectedPatterns[0]?.reasons.join(" ")));
  const dup = checkPlacementAnswer(proposal([n(HEIST[0]), n(HEIST[1])], { label: "Slow-burn uncanny horror" }), request, ctx);
  check("new pattern that names an existing one: rejected as redundant", !dup.newPatterns.length && /redundant/.test(dup.rejectedPatterns[0]?.reasons.join(" ")));
  check("redundancy: most citations already supporting a pattern", redundancy({ label: "Something else entirely", evidence: [ref(SLOW[0]), ref(SLOW[1]), ref(HEIST[0])] }, [P_SLOW]).length === 1);

  let called = 0;
  const none = await placeNewItems({ ctx: buildContext(profile()), patterns: P_SLOW ? [P_SLOW] : [], items: [], pool: [], callModel: async () => { called += 1; return null; } });
  check("nothing new: no model call", called === 0 && none.source === "nothing-new");
}

// ---- 4. applying an answer -----------------------------------------------------------------------------------
{
  // supports, history and level
  const s = profile();
  react(s, COMEDY[0], "liked");
  const tv2 = item("tv-2", "Nathan for You", ["tv"], ["35"]);
  const tv3 = item("tv-3", "The Rehearsal", ["tv"], ["35"]);
  react(s, tv2, "loved"); react(s, tv3, "liked");
  const q = refreshQueue(s);
  const before = s.hypothesisHistory.length;
  const out = applyPlacementResult(s, q, placed([put(tv2, "supports", "ai-comedy"), put(tv3, "supports", "ai-comedy")]));
  eq("supports: added to the pattern", pattern(s, "ai-comedy").supports.length, 3);
  eq("supports: level recomputed from the evidence (3 tried, none against: strong)", pattern(s, "ai-comedy").strength, "strong");
  eq("supports: name and claim untouched", pattern(s, "ai-comedy").claim, P_COMEDY.claim);
  eq("one history entry per changed pattern", s.hypothesisHistory.length - before, 1);
  eq("history names the refresh", s.hypothesisHistory.at(-1).reason, "Refresh placed new ratings");
  eq("message: where each rating went", out.message, "2 new ratings: 2 support “Quirky character-driven comedy”.");
  eq("the placed items are settled in the ledger", refreshQueue(s).items.length, 0);
}
{
  // the decision-6 message
  const s = profile();
  react(s, HEIST[0], "liked"); react(s, item("slow-4", "Lake Mungo", ["movies"], ["27"]), "liked"); react(s, item("slow-5", "Kill List", ["movies"], ["27"]), "liked"); react(s, SCARY_MISS[0], "disliked");
  const q = refreshQueue(s);
  const out = applyPlacementResult(s, q, placed([put({ id: "slow-4" }, "supports", "ai-slow-horror"), put({ id: "slow-5" }, "supports", "ai-slow-horror"), put(SCARY_MISS[0], "counter", "ai-slow-horror"), put(HEIST[0], "unexplained")]));
  eq("message: 4 new ratings: 2 support X, 1 counts against X and 1 isn't part of a pattern yet", out.message, "4 new ratings: 2 support “Uncanny slow-burn horror on screen”, 1 counts against “Uncanny slow-burn horror on screen” and 1 isn’t part of a pattern yet.");
  eq("one miss never weakens a pattern", pattern(s, "ai-slow-horror").strength, "strong");
}
{
  // liked -> disliked
  const s = profile();
  react(s, SLOW[0], "disliked");
  const q = refreshQueue(s);
  applyPlacementResult(s, q, placed([put(SLOW[0], "counter", "ai-slow-horror")]));
  const p = pattern(s, "ai-slow-horror");
  check("liked then disliked: it comes off supports", !p.supports.includes(ref(SLOW[0])));
  check("…and becomes the counter the model placed", p.counters.includes(ref(SLOW[0])));
  const t = profile();
  react(t, SLOW[0], "disliked");
  const unplaced = applyPlacementResult(t, refreshQueue(t), placed([], { invalid: [ref(SLOW[0])] }));
  check("liked then disliked, placement invalid: still comes off supports", !pattern(t, "ai-slow-horror").supports.includes(ref(SLOW[0])));
  check("…and stays new for the next refresh", refreshQueue(t).items.includes(ref(SLOW[0])) && /couldn’t be placed/.test(unplaced.message));
}
{
  // unconfirmed: 2 counters lower one level; counters outnumbering supports retire it
  const s = profile();
  react(s, SCARY_MISS[0], "disliked"); react(s, SCARY_MISS[1], "disliked");
  const out = applyPlacementResult(s, refreshQueue(s), placed([put(SCARY_MISS[0], "counter", "ai-slow-horror"), put(SCARY_MISS[1], "counter", "ai-slow-horror")]));
  // evidence allows supported (3 tried, 2 against: not two clear for strong), and 2 counters lower it one more
  eq("unconfirmed, 2 counters: one level below what the evidence allows", pattern(s, "ai-slow-horror").strength, "emerging");
  check("…kept, not retired (3 supports, 2 counters)", Boolean(pattern(s, "ai-slow-horror")));
  check("…and the message says it", /lean on “Uncanny slow-burn horror on screen” more cautiously/.test(out.message));
  react(s, SCARY_MISS[2], "disliked"); react(s, SCARY_MISS[3], "disliked");
  const gone = applyPlacementResult(s, refreshQueue(s), placed([put(SCARY_MISS[2], "counter", "ai-slow-horror"), put(SCARY_MISS[3], "counter", "ai-slow-horror")]));
  check("unconfirmed, counters outnumber supports (4 > 3): retired", !pattern(s, "ai-slow-horror"));
  check("…with a history entry saying why", s.hypothesisHistory.at(-1).hypothesisId === "ai-slow-horror" && /Retired/.test(s.hypothesisHistory.at(-1).reason));
  check("…and the message says it", /was retired/.test(gone.message));

  const first = profile({ ledger: false });
  react(first, SCARY_MISS[0], "disliked"); react(first, SCARY_MISS[1], "disliked"); react(first, SCARY_MISS[2], "disliked"); react(first, SCARY_MISS[3], "disliked");
  applyPlacementResult(first, refreshQueue(first), placed(SCARY_MISS.map((it) => put(it, "counter", "ai-slow-horror"))));
  check("first run that retires a pattern: what it cited is still recorded as seen", !pattern(first, "ai-slow-horror") && SLOW.every((it) => ref(it) in first.profileLedger.items) && !refreshQueue(first).items.length);

  const one = profile();
  react(one, SCARY_MISS[0], "disliked");
  applyPlacementResult(one, refreshQueue(one), placed([put(SCARY_MISS[0], "counter", "ai-slow-horror")]));
  eq("unconfirmed, 1 counter: not lowered", pattern(one, "ai-slow-horror").strength, "strong");
}
{
  // confirmed: 2+ new counters flag it; never dropped, reworded or lowered
  const s = profile();
  react(s, GAME_MISS[0], "disliked");
  applyPlacementResult(s, refreshQueue(s), placed([put(GAME_MISS[0], "counter", "ai-puzzles")]));
  check("confirmed, 1 new counter: no flag", !pattern(s, "ai-puzzles").evidenceStatus);
  react(s, GAME_MISS[1], "disliked"); react(s, GAME_MISS[2], "disliked");
  const out = applyPlacementResult(s, refreshQueue(s), placed([put(GAME_MISS[1], "counter", "ai-puzzles"), put(GAME_MISS[2], "counter", "ai-puzzles")]));
  const p = pattern(s, "ai-puzzles");
  check("confirmed, counters now outnumber supports: still kept", Boolean(p));
  eq("…flagged Needs another look", p?.evidenceStatus, NEEDS_REVIEW);
  eq("…for the counters", p?.placementReview?.kind, "counters");
  eq("…name unchanged", p?.title, P_PUZZLE.title);
  eq("…claim unchanged", p?.claim, P_PUZZLE.claim);
  eq("…level not lowered", p?.strength, "supported");
  eq("…areas unchanged", p?.domains.join(","), "play");
  check("…the message says it needs another look", /“Exploration-heavy games with puzzles” needs another look/.test(out.message));
  check("…and the Profile explains why", /3 things you tried and didn’t like/.test(needsReviewText(p)));
  check("the user can confirm it again", canReconfirm(s, "ai-puzzles"));
  const said = reconfirmPattern(s, "ai-puzzles");
  check("confirming again clears the flag and keeps the counters", !pattern(s, "ai-puzzles").evidenceStatus && !pattern(s, "ai-puzzles").placementReview && pattern(s, "ai-puzzles").counters.length === 3 && /confirmed it still fits/.test(said));
  eq("…and the history records the user's answer", s.hypothesisHistory.at(-1).origin, "user-confirmed");

  const c = profile();
  react(c, GAMES[0], "disliked");
  applyPlacementResult(c, refreshQueue(c), placed([put(GAMES[0], "counter", "ai-puzzles")]));
  eq("confirmed, a support turned dislike: flagged as changed", pattern(c, "ai-puzzles").placementReview?.kind, "changed");
  eq("…claim unchanged", pattern(c, "ai-puzzles").claim, P_PUZZLE.claim);
}
{
  // removed ratings
  const s = profile();
  delete s.feedbackByRecommendation[SLOW[0].id];
  delete s.feedbackByRecommendation[GAMES[0].id];
  const q = refreshQueue(s);
  eq("removals alone: nothing new to place", q.items.length, 0);
  const out = applyPlacementResult(s, q, null);
  check("a removed rating comes off an unconfirmed pattern", !pattern(s, "ai-slow-horror").supports.includes(ref(SLOW[0])));
  check("a confirmed pattern keeps the citation and is flagged, as today (#325)", pattern(s, "ai-puzzles").supports.includes(ref(GAMES[0])) && pattern(s, "ai-puzzles").evidenceStatus === NEEDS_REVIEW && !pattern(s, "ai-puzzles").placementReview);
  check("…and can be confirmed again without it, as today", canReconfirm(s, "ai-puzzles"));
  check("the ledger forgets the removed rating", !(ref(SLOW[0]) in s.profileLedger.items));
  check("message for removals", /removed/.test(out.message));
  const t = profile();
  eq("nothing new and nothing removed: the message says nothing changed", applyPlacementResult(t, refreshQueue(t), null).message, NOTHING_NEW_MESSAGE);
}
{
  // partial answers, failures and the pool
  const s = profile();
  HEIST.slice(0, 2).forEach((it) => react(s, it, "liked"));
  const q = refreshQueue(s);
  const out = applyPlacementResult(s, q, placed([put(HEIST[0], "unexplained")], { invalid: [ref(HEIST[1])] }));
  check("partial answer: the valid placement applies", s.profileLedger.pool.includes(ref(HEIST[0])));
  check("partial answer: the invalid item stays new", refreshQueue(s).items.join(",") === ref(HEIST[1]));
  check("…and the message says so", /1 couldn’t be placed this time/.test(out.message));
  eq("a liked unexplained item goes to the pool and isn't new any more", refreshQueue(s).pool.join(","), ref(HEIST[0]));
  for (let i = 1; i < FAILURES_BEFORE_POOL; i += 1) applyPlacementResult(s, refreshQueue(s), placed([], { invalid: [ref(HEIST[1])] }));
  check(`after ${FAILURES_BEFORE_POOL} failed refreshes an item moves to the pool`, s.profileLedger.pool.includes(ref(HEIST[1])) && !refreshQueue(s).items.includes(ref(HEIST[1])));
  check("…and its failure count is cleared", !(ref(HEIST[1]) in s.profileLedger.failures));
  const t = profile();
  react(t, HEIST[0], "liked");
  const ledgerBefore = JSON.stringify(t.profileLedger);
  check("a call that failed changes nothing: the ledger isn't advanced", JSON.stringify(t.profileLedger) === ledgerBefore && refreshQueue(t).items.includes(ref(HEIST[0])));
  const u = profile();
  react(u, SCARY_MISS[0], "disliked");
  applyPlacementResult(u, refreshQueue(u), placed([put(SCARY_MISS[0], "not-taste")]));
  check("not-taste: settled, not pooled", !u.profileLedger.pool.length && !refreshQueue(u).items.length);
  react(u, HEIST[0], "liked");
  applyPlacementResult(u, refreshQueue(u), placed([put(HEIST[0], "unexplained")]));
  react(u, HEIST[0], "loved");
  check("a pooled item whose rating changed is new again and leaves the pool", refreshQueue(u).items.includes(ref(HEIST[0])) && !refreshQueue(u).pool.includes(ref(HEIST[0])));
}
{
  // the pool builds a new pattern over two refreshes (fixture 2, offline)
  const s = profile();
  HEIST.slice(0, 2).forEach((it) => react(s, it, "liked"));
  applyPlacementResult(s, refreshQueue(s), placed([put(HEIST[0], "unexplained"), put(HEIST[1], "unexplained")]));
  check("refresh 1: no new pattern, both pooled", s.modelHypotheses.length === 3 && s.profileLedger.pool.length === 2);
  HEIST.slice(2).forEach((it) => react(s, it, "liked"));
  const q = refreshQueue(s);
  eq("refresh 2: the pool is sent with the new items", q.pool.length, 2);
  const heist = { label: "Clever heist and con capers", claim: "Enjoys films about a crew planning and pulling off an elaborate, clever con or heist.", evidence: [...HEIST.slice(0, 3).map(ref)], domains: ["movies"], conditional: false };
  const out = applyPlacementResult(s, q, placed([put(HEIST[2], "unexplained"), put(HEIST[3], "unexplained")], { newPatterns: [heist] }));
  const p = s.modelHypotheses.find((x) => x.title === heist.label);
  check("refresh 2: the new pattern is added", Boolean(p));
  eq("…at the level its evidence allows (3 liked, none against)", p?.strength, "strong");
  check("…its pooled items leave the pool; the one it didn't cite stays", !s.profileLedger.pool.includes(ref(HEIST[0])) && s.profileLedger.pool.includes(ref(HEIST[3])));
  check("…with a history entry", s.hypothesisHistory.some((r) => r.hypothesisId === p?.id && /New pattern/.test(r.reason)));
  check("…and the message names it", /started a new pattern, “Clever heist and con capers”/.test(out.message));
}
{
  // the #364 support filing runs as today
  const s = profile();
  const re7 = item("re7", "Resident Evil 7", ["play"], ["Shooter"]);
  const circe = item("circe", "Circe", ["read"], ["Fantasy", "Mythology"]);
  const bio = item("bio", "Hollow Knight", ["play"], ["Fantasy"]);
  [re7, circe, bio].forEach((it) => react(s, it, "loved"));
  s.modelHypotheses.push(
    { id: "ai-mythic", title: "Mythic and fantastical worlds", claim: "Drawn to mythic and fantastical worlds in both books and games.", supports: [ref(circe), ref(bio), ref(re7)], counters: [], domains: ["read", "play"], strength: "supported", status: "supported", crossDomain: "tentative" },
    { id: "ai-horror-games", title: "Atmosphere-driven horror in games", claim: "Enjoys horror games that lean on atmosphere and tension more than combat.", supports: [ref(re7)], counters: [], domains: ["play"], strength: "supported", status: "supported", crossDomain: "untested" }
  );
  s.profileLedger = { ...ledgerAfterFullRefresh(s), pool: [] };
  react(s, HEIST[0], "liked");
  applyPlacementResult(s, refreshQueue(s), placed([put(HEIST[0], "unexplained")]));
  check("#364 filing: a misfiled support comes off the cross-media pattern", !pattern(s, "ai-mythic").supports.includes(ref(re7)));
  check("…and stays on the pattern it belongs to", pattern(s, "ai-horror-games").supports.includes(ref(re7)));
}

// ---- 5. the browser path, through the real endpoint code with a canned model ---------------------------------
const ENV = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
let modelCalls = 0;
let decide = () => ({ placements: [], newPatterns: [] });
const cannedModel = async (_url, init) => {
  modelCalls += 1;
  const prompt = JSON.parse(init.body).messages[0].content;
  const context = JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8));
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(decide(context)) }], usage: { input_tokens: 900, output_tokens: 60 }, model: "claude-test" }) };
};
const requests = [];
let serverEnv = { ...ENV, TASTEMAKE_PROFILE_PLACEMENT: "1" };
let failNext = false;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  if (failNext) { failNext = false; throw new Error("network"); }
  const quiet = [console.log, console.info, console.error];
  console.log = () => {}; console.info = () => {}; console.error = () => {};
  try {
    const { produceHypotheses } = await import("../../api/hypotheses.mjs");
    const payload = body.placement
      ? await producePlacement({ rawState: body.state, placement: body.placement, env: serverEnv, fetchImpl: cannedModel })
      : await produceHypotheses({ rawState: body.state, env: serverEnv, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ hypotheses: s0Hypotheses(), insufficientEvidence: false }) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) }) });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) };
  } finally { [console.log, console.info, console.error] = quiet; }
};
const s0Hypotheses = () => [{ id: P_SLOW.id, label: P_SLOW.title, claim: P_SLOW.claim, evidence: P_SLOW.supports, counter: [], domains: ["movies"], crossDomain: "untested", level: "strong", conditional: false, context: null }];
const byTitle = (context, title) => [...context.new, ...context.pool].find((r) => r.t === title)?.id;
const patternId = (context, name) => context.patterns.find((p) => p.name === name)?.id;
const browserState = () => { const s = profile(); s.hypothesisAiChecked = null; return s; };
{
  eq("server flag: off unless TASTEMAKE_PROFILE_PLACEMENT=1", placementConfig(ENV).enabled, false);
  eq("server flag: on with it", placementConfig({ ...ENV, TASTEMAKE_PROFILE_PLACEMENT: "1" }).enabled, true);

  const s = browserState();
  requests.length = 0; modelCalls = 0;
  await refreshProfileHypotheses(s, { placement: true, force: true });
  check("browser, nothing new: no request, no model call", requests.length === 0 && modelCalls === 0);
  eq("…and the message says nothing changed", s.hypothesisAiMessage, NOTHING_NEW_MESSAGE);

  react(s, HEIST[0], "liked"); react(s, SCARY_MISS[0], "disliked");
  decide = (context) => ({ placements: [{ item: byTitle(context, "Ocean's Eleven"), place: "unexplained", pattern: null }, { item: byTitle(context, "It Comes at Night"), place: "counter", pattern: patternId(context, P_SLOW.title) }], newPatterns: [] });
  requests.length = 0; modelCalls = 0;
  await refreshProfileHypotheses(s, { placement: true });
  eq("browser, 2 new: one request, one model call", `${requests.length}/${modelCalls}`, "1/1");
  eq("…the request names only the new items", requests[0].placement.items.sort().join(","), [ref(HEIST[0]), ref(SCARY_MISS[0])].sort().join(","));
  check("…the counter is applied by software", pattern(s, "ai-slow-horror").counters.includes(ref(SCARY_MISS[0])));
  eq("…the message says where each went", s.hypothesisAiMessage, "2 new ratings: 1 counts against “Uncanny slow-burn horror on screen” and 1 isn’t part of a pattern yet.");
  check("…the refresh is recorded as checked", Boolean(s.hypothesisAiChecked));
  requests.length = 0;
  await refreshProfileHypotheses(s, { placement: true });
  eq("…and a second refresh of the same evidence makes no request", requests.length, 0);

  // the model tries to reword a confirmed pattern: there's nowhere in the answer to do it
  react(s, GAME_MISS[0], "disliked");
  decide = (context) => ({ placements: [{ item: byTitle(context, "Myst"), place: "counter", pattern: patternId(context, P_PUZZLE.title) }], newPatterns: [{ label: P_PUZZLE.title, claim: "A reworded claim about puzzle games that the user never confirmed at all.", evidence: [byTitle(context, "Ocean's Eleven"), byTitle(context, "Myst")], domains: ["play"], conditional: false }], label: "x", claim: "y" });
  await refreshProfileHypotheses(s, { placement: true });
  eq("confirmed patterns are never reworded, whatever the answer says", pattern(s, "ai-puzzles").claim, P_PUZZLE.claim);
  eq("…and no second pattern with its name is added", s.modelHypotheses.filter((p) => p.title === P_PUZZLE.title).length, 1);

  // a failed request
  react(s, HEIST[1], "liked");
  const ledgerBefore = JSON.stringify(s.profileLedger);
  const patternsBefore = JSON.stringify(s.modelHypotheses);
  failNext = true;
  await refreshProfileHypotheses(s, { placement: true });
  check("browser, failed request: patterns and ledger unchanged", JSON.stringify(s.profileLedger) === ledgerBefore && JSON.stringify(s.modelHypotheses) === patternsBefore);
  check("…the item stays new", refreshQueue(s).items.includes(ref(HEIST[1])));
  check("…and the message is today's", /couldn’t update your profile/.test(s.hypothesisAiMessage));

  // the server's switch is off: today's full refresh runs instead, in the same refresh
  serverEnv = { ...ENV };
  requests.length = 0; modelCalls = 0;
  await refreshProfileHypotheses(s, { placement: true, force: true });
  eq("server switch off: placement request, then today's full request", requests.map((r) => (r.placement ? "placement" : "full")).join(","), "placement,full");
  eq("…no placement model call", modelCalls, 0);
  check("…and the ledger is rebuilt from the full refresh", readLedger(s.profileLedger) && !refreshQueue(s).items.length);
  serverEnv = { ...ENV, TASTEMAKE_PROFILE_PLACEMENT: "1" };

  // flag off (placement: false, the rollback): today's request, no ledger written
  const t = browserState();
  delete t.profileLedger;
  react(t, HEIST[0], "liked");
  requests.length = 0;
  await refreshProfileHypotheses(t, { placement: false, force: true });
  check("browser flag off: today's request, without placement", requests.length === 1 && !requests[0].placement);
  check("…and no ledger is written", t.profileLedger === undefined);

  // first build (no patterns yet) with the flag on: today's fresh build, then the ledger starts
  const u = browserState();
  u.modelHypotheses = [];
  delete u.profileLedger;
  requests.length = 0;
  await refreshProfileHypotheses(u, { placement: true, force: true });
  check("flag on, no patterns yet: today's build runs", requests.length === 1 && !requests[0].placement && u.modelHypotheses.length > 0);
  check("…and the ledger starts from it", Boolean(readLedger(u.profileLedger)));
}
{
  // the endpoint itself
  const s = profile();
  react(s, HEIST[0], "liked");
  const rawState = { ...s, selectedFavorites: [], libraryFavorites: [], blindSpotDismissed: [] };
  modelCalls = 0;
  const off = await producePlacement({ rawState, placement: { items: [ref(HEIST[0])] }, env: ENV, fetchImpl: cannedModel });
  check("endpoint, switch off: placementOff, no call", off.meta.placementOff === true && off.meta.paidCallMade === false && modelCalls === 0);
  const none = await producePlacement({ rawState, placement: { items: [] }, env: serverEnv, fetchImpl: cannedModel });
  check("endpoint, nothing new: no call", none.source === "nothing-new" && modelCalls === 0);
  const notTried = await producePlacement({ rawState, placement: { items: ["ev:nope"] }, env: serverEnv, fetchImpl: cannedModel });
  check("endpoint, only unknown refs: no call", notTried.source === "nothing-new" && modelCalls === 0 && notTried.meta.notSent.includes("ev:nope"));
  decide = (context) => ({ placements: [{ item: byTitle(context, "Ocean's Eleven"), place: "unexplained", pattern: null }], newPatterns: [] });
  const quiet = console.info; console.info = () => {};
  const yes = await producePlacement({ rawState, placement: { items: [ref(HEIST[0])] }, env: serverEnv, fetchImpl: cannedModel });
  console.info = quiet;
  check("endpoint, switch on: one call, checked placements returned", yes.source === "model" && modelCalls === 1 && yes.placement.placements[0]?.place === "unexplained");
  check("endpoint: usage reported for the eval and metrics", yes.meta.usage?.output_tokens === 60);
}

// ---- 6. the paid-eval fixtures are wired (no call) -----------------------------------------------------------
{
  const ids = REFRESH_A_FIXTURES.map((f) => f.id);
  for (const id of ["example-refresh", "example-refresh-confirmed", "example-refresh-partly", "refresh-new-preference", "refresh-nothing-new", "refresh-one-unexplained", "refresh-pool-builds", "refresh-first-run", "refresh-second-profile"]) check(`refresh-a fixture: ${id}`, ids.includes(id));
  const calls = REFRESH_A_FIXTURES.reduce((n, f) => n + 1 + (f.then?.length ?? 0), 0);
  eq("refresh-a: 10 placement calls per repetition", calls, 10);
  const firstRun = REFRESH_A_FIXTURES.find((f) => f.id === "refresh-first-run").build();
  const q = refreshQueue(firstRun);
  check("refresh-first-run: no ledger, so the Example Profile's 23 uncited items are new", q.firstRun && q.items.length === 23);
  const newPref = refreshQueue(REFRESH_A_FIXTURES.find((f) => f.id === "refresh-new-preference").build());
  eq("refresh-new-preference: with its ledger only the 5 added ratings are new", newPref.items.length, 5);
  check("refresh-nothing-new: with its ledger only the 3 added ratings are new", refreshQueue(REFRESH_A_FIXTURES.find((f) => f.id === "refresh-nothing-new").build()).items.length === 3);
  eq("refresh-one-unexplained: one new item", refreshQueue(REFRESH_A_FIXTURES.find((f) => f.id === "refresh-one-unexplained").build()).items.length, 1);
  const pool = REFRESH_A_FIXTURES.find((f) => f.id === "refresh-pool-builds");
  const step = pool.build();
  const call1 = refreshQueue(step);
  eq("refresh-pool-builds, call 1: two new items", call1.items.length, 2);
  applyPlacementResult(step, call1, placed(call1.items.map((r) => ({ ref: r, place: "unexplained", patternId: null }))));
  pool.then[0](step);
  const call2 = refreshQueue(step);
  check("refresh-pool-builds, call 2: two more new, the first two pooled", call2.items.length === 2 && call2.pool.length === 2);
  check("the #318 fixtures run as a first refresh (no ledger)", ["example-refresh", "example-refresh-confirmed", "example-refresh-partly"].every((id) => refreshQueue(REFRESH_A_FIXTURES.find((f) => f.id === id).build()).firstRun));
  eq("refresh-second-profile: its 3 added ratings are new", refreshQueue(REFRESH_A_FIXTURES.find((f) => f.id === "refresh-second-profile").build()).items.length, 3);
}

// ---- 7. the paid-eval wrapper's plan and cap (nothing is run) -----------------------------------------------
{
  const { APPROVED_CALLS, TOTAL_CAP_USD, plan, plannedCalls, remainingCap } = await import("../evals/refresh-a-eval.mjs");
  const runs = plan();
  eq("paid eval plan: 45 calls", plannedCalls(runs), 45);
  eq("…within the approved count", plannedCalls(runs) <= APPROVED_CALLS, true);
  eq("…arms interleaved, three repetitions", runs.map((r) => r.arm[0]).join(""), "bababa");
  eq("…total cap $0.06", TOTAL_CAP_USD, 0.06);
  eq("cap: what's left goes to the next run", remainingCap(0.0412), 0.0188);
  eq("cap: never negative", remainingCap(0.07), 0);
}

finish();
