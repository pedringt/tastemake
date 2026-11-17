#!/usr/bin/env node
// Correction eval, round 5 (Nov 17, #380 follow-up): correction-aware retrieval after #381. Since #381 the
// production shortlist (chooseCandidates via offeredCandidates) leaves out every title notMeConflict(state)
// flags, so a set can lose a medium or come up short when the pool's titles of that medium all conflict.
// Production retrieval never reads corrections, so its top-up logic can't see that. This round compares
// retrieval options on the stand-in (retrieval.mjs), every arm selected by PRODUCTION's own chooser
// (offeredCandidates from api/recommendations.mjs, post-#381, with the scenario's real correctionConflict).
// Free: no network, no model, no production change. Deterministic.
//
//   node scripts/evals/corrections/run5.mjs                 # writes reports/round5.md and round5.json
//   node scripts/evals/corrections/run5.mjs --out <dir>
//
// Arms (all with production selection):
//   R-current         the stand-in as today;
//   R-filter          titles the scenario's notMeConflict matcher flags are dropped from `eligible` before the
//                     pool-health checks, so the second wave / missing-medium fallback see the clean pool;
//   R-reorder         rated anchors the matcher flags go behind the unflagged ones (stable) before anchor
//                     selection; ratings stay evidence for scoring;
//   R-filter+reorder  both;
//   swap / add        round 3's support-based options (rejectedFn), re-run post-#381 for reference.
// Same cases, scenarios and rounds as round 3 (3 rounds; rounds 2-3 use the no-correction sets as history).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { offeredCandidates } from "../../../api/recommendations.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { notMeConflict, rejectsSomewhere } from "../../../src/ai/corrections.js";
import { featureRarity } from "../../../src/ai/taste-score.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { loadSnapshot } from "../stress/profiles.mjs";
import { loadCases } from "./fixtures.mjs";
import { attribution, primaryDomain, productionScorer, scoreParts } from "./rank.mjs";
import { catalogIndex, retrieve, seedFor } from "./retrieval.mjs";
import { ROUNDS3, rejectedFn } from "./run3.mjs";
import { scenariosFor, targetsOf } from "./run.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const NOT_ME = new Set(["not-me", "conflict", "double", "not-me+accurate", "surprise"]);
const PARTLY = new Set(["excluded"]);

// `opts(matcher, rejected)` -> retrieve() options, or null for "same as current retrieval".
export const ROUND5_ARMS = [
  { id: "R-current", opts: () => null },
  { id: "R-filter", opts: (m) => (m ? { conflictFilter: m } : null) },
  { id: "R-reorder", opts: (m) => (m ? { anchorReorder: m } : null) },
  { id: "R-filter+reorder", opts: (m) => (m ? { conflictFilter: m, anchorReorder: m } : null) },
  { id: "R-filter+waveOrder", opts: (m) => (m ? { conflictFilter: m, waveOrder: "first-then-later" } : null) },
  { id: "R-filter+reorder+waveOrder", opts: (m) => (m ? { conflictFilter: m, anchorReorder: m, waveOrder: "first-then-later" } : null) },
  { id: "swap (round 3)", opts: (m, rej) => (rej ? { mode: "swap", rejected: rej } : null) },
  { id: "add (round 3)", opts: (m, rej) => (rej ? { mode: "add", rejected: rej } : null) }
];

const rawOf = (state) => JSON.parse(JSON.stringify(serializeAiState(state)));
const ctxFor = (raw, pool) => buildContext(hydrateState(structuredClone(raw)), pool);
const poolKey = (pool) => pool.map((i) => `${i.id}${i.surpriseOnly ? "*" : ""}`).join("|");
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && Boolean(x.edge) === Boolean(b[i].edge));

// Production's six and its full order (from the eval-only trace; the six is the same with or without it).
function select(ctx) {
  const trace = {};
  const outcome = {};
  const six = offeredCandidates(ctx, 6, trace, outcome);
  const order = [...trace.candidates].sort((a, b) => a.order - b.order).map((c) => c.itemId);
  // A set one short with no Surprise while a Surprise was picked: chooseCandidates' existing rule (a Surprise
  // of the same franchise as a pick is dropped without a replacement), not a lack of offerable titles.
  const offerable = trace.candidates.filter((c) => c.outcome !== "not-me").length;
  const slotFranchise = six.length === 5 && Boolean(ctx.curveball) && !six.some((c) => c.edge) && !outcome.surpriseDropped
    && offerable > 6 && trace.candidates.some((c) => c.outcome === "same-franchise");
  return { six, order, surpriseDropped: Boolean(outcome.surpriseDropped), slotFranchise };
}

function prepareCase(kase, index) {
  const preps = [];
  const history = [];
  for (let round = 0; round < ROUNDS3; round += 1) {
    const state = kase.state(0);
    state.recommendationSets = history.map((ids) => [...ids]);
    const raw = rawOf(state);
    const seed = seedFor(kase.id, round);
    const baseRet = retrieve(state, index, { seed });
    const baseCtx = ctxFor(raw, baseRet.pool);
    const base = select(baseCtx);
    history.push(base.six.map((c) => c.id));
    preps.push({ kase, round, seed, history: history.slice(0, round), baseRet, baseCtx, base });
  }
  return preps;
}

// One scenario of one prep: the request state with the case's patterns stored and these answers given,
// the matcher production builds from it, and every arm's pool and six (pools shared between arms are
// selected once).
function runScenario(prep, scenario, index, arms) {
  const { kase } = prep;
  const state = kase.state(0);
  state.recommendationSets = prep.history.map((ids) => [...ids]);
  state.modelHypotheses = kase.patterns.map((p) => ({ id: p.id, title: p.label, domains: p.domains, supports: p.supports }));
  state.patternStatements = scenario.statements;
  const raw = rawOf(state);
  const matcher = notMeConflict(hydrateState(structuredClone(raw)));
  const rejected = rejectedFn(kase, scenario.statements);
  const bySelection = new Map();
  const out = {};
  for (const a of arms) {
    const o = a.opts(matcher, rejected);
    const ret = o ? retrieve(state, index, { seed: prep.seed, ...o }) : prep.baseRet;
    const key = poolKey(ret.pool);
    if (!bySelection.has(key)) {
      const ctx = ctxFor(raw, ret.pool);
      bySelection.set(key, { ctx, ...select(ctx) });
    }
    out[a.id] = { ret, acted: Boolean(o), ...bySelection.get(key) };
  }
  return { matcher, rejected, arms: out };
}

function measure(prep, scenario, run, armId) {
  const { kase, baseCtx, base, baseRet } = prep;
  const arm = run.arms[armId];
  const current = run.arms["R-current"];
  const six = arm.six;
  const records = baseCtx.evidence;
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  const partsMap = new Map();
  const parts = (c) => { if (!partsMap.has(c.id)) partsMap.set(c.id, scoreParts(c, records, { cache, rarity })); return partsMap.get(c.id); };
  const score = productionScorer(records);
  const t = targetsOf(kase, scenario.statements);
  const negTrue = t.neg.map(({ p, domains }) => ({ refs: new Set(p.trueSupports), domains }));
  const attrNeg = (c) => Math.max(0, ...negTrue.filter((n) => !n.domains || n.domains.includes(primaryDomain(c))).map((n) => attribution(parts(c), n.refs)));
  const attrOf = (c, list) => Math.max(0, ...list.map((refs) => attribution(parts(c), refs)));
  const sets = (list, key) => list.map((p) => new Set(p[key]));
  const related = (c) => attrOf(c, [...sets(t.all, "trueSupports"), ...sets(t.all, "supports")]);
  const wrongRefs = t.neg.filter(({ p }) => p.wrongSupports.length).map(({ p }) => new Set(p.wrongSupports));
  const endorsedRefs = sets(t.endorsed, "trueSupports");
  const rejectedIds = new Set(t.neg.map(({ p }) => p.id));
  const otherRefs = kase.patterns.filter((p) => !rejectedIds.has(p.id)).map((p) => new Set(p.trueSupports));
  const flagged = (c) => Boolean(run.matcher?.(c));

  // Round 3's definitions, against the no-correction set (`base`).
  const inSix = new Set(six.map((c) => c.id));
  const kept = (list) => list.filter((c) => inSix.has(c.id)).length;
  const unrelatedBase = base.six.filter((c) => related(c) < 0.2);
  const wrongBase = wrongRefs.length ? base.six.filter((c) => attrOf(c, wrongRefs) >= 0.2 && attrNeg(c) < 0.2) : [];
  const endorsedBase = base.six.filter((c) => attrOf(c, endorsedRefs) >= 0.5 && attrOf(c, endorsedRefs) >= attrNeg(c));
  const otherBase = base.six.filter((c) => attrOf(c, otherRefs) >= 0.5 && attrNeg(c) < 0.5);

  const media = (list) => new Set(list.map(primaryDomain));
  const lostOf = (ref) => [...media(ref)].filter((d) => !media(six).has(d));
  const lost = lostOf(base.six);
  const cleanIn = (pool, d) => pool.some((i) => primaryDomain(i) === d && !flagged(i));

  // Relative order of unrelated, unflagged titles present in both full orders (flagged titles are never
  // offered since #381, so their place is moot).
  const rb = new Map(base.order.map((id, i) => [id, i])), ra = new Map(arm.order.map((id, i) => [id, i]));
  const common = arm.ctx.candidates.filter((c) => rb.has(c.id) && ra.has(c.id) && related(c) < 0.05 && !flagged(c)).map((c) => c.id);
  let pairs = 0, concordant = 0;
  for (let i = 0; i < common.length; i += 1) for (let j = i + 1; j < common.length; j += 1) {
    pairs += 1;
    if (Math.sign(rb.get(common[i]) - rb.get(common[j])) === Math.sign(ra.get(common[i]) - ra.get(common[j]))) concordant += 1;
  }
  const mean = (list) => (list.length ? list.reduce((s, c) => s + score(c), 0) / list.length : 0);
  return {
    active: Boolean(run.matcher), acted: arm.acted,
    identicalToCurrent: sameSet(six, current.six) && arm.ret.calls === current.ret.calls,
    size: six.length, short: six.length < 6, empty: six.length === 0, shortBase: base.six.length < 6,
    shortFranchise: six.length < 6 && arm.slotFranchise, surpriseDropped: arm.surpriseDropped,
    lostMedium: lost.length > 0,
    lostNoCleanSupply: lost.filter((d) => !cleanIn(arm.ret.pool, d)).length,
    lostVsCurrent: lostOf(current.six).length > 0,
    conflictsOffered: six.filter(flagged).length,
    surpriseBase: base.six.some((c) => c.edge), surpriseArm: six.some((c) => c.edge),
    unrelatedBase: unrelatedBase.length, unrelatedKept: kept(unrelatedBase),
    wrongBase: wrongBase.length, wrongKept: kept(wrongBase),
    endorsedBase: endorsedBase.length, endorsedKept: kept(endorsedBase),
    otherBase: otherBase.length, otherKept: kept(otherBase),
    scoreBase: mean(base.six), scoreCurrent: mean(current.six), scoreArm: mean(six),
    totalBase: base.six.reduce((s, c) => s + score(c), 0), totalArm: six.reduce((s, c) => s + score(c), 0),
    pairs, concordant,
    callsBase: baseRet.calls, callsArm: arm.ret.calls, wavesBase: baseRet.waves, wavesArm: arm.ret.waves,
    poolArm: arm.ret.pool.length, cleanPool: arm.ret.pool.filter((i) => !flagged(i)).length
  };
}

const sum = (list, key) => list.reduce((s, m) => s + (typeof key === "function" ? key(m) : m[key]), 0);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const r2 = (x) => Math.round(x * 100) / 100;
const count = (list, key) => list.filter((m) => m[key]).length;

function summarize(list) {
  const drop = (num, den) => (den ? Math.round((1 - num / den) * 1000) / 10 : 0);
  return {
    sets: list.length, active: count(list, "active"),
    lostMedium: count(list, "lostMedium"),
    lostNoCleanSupply: list.filter((m) => m.lostNoCleanSupply > 0).length,
    lostVsCurrent: count(list, "lostVsCurrent"),
    short: count(list, "short"), empty: count(list, "empty"), shortBase: count(list, "shortBase"),
    shortFranchise: count(list, "shortFranchise"), surpriseDropped: count(list, "surpriseDropped"), meanSize: r2(sum(list, "size") / Math.max(1, list.length)),
    conflictsOffered: sum(list, "conflictsOffered"),
    surpriseBase: count(list, "surpriseBase"), surpriseArm: count(list, "surpriseArm"),
    unrelatedKept: sum(list, "unrelatedKept"), unrelatedBase: sum(list, "unrelatedBase"),
    wrongKept: sum(list, "wrongKept"), wrongBase: sum(list, "wrongBase"),
    endorsedKept: sum(list, "endorsedKept"), endorsedBase: sum(list, "endorsedBase"),
    otherKept: sum(list, "otherKept"), otherBase: sum(list, "otherBase"),
    // Mean score of the offered titles (round 3's relevance proxy), and the total over the set (which also
    // counts titles missing from a short set).
    scoreDropVsBase: drop(sum(list, "scoreArm"), sum(list, "scoreBase")),
    scoreDropVsCurrent: drop(sum(list, "scoreArm"), sum(list, "scoreCurrent")),
    totalDropVsBase: drop(sum(list, "totalArm"), sum(list, "totalBase")),
    concordance: pct(sum(list, "concordant"), sum(list, "pairs")), pairs: sum(list, "pairs"),
    callsBase: r2(sum(list, "callsBase") / Math.max(1, list.length)), callsArm: r2(sum(list, "callsArm") / Math.max(1, list.length)),
    moreCalls: pct(list.filter((m) => m.callsArm > m.callsBase).length, list.length),
    extraWave: pct(list.filter((m) => m.wavesArm > m.wavesBase).length, list.length),
    cleanPool: r2(sum(list, "cleanPool") / Math.max(1, list.length))
  };
}

export function runEval5({ cases = loadCases(), arms = ROUND5_ARMS } = {}) {
  const index = catalogIndex(loadSnapshot().items);
  const preps = cases.flatMap((kase) => prepareCase(kase, index));
  const agg = Object.fromEntries(arms.map((a) => [a.id, { notMe: [], partly: [], neutral: [], inactiveRejection: [] }]));
  for (const prep of preps) for (const scenario of scenariosFor(prep.kase)) {
    const run = runScenario(prep, scenario, index, arms);
    const rejecting = scenario.statements.some(rejectsSomewhere);
    for (const a of arms) {
      const m = measure(prep, scenario, run, a.id);
      const bucket = agg[a.id];
      if (!rejecting) bucket.neutral.push(m);
      else if (!run.matcher) bucket.inactiveRejection.push(m);
      if (NOT_ME.has(scenario.cls)) bucket.notMe.push(m);
      else if (PARTLY.has(scenario.cls)) bucket.partly.push(m);
    }
  }
  const results = arms.map((a) => {
    const b = agg[a.id];
    return {
      arm: a.id,
      notMe: summarize(b.notMe),
      partly: summarize(b.partly),
      neutrality: { evaluations: b.neutral.length, mismatches: b.neutral.filter((m) => !m.identicalToCurrent).length },
      inactiveRejection: { evaluations: b.inactiveRejection.length, differ: b.inactiveRejection.filter((m) => !m.identicalToCurrent).length }
    };
  });
  const pools = preps.filter((p) => p.round === 0).map((p) => ({ id: p.kase.id, pool: p.baseRet.pool.length, calls: p.baseRet.calls, waves: p.baseRet.waves }));
  return { cases: cases.length, rounds: ROUNDS3, pools, results };
}

const COLUMNS = [
  ["Sets (matcher reaches)", (n) => `${n.sets} (${n.active})`],
  ["Lost a medium vs no-correction set", (n) => `${n.lostMedium}`],
  ["…with no clean title of it in the pool", (n) => `${n.lostNoCleanSupply}`],
  ["Lost a medium R-current offered", (n) => `${n.lostVsCurrent}`],
  ["Short (<6) / empty", (n) => `${n.short} / ${n.empty}`],
  ["…short because the Surprise was the same franchise as a pick", (n) => `${n.shortFranchise}`],
  ["Short in the no-correction set", (n) => `${n.shortBase}`],
  ["Surprise dropped (every Surprise candidate conflicts)", (n) => `${n.surpriseDropped}`],
  ["Mean set size", (n) => `${n.meanSize}`],
  ["Recognized-conflict titles offered", (n) => `${n.conflictsOffered}`],
  ["Surprise (no-correction → arm)", (n) => `${n.surpriseBase} → ${n.surpriseArm}`],
  ["Endorsed kept", (n) => `${n.endorsedKept}/${n.endorsedBase}`],
  ["Wrong-support kept", (n) => `${n.wrongKept}/${n.wrongBase}`],
  ["Other-pattern kept", (n) => `${n.otherKept}/${n.otherBase}`],
  ["Unrelated kept", (n) => `${n.unrelatedKept}/${n.unrelatedBase}`],
  ["Mean-score drop vs no-correction / vs R-current", (n) => `${n.scoreDropVsBase}% / ${n.scoreDropVsCurrent}%`],
  ["Total-score drop vs no-correction", (n) => `${n.totalDropVsBase}%`],
  ["Unrelated pairs in order", (n) => `${n.concordance}% (${n.pairs})`],
  ["Provider calls per set (current → arm)", (n) => `${n.callsBase} → ${n.callsArm}`],
  ["Sets with more calls / an extra wave", (n) => `${n.moreCalls}% / ${n.extraWave}%`],
  ["Unflagged titles in pool (mean)", (n) => `${n.cleanPool}`]
];

function table(L, results, key) {
  L.push(`| Measure | ${results.map((r) => r.arm).join(" | ")} |`, `|---|${results.map(() => "---").join("|")}|`);
  for (const [label, fn] of COLUMNS) L.push(`| ${label} | ${results.map((r) => fn(r[key])).join(" | ")} |`);
}

export function reportMarkdown5(run) {
  const L = [];
  L.push("# Correction eval, round 5: correction-aware retrieval after #381", "");
  L.push("Generated by `node scripts/evals/corrections/run5.mjs`. No network, no model calls, no production change. Deterministic. Pools come from the retrieval stand-in (retrieval.mjs) over the 1,134-title catalog snapshot; every arm is selected by production's own `offeredCandidates` (post-#381: titles `notMeConflict` flags are never offered). " +
    `${run.cases} cases × ${run.rounds} rounds × every round-3 scenario.`, "");
  L.push("Unlike rounds 3-4, whose \"production selection\" is rank.mjs's copy of chooseCandidates without the #334/#381 conflict rule, round 5 calls production's offeredCandidates directly with the scenario's real `correctionConflict` (the same request path shortlist-334.mjs uses).", "");
  L.push("Baseline (\"no-correction set\"): R-current's pool with no answers given, selected by production. \"Not me\" = scenarios with at least one Not me (single, conflict, double, Not me + Yes, Surprise); \"Partly\" = a Partly answer with one unticked area. Endorsed / wrong-support / unrelated kept follow round 3 (true supports, against the no-correction set); other-pattern kept = no-correction titles mostly (>=50%) from a pattern the scenario did not reject.", "");
  L.push("## No-op neutrality", "", "| Arm | Scenarios with no rejection: differ from R-current | Rejections the matcher can't read (no distinctive labels): differ from R-current |", "|---|---|---|");
  for (const r of run.results) L.push(`| ${r.arm} | ${r.neutrality.mismatches}/${r.neutrality.evaluations} | ${r.inactiveRejection.differ}/${r.inactiveRejection.evaluations} |`);
  L.push("", "## \"Not me\" scenarios", "");
  table(L, run.results, "notMe");
  L.push("", "## Partly with an unticked area", "");
  table(L, run.results, "partly");
  L.push("", "## Round 5b: pre-registered bar (qualifies over R-reorder)", "");
  L.push(`| Arm | ${BAR5B.map(([l]) => l).join(" | ")} | Qualifies |`, `|---|${BAR5B.map(() => "---").join("|")}|---|`);
  for (const r of run.results) {
    const checks = qualifies5b(r);
    L.push(`| ${r.arm} | ${checks.map(([, ok]) => (ok ? "yes" : "**no**")).join(" | ")} | ${checks.every(([, ok]) => ok) ? "**yes**" : "no"} |`);
  }
  L.push("", "## Verdict", "");
  for (const v of VERDICT) L.push(`- ${v}`);
  L.push("", "## Limitations", "");
  for (const l of LIMITATIONS5) L.push(`- ${l}`);
  return L.join("\n") + "\n";
}

// Round 5b bar, pre-registered by the coordinator (Nov 17) before the waveOrder arms were run: an arm qualifies
// over R-reorder only if every check holds (Not me sets unless noted).
export const BAR5B = [
  ["wrong-support kept >= 24/26", (r) => r.notMe.wrongKept >= 24],
  ["endorsed kept >= 274/282", (r) => r.notMe.endorsedKept >= 274],
  ["lost a medium < 52", (r) => r.notMe.lostMedium < 52],
  ["Partly lost a medium <= 6", (r) => r.partly.lostMedium <= 6],
  ["conflicts offered 0", (r) => r.notMe.conflictsOffered === 0 && r.partly.conflictsOffered === 0],
  ["empty sets 0", (r) => r.notMe.empty === 0 && r.partly.empty === 0],
  ["neutrality 0 mismatches", (r) => r.neutrality.mismatches === 0],
  ["calls per set <= 5.5", (r) => r.notMe.callsArm <= 5.5]
];
export const qualifies5b = (r) => BAR5B.map(([label, ok]) => [label, ok(r)]);

// Written after reading the numbers (Nov 17); re-check if the numbers change.
export const VERDICT = [
  "**No arm offers a recognized-conflict title** (0 everywhere: production's #381 exclusion holds whatever the pool). **Short sets are not a retrieval problem on the stand-in**: every short set in every arm is the existing rule that drops a Surprise of the same franchise as a pick (38 Not me / 18 Partly short sets already in the no-correction set); none is short for lack of offerable titles, and none is empty. The fixed-pool shortfalls #381 measured come from 36-title fixed pools, which retrieval would refill.",
  "**R-current**: 75/303 Not me and 12/90 Partly sets lose a medium of the no-correction set; in every one the pool has no unflagged title of that medium. Retrieval's top-up never fires (0 extra waves) because the pool looks healthy before the shortlist filters it.",
  "**R-filter**: the largest cut in lost media (75 → 28 Not me, 12 → 4 Partly) and it drops the 8 Not me sets where every Surprise candidate conflicted to 0. Cost: a sequential second wave in 23% of Not me sets (12% Partly), 4.91 → 5.99 calls. The second wave's rows interleave ahead of first-wave titles, so it also displaces kept titles: wrong-support kept 26 → 20 of 26 (77%, below round 3's 90% bar), other-pattern kept 98% → 91%, unrelated kept 99% → 92%, endorsed 98% → 93%. Score rises ~2%.",
  "**R-reorder**: a smaller cut (75 → 52 Not me, 12 → 6 Partly) at almost no cost: 1-2% of sets gain one call, endorsed/wrong-support/other/unrelated kept stay within 0-1 titles of R-current (26/26 wrong-support kept), 99.6% of unrelated pairs keep their order. Five more sets are short than R-current (38, the same as the no-correction set), all from the Surprise-franchise rule: with clean anchors first, a Surprise is found more often (no set loses it to conflicts) and is sometimes then dropped as the same franchise as a pick.",
  "**R-filter+reorder**: the same lost-media cut as R-filter (28 / 4) with fewer extra waves (17.5% Not me, 8.9% Partly; 5.74 calls) because clean anchors come first; the same displacement of kept titles as R-filter (wrong-support 20/26, endorsed 257/282). If the full cut is wanted, it dominates R-filter.",
  "**swap (round 3)**: barely helps post-#381 (75 → 72) and is the worst for wrong-support titles (10/26 kept); it also changes 74 of 171 sets where the label matcher sees no rejection (support-based, so not neutral to production's rule) and loses a medium R-current offered in 8 sets. **add (round 3)**: 75 → 59 at +44% calls in the first wave, with wrong-support kept 18/26. Neither beats R-reorder.",
  "**Round 5b, R-filter+waveOrder / R-filter+reorder+waveOrder** (later-wave titles kept behind the first wave's): the hypothesis holds for wrong-support titles (20 → 26 of 26 in both) and most of the displacement goes (endorsed 261 → 270 and 257 → 266; other-pattern 779 → 830 and 776 → 826; unrelated 866 → 913 and 866 → 910), with the same lost-media cut (28 Not me, 4 Partly) and short sets unchanged. Neither qualifies over R-reorder on the pre-registered bar: endorsed kept stays under 274 (270, 266), and calls per set are unchanged by wave order (5.99, 5.74 > 5.5; 23% / 17.5% of Not me sets take a sequential extra wave).",
  "**Best trade-off: R-reorder** (about a third fewer lost-media sets, half for Partly, with no measurable harm or cost). **R-filter+reorder** is the arm that removes most lost media, but only if a ~17% second-wave rate and the displacement of non-rejected titles are acceptable; placing second-wave rows after the first wave's (untested here) may remove that displacement."
];

export const LIMITATIONS5 = [
  "Retrieval is a stand-in: \"related\" is feature similarity over a 1,134-title snapshot. TMDb's recommendations (film, TV) are behavioural, so the share of conflicting titles a real film/TV anchor returns, and therefore how often a filtered pool triggers a second wave, may differ.",
  "Fixtures are synthetic (stress profiles plus the Example Profile); patterns' stored supports include deliberate wrong supports.",
  "Calls and waves stand in for cost and latency; a filtered first wave that triggers the second wave adds a sequential round trip in production.",
  "The novelty guard and series checks are not simulated; rounds 2-3 use the no-correction sets as history for every arm.",
  "The matcher is production's label rule (notMeConflict); titles without labels (many games) never conflict, so they are neither filtered nor counted."
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--out");
  const dir = at > 0 ? process.argv[at + 1] : join(HERE, "reports");
  const run = runEval5();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "round5.json"), JSON.stringify(run, null, 1) + "\n");
  writeFileSync(join(dir, "round5.md"), reportMarkdown5(run));
  console.log(`wrote ${join(dir, "round5.md")}`);
  for (const r of run.results) console.log(`${r.arm}: neutral mismatches ${r.neutrality.mismatches}/${r.neutrality.evaluations}; Not me lost medium ${r.notMe.lostMedium}, short ${r.notMe.short}, empty ${r.notMe.empty}, conflicts ${r.notMe.conflictsOffered}, calls ${r.notMe.callsArm}; Partly lost ${r.partly.lostMedium}, short ${r.partly.short}`);
}
