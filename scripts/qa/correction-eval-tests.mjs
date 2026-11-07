// Correction-aware ranking eval (scripts/evals/corrections/): the prototype must equal production when no
// correction applies, the fixtures must be deterministic and contain the cases the eval relies on, and the
// correction arithmetic must do what rank.mjs says. Free: no network, no model.
import { createSuite } from "./lib/assert.mjs";
import { offeredCandidates } from "../../api/recommendations.mjs";
import { buildContext } from "../../src/ai/context.js";
import { serializeAiState } from "../../src/ai/live-client.js";
import { chooseCandidates, tasteScore, featureRarity } from "../../src/ai/taste-score.js";
import { hydrateState } from "../../src/server/request-state.mjs";
import { ROUNDS, loadCases, wireRecords } from "../evals/corrections/fixtures.mjs";
import { armSelection, chooseWith, correctedScorer, patternFactor, productionScorer, withAnchors } from "../evals/corrections/rank.mjs";
import { ROUND2_ARMS, scenariosFor } from "../evals/corrections/run.mjs";
import { catalogIndex, evidenceItems, retrieve, seedFor } from "../evals/corrections/retrieval.mjs";
import { rejectedFn } from "../evals/corrections/run3.mjs";
import { loadSnapshot } from "../evals/stress/profiles.mjs";
import { primaryDomain } from "../evals/corrections/rank.mjs";
import { patternLabels, rejectionProfile } from "../evals/corrections/patterns.mjs";

const { check, eq, finish } = createSuite("correction-eval");

const cases = loadCases();
const contexts = [];
for (const kase of cases) {
  const anchored = withAnchors(kase.pool, wireRecords(kase.state(0)));
  for (let round = 0; round < ROUNDS; round += 1) {
    const raw = JSON.parse(JSON.stringify(serializeAiState(kase.state(round))));
    contexts.push({ kase, round, ctx: buildContext(hydrateState(raw), anchored) });
  }
}
const opts = (ctx) => ({ count: 6, mode: ctx.recommendationFilter, curveball: ctx.curveball });
const key = (list) => list.map((c) => `${c.id}:${c.tasteScore}:${c.edge ? 1 : 0}`).join("|");

// ---- parity with production ------------------------------------------------------------------------------
{
  let scoreDiffs = 0, selectionDiffs = 0, offeredDiffs = 0;
  for (const { ctx } of contexts) {
    const cache = new Map();
    const rarity = featureRarity(ctx.evidence, cache);
    const ours = productionScorer(ctx.evidence);
    for (const c of ctx.candidates) if (Math.abs(ours(c) - tasteScore(c, ctx.evidence, { cache, rarity })) > 1e-12) scoreDiffs += 1;
    const proto = chooseWith(ctx.candidates, ctx.evidence, ours, opts(ctx)).chosen;
    if (key(proto) !== key(chooseCandidates(ctx.candidates, ctx.evidence, opts(ctx)))) selectionDiffs += 1;
    if (key(proto) !== key(offeredCandidates(ctx))) offeredDiffs += 1;
  }
  eq("the harness's score parts add up to production's tasteScore on every candidate", scoreDiffs, 0);
  eq("its copy of the selection step returns exactly chooseCandidates' six, order and Surprise slot", selectionDiffs, 0);
  eq("...which is what production offers (offeredCandidates)", offeredDiffs, 0);
  eq("every case and round is covered", contexts.length, cases.length * ROUNDS);
}

// ---- fixtures --------------------------------------------------------------------------------------------
{
  const again = loadCases();
  check("fixtures are deterministic (pools and supports)", JSON.stringify(cases.map((c) => [c.pool.map((i) => i.id), c.patterns])) === JSON.stringify(again.map((c) => [c.pool.map((i) => i.id), c.patterns])));
  check("every pool has 36 titles", cases.every((c) => c.pool.length === 36), cases.map((c) => c.pool.length).join(","));
  check("every pattern has at least one support", cases.every((c) => c.patterns.every((p) => p.trueSupports.length > 0)));
  const example = cases.find((c) => c.id === "example-paige");
  const fantasy = example.patterns.find((p) => p.id === "ai-genre-fantasy-mythic-worlds");
  check("#318: the Example Profile's fantasy pattern stores Resident Evil 7 as a support (as the data file did before #318's fix)", fantasy.supports.includes("ev:igdb-game-19562"));
  check("...and the true supports leave it out", !fantasy.trueSupports.includes("ev:igdb-game-19562") && fantasy.wrongSupports.length === 1);
  check("...while it still truly supports the horror and exploration patterns", ["ai-atmospheric-horror-games", "ai-puzzle-exploration-games"].every((id) => example.patterns.find((p) => p.id === id).trueSupports.includes("ev:igdb-game-19562")));
  const wrongOnWire = cases.flatMap((c) => c.patterns.flatMap((p) => p.wrongSupports.map((ref) => ({ c, ref }))))
    .every(({ c, ref }) => contexts.find((x) => x.kase === c).ctx.evidence.some((r) => r.ref === ref));
  check("every deliberately wrong support is among the tried items the browser sends", wrongOnWire);
  check("there are overlapping patterns (an item supporting 2+)", cases.some((c) => c.patterns.some((a) => c.patterns.some((b) => a !== b && a.supports.some((r) => b.supports.includes(r))))));
  const classes = new Set(cases.flatMap((c) => scenariosFor(c).map((s) => s.cls)));
  check("scenarios cover explicit, ambiguous, excluded-area and conflicting corrections", ["none", "ambiguous", "not-me", "lot", "little", "excluded", "conflict", "stored"].every((x) => classes.has(x)), [...classes].join(","));
  check("anchors are stand-ins from the profile's own ratings", contexts.every(({ ctx }) => ctx.candidates.every((c) => !c.relatedToId || ctx.evidence.some((r) => r.itemId === c.relatedToId))));
}

// ---- correction arithmetic -------------------------------------------------------------------------------
{
  const strength = { notMe: 0.25, lot: 1.5, little: 0.5 };
  eq("'not me' uses the not-me strength", patternFactor({ says: "not-me" }, "tv", strength), 0.25);
  eq("'important' after 'accurate' boosts", patternFactor({ says: "accurate", weight: "lot" }, "tv", strength), 1.5);
  eq("'not important' after 'accurate' lowers", patternFactor({ says: "accurate", weight: "little" }, "tv", strength), 0.5);
  eq("'partly' with no excluded area does nothing", patternFactor({ says: "partial" }, "tv", strength), 1);
  eq("'partly' with an excluded area acts inside that area", patternFactor({ says: "partial", excludedDomains: ["tv"] }, "tv", strength), 0.25);
  eq("...and nowhere else", patternFactor({ says: "partial", excludedDomains: ["tv"] }, "read", strength), 1);
  eq("'not sure' does nothing", patternFactor({ says: "unsure" }, "tv", strength), 1);
  eq("'depends on context' does nothing to ranking", patternFactor({ says: "accurate", context: "some" }, "tv", strength), 1);

  // One loved item supporting three patterns; a candidate scored only through it.
  const rec = (id, extra = {}) => ({ ref: `ev:${id}`, itemId: id, title: id, class: "experienced", polarity: 1, weight: 2, kind: "experienced-strong-positive", domains: ["play"], genres: ["horror"], refinements: [], ...extra });
  const records = [rec("re7"), rec("other", { genres: ["puzzle"] })];
  const candidate = { id: "c", domains: ["play"], genres: ["horror"], relatedToId: "re7" };
  const patterns = ["a", "b", "c"].map((id) => ({ id, label: id, domains: ["play"], supports: ["ev:re7"], trueSupports: ["ev:re7"] }));
  const notMeA = [{ hypothesisId: "a", says: "not-me" }];
  const base = productionScorer(records)(candidate);
  const full = correctedScorer(records, patterns, notMeA, { strength })(candidate);
  const split = correctedScorer(records, patterns, notMeA, { strength, split: true })(candidate);
  const anchorOff = correctedScorer(records, patterns, notMeA, { strength, anchorOff: true })(candidate);
  const floored = correctedScorer(records, patterns, notMeA, { strength, floor: 0.5 })(candidate);
  check("without split, the whole contribution takes the factor", Math.abs(full - base * 0.25) < 1e-9, `${full} vs ${base}`);
  check("with split, one of three patterns passes a third of it: x0.75", Math.abs(split - base * 0.75) < 1e-9, `${split} vs ${base}`);
  check("anchor off keeps the 'found from' bonus whole", anchorOff > full);
  check("a floor stops the score falling below half", Math.abs(floored - base * 0.5) < 1e-9, `${floored} vs ${base}`);
  eq("ambiguous answers leave the score exactly as production's", correctedScorer(records, patterns, [{ hypothesisId: "a", says: "partial" }], { strength, split: true })(candidate), base);
  const lotA = correctedScorer(records, patterns, [{ hypothesisId: "a", says: "accurate", weight: "lot" }], { strength })(candidate);
  check("'important' raises the score", lotA > base);
  const neg = [...records, rec("bad", { polarity: -1, weight: -2, kind: "experienced-negative" })];
  const negPatterns = [{ id: "a", label: "a", domains: ["play"], supports: ["ev:bad"], trueSupports: ["ev:bad"] }];
  eq("dislikes are never scaled", correctedScorer(neg, negPatterns, notMeA, { strength })(candidate), productionScorer(neg)(candidate));
}

// ---- round 2: structural options ---------------------------------------------------------------------------
{
  // The arm-by-arm neutrality and set-size sweep (~30 s) runs with `npm run test:corrections`
  // (correction-eval-arms-tests.mjs), not in npm test.

  // A medium's turn yields only to a clearly better title from another medium.
  const rec = (id, domain, genre) => ({ ref: `ev:${id}`, itemId: id, title: id, class: "experienced", polarity: 1, weight: 2, kind: "experienced-strong-positive", domains: [domain], genres: [genre], refinements: [] });
  const records = [rec("tvA", "tv", "comedy"), rec("mvA", "movies", "drama")];
  const cands = [
    { id: "tv1", title: "tv1", domains: ["tv"], genres: ["comedy"], relatedToId: "tvA" },
    { id: "mv1", title: "mv1", domains: ["movies"], genres: ["drama"], relatedToId: "mvA" },
    { id: "mv2", title: "mv2", domains: ["movies"], genres: ["drama"], relatedToId: "mvA" }
  ];
  const patterns = [{ id: "comedy", label: "comedy", domains: ["tv"], supports: ["ev:tvA"], trueSupports: ["ev:tvA"] }];
  const notMe = [{ hypothesisId: "comedy", says: "not-me" }];
  const arm = (id) => ROUND2_ARMS.find((a) => a.id === id);
  const pick = (a) => armSelection(records, cands, patterns, notMe, a, { mode: "all" }).proto;
  eq("B one medium: a rejected first title yields to a better title from another medium", pick(arm("notMe 0.25 / B one medium")).chosen.map((c) => c.id).join(","), "mv1,mv2,tv1");
  check("B second turns: a medium's only title never yields", pick(arm("notMe 0.25 / B second turns")).chosen.some((c) => c.id === "tv1") && pick(arm("notMe 0.25 / B second turns")).yields === 0);
  eq("...and with nothing rejected, B does nothing", armSelection(records, cands, patterns, [], arm("notMe 0.25 / B one medium"), { mode: "all" }).proto.yields, 0);
  const lowered = armSelection(records, cands, patterns, notMe, arm("notMe 0.25 / A local order"), { mode: "all" }).lowered;
  check("A local: a rejected title's retrieval term shrinks with its score, other titles keep theirs", lowered(cands[0]) < 1 && lowered(cands[1]) === 1, `${lowered(cands[0])}, ${lowered(cands[1])}`);
  const surprise = new Set(cases.flatMap((c) => scenariosFor(c).filter((x) => x.cls === "surprise").map(() => c.id)));
  check("round-2 fixtures: Surprise-anchor rejections exist in several cases", surprise.size >= 4, [...surprise].join(","));
  check("round-2 fixtures: three extended cases, each with wrong supports on the wire or none by design", cases.filter((c) => c.extended).length === 3);
}

// ---- round 3: retrieval stand-in ----------------------------------------------------------------------------
{
  const index = catalogIndex(loadSnapshot().items);
  let neutralDiffs = 0, mediaLost = 0, extraWaves = 0, blockedLeaks = 0, rejectedAnchors = 0, swapRejectedAnchors = 0, checked = 0;
  for (const kase of cases) {
    const state = kase.state(0);
    const seed = seedFor(kase.id, 0);
    const base = retrieve(state, index, { seed });
    const again = retrieve(state, index, { seed });
    if (base.pool.map((i) => i.id).join() !== again.pool.map((i) => i.id).join()) neutralDiffs += 1;
    const rated = new Set(evidenceItems(state).map((i) => i.id));
    if (base.pool.some((i) => rated.has(i.id) || state.feedbackByRecommendation[i.id])) blockedLeaks += 1;
    for (const scenario of scenariosFor(kase)) {
      const rej = rejectedFn(kase, scenario.statements);
      if (!rej) {
        for (const mode of ["swap", "add"]) if (retrieve(state, index, { seed, mode, surpriseAnchor: true, rejected: rej }).pool.map((i) => i.id).join() !== base.pool.map((i) => i.id).join()) neutralDiffs += 1;
        continue;
      }
      checked += 1;
      const swap = retrieve(state, index, { seed, mode: "swap", rejected: rej });
      const add = retrieve(state, index, { seed, mode: "add", rejected: rej });
      const anchorMedia = (r) => new Set(r.anchors.map((id) => primaryDomain(evidenceItems(state).find((i) => i.id === id))));
      for (const d of anchorMedia(base)) if (!anchorMedia(swap).has(d)) mediaLost += 1;
      if (add.waves > base.waves + 1) extraWaves += 1;
      const ev = new Map(evidenceItems(state).map((i) => [i.id, i]));
      rejectedAnchors += base.anchors.filter((id) => rej(ev.get(id))).length;
      swapRejectedAnchors += swap.anchors.filter((id) => rej(ev.get(id))).length;
    }
  }
  eq("the stand-in is deterministic, and with nothing rejected every retrieval option is exactly current retrieval", neutralDiffs, 0);
  eq("rated, saved and shown titles never enter the stand-in pool", blockedLeaks, 0);
  eq("swap never takes a medium's only anchor away", mediaLost, 0);
  check("swap uses fewer rejected anchors than current retrieval", checked > 0 && swapRejectedAnchors < rejectedAnchors, `${rejectedAnchors} → ${swapRejectedAnchors} over ${checked} scenarios`);
  eq("add puts its extra anchors in the first wave (never more than one extra round trip than current)", extraWaves, 0);
  const example = cases.find((c) => c.id === "example-paige");
  const fantasy = scenariosFor(example).find((x) => x.id === "not me: ai-genre-fantasy-mythic-worlds");
  const re7 = { id: "igdb-game-19562", domains: ["play"] };
  check("#318 case: with stored supports Resident Evil 7 counts as a rejected-only anchor (it also supports confirmed patterns only if confirmed)", rejectedFn(example, fantasy.statements)(re7) === true);
  check("...with true supports it doesn't", rejectedFn(example, fantasy.statements, "trueSupports")(re7) === false);
}

// ---- round 4: conservative, label-aware rules -------------------------------------------------------------------
{
  const index = catalogIndex(loadSnapshot().items);
  const example = cases.find((c) => c.id === "example-paige");
  const state = example.state(0);
  const items = new Map(evidenceItems(state).map((i) => [`ev:${i.id}`, i]));
  const fantasy = example.patterns.find((p) => p.id === "ai-genre-fantasy-mythic-worlds");
  const notMe = [{ hypothesisId: fantasy.id, says: "not-me" }];
  const profile = rejectionProfile(example, state, notMe);
  const re7 = evidenceItems(state).find((i) => i.id === "igdb-game-19562");
  check("no rejection, no profile (every round-4 option is then off)", rejectionProfile(example, state, []) === null && rejectionProfile(example, state, [{ hypothesisId: fantasy.id, says: "partial" }]) === null);
  check("the fantasy pattern's labels include fantasy", patternLabels(fantasy, items).includes("fantasy"));
  check("Resident Evil 7 (stored under fantasy by mistake) is never dropped as an anchor: it also supports other patterns", re7 && !profile.rejectedOnly(re7) && !profile.conservativeDrop(re7));
  const seed = seedFor(example.id, 0);
  const base = retrieve(state, index, { seed });
  const swapped = retrieve(state, index, { seed, mode: "swap", rejected: profile.conservativeDrop, avoid: profile.avoid, reorder: profile.kind });
  const ev = new Map(evidenceItems(state).map((i) => [i.id, i]));
  const added = swapped.anchors.filter((id) => !base.anchors.includes(id)).map((id) => ev.get(id));
  check("a dropped anchor's replacement is never the rejected kind", added.length > 0 && added.every((i) => !profile.kind(i)), added.map((i) => i.title).join(", "));
  check("...and no medium loses its anchor", [...new Set(base.anchors.map((id) => primaryDomain(ev.get(id))))].every((d) => swapped.anchors.some((id) => primaryDomain(ev.get(id)) === d)));
  // Guard: a broad label alone never defines a pattern.
  const broadOnly = { id: "x", supports: ["ev:a", "ev:b"] };
  const fake = new Map([["ev:a", { id: "a", provider: "tmdb", genres: ["35"] }], ["ev:b", { id: "b", provider: "tmdb", genres: ["35"] }], ["ev:c", { id: "c", provider: "tmdb", genres: ["27"] }]]);
  eq("guarded: a pattern carried only by a broad label (comedy) has no labels", patternLabels(broadOnly, fake).join(), "");
  eq("...unguarded it does", patternLabels(broadOnly, fake, { guard: false }).join(), "comedy");
  // Surprise-only titles never take a main slot.
  const bridged = retrieve(state, index, { seed, bridge: profile.bridge });
  const onlyForSurprise = bridged.pool.filter((i) => i.surpriseOnly);
  const ctxRecords = wireRecords(state);
  const pick = chooseWith(bridged.pool, ctxRecords, productionScorer(ctxRecords), { count: 6, mode: "all", curveball: true }).chosen;
  check("bridge titles are marked Surprise-only and never fill a main slot", onlyForSurprise.length > 0 && pick.filter((c) => !c.edge).every((c) => !c.surpriseOnly));
}

finish();
