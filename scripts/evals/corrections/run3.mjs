#!/usr/bin/env node
// Correction eval, round 3 (Nov 4): replacement retrieval. Does fetching different candidates after a
// correction give same-medium alternatives that fixed pools lacked (round 2: 59% of "not me" titles had a
// relevant replacement only in another medium, 27% none at all)? Free: no network, no model, no production
// change. Deterministic.
//
//   node scripts/evals/corrections/run3.mjs                 # writes reports/round3.md and round3.json
//   node scripts/evals/corrections/run3.mjs --out <dir>
//
// Pools come from the retrieval stand-in in retrieval.mjs (not the fixed 36-title pools of rounds 1-2), so
// round-3 numbers compare arms with each other and with current retrieval on the same stand-in, not with
// rounds 1-2. Gates: round 1's (unchanged where they still apply) and the four provisional revisions Paige
// approved on Nov 4, reported side by side.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { offeredCandidates, produceRecommendations } from "../../../api/recommendations.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { featureRarity } from "../../../src/ai/taste-score.js";
import { setStatement } from "../../../src/model/statements.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { evidenceRecords } from "../../../src/model/evidence.js";
import { loadSnapshot } from "../stress/profiles.mjs";
import { loadCases } from "./fixtures.mjs";
import { armSelection, attribution, correctedScorer, primaryDomain, productionScorer, scoreParts } from "./rank.mjs";
import { catalogIndex, evidenceItems, retrieve, seedFor } from "./retrieval.mjs";
import { JUDGE, STRENGTHS, scenariosFor, targetsOf } from "./run.mjs";
import { rejectionProfile } from "./patterns.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const ROUNDS3 = 3;

// A = round 2's correction-aware local ordering at notMe 0.75 with split + anchor off (Paige, Nov 4:
// "a conservative experimental starting point, not a final decision").
const A = { strength: STRENGTHS[0], split: true, anchorOff: true, retrieval: "local" };
const arm = (id, retrieval, select, extra = {}) => ({ id, retrieval: undefined, fetch: retrieval, ...(select === "A" ? A : { select: "production" }), ...extra });
export const ROUND3_ARMS = [
  arm("current retrieval / production selection", "current", "production"),
  arm("current retrieval / A", "current", "A"),
  arm("swap / production selection", "swap", "production"),
  arm("swap / A", "swap", "A"),
  arm("add / production selection", "add", "production"),
  arm("add / A", "add", "A"),
  arm("swap / A / Surprise alternatives", "swap", "A", { surprise: true }),
  arm("add / A / Surprise alternatives", "add", "A", { surprise: true }),
  arm("oracle: swap / A / Surprise alternatives / true supports", "swap", "A", { surprise: true, supportsKey: "trueSupports", oracle: true }),
  arm("oracle: add / A / Surprise alternatives / true supports", "add", "A", { surprise: true, supportsKey: "trueSupports", oracle: true })
].map((a) => ({ ...a, retrieval: a.select === "production" ? undefined : "local" }));

export const GATES3 = {
  neutrality: "No statements or only ambiguous ones: the six, their order, the Surprise slot and the number of provider calls match current retrieval exactly.",
  setSize: "As many titles as current retrieval offers, every evaluation.",
  reversibility: "An answer chosen and then cleared (setStatement twice) leaves exactly current retrieval's six.",
  fallbackParity: "Production's no-AI fallback shows the stand-in pool's shortlist, every case and round.",
  compliance: "\"Not me\": titles mostly (>=50%) from the rejected pattern fall to at most half of current retrieval's.",
  excludedArea: "Excluded area: the same, inside the excluded area.",
  unrelated: "Titles in current retrieval's six under 20% related to any corrected pattern: at least 90% stay.",
  wrongSupport: "Titles there partly (>=20%) because of a wrongly stored support and under 20% from true supports: at least 90% stay.",
  heldOut: "Held-out Loved items unrelated to the correction: offered at least as often as under current retrieval, minus 5 points.",
  diversity: "Distinct media never more than one below current retrieval's (round 1's rule).",
  surprisePresent: "A Surprise slot at least as often as current retrieval, minus 5 points.",
  surpriseCompliance: "Surprise slots mostly from a rejected pattern fall by at least half.",
  relevanceProxy: "Mean uncorrected score of the six falls by no more than 10% under \"not me\".",
  // Provisional revisions (Nov 4), reported next to the originals:
  complianceReplaceable: "Revised: of current retrieval's \"not me\" titles that have a relevant same-medium replacement in the arm's own pool, at least half are replaced.",
  mediaLoss: "Revised: at most 5% of rejection evaluations lose a medium current retrieval offered.",
  concentration: "Revised: sets with 3+ titles of one medium no more than 5 points above current retrieval's rate.",
  order: "Revised (replaces mean place shift): at least 90% of pairs of unrelated titles present in both orders keep their relative order.",
  endorsedKept: "Revised (new): titles mostly (>=50%) from a confirmed pattern stay at least 90% of the time."
};

const NEUTRAL = new Set(["none", "ambiguous"]);
const REJECTING = new Set(["not-me", "excluded", "conflict", "double", "not-me+accurate", "surprise"]);
const quietly = async (fn) => {
  const saved = { info: console.info, log: console.log, error: console.error, warn: console.warn };
  console.info = console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

// Which evidence items a scenario rejects, for retrieval: the rating supports a rejected pattern (inside
// its excluded area, if that's the rejection) and no confirmed one. Null when nothing is rejected.
export function rejectedFn(kase, statements, supportsKey = "supports") {
  const byId = new Map(kase.patterns.map((p) => [p.id, p]));
  const rej = [], endorsed = [];
  for (const s of statements) {
    const p = byId.get(s.hypothesisId);
    if (!p) continue;
    if (s.says === "not-me") rej.push({ p, domains: null });
    else if (s.says === "partial" && s.excludedDomains?.length) rej.push({ p, domains: s.excludedDomains });
    else if (s.says === "accurate" && s.weight !== "little") endorsed.push(p);
  }
  if (!rej.length) return null;
  return (item) => {
    const ref = `ev:${item.id}`;
    const d = primaryDomain(item);
    return rej.some(({ p, domains }) => p[supportsKey].includes(ref) && (!domains || domains.includes(d))) && !endorsed.some((p) => p[supportsKey].includes(ref));
  };
}

const ctxFor = (raw, pool) => buildContext(hydrateState(structuredClone(raw)), pool);
const opts = (ctx) => ({ mode: ctx.recommendationFilter, curveball: ctx.curveball });
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && Boolean(x.edge) === Boolean(b[i].edge));

async function prepareCase(kase, index) {
  const preps = [];
  const history = [];
  for (let round = 0; round < ROUNDS3; round += 1) {
    const state = kase.state(0);
    state.recommendationSets = history.map((ids) => [...ids]);
    const raw = JSON.parse(JSON.stringify(serializeAiState(state)));
    const seed = seedFor(kase.id, round);
    const baseRet = retrieve(state, index, { seed });
    const baseCtx = ctxFor(raw, baseRet.pool);
    const baseOffered = offeredCandidates(baseCtx);
    history.push(baseOffered.map((c) => c.id));
    const fallback = await quietly(() => produceRecommendations({ rawState: raw, env: {}, retrieve: async () => baseRet.pool }));
    preps.push({ kase, round, state, raw, seed, baseRet, baseCtx, baseOffered, fallbackIds: (fallback.picks ?? []).map((p) => p.id), retCache: new Map() });
  }
  return preps;
}

function armRun(prep, statements, scenarioKey, a, index) {
  if (a.r4) return armRun4(prep, statements, scenarioKey, a, index);
  const rejected = rejectedFn(prep.kase, statements, a.supportsKey ?? "supports");
  let ret = prep.baseRet, ctx = prep.baseCtx;
  if (rejected && (a.fetch !== "current" || a.surprise)) {
    const key = `${a.fetch}|${a.surprise ? 1 : 0}|${a.supportsKey ?? "supports"}|${scenarioKey}`;
    if (!prep.retCache.has(key)) {
      const r = retrieve(prep.state, index, { seed: prep.seed, mode: a.fetch, surpriseAnchor: Boolean(a.surprise), rejected });
      prep.retCache.set(key, { ret: r, ctx: ctxFor(prep.raw, r.pool) });
    }
    ({ ret, ctx } = prep.retCache.get(key));
  }
  const { scorer, proto } = armSelection(ctx.evidence, ctx.candidates, prep.kase.patterns, statements, { ...a, hadEdge: prep.baseOffered.some((c) => c.edge) }, opts(ctx));
  return { ret, ctx, scorer, six: proto.chosen, order: proto.order };
}

// Round 4 arms (run4.mjs): retrieval and Surprise options built from patterns.mjs's rules. Nothing changes
// when no rejection applies.
function armRun4(prep, statements, scenarioKey, a, index) {
  const supportsKey = a.supportsKey ?? "supports";
  const profile = rejectionProfile(prep.kase, prep.state, statements, { supportsKey, guard: a.reorder !== "unguarded" });
  let ret = prep.baseRet, ctx = prep.baseCtx;
  if (profile) {
    const key = `${a.id}|${supportsKey}|${scenarioKey}`;
    if (!prep.retCache.has(key)) {
      const swap = a.fetch === "swap";
      const r = retrieve(prep.state, index, {
        seed: prep.seed,
        mode: swap ? "swap" : "current",
        rejected: swap ? (a.conservative ? profile.conservativeDrop : rejectedFn(prep.kase, statements, supportsKey)) : null,
        avoid: swap && a.conservative ? profile.avoid : null,
        reorder: a.reorder ? profile.kind : null,
        discovery: a.discovery ? profile.discovery : null,
        bridge: a.bridge ? profile.bridge : null
      });
      prep.retCache.set(key, { ret: r, ctx: ctxFor(prep.raw, r.pool) });
    }
    ({ ret, ctx } = prep.retCache.get(key));
  }
  const { scorer, proto } = armSelection(ctx.evidence, ctx.candidates, prep.kase.patterns, statements, { ...a, hadEdge: prep.baseOffered.some((c) => c.edge) }, { ...opts(ctx), extraCut: a.labelCut && profile ? profile.kind : null });
  return { ret, ctx, scorer, six: proto.chosen, order: proto.order };
}

function evaluate(prep, scenario, a, index) {
  const { kase, baseCtx, baseOffered: base, baseRet } = prep;
  const run = armRun(prep, scenario.statements, scenario.id, a, index);
  const six = run.six;
  const records = baseCtx.evidence;
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  const partsMap = new Map();
  const parts = (c) => { if (!partsMap.has(c.id)) partsMap.set(c.id, scoreParts(c, records, { cache, rarity })); return partsMap.get(c.id); };
  const baseScore = productionScorer(records);
  const judge = correctedScorer(records, kase.patterns, scenario.statements, JUDGE);
  const t = targetsOf(kase, scenario.statements);
  const negTrue = t.neg.map(({ p, domains }) => ({ refs: new Set(p.trueSupports), domains }));
  const attrNeg = (c) => Math.max(0, ...negTrue.filter((n) => !n.domains || n.domains.includes(primaryDomain(c))).map((n) => attribution(parts(c), n.refs)));
  const attrOf = (c, list) => Math.max(0, ...list.map((refs) => attribution(parts(c), refs)));
  const sets = (list, key) => list.map((p) => new Set(p[key]));
  const related = (c) => attrOf(c, [...sets(t.all, "trueSupports"), ...sets(t.all, "supports")]);
  const wrongRefs = t.neg.filter(({ p }) => p.wrongSupports.length).map(({ p }) => new Set(p.wrongSupports));
  const endorsedRefs = sets(t.endorsed, "trueSupports");
  const meanScore = (list) => (list.length ? list.reduce((s, c) => s + baseScore(c), 0) / list.length : 0);
  const bar = 0.5 * meanScore(base.filter((c) => !c.edge));
  const relevant = (o) => attrNeg(o) < 0.5 && baseScore(o) >= bar;
  const baseIds = new Set(base.map((c) => c.id)), inSix = new Set(six.map((c) => c.id));
  const domains = (list) => new Set(list.map(primaryDomain));
  const maxMedium = (list) => Math.max(0, ...[...list.reduce((m, c) => m.set(primaryDomain(c), (m.get(primaryDomain(c)) ?? 0) + 1), new Map()).values()]);
  const edgeOf = (list) => list.find((c) => c.edge) ?? null;
  const scarcity = (cands, d) => {
    const alts = cands.filter((o) => !baseIds.has(o.id) && relevant(o));
    return !alts.length ? "pool" : !alts.some((o) => primaryDomain(o) === d) ? "media" : "replaceable";
  };
  const targets = base.filter((c) => attrNeg(c) >= 0.5).map((c) => {
    const d = primaryDomain(c);
    return {
      title: c.title, domain: d, attr: attrNeg(c),
      basePool: scarcity(baseCtx.candidates, d), armPool: scarcity(run.ctx.candidates, d),
      replaced: !inSix.has(c.id),
      sameMediumInSix: six.some((o) => o.id !== c.id && primaryDomain(o) === d && relevant(o))
    };
  });
  // Media where current retrieval offered a rejected title: does the six still offer a relevant title of
  // that medium that isn't from the rejection? ("Not this, but still books.")
  const rejectedMedia = [...new Set(targets.map((x) => x.domain))];
  const served = (list) => rejectedMedia.filter((d) => list.some((o) => primaryDomain(o) === d && relevant(o))).length;
  const removed = base.filter((c) => !inSix.has(c.id));
  const removedClass = (c) => {
    if (attrOf(c, endorsedRefs) >= 0.5) return "endorsed";
    const x = attrNeg(c);
    if (x >= 0.5) return "intended";
    if (x >= 0.2) return "partly";
    if (wrongRefs.length && attrOf(c, wrongRefs) >= 0.2) return "wrong support";
    return "unrelated";
  };
  const unrelatedBase = base.filter((c) => related(c) < 0.2);
  const wrongBase = wrongRefs.length ? base.filter((c) => attrOf(c, wrongRefs) >= 0.2 && attrNeg(c) < 0.2) : [];
  const endorsedBase = base.filter((c) => attrOf(c, endorsedRefs) >= 0.5 && attrOf(c, endorsedRefs) >= attrNeg(c));
  // Relative order of unrelated titles present in both full orders.
  const rb = new Map(prep.baseOrder.map((id, i) => [id, i])), ra = new Map(run.order.map((id, i) => [id, i]));
  const common = run.ctx.candidates.filter((c) => rb.has(c.id) && ra.has(c.id) && related(c) < 0.05).map((c) => c.id);
  let pairs = 0, concordant = 0;
  for (let i = 0; i < common.length; i += 1) for (let j = i + 1; j < common.length; j += 1) {
    pairs += 1;
    if (Math.sign(rb.get(common[i]) - rb.get(common[j])) === Math.sign(ra.get(common[i]) - ra.get(common[j]))) concordant += 1;
  }
  const edgeB = edgeOf(base), edgeA = edgeOf(six);
  const topSim = (c) => parts(c).positives[0]?.similarity ?? 0;
  // Round 4 diagnostics. "Rejected kind" by catalog labels (guarded, true supports): independent of the
  // stored supports, so a leak like Unfinished Tales under a fantasy rejection shows up.
  const judgeProfile = rejectionProfile(kase, prep.state, scenario.statements, { supportsKey: "trueSupports", guard: true });
  const kindOf = (c) => Boolean(judgeProfile?.kind(c));
  const rejectedIds = new Set(t.neg.map(({ p }) => p.id));
  const otherRefs = kase.patterns.filter((p) => !rejectedIds.has(p.id)).map((p) => new Set(p.trueSupports));
  const otherBase = base.filter((c) => attrOf(c, otherRefs) >= 0.5 && attrNeg(c) < 0.5);
  const records0 = new Map(records.map((r) => [r.itemId, r]));
  const validAnchor = (id) => { const r = records0.get(id); return r && otherRefs.some((refs) => refs.has(r.ref)); };
  const lostAnchors = baseRet.anchors.filter((id) => !run.ret.anchors.includes(id));
  let anchorsDifferWithTrueSupports = null;
  if (!a.oracle && run.ret !== baseRet) {
    const truth = armRun(prep, scenario.statements, scenario.id, { ...a, supportsKey: "trueSupports" }, index);
    anchorsDifferWithTrueSupports = truth.ret.anchors.join() !== run.ret.anchors.join() || truth.ret.pool.map((i) => i.id).join() !== run.ret.pool.map((i) => i.id).join();
  }
  const fromShelf = six.filter((c) => !c.relatedToId);
  const r4 = {
    kindBase: base.filter(kindOf).length, kindArm: six.filter(kindOf).length,
    otherBase: otherBase.length, otherKept: otherBase.filter((c) => inSix.has(c.id)).length,
    lostAnchors: lostAnchors.length, lostValidAnchors: lostAnchors.filter(validAnchor).length,
    anchorsDifferWithTrueSupports,
    discoveryInSix: fromShelf.length, discoveryRelevant: fromShelf.filter(relevant).length,
    edgeKindBase: edgeB ? kindOf(edgeB) : false, edgeKindArm: edgeA ? kindOf(edgeA) : false,
    shelfCalls: run.ret.shelfCalls ?? 0
  };
  return {
    r4,
    identical: sameSet(six, base) && run.ret.calls === baseRet.calls,
    sizeBase: base.length, sizeArm: six.length,
    negBase: targets.length, negArm: six.filter((c) => attrNeg(c) >= 0.5).length,
    targets, rejectedMedia: rejectedMedia.length, servedBase: served(base), servedArm: served(six),
    removedClasses: removed.map(removedClass),
    added: six.filter((c) => !baseIds.has(c.id)).length, addedRelevant: six.filter((c) => !baseIds.has(c.id) && relevant(c)).length,
    unrelatedBase: unrelatedBase.length, unrelatedKept: unrelatedBase.filter((c) => inSix.has(c.id)).length,
    wrongBase: wrongBase.length, wrongKept: wrongBase.filter((c) => inSix.has(c.id)).length,
    endorsedBase: endorsedBase.length, endorsedKept: endorsedBase.filter((c) => inSix.has(c.id)).length,
    domainsBase: domains(base).size, domainsArm: domains(six).size,
    lostMedium: [...domains(base)].some((d) => !domains(six).has(d)),
    concentratedBase: maxMedium(base) >= 3, concentratedArm: maxMedium(six) >= 3,
    creatorDupesArm: six.length - new Set(six.map((c) => c.by ?? c.id)).size,
    pairs, concordant,
    scoreBase: meanScore(base), scoreArm: meanScore(six),
    judgeBase: base.reduce((s, c) => s + judge(c), 0), judgeArm: six.reduce((s, c) => s + judge(c), 0),
    edgeBase: Boolean(edgeB), edgeArm: Boolean(edgeA),
    edgeNegBase: edgeB ? attrNeg(edgeB) >= 0.5 : false, edgeNegArm: edgeA ? attrNeg(edgeA) >= 0.5 : false,
    edgePartBase: edgeB ? attrNeg(edgeB) >= 0.2 : false, edgePartArm: edgeA ? attrNeg(edgeA) >= 0.2 : false,
    edgeSimBase: edgeB ? topSim(edgeB) : null, edgeSimArm: edgeA ? topSim(edgeA) : null,
    edgeFromLiked: edgeA ? Boolean(run.ctx.evidence.find((r) => r.itemId === edgeA.relatedToId && r.kind === "experienced-positive")) : null,
    callsBase: baseRet.calls, callsArm: run.ret.calls, wavesBase: baseRet.waves, wavesArm: run.ret.waves,
    baseSix: base.map((c) => `${c.title}${c.edge ? " [Surprise]" : ""}`), armSix: six.map((c) => `${c.title}${c.edge ? " [Surprise]" : ""} (${Math.round(attrNeg(c) * 100)}%)`)
  };
}

// Held-out Loved item unrelated to the correction: taken out of the profile, can retrieval and selection
// find it again? (Round 0, rejection scenarios of round 1's classes.)
async function heldOut(kase, scenario, a, index, cache) {
  const t = targetsOf(kase, scenario.statements);
  const touched = new Set(t.all.flatMap((p) => [...p.supports, ...p.trueSupports]));
  const records0 = evidenceRecords(hydrateState(JSON.parse(JSON.stringify(serializeAiState(kase.state(0))))));
  const picks = records0.filter((r) => r.class === "experienced" && r.weight >= 2 && !touched.has(r.ref)).slice(0, 3);
  let hitsBase = 0, hitsArm = 0;
  for (const r of picks) {
    const key = `${kase.id}|${r.itemId}`;
    if (!cache.has(key)) {
      const state = kase.state(0);
      delete state.feedbackByRecommendation[r.itemId];
      state.selectedFavorites.delete(r.itemId);
      state.libraryFavorites.delete(r.itemId);
      delete state.customItems[r.itemId];
      const raw = JSON.parse(JSON.stringify(serializeAiState(state)));
      const seed = seedFor(kase.id, 0);
      const baseRet = retrieve(state, index, { seed });
      const baseCtx = ctxFor(raw, baseRet.pool);
      const baseOffered = offeredCandidates(baseCtx);
      cache.set(key, { kase, state, raw, seed, baseRet, baseCtx, baseOffered, retCache: new Map(), hit: baseOffered.some((c) => c.id === r.itemId) });
    }
    const p = cache.get(key);
    const run = armRun(p, scenario.statements, scenario.id, a, index);
    hitsBase += p.hit ? 1 : 0;
    hitsArm += run.six.some((c) => c.id === r.itemId) ? 1 : 0;
  }
  return { n: picks.length, hitsBase, hitsArm };
}

function reversible(prep, a, index) {
  const p = prep.kase.patterns[0];
  const state = { modelHypotheses: prep.kase.patterns.map((x) => ({ id: x.id, title: x.label, claim: x.label })), patternStatements: [], hypothesisHistory: [] };
  setStatement(state, p.id, "says", "not-me");
  const set = state.patternStatements.length === 1;
  setStatement(state, p.id, "says", "not-me");
  const run = armRun(prep, state.patternStatements, "cleared", a, index);
  return set && state.patternStatements.length === 0 && sameSet(run.six, prep.baseOffered) && run.ret.calls === prep.baseRet.calls;
}

const sum = (list, key) => list.reduce((s, m) => s + (typeof key === "function" ? key(m) : m[key]), 0);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const tally = (list) => list.reduce((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});

function summarize(a, agg, ho, rev, fallbackOk) {
  const all = Object.values(agg).flat();
  const neutral = [...(agg.none ?? []), ...(agg.ambiguous ?? [])];
  const notMe = agg["not-me"] ?? [];
  const excluded = agg.excluded ?? [];
  const rejecting = Object.entries(agg).filter(([cls]) => REJECTING.has(cls)).flatMap(([, list]) => list);
  const wrong = agg["wrong-support"] ?? [];
  const withEdge = rejecting.filter((m) => m.edgeBase);
  const targets = notMe.flatMap((m) => m.targets);
  const mean = (list) => (list.length ? Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 1000) / 1000 : null);
  const n = {
    evaluations: all.length, rejecting: rejecting.length,
    neutralMismatches: neutral.filter((m) => !m.identical).length,
    sizeMismatches: all.filter((m) => m.sizeArm !== m.sizeBase).length,
    // chooseCandidates drops the Surprise slot without a replacement when it is the same franchise as a pick.
    shortBase: all.filter((m) => m.sizeBase < 6).length, shortArm: all.filter((m) => m.sizeArm < 6).length,
    smaller: all.filter((m) => m.sizeArm < m.sizeBase).length, larger: all.filter((m) => m.sizeArm > m.sizeBase).length,
    notMeBase: sum(notMe, "negBase"), notMeArm: sum(notMe, "negArm"),
    excludedBase: sum(excluded, "negBase"), excludedArm: sum(excluded, "negArm"),
    supplyBase: tally(targets.map((x) => x.basePool)), supplyArm: tally(targets.map((x) => x.armPool)),
    replaceableInArmPool: targets.filter((x) => x.armPool === "replaceable").length,
    replacedOfReplaceable: targets.filter((x) => x.armPool === "replaceable" && x.replaced).length,
    replaced: targets.filter((x) => x.replaced).length,
    replacedSameMedium: targets.filter((x) => x.replaced && x.sameMediumInSix).length,
    rejectedMedia: sum(notMe, "rejectedMedia"), servedBase: sum(notMe, "servedBase"), servedArm: sum(notMe, "servedArm"),
    removed: tally(rejecting.flatMap((m) => m.removedClasses)),
    added: sum(rejecting, "added"), addedRelevant: sum(rejecting, "addedRelevant"),
    unrelatedBase: sum(rejecting, "unrelatedBase"), unrelatedKept: sum(rejecting, "unrelatedKept"),
    wrongBase: sum(wrong, "wrongBase"), wrongKept: sum(wrong, "wrongKept"),
    endorsedBase: sum(rejecting, "endorsedBase"), endorsedKept: sum(rejecting, "endorsedKept"),
    heldOutN: ho.n, heldOutBase: pct(ho.hitsBase, ho.n), heldOutArm: pct(ho.hitsArm, ho.n),
    diversityViolations: all.filter((m) => m.domainsArm < m.domainsBase - 1).length,
    lostMedium: rejecting.filter((m) => m.lostMedium).length,
    concentratedBase: pct(rejecting.filter((m) => m.concentratedBase).length, rejecting.length),
    concentratedArm: pct(rejecting.filter((m) => m.concentratedArm).length, rejecting.length),
    creatorDupes: sum(rejecting, "creatorDupesArm"),
    concordance: pct(sum(rejecting, "concordant"), sum(rejecting, "pairs")),
    scoreDrop: sum(notMe, "scoreBase") ? Math.round((1 - sum(notMe, "scoreArm") / sum(notMe, "scoreBase")) * 1000) / 10 : 0,
    judgeGain: sum(rejecting, "judgeBase") ? Math.round((sum(rejecting, "judgeArm") / sum(rejecting, "judgeBase") - 1) * 1000) / 10 : 0,
    edgeBase: pct(sum(rejecting, (m) => (m.edgeBase ? 1 : 0)), rejecting.length), edgeArm: pct(sum(rejecting, (m) => (m.edgeArm ? 1 : 0)), rejecting.length),
    edgeNegBase: sum(withEdge, (m) => (m.edgeNegBase ? 1 : 0)), edgeNegArm: sum(rejecting, (m) => (m.edgeNegArm ? 1 : 0)),
    edgePartBase: sum(withEdge, (m) => (m.edgePartBase ? 1 : 0)), edgePartArm: sum(rejecting, (m) => (m.edgePartArm ? 1 : 0)),
    edgeLost: withEdge.filter((m) => !m.edgeArm).length, edgeEvaluations: withEdge.length,
    edgeNotLiked: rejecting.filter((m) => m.edgeArm && m.edgeFromLiked === false).length,
    edgeSimBase: mean(withEdge.map((m) => m.edgeSimBase)), edgeSimArm: mean(rejecting.filter((m) => m.edgeArm).map((m) => m.edgeSimArm)),
    callsBase: Math.round((sum(rejecting, "callsBase") / rejecting.length) * 100) / 100, callsArm: Math.round((sum(rejecting, "callsArm") / rejecting.length) * 100) / 100,
    moreCalls: pct(rejecting.filter((m) => m.callsArm > m.callsBase).length, rejecting.length),
    extraWave: pct(rejecting.filter((m) => m.wavesArm > m.wavesBase).length, rejecting.length)
  };
  const r4 = rejecting.map((m) => m.r4);
  const notMe4 = notMe.map((m) => m.r4);
  const stab = r4.filter((x) => x.anchorsDifferWithTrueSupports !== null);
  n.r4 = {
    kindBase: sum(notMe4, "kindBase"), kindArm: sum(notMe4, "kindArm"),
    kindBaseAll: sum(r4, "kindBase"), kindArmAll: sum(r4, "kindArm"),
    otherBase: sum(r4, "otherBase"), otherKept: sum(r4, "otherKept"),
    lostAnchors: sum(r4, "lostAnchors"), lostValidAnchors: sum(r4, "lostValidAnchors"),
    supportSensitive: stab.length ? pct(stab.filter((x) => x.anchorsDifferWithTrueSupports).length, stab.length) : null, supportChecked: stab.length,
    discoveryInSix: sum(r4, "discoveryInSix"), discoveryRelevant: sum(r4, "discoveryRelevant"),
    edgeKindBase: r4.filter((x) => x.edgeKindBase).length, edgeKindArm: r4.filter((x) => x.edgeKindArm).length,
    shelfCalls: Math.round((sum(r4, "shelfCalls") / Math.max(1, r4.length)) * 100) / 100
  };
  const gates = {
    neutrality: n.neutralMismatches === 0,
    setSize: n.sizeMismatches === 0,
    reversibility: rev,
    fallbackParity: fallbackOk,
    compliance: n.notMeBase ? n.notMeArm <= 0.5 * n.notMeBase : null,
    excludedArea: n.excludedBase ? n.excludedArm <= 0.5 * n.excludedBase : null,
    unrelated: n.unrelatedBase ? n.unrelatedKept / n.unrelatedBase >= 0.9 : null,
    wrongSupport: n.wrongBase ? n.wrongKept / n.wrongBase >= 0.9 : null,
    // n/a when current retrieval never finds a held-out favorite again: then the stand-in can't measure it.
    heldOut: n.heldOutN && n.heldOutBase > 0 ? n.heldOutArm >= n.heldOutBase - 5 : null,
    diversity: n.diversityViolations === 0,
    surprisePresent: n.edgeArm >= n.edgeBase - 5,
    surpriseCompliance: n.edgeNegBase ? n.edgeNegArm <= 0.5 * n.edgeNegBase : null,
    relevanceProxy: n.scoreDrop <= 10,
    complianceReplaceable: n.replaceableInArmPool ? n.replacedOfReplaceable >= 0.5 * n.replaceableInArmPool : null,
    mediaLoss: n.lostMedium <= 0.05 * n.rejecting,
    concentration: n.concentratedArm <= n.concentratedBase + 5,
    order: n.concordance == null ? null : n.concordance >= 90,
    endorsedKept: n.endorsedBase ? n.endorsedKept / n.endorsedBase >= 0.9 : null
  };
  return { arm: a.id, oracle: Boolean(a.oracle), numbers: n, gates };
}

export { sum as sumOf, pct as pctOf, mark as markOf };
export async function runEval3({ cases = loadCases(), arms = ROUND3_ARMS, exampleArms = EXAMPLE_ARMS, examples: wantedExamples = EXAMPLES } = {}) {
  const snapshot = loadSnapshot();
  const index = catalogIndex(snapshot.items);
  const preps = [];
  for (const kase of cases) preps.push(...await prepareCase(kase, index));
  // Production's full order for the baseline (for the relative-order gate).
  for (const prep of preps) prep.baseOrder = armRun(prep, [], "none", arms[0], index).order;
  const fallbackMismatches = preps.filter((p) => p.fallbackIds.join("|") !== p.baseOffered.map((c) => c.id).join("|")).length;
  const parity = preps.every((p) => sameSet(armRun(p, [], "none", arms[0], index).six, p.baseOffered));
  const results = [];
  const hoCache = new Map();
  for (const a of arms) {
    const agg = {};
    for (const prep of preps) for (const scenario of scenariosFor(prep.kase)) {
      const m = evaluate(prep, scenario, a, index);
      (agg[scenario.cls] ??= []).push(m);
      if (scenario.wrongSupport) (agg["wrong-support"] ??= []).push(m);
    }
    const ho = { n: 0, hitsBase: 0, hitsArm: 0 };
    for (const kase of cases) for (const scenario of scenariosFor(kase).filter((s) => ["not-me", "excluded", "conflict"].includes(s.cls))) {
      const r = await heldOut(kase, scenario, a, index, hoCache);
      ho.n += r.n; ho.hitsBase += r.hitsBase; ho.hitsArm += r.hitsArm;
    }
    const rev = cases.every((kase) => reversible(preps.find((p) => p.kase === kase && p.round === 0), a, index));
    results.push(summarize(a, agg, ho, rev, fallbackMismatches === 0));
  }
  const examples = exampleLines(preps, arms, index, exampleArms, wantedExamples);
  const pools = cases.map((kase) => {
    const p = preps.find((x) => x.kase === kase && x.round === 0);
    return { id: kase.id, pool: p.baseRet.pool.length, calls: p.baseRet.calls, waves: p.baseRet.waves, media: [...new Set(p.baseRet.pool.map(primaryDomain))].join("/") };
  });
  return { parity, fallbackMismatches, pools, results, examples };
}

const EXAMPLE_ARMS = ["current retrieval / production selection", "current retrieval / A", "swap / A", "add / A", "add / A / Surprise alternatives"];
const EXAMPLES = [
  ["example-paige", "not me: ai-genre-fantasy-mythic-worlds"],
  ["example-paige", "not me: every pattern behind the Surprise anchor (ai-uncanny-mystery-tv)"],
  ["dislikes-50", "not me: horror-anywhere"],
  ["split-50", "not me: fantasy-books"],
  ["narrow-100", "not me: sci-fi-films"],
  ["broad-50", "not in movies: thrillers"]
];
function exampleLines(preps, arms, index, exampleArms, wanted) {
  const EXAMPLE_ARMS = exampleArms;
  const out = [];
  for (const [caseId, scenarioId] of wanted) {
    const prep = preps.find((p) => p.kase.id === caseId && p.round === 0);
    const scenario = prep && scenariosFor(prep.kase).find((s) => s.id === scenarioId);
    if (!scenario) continue;
    const rows = EXAMPLE_ARMS.filter((id) => arms.some((x) => x.id === id)).map((id) => {
      const a = arms.find((x) => x.id === id);
      const m = evaluate(prep, scenario, a, index);
      return { arm: id, six: m.armSix, calls: m.callsArm, anchors: armRun(prep, scenario.statements, scenario.id, a, index).ret.anchors.map((id) => evidenceItems(prep.state).find((i) => i.id === id)?.title ?? id), targets: m.targets.map((x) => `${x.title}: ${x.replaced ? "replaced" : "kept"} (current pool: ${x.basePool}; this pool: ${x.armPool})`) };
    });
    out.push({ case: caseId, scenario: scenarioId, production: prep.baseOffered.map((c) => `${c.title}${c.edge ? " [Surprise]" : ""}`), rows });
  }
  return out;
}

const mark = (v) => (v === null ? "n/a" : v ? "pass" : "FAIL");
export function reportMarkdown3(run) {
  const L = [];
  L.push("# Correction eval, round 3: replacement retrieval", "");
  L.push("Generated by `node scripts/evals/corrections/run3.mjs`. No network, no model calls, no production change. Deterministic. Pools come from the retrieval stand-in (retrieval.mjs) over the 1,134-title catalog snapshot, so these numbers compare arms with current retrieval on the same stand-in, not with rounds 1-2's fixed pools.", "");
  L.push(`- Stand-in selection matches production's on every case and round (no statements): **${run.parity ? "yes" : "NO"}**`);
  L.push(`- Production fallback shows the stand-in pool's shortlist: **${run.fallbackMismatches ? `NO (${run.fallbackMismatches})` : "yes"}**`, "");
  L.push("## Stand-in pools (round 1 of each case)", "", "| Case | Pool | Provider calls | Waves | Media |", "|---|---|---|---|---|");
  for (const p of run.pools) L.push(`| ${p.id} | ${p.pool} | ${p.calls} | ${p.waves} | ${p.media} |`);
  L.push("", "## Gates", "");
  const ids = Object.keys(GATES3);
  L.push(`| Arm | ${ids.join(" | ")} |`, `|---|${ids.map(() => "---").join("|")}|`);
  for (const r of run.results) L.push(`| ${r.arm} | ${ids.map((g) => mark(r.gates[g])).join(" | ")} |`);
  L.push("", "Sets under six titles (production drops a Surprise that is the same franchise as a pick, without a replacement): " + run.results.map((r) => `${r.arm}: ${r.numbers.shortBase} → ${r.numbers.shortArm} (smaller than current ${r.numbers.smaller}, larger ${r.numbers.larger})`).join("; ") + ".");
  L.push("", "## Correction and supply (\"not me\" evaluations)", "");
  L.push("Supply: for each title current retrieval offers that is mostly from the rejected pattern, is there a relevant replacement (under 50% from the rejection, at least half as good a fit as current retrieval's average main pick) in the pool: none at all (pool), only in other media (media), or in the same medium (replaceable).", "");
  L.push("| Arm | \"Not me\" titles (current → arm) | Supply in current pool: pool / media / replaceable | Supply in arm's pool | Replaced (of replaceable in arm's pool) | Rejected media still served with a relevant title (current → arm) | Excluded-area titles |", "|---|---|---|---|---|---|---|");
  const s = (o) => `${o.pool ?? 0} / ${o.media ?? 0} / ${o.replaceable ?? 0}`;
  for (const r of run.results) {
    const n = r.numbers;
    L.push(`| ${r.arm} | ${n.notMeBase} → ${n.notMeArm} | ${s(n.supplyBase)} | ${s(n.supplyArm)} | ${n.replacedOfReplaceable}/${n.replaceableInArmPool} | ${n.servedBase}/${n.rejectedMedia} → ${n.servedArm}/${n.rejectedMedia} | ${n.excludedBase} → ${n.excludedArm} |`);
  }
  L.push("", "## Quality, diversity and cost (every rejection evaluation)", "");
  L.push("| Arm | Removed: intended / partly / wrong support / endorsed / unrelated | Added relevant | Unrelated kept | Wrong-support kept | Endorsed kept | Held-out (current → arm) | Lost a medium | 3+ of one medium (current → arm) | Unrelated pairs in order | Score drop | Corrected fit | Provider calls (current → arm) | Sets with more calls | Sets with an extra wave |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of run.results) {
    const n = r.numbers, rm = n.removed;
    L.push(`| ${r.arm} | ${rm.intended ?? 0} / ${rm.partly ?? 0} / ${rm["wrong support"] ?? 0} / ${rm.endorsed ?? 0} / ${rm.unrelated ?? 0} | ${n.addedRelevant}/${n.added} | ${n.unrelatedKept}/${n.unrelatedBase} | ${n.wrongKept}/${n.wrongBase} | ${n.endorsedKept}/${n.endorsedBase} | ${n.heldOutBase}% → ${n.heldOutArm}% (n=${n.heldOutN}) | ${n.lostMedium}/${n.rejecting} | ${n.concentratedBase}% → ${n.concentratedArm}% | ${n.concordance}% | ${n.scoreDrop}% | ${n.judgeGain}% | ${n.callsBase} → ${n.callsArm} | ${n.moreCalls}% | ${n.extraWave}% |`);
  }
  L.push("", "## Surprise Me (rejection evaluations)", "");
  L.push("| Arm | Surprise offered (current → arm) | Mostly from a rejection (current → arm) | Partly (>=20%) | Lost (of evaluations with one) | Not from a Liked rating | Top similarity to a rating (lower = more novel) |", "|---|---|---|---|---|---|---|");
  for (const r of run.results) {
    const n = r.numbers;
    L.push(`| ${r.arm} | ${n.edgeBase}% → ${n.edgeArm}% | ${n.edgeNegBase} → ${n.edgeNegArm} | ${n.edgePartBase} → ${n.edgePartArm} | ${n.edgeLost}/${n.edgeEvaluations} | ${n.edgeNotLiked} | ${n.edgeSimBase} → ${n.edgeSimArm} |`);
  }
  L.push("", "## Worked examples (round 1)", "");
  for (const e of run.examples) {
    L.push(`### ${e.case}: ${e.scenario}`, "", `Current retrieval offers: ${e.production.join(" · ")}`, "");
    for (const r of e.rows) {
      L.push(`- **${r.arm}** (${r.calls} calls): ${r.six.join(" · ")}`);
      for (const x of r.targets) L.push(`  - ${x}`);
    }
    L.push("");
  }
  L.push("## Gate definitions", "");
  for (const [id, text] of Object.entries(GATES3)) L.push(`- **${id}**: ${text}`);
  L.push("", "## Limitations", "");
  for (const l of LIMITATIONS3) L.push(`- ${l}`);
  return L.join("\n") + "\n";
}

export const LIMITATIONS3 = [
  "Retrieval is a stand-in: \"related\" is feature similarity over a 1,134-title snapshot. Open Library subject search and IGDB genre overlap behave roughly like this; TMDb recommendations (film, TV) are behavioral and may return more, or less, same-medium variety. A live, free check of provider results is the next step before any build.",
  "Latency is counted as provider calls and waves, not milliseconds. Extra anchors here join the first wave (parallel), so they add calls but not a round trip; real provider timing varies (Open Library is the slowest).",
  "Rounds 2-3 of each case use current retrieval's earlier sets as history for every arm.",
  "Attribution, relevance and the corrected-fit judge are the harness's rules, not human judgment; the judge is close to A's own scorer.",
  "The novelty guard and series checks are not simulated.",
  "Held-out recall is not measurable here: under the stand-in a removed favorite sits 19th-110th in its related lists (12 are kept), so current retrieval never finds one again (gate n/a).",
  "The AI reorders sets and picks its own Surprise live; these numbers describe what is offered to it."
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--out");
  const dir = at > 0 ? process.argv[at + 1] : join(HERE, "reports");
  const run = await runEval3();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "round3.json"), JSON.stringify(run, null, 1) + "\n");
  writeFileSync(join(dir, "round3.md"), reportMarkdown3(run));
  console.log(`wrote ${join(dir, "round3.md")}`);
  console.log(`parity: ${run.parity ? "yes" : "NO"}; fallback mismatches: ${run.fallbackMismatches}`);
  for (const r of run.results) console.log(`${r.arm}: failed ${Object.entries(r.gates).filter(([, g]) => g === false).map(([k]) => k).join(", ") || "none"}`);
}
