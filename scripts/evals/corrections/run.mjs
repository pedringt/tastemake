#!/usr/bin/env node
// Correction-aware ranking eval (learning-loop review, Nov 3). Compares production's shortlist with
// prototype rankings that respond to Taste Profile corrections, on fixed pools. Free: no network, no
// model, no production code changed. Deterministic: the same inputs always give the same report.
//
//   node scripts/evals/corrections/run.mjs                 # writes reports/latest.md and latest.json
//   node scripts/evals/corrections/run.mjs --out <dir>     # somewhere else
//
// The prototype lives in rank.mjs and is never wired into production. Gates were written before the
// first run (learning-loop-review-2.md, section 3) and are not tuned to make an arm pass.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { offeredCandidates, produceRecommendations } from "../../../api/recommendations.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { evidenceRecords } from "../../../src/model/evidence.js";
import { setStatement } from "../../../src/model/statements.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { ROUNDS, loadCases, wireRecords } from "./fixtures.mjs";
import { armSelection, attribution, chooseWith, correctedScorer, primaryDomain, productionScorer, rejects, scoreParts, withAnchors } from "./rank.mjs";
import { isFranchiseContinuation } from "../../../src/catalog/novelty.mjs";
import { featureRarity } from "../../../src/ai/taste-score.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));

// "Not me" strength is what varies. "Important" / "not important" keep the values first designed for
// them (x1.5 / x0.5, statements.js). An excluded area uses the "not me" strength inside that area.
export const STRENGTHS = [0.75, 0.5, 0.25, 0.1].map((notMe) => ({ id: `notMe ${notMe}`, notMe, lot: 1.5, little: 0.5 }));
export const SAFEGUARDS = [
  { id: "none" },
  { id: "split", split: true },
  { id: "split + anchor off", split: true, anchorOff: true },
  { id: "split + anchor off + floor 0.5", split: true, anchorOff: true, floor: 0.5 }
];
export const ARMS = [
  ...STRENGTHS.flatMap((strength) => SAFEGUARDS.map(({ id, ...g }) => ({ id: `${strength.id} / ${id}`, strength, ...g }))),
  // What the reference arm would do if every stored support were right (#318 fixed): not a candidate
  // design, a measure of how much wrong supports cost.
  { id: "oracle: notMe 0.5 / split + anchor off / true supports", strength: STRENGTHS[1], split: true, anchorOff: true, supportsKey: "trueSupports", oracle: true }
];

// Round 2: structural changes (rank.mjs, armSelection), each on top of round 1's split + anchor-off
// safeguards. A = correction-aware ordering, B = flexible media balancing, C = both.
export const STRUCTURES = [
  { id: "A local order", retrieval: "local" },
  { id: "A global order", retrieval: "global" },
  { id: "B second turns", yieldTurn: "second" },
  { id: "B one medium", yieldTurn: "one-medium" },
  { id: "C local + second turns", retrieval: "local", yieldTurn: "second" },
  { id: "C local + one medium", retrieval: "local", yieldTurn: "one-medium" }
];
const R2 = { round: 2, split: true, anchorOff: true };
export const ROUND2_ARMS = [
  ...STRENGTHS.slice(0, 3).flatMap((strength) => STRUCTURES.map(({ id, ...s }) => ({ id: `${strength.id} / ${id}`, strength, ...R2, ...s }))),
  ...[STRENGTHS[1], STRENGTHS[2]].map((strength) => ({ id: `${strength.id} / C local + one medium + floor 0.5`, strength, ...R2, floor: 0.5, retrieval: "local", yieldTurn: "one-medium" })),
  { id: "oracle: notMe 0.5 / A local order / true supports", strength: STRENGTHS[1], ...R2, retrieval: "local", supportsKey: "trueSupports", oracle: true },
  { id: "oracle: notMe 0.5 / C local + one medium / true supports", strength: STRENGTHS[1], ...R2, retrieval: "local", yieldTurn: "one-medium", supportsKey: "trueSupports", oracle: true }
];
export const ALL_ARMS = [...ARMS, ...ROUND2_ARMS];

// A fixed judge of how well a six fits the corrected profile, the same for every arm: notMe 0.5, split,
// true supports. Not ground truth (it is one of the scoring rules being tested), so it is reported as a
// diagnostic next to production's uncorrected score, not as a gate.
export const JUDGE = { strength: STRENGTHS[1], split: true, anchorOff: true, supportsKey: "trueSupports" };

export const GATES = {
  neutrality: "No statements, or only ambiguous ones (partly with no excluded area, not sure, depends on context, accurate alone): the offered six, their order and the Surprise slot match production exactly, every case and round.",
  setSize: "The prototype offers as many titles as production, every evaluation.",
  reversibility: "Choosing an answer and then choosing it again (production's setStatement) leaves no statement, and the prototype then matches production.",
  fallbackParity: "Production's no-AI fallback shows the same titles as its shortlist, every case and round (measured on production; the prototype only changes the shortlist).",
  compliance: "\"Not me\": among cases where production's six include a title mostly (>=50%) attributed to the corrected pattern and an unattributed alternative exists, the prototype has at most half as many such titles in total.",
  excludedArea: "Excluded area: the same, counting only titles in the excluded area.",
  importance: "\"Important\" never lowers, and \"not important\" never raises, the number of titles mostly attributed to that pattern (at most 5% of evaluations may go the wrong way).",
  unrelated: "Titles in production's six with under 20% attribution to every corrected pattern: at least 90% stay in the six (\"not me\", excluded area and conflict scenarios).",
  wrongSupport: "Titles in production's six that get at least 20% of their score from a wrongly stored support and under 20% from the pattern's true supports: at least 90% stay.",
  heldOut: "Held-out Loved items unrelated to the correction, put back in the pool: hit rate no more than 5 points below production's.",
  diversity: "Distinct media in the six never fall more than one below production's.",
  movement: "Titles with under 5% attribution to any corrected pattern move on average at most one place in the full order.",
  surprisePresent: "A Surprise Me slot is offered at least as often as production, minus 5 points.",
  surpriseCompliance: "Surprise slots mostly attributed to a \"not me\" pattern fall by at least half.",
  relevanceProxy: "Mean uncorrected score of the six falls by no more than 10% under \"not me\" (a guardrail: some fall is the intended effect)."
};

// Round-1 scenario classes: the core results use only these, on the six round-1 cases, so round-1 arms
// reproduce round 1's numbers exactly. Round 2 adds "double" (two rejections sharing a support),
// "not-me+accurate" (a rejection next to a confirmed pattern sharing a support) and "surprise" (rejecting
// every pattern behind the Surprise anchor).
export const ROUND1_CLASSES = new Set(["none", "ambiguous", "not-me", "lot", "little", "excluded", "conflict", "stored"]);
const NEUTRAL = new Set(["none", "ambiguous"]);
const NEGATIVE = new Set(["not-me", "excluded", "conflict"]);

const quietly = async (fn) => {
  const saved = { info: console.info, log: console.log, error: console.error, warn: console.warn };
  console.info = console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

// ---- Scenarios ------------------------------------------------------------------------------------------
const stmt = (p, fields) => ({ hypothesisId: p.id, label: p.label, says: null, weight: null, context: null, authority: "user-confirmed", ...fields });

export function scenariosFor(kase) {
  const out = [{ id: "none", cls: "none", statements: [] }];
  for (const p of kase.patterns) {
    out.push({ id: `partly: ${p.id}`, cls: "ambiguous", statements: [stmt(p, { says: "partial" })] });
    out.push({ id: `not sure: ${p.id}`, cls: "ambiguous", statements: [stmt(p, { says: "unsure" })] });
    out.push({ id: `depends on context: ${p.id}`, cls: "ambiguous", statements: [stmt(p, { says: "accurate", context: "some" })] });
    out.push({ id: `accurate: ${p.id}`, cls: "ambiguous", statements: [stmt(p, { says: "accurate" })] });
    out.push({ id: `not me: ${p.id}`, cls: "not-me", statements: [stmt(p, { says: "not-me" })], wrongSupport: p.wrongSupports.length > 0 });
    out.push({ id: `important: ${p.id}`, cls: "lot", statements: [stmt(p, { says: "accurate", weight: "lot" })] });
    out.push({ id: `not important: ${p.id}`, cls: "little", statements: [stmt(p, { says: "accurate", weight: "little" })] });
    if (p.domains.length > 1) for (const d of p.domains) {
      out.push({ id: `not in ${d}: ${p.id}`, cls: "excluded", statements: [stmt(p, { says: "partial", excludedDomains: [d] })], wrongSupport: p.wrongSupports.length > 0 });
    }
  }
  // Conflict: "important" on one pattern, "not me" on another that shares a stored support.
  for (const a of kase.patterns) for (const b of kase.patterns) {
    if (a.id === b.id || !a.supports.some((r) => b.supports.includes(r))) continue;
    out.push({ id: `important ${a.id} + not me ${b.id}`, cls: "conflict", statements: [stmt(a, { says: "accurate", weight: "lot" }), stmt(b, { says: "not-me" })], wrongSupport: b.wrongSupports.length > 0 });
  }
  if (kase.storedStatements.length) out.push({ id: "as stored in the profile", cls: "stored", statements: kase.storedStatements });
  for (const a of kase.patterns) for (const b of kase.patterns) {
    if (a.id >= b.id || !a.trueSupports.some((r) => b.trueSupports.includes(r))) continue;
    out.push({ id: `not me ${a.id} + not me ${b.id}`, cls: "double", statements: [stmt(a, { says: "not-me" }), stmt(b, { says: "not-me" })], wrongSupport: a.wrongSupports.length + b.wrongSupports.length > 0 });
  }
  for (const a of kase.patterns) for (const b of kase.patterns) {
    if (a.id === b.id || !a.trueSupports.some((r) => b.trueSupports.includes(r))) continue;
    out.push({ id: `not me ${a.id} + accurate ${b.id}`, cls: "not-me+accurate", statements: [stmt(a, { says: "not-me" }), stmt(b, { says: "accurate" })], wrongSupport: a.wrongSupports.length > 0 });
  }
  const behind = kase.patterns.filter((p) => p.trueSupports.some((r) => (kase.edgeAnchorRefs ?? []).includes(r)));
  if (behind.length) out.push({ id: `not me: every pattern behind the Surprise anchor (${behind.map((p) => p.id).join(", ")})`, cls: "surprise", statements: behind.map((p) => stmt(p, { says: "not-me" })) });
  return out;
}

// What a scenario's statements target, for attribution (always against TRUE supports, so a demotion
// caused only by a wrong support never counts as compliance).
export function targetsOf(kase, statements) {
  const byId = new Map(kase.patterns.map((p) => [p.id, p]));
  const neg = [], lot = [], little = [], all = [], endorsed = [];
  for (const s of statements) {
    const p = byId.get(s.hypothesisId);
    if (!p) continue;
    if (s.says === "accurate" && s.weight !== "little") endorsed.push(p);
    const explicit = s.says === "not-me" || (s.says === "accurate" && s.weight) || (s.says === "partial" && s.excludedDomains?.length);
    if (!explicit) continue;
    all.push(p);
    if (s.says === "not-me") neg.push({ p, domains: null });
    else if (s.says === "partial") neg.push({ p, domains: s.excludedDomains });
    else if (s.weight === "lot") lot.push(p);
    else little.push(p);
  }
  return { neg, lot, little, all, endorsed };
}

// ---- One case and round: production's answer and what attribution needs --------------------------------
async function prepareRound(kase, round, anchoredPool) {
  const state = kase.state(round);
  const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
  const ctx = buildContext(hydrateState(rawState), anchoredPool);
  const offered = offeredCandidates(ctx);
  const records = ctx.evidence;
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  const parts = new Map(ctx.candidates.map((c) => [c.id, scoreParts(c, records, { cache, rarity })]));
  const baseScore = productionScorer(records);
  const baseline = chooseWith(ctx.candidates, records, baseScore, { count: 6, mode: ctx.recommendationFilter, curveball: ctx.curveball });
  const fallback = await quietly(() => produceRecommendations({ rawState, env: {}, retrieve: async () => anchoredPool }));
  return { kase, round, ctx, records, offered, parts, baseScore, baseline, fallbackIds: (fallback.picks ?? []).map((p) => p.id) };
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && Boolean(x.edge) === Boolean(b[i].edge));

const selectOpts = (ctx) => ({ mode: ctx.recommendationFilter, curveball: ctx.curveball });

function evaluate(prep, scenario, arm) {
  const { kase, ctx, records, offered, parts, baseScore, baseline } = prep;
  const { scorer, proto } = armSelection(records, ctx.candidates, kase.patterns, scenario.statements, arm, selectOpts(ctx));
  const t = targetsOf(kase, scenario.statements);
  const sets = (list, key) => list.map((p) => new Set(p[key]));
  const negTrue = t.neg.map(({ p, domains }) => ({ refs: new Set(p.trueSupports), domains }));
  const attrNeg = (c) => Math.max(0, ...negTrue.filter((n) => !n.domains || n.domains.includes(primaryDomain(c))).map((n) => attribution(parts.get(c.id), n.refs)));
  const attrOf = (c, refsList) => Math.max(0, ...refsList.map((refs) => attribution(parts.get(c.id), refs)));
  const related = (c) => attrOf(c, [...sets(t.all, "trueSupports"), ...sets(t.all, "supports")]);
  const wrongRefs = t.neg.filter(({ p }) => p.wrongSupports.length).map(({ p }) => new Set(p.wrongSupports));
  const lotRefs = sets(t.lot, "trueSupports");
  const littleRefs = sets(t.little, "trueSupports");

  const base = offered;
  const six = proto.chosen;
  const inSix = new Set(six.map((c) => c.id));
  const baseIds = new Set(base.map((c) => c.id));
  const count = (list, f) => list.filter(f).length;
  const unrelatedBase = base.filter((c) => related(c) < 0.2);
  // One item is one of up to five rated items behind a score, so 20% (not 50%) marks a title that is there
  // partly because of the wrong support.
  const wrongBase = wrongRefs.length ? base.filter((c) => attrOf(c, wrongRefs) >= 0.2 && attrNeg(c) < 0.2) : [];
  const alternatives = ctx.candidates.some((c) => !baseIds.has(c.id) && attrNeg(c) < 0.5);
  const negBase = count(base, (c) => attrNeg(c) >= 0.5);
  const domains = (list) => new Set(list.map(primaryDomain)).size;
  const edgeOf = (list) => list.find((c) => c.edge) ?? null;
  const rank = (order) => new Map(order.map((id, i) => [id, i]));
  const rb = rank(baseline.order), ra = rank(proto.order);
  const still = ctx.candidates.filter((c) => related(c) < 0.05);
  const meanScore = (list) => (list.length ? list.reduce((s, c) => s + baseScore(c), 0) / list.length : 0);

  // ---- Round 2 diagnostics ----
  const judge = correctedScorer(records, kase.patterns, scenario.statements, JUDGE);
  const endorsedRefs = sets(t.endorsed, "trueSupports");
  const attrEndorsed = (c) => attrOf(c, endorsedRefs);
  // A relevant replacement: not mostly from the rejected pattern, and at least half as good a fit (by
  // production's own score) as production's average main pick.
  const relevanceBar = 0.5 * meanScore(base.filter((c) => !c.edge));
  const relevant = (o) => attrNeg(o) < 0.5 && baseScore(o) >= relevanceBar;
  const outside = (setIds) => ctx.candidates.filter((o) => !setIds.has(o.id) && relevant(o));
  const altsOutsideBase = outside(baseIds);
  const altsOutsideArm = outside(inSix);
  const edgeArmId = edgeOf(six)?.id;
  // Every production title mostly from the rejection: is a relevant replacement available at all
  // (arm-independent), and what happened to it.
  const targets = base.filter((c) => attrNeg(c) >= 0.5).map((c) => {
    const d = primaryDomain(c);
    const anyAlt = altsOutsideBase.length;
    const sameAlt = altsOutsideBase.filter((o) => primaryDomain(o) === d).length;
    const scarcity = !anyAlt ? "pool" : !sameAlt ? "media" : "replaceable";
    let outcome;
    if (!inSix.has(c.id)) outcome = "replaced";
    else if (c.id === edgeArmId) outcome = "surprise slot";
    else if (scarcity === "pool") outcome = "pool";
    else if (scarcity === "media") outcome = "media turn";
    else {
      const higher = altsOutsideArm.filter((o) => primaryDomain(o) === d && scorer(o) > scorer(c));
      outcome = higher.length ? "retrieval order" : "score";
    }
    return { title: c.title, domain: d, scarcity, outcome, anyAlt, sameAlt, attr: attrNeg(c), endorsed: attrEndorsed(c) };
  });
  const removed = base.filter((c) => !inSix.has(c.id));
  const removedClass = (c) => {
    if (attrEndorsed(c) >= 0.5) return "endorsed";
    const a = attrNeg(c);
    if (a >= 0.5) return "intended";
    if (a >= 0.2) return "partly";
    if (wrongRefs.length && attrOf(c, wrongRefs) >= 0.2) return "wrong support";
    return "unrelated";
  };
  const added = six.filter((c) => !baseIds.has(c.id));
  const maxMedium = (list) => Math.max(0, ...[...list.reduce((m, c) => m.set(primaryDomain(c), (m.get(primaryDomain(c)) ?? 0) + 1), new Map()).values()]);
  const creatorDupes = (list) => list.length - new Set(list.map((c) => c.by ?? c.id)).size;
  const franchiseDupes = (list) => list.filter((a, i) => list.some((b, j) => j > i && (isFranchiseContinuation(a, b) || isFranchiseContinuation(b, a)))).length;
  const meanJudge = (list) => (list.length ? list.reduce((s2, c) => s2 + judge(c), 0) / list.length : 0);
  const topSim = (c) => parts.get(c.id)?.positives[0]?.similarity ?? 0;
  const mediumKept = (() => {
    const single = t.neg.filter(({ p, domains }) => !domains && p.domains.length === 1).map(({ p }) => p.domains[0]);
    if (!single.length) return null;
    const d = single[0];
    if (!base.some((c) => primaryDomain(c) === d) || !altsOutsideBase.some((o) => primaryDomain(o) === d)) return null;
    return six.some((c) => primaryDomain(c) === d);
  })();
  const edgeB = edgeOf(base), edgeA = edgeOf(six);

  return {
    targets,
    removedClasses: removed.map(removedClass),
    addedRelevant: added.filter(relevant).length, addedCount: added.length,
    expectReplace: targets.filter((x) => x.attr >= 0.6 && x.endorsed < 0.2 && x.scarcity === "replaceable").map((x) => x.outcome === "replaced"),
    expectKeep: base.filter((c) => attrEndorsed(c) >= 0.5 && attrEndorsed(c) >= attrNeg(c)).map((c) => inSix.has(c.id)),
    mediumKept,
    concentratedBase: maxMedium(base) >= 3, concentratedArm: maxMedium(six) >= 3,
    mediumDropped: domains(six) < domains(base),
    creatorDupesBase: creatorDupes(base), creatorDupesArm: creatorDupes(six),
    franchiseDupesArm: franchiseDupes(six),
    judgeBase: meanJudge(base), judgeArm: meanJudge(six),
    yields: proto.yields ?? 0, firstYields: proto.firstYields ?? 0,
    edgeChanged: (edgeB?.id ?? null) !== (edgeA?.id ?? null),
    edgePartBase: edgeB ? attrNeg(edgeB) >= 0.2 : false, edgePartArm: edgeA ? attrNeg(edgeA) >= 0.2 : false,
    edgeSimBase: edgeB ? topSim(edgeB) : null, edgeSimArm: edgeA ? topSim(edgeA) : null,
    edgeUnrelatedBase: edgeB ? related(edgeB) < 0.2 : false, edgeUnrelatedKept: edgeB && related(edgeB) < 0.2 ? edgeA?.id === edgeB.id : false,
    edgeTitles: [edgeB?.title ?? null, edgeA?.title ?? null],
    identical: sameSet(six, base),
    sizeBase: base.length, sizeArm: six.length,
    negBase, negArm: count(six, (c) => attrNeg(c) >= 0.5),
    // Left in only because each medium takes a turn: no eligible candidate of the same medium is less attributed.
    negBaseStuck: count(base, (c) => attrNeg(c) >= 0.5 && !ctx.candidates.some((o) => !baseIds.has(o.id) && primaryDomain(o) === primaryDomain(c) && attrNeg(o) < 0.5)),
    // Still offered although a same-medium, less attributed candidate now scores higher: kept by
    // retrieval order, which is half of the fused ranking and which a score correction never moves.
    negArmByRetrieval: count(six, (c) => attrNeg(c) >= 0.5 && ctx.candidates.some((o) => !inSix.has(o.id) && primaryDomain(o) === primaryDomain(c) && attrNeg(o) < 0.5 && scorer(o) > scorer(c))),
    negArmStuck: count(six, (c) => attrNeg(c) >= 0.5 && !ctx.candidates.some((o) => !inSix.has(o.id) && primaryDomain(o) === primaryDomain(c) && attrNeg(o) < 0.5)),
    replacementCase: negBase > 0 && alternatives,
    unrelatedBase: unrelatedBase.length, unrelatedKept: count(unrelatedBase, (c) => inSix.has(c.id)),
    wrongBase: wrongBase.length, wrongKept: count(wrongBase, (c) => inSix.has(c.id)),
    lotBase: count(base, (c) => attrOf(c, lotRefs) >= 0.5), lotArm: count(six, (c) => attrOf(c, lotRefs) >= 0.5),
    littleBase: count(base, (c) => attrOf(c, littleRefs) >= 0.5), littleArm: count(six, (c) => attrOf(c, littleRefs) >= 0.5),
    domainsBase: domains(base), domainsArm: domains(six),
    anchorsBase: new Set(base.map((c) => c.relatedToId)).size, anchorsArm: new Set(six.map((c) => c.relatedToId)).size,
    edgeBase: Boolean(edgeOf(base)), edgeArm: Boolean(edgeOf(six)),
    edgeNegBase: edgeOf(base) ? attrNeg(edgeOf(base)) >= 0.5 : false, edgeNegArm: edgeOf(six) ? attrNeg(edgeOf(six)) >= 0.5 : false,
    movement: still.length ? still.reduce((s, c) => s + Math.abs(ra.get(c.id) - rb.get(c.id)), 0) / still.length : 0,
    scoreBase: meanScore(base), scoreArm: meanScore(six),
    replaced: base.filter((c) => !inSix.has(c.id)).map((c) => ({ title: c.title, attr: attrNeg(c) })),
    added: six.filter((c) => !baseIds.has(c.id)).map((c) => ({ title: c.title, attr: attrNeg(c) })),
    kept: base.filter((c) => inSix.has(c.id)).map((c) => ({ title: c.title, attr: attrNeg(c) }))
  };
}

// Held-out favorites: take a Loved item unrelated to the correction out of the profile, put it in the
// pool (12th place), and see whether the six still find it.
async function heldOut(kase, scenario, arm, cache) {
  const t = targetsOf(kase, scenario.statements);
  const touched = new Set(t.all.flatMap((p) => [...p.supports, ...p.trueSupports]));
  const state0 = kase.state(0);
  const records0 = wireRecords(state0);
  const picks = records0.filter((r) => r.class === "experienced" && r.weight >= 2 && !touched.has(r.ref)).slice(0, 3);
  let hitsBase = 0, hitsArm = 0;
  for (const r of picks) {
    const key = `${kase.id}|${r.itemId}`;
    if (!cache.has(key)) {
      const state = kase.state(0);
      const item = state.feedbackByRecommendation[r.itemId]?.item ?? state.customItems?.[r.itemId];
      delete state.feedbackByRecommendation[r.itemId];
      state.selectedFavorites.delete(r.itemId);
      state.libraryFavorites.delete(r.itemId);
      const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
      const hstate = hydrateState(rawState);
      const records = evidenceRecords(hstate);
      const pool = [...kase.pool.slice(0, 11), item, ...kase.pool.slice(11)];
      const ctx = buildContext(hstate, withAnchors(pool, records));
      cache.set(key, { ctx, base: offeredCandidates(ctx).some((c) => c.id === r.itemId) });
    }
    const { ctx, base } = cache.get(key);
    const six = armSelection(ctx.evidence, ctx.candidates, kase.patterns, scenario.statements, arm, selectOpts(ctx)).proto.chosen;
    hitsBase += base ? 1 : 0;
    hitsArm += six.some((c) => c.id === r.itemId) ? 1 : 0;
  }
  return { n: picks.length, hitsBase, hitsArm };
}

// Choose then choose again: production clears the answer, leaving nothing for the prototype to act on.
function reversibilityHolds(kase, prep, arm) {
  const p = kase.patterns[0];
  const state = { modelHypotheses: kase.patterns.map((x) => ({ id: x.id, title: x.label, claim: x.label })), patternStatements: [], hypothesisHistory: [] };
  setStatement(state, p.id, "says", "not-me");
  const set = state.patternStatements.length === 1;
  setStatement(state, p.id, "says", "not-me");
  const cleared = state.patternStatements.length === 0;
  const six = armSelection(prep.records, prep.ctx.candidates, kase.patterns, state.patternStatements, arm, selectOpts(prep.ctx)).proto.chosen;
  return set && cleared && sameSet(six, prep.offered);
}

// ---- Run -----------------------------------------------------------------------------------------------
export async function runEval({ cases = loadCases(), arms = ALL_ARMS } = {}) {
  const preps = [];
  const fixtures = [];
  for (const kase of cases) {
    const anchored = withAnchors(kase.pool, wireRecords(kase.state(0)));
    for (let round = 0; round < ROUNDS; round += 1) preps.push(await prepareRound(kase, round, anchored));
    fixtures.push(describeCase(kase, preps.find((p) => p.kase === kase && p.round === 0)));
  }
  const fallbackMismatches = preps.filter((p) => p.fallbackIds.join("|") !== p.offered.map((c) => c.id).join("|"))
    .map((p) => ({ case: p.kase.id, round: p.round, shortlist: p.offered.map((c) => c.title), fallback: p.fallbackIds }));
  const parity = preps.every((p) => sameSet(p.baseline.chosen, p.offered));

  // Core: round-1 cases and scenario classes (comparable with round 1). Extended: every case and class.
  const sets = {
    core: { preps: preps.filter((p) => !p.kase.extended), keep: (s) => ROUND1_CLASSES.has(s.cls) },
    extended: { preps, keep: () => true }
  };
  const hoCache = new Map();   // the held-out pools and production's answer: the same for every arm
  const results = { core: [], extended: [] };
  for (const [name, { preps: list, keep }] of Object.entries(sets)) {
    const setCases = cases.filter((k) => list.some((p) => p.kase === k));
    for (const arm of arms) {
      const agg = {};
      const add = (cls, m) => { (agg[cls] ??= []).push(m); };
      for (const prep of list) for (const scenario of scenariosFor(prep.kase).filter(keep)) {
        const m = evaluate(prep, scenario, arm);
        add(scenario.cls, m);
        if (scenario.wrongSupport) add("wrong-support", m);
      }
      const ho = { n: 0, hitsBase: 0, hitsArm: 0 };
      for (const kase of setCases) for (const scenario of scenariosFor(kase).filter((s) => NEGATIVE.has(s.cls) && keep(s))) {
        const r = await heldOut(kase, scenario, arm, hoCache);
        ho.n += r.n; ho.hitsBase += r.hitsBase; ho.hitsArm += r.hitsArm;
      }
      const reversible = setCases.every((kase) => reversibilityHolds(kase, list.find((p) => p.kase === kase && p.round === 0), arm));
      results[name].push(summarize(arm, agg, ho, reversible, fallbackMismatches.length === 0));
    }
  }
  const examples = exampleLines(sets.core.preps, ARMS.find((a) => a.id === "notMe 0.5 / split + anchor off"));
  const spotlight = spotlightLines(preps, arms);
  return { parity, fallbackMismatches, fixtures, results, examples, spotlight };
}

const sum = (list, key) => list.reduce((s, m) => s + (typeof key === "function" ? key(m) : m[key]), 0);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

function summarize(arm, agg, ho, reversible, fallbackOk) {
  const all = Object.values(agg).flat();
  const neutral = [...(agg.none ?? []), ...(agg.ambiguous ?? [])];
  const notMe = agg["not-me"] ?? [];
  const excluded = agg.excluded ?? [];
  const negative = [...notMe, ...excluded, ...(agg.conflict ?? [])];
  const repl = (list) => list.filter((m) => m.replacementCase);
  const importance = [...(agg.lot ?? []).map((m) => m.lotArm < m.lotBase), ...(agg.little ?? []).map((m) => m.littleArm > m.littleBase)];
  const wrong = agg["wrong-support"] ?? [];
  const edgeNegBase = sum(notMe, (m) => (m.edgeNegBase ? 1 : 0));
  const scoreBase = sum(notMe, "scoreBase"), scoreArm = sum(notMe, "scoreArm");
  const numbers = {
    evaluations: all.length,
    neutralMismatches: neutral.filter((m) => !m.identical).length,
    sizeMismatches: all.filter((m) => m.sizeArm !== m.sizeBase).length,
    complianceBase: sum(repl(notMe), "negBase"), complianceArm: sum(repl(notMe), "negArm"), complianceCases: repl(notMe).length,
    complianceStuck: sum(repl(notMe), "negArmStuck"), complianceBaseStuck: sum(repl(notMe), "negBaseStuck"), complianceByRetrieval: sum(repl(notMe), "negArmByRetrieval"),
    replacedRate: pct(repl(notMe).filter((m) => m.negArm < m.negBase).length, repl(notMe).length),
    excludedBase: sum(repl(excluded), "negBase"), excludedArm: sum(repl(excluded), "negArm"), excludedCases: repl(excluded).length,
    importanceWrongWay: importance.filter(Boolean).length, importanceEvaluations: importance.length,
    lotMoved: pct((agg.lot ?? []).filter((m) => m.lotArm > m.lotBase).length, (agg.lot ?? []).length),
    littleMoved: pct((agg.little ?? []).filter((m) => m.littleArm < m.littleBase).length, (agg.little ?? []).length),
    unrelatedBase: sum(negative, "unrelatedBase"), unrelatedKept: sum(negative, "unrelatedKept"),
    wrongBase: sum(wrong, "wrongBase"), wrongKept: sum(wrong, "wrongKept"),
    heldOutN: ho.n, heldOutBase: pct(ho.hitsBase, ho.n), heldOutArm: pct(ho.hitsArm, ho.n),
    diversityViolations: all.filter((m) => m.domainsArm < m.domainsBase - 1).length,
    movement: negative.length ? Math.round((sum(negative, "movement") / negative.length) * 100) / 100 : 0,
    edgeBase: pct(sum(all, (m) => (m.edgeBase ? 1 : 0)), all.length), edgeArm: pct(sum(all, (m) => (m.edgeArm ? 1 : 0)), all.length),
    edgeNegBase, edgeNegArm: sum(notMe, (m) => (m.edgeNegArm ? 1 : 0)),
    scoreDrop: scoreBase ? Math.round((1 - scoreArm / scoreBase) * 1000) / 10 : 0,
    anchorsBase: Math.round((sum(all, "anchorsBase") / all.length) * 100) / 100, anchorsArm: Math.round((sum(all, "anchorsArm") / all.length) * 100) / 100
  };
  // ---- Round 2 numbers (diagnostics; the gates below are round 1's, unchanged) ----
  const rejecting = [...notMe, ...excluded, ...(agg.conflict ?? []), ...(agg.double ?? []), ...(agg["not-me+accurate"] ?? []), ...(agg.surprise ?? [])];
  const tally = (list, key) => list.reduce((o, x) => ({ ...o, [x[key]]: (o[x[key]] ?? 0) + 1 }), {});
  const notMeTargets = notMe.flatMap((m) => m.targets);
  const excludedTargets = excluded.flatMap((m) => m.targets);
  const allTargets = rejecting.flatMap((m) => m.targets);
  const expectReplace = rejecting.flatMap((m) => m.expectReplace);
  const expectKeep = [...(agg.conflict ?? []), ...(agg["not-me+accurate"] ?? [])].flatMap((m) => m.expectKeep);
  const mediumKept = notMe.map((m) => m.mediumKept).filter((x) => x !== null);
  const withEdge = rejecting.filter((m) => m.edgeBase);
  const meanOf = (list, key) => { const v = list.map((m) => m[key]).filter((x) => x !== null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null; };
  const judgeBase = sum(rejecting, "judgeBase"), judgeArm = sum(rejecting, "judgeArm");
  numbers.round2 = {
    rejectingEvaluations: rejecting.length,
    notMe: { titles: notMeTargets.length, scarcity: tally(notMeTargets, "scarcity"), outcome: tally(notMeTargets, "outcome"),
      replacedBy: tally(notMeTargets.filter((x) => x.outcome === "replaced"), "scarcity"),
      replaceableReplaced: notMeTargets.filter((x) => x.scarcity === "replaceable" && x.outcome === "replaced").length,
      replaceable: notMeTargets.filter((x) => x.scarcity === "replaceable").length,
      meanAlternatives: notMeTargets.length ? Math.round((notMeTargets.reduce((a, x) => a + x.anyAlt, 0) / notMeTargets.length) * 10) / 10 : 0,
      meanSameMedium: notMeTargets.length ? Math.round((notMeTargets.reduce((a, x) => a + x.sameAlt, 0) / notMeTargets.length) * 10) / 10 : 0 },
    excluded: { titles: excludedTargets.length, scarcity: tally(excludedTargets, "scarcity"), outcome: tally(excludedTargets, "outcome") },
    allRejections: { titles: allTargets.length, scarcity: tally(allTargets, "scarcity"), outcome: tally(allTargets, "outcome") },
    removed: tally(rejecting.flatMap((m) => m.removedClasses).map((c) => ({ c })), "c"),
    added: sum(rejecting, "addedCount"), addedRelevant: sum(rejecting, "addedRelevant"),
    expectReplace: { n: expectReplace.length, met: expectReplace.filter(Boolean).length },
    expectKeep: { n: expectKeep.length, met: expectKeep.filter(Boolean).length },
    mediumKept: { n: mediumKept.length, met: mediumKept.filter(Boolean).length },
    concentratedBase: rejecting.filter((m) => m.concentratedBase).length, concentratedArm: rejecting.filter((m) => m.concentratedArm).length,
    mediumDropped: rejecting.filter((m) => m.mediumDropped).length,
    creatorDupesBase: sum(rejecting, "creatorDupesBase"), creatorDupesArm: sum(rejecting, "creatorDupesArm"), franchiseDupesArm: sum(rejecting, "franchiseDupesArm"),
    judgeGain: judgeBase ? Math.round((judgeArm / judgeBase - 1) * 1000) / 10 : 0,
    yields: sum(rejecting, "yields"), firstYields: sum(rejecting, "firstYields"),
    surprise: {
      evaluations: withEdge.length,
      changed: withEdge.filter((m) => m.edgeChanged).length,
      mostlyRejectedBase: withEdge.filter((m) => m.edgeNegBase).length, mostlyRejectedArm: withEdge.filter((m) => m.edgeNegArm).length,
      partlyRejectedBase: withEdge.filter((m) => m.edgePartBase).length, partlyRejectedArm: withEdge.filter((m) => m.edgePartArm).length,
      unrelatedBase: withEdge.filter((m) => m.edgeUnrelatedBase).length, unrelatedKept: withEdge.filter((m) => m.edgeUnrelatedKept).length,
      lost: withEdge.filter((m) => !m.edgeArm).length,
      topSimilarityBase: meanOf(withEdge, "edgeSimBase"), topSimilarityArm: meanOf(withEdge.filter((m) => m.edgeArm), "edgeSimArm")
    }
  };
  const n = numbers;
  const gates = {
    neutrality: n.neutralMismatches === 0,
    setSize: n.sizeMismatches === 0,
    reversibility: reversible,
    fallbackParity: fallbackOk,
    compliance: n.complianceBase > 0 && n.complianceArm <= 0.5 * n.complianceBase,
    excludedArea: n.excludedBase > 0 ? n.excludedArm <= 0.5 * n.excludedBase : null,
    importance: n.importanceWrongWay <= 0.05 * n.importanceEvaluations,
    unrelated: n.unrelatedBase ? n.unrelatedKept / n.unrelatedBase >= 0.9 : null,
    wrongSupport: n.wrongBase ? n.wrongKept / n.wrongBase >= 0.9 : null,
    heldOut: n.heldOutN ? n.heldOutArm >= n.heldOutBase - 5 : null,
    diversity: n.diversityViolations === 0,
    movement: n.movement <= 1,
    surprisePresent: n.edgeArm >= n.edgeBase - 5,
    surpriseCompliance: n.edgeNegBase ? n.edgeNegArm <= 0.5 * n.edgeNegBase : null,
    relevanceProxy: n.scoreDrop <= 10
  };
  return { arm: arm.id, round: arm.round ?? 1, oracle: Boolean(arm.oracle), numbers, gates };
}

function describeCase(kase, prep) {
  const supportsOf = (refs) => refs.map((r) => prep.records.find((x) => x.ref === r)?.title ?? r);
  const shared = new Map();
  for (const p of kase.patterns) for (const r of p.supports) shared.set(r, (shared.get(r) ?? 0) + 1);
  return {
    id: kase.id,
    rated: prep.records.filter((r) => r.class === "experienced").length,
    pool: kase.pool.length,
    anchored: prep.ctx.candidates.filter((c) => c.relatedToId).length,
    patterns: kase.patterns.map((p) => ({ id: p.id, label: p.label, domains: p.domains, supports: p.supports.length, wrong: supportsOf(p.wrongSupports) })),
    sharedSupports: [...shared.values()].filter((n) => n > 1).length,
    supportedItems: shared.size
  };
}

function exampleLines(preps, arm) {
  const out = [];
  for (const prep of preps.filter((p) => p.round === 0)) {
    for (const scenario of scenariosFor(prep.kase).filter((s) => s.cls === "not-me")) {
      const m = evaluate(prep, scenario, arm);
      if (!m.replacementCase) continue;
      out.push({ case: prep.kase.id, scenario: scenario.id, replaced: m.replaced, added: m.added, kept: m.kept.filter((k) => k.attr < 0.2).map((k) => k.title) });
      break;
    }
  }
  return out;
}

// Worked examples for a few arms: what production offered, what the arm offered, and why each title mostly
// from the rejected pattern stayed or went.
export const SPOTLIGHT_ARMS = ["notMe 0.5 / split + anchor off", "notMe 0.5 / A local order", "notMe 0.5 / B one medium", "notMe 0.5 / C local + one medium"];
function spotlightLines(preps, arms) {
  const picked = [];
  for (const prep of preps.filter((p) => p.round === 0)) {
    const scen = scenariosFor(prep.kase);
    const want = [
      scen.find((s) => s.cls === "not-me" && s.wrongSupport),
      scen.find((s) => s.cls === "not-me" && !s.wrongSupport && evaluate(prep, s, ARMS[0]).targets.length >= 2),
      scen.find((s) => s.cls === "not-me+accurate" && evaluate(prep, s, ARMS[0]).expectKeep.length),
      scen.find((s) => s.cls === "surprise")
    ].filter(Boolean);
    for (const scenario of want) picked.push({ prep, scenario });
  }
  const out = [];
  for (const { prep, scenario } of picked) {
    const rows = [];
    for (const id of SPOTLIGHT_ARMS) {
      const arm = arms.find((a) => a.id === id);
      if (!arm) continue;
      const m = evaluate(prep, scenario, arm);
      rows.push({ arm: id, six: m.kept.concat(m.added).map((x) => `${x.title} (${Math.round(x.attr * 100)}%)`), replaced: m.replaced.map((x) => x.title), added: m.added.map((x) => x.title), targets: m.targets.map((x) => `${x.title}: ${x.outcome} [${x.scarcity}; ${x.anyAlt} relevant alternatives, ${x.sameAlt} same medium]`), surprise: m.edgeTitles });
    }
    out.push({ case: prep.kase.id, scenario: scenario.id, cls: scenario.cls, production: prep.offered.map((c) => c.title + (c.edge ? " [Surprise]" : "")), rows });
  }
  return out;
}

// ---- Report ---------------------------------------------------------------------------------------------
const mark = (v) => (v === null ? "n/a" : v ? "pass" : "FAIL");

export function reportMarkdown(run) {
  const lines = [];
  lines.push("# Correction-aware ranking: offline eval", "");
  lines.push("Generated by `node scripts/evals/corrections/run.mjs`. No network, no model calls, no production change. Deterministic.", "");
  lines.push("Baseline: production's shortlist (`offeredCandidates`, `chooseCandidates`). Arms: prototype rankings in `scripts/evals/corrections/rank.mjs`, not wired into production.", "");
  lines.push(`- Prototype selection matches production on every case and round when no statements apply: **${run.parity ? "yes" : "NO"}**`);
  lines.push(`- Production fallback shows its shortlist on every case and round: **${run.fallbackMismatches.length ? `NO (${run.fallbackMismatches.length} mismatches)` : "yes"}**`, "");
  lines.push("## Fixtures", "");
  lines.push("| Case | Rated (experienced) | Pool | With an anchor | Patterns | Items supporting a pattern | Items supporting 2+ | Wrong supports |", "|---|---|---|---|---|---|---|---|");
  for (const f of run.fixtures) {
    const wrong = f.patterns.filter((p) => p.wrong.length).map((p) => `${p.id}: ${p.wrong.join(", ")}`).join("; ") || "none";
    lines.push(`| ${f.id} | ${f.rated} | ${f.pool} | ${f.anchored} | ${f.patterns.length} | ${f.supportedItems} | ${f.sharedSupports} | ${wrong} |`);
  }
  lines.push("");
  const gateIds = Object.keys(GATES);
  lines.push("## Gates by arm (core set: the six round-1 cases and scenario classes, comparable with round 1)", "");
  lines.push(`| Arm | ${gateIds.join(" | ")} |`, `|---|${gateIds.map(() => "---").join("|")}|`);
  for (const r of run.results.core) lines.push(`| ${r.arm} | ${gateIds.map((g) => mark(r.gates[g])).join(" | ")} |`);
  lines.push("", "Extended set (all nine cases, all scenario classes):", "");
  lines.push(`| Arm | ${gateIds.join(" | ")} |`, `|---|${gateIds.map(() => "---").join("|")}|`);
  for (const r of run.results.extended) lines.push(`| ${r.arm} | ${gateIds.map((g) => mark(r.gates[g])).join(" | ")} |`);
  lines.push("");
  lines.push("## Numbers by arm (core set)", "");
  const cols = [
    ["\"Not me\" titles in six (prod → arm)", (n) => `${n.complianceBase} → ${n.complianceArm} (${n.complianceCases} cases)`],
    ["Of those, no same-medium alternative (prod → arm)", (n) => `${n.complianceBaseStuck} → ${n.complianceStuck}`],
    ["Kept by retrieval order over a higher-scoring alternative", (n) => `${n.complianceByRetrieval}`],
    ["Cases with a replacement", (n) => `${n.replacedRate}%`],
    ["Excluded-area titles", (n) => `${n.excludedBase} → ${n.excludedArm}`],
    ["Importance wrong way", (n) => `${n.importanceWrongWay}/${n.importanceEvaluations}`],
    ["Important moved / not important moved", (n) => `${n.lotMoved}% / ${n.littleMoved}%`],
    ["Unrelated kept", (n) => `${n.unrelatedKept}/${n.unrelatedBase}`],
    ["Wrong-support titles kept", (n) => `${n.wrongKept}/${n.wrongBase}`],
    ["Held-out hits (prod → arm)", (n) => `${n.heldOutBase}% → ${n.heldOutArm}% (n=${n.heldOutN})`],
    ["Mean place shift, unrelated", (n) => `${n.movement}`],
    ["Surprise offered (prod → arm)", (n) => `${n.edgeBase}% → ${n.edgeArm}%`],
    ["\"Not me\" Surprise", (n) => `${n.edgeNegBase} → ${n.edgeNegArm}`],
    ["Score drop under \"not me\"", (n) => `${n.scoreDrop}%`],
    ["Distinct anchors (prod → arm)", (n) => `${n.anchorsBase} → ${n.anchorsArm}`]
  ];
  lines.push(`| Arm | ${cols.map(([h]) => h).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
  for (const r of run.results.core) lines.push(`| ${r.arm} | ${cols.map(([, f]) => f(r.numbers)).join(" | ")} |`);
  lines.push("");
  lines.push(...round2Markdown(run));
  lines.push("## Examples (notMe 0.5 / split + anchor off, round 1)", "");
  lines.push("A title's share in brackets is how much of its score came from the corrected pattern's true supports.", "");
  for (const e of run.examples) {
    lines.push(`- **${e.case}, ${e.scenario}.** Replaced: ${e.replaced.map((x) => `${x.title} (${Math.round(x.attr * 100)}%)`).join(", ") || "nothing"}. Added: ${e.added.map((x) => `${x.title} (${Math.round(x.attr * 100)}%)`).join(", ") || "nothing"}. Unrelated titles kept: ${e.kept.join(", ") || "none"}.`);
  }
  lines.push("");
  lines.push("## Gate definitions", "");
  for (const [id, text] of Object.entries(GATES)) lines.push(`- **${id}**: ${text}`);
  lines.push("");
  lines.push("## Limitations", "");
  lines.push(...LIMITATIONS.map((l) => `- ${l}`));
  if (run.fallbackMismatches.length) {
    lines.push("", "## Fallback mismatches", "");
    for (const m of run.fallbackMismatches) lines.push(`- ${m.case} round ${m.round + 1}: shortlist ${m.shortlist.join(", ")}; fallback ids ${m.fallback.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

function round2Markdown(run) {
  const lines = [];
  const t = (o, k) => o?.[k] ?? 0;
  for (const name of ["core", "extended"]) {
    lines.push(`## Round 2: where "not me" titles go (${name} set)`, "");
    lines.push("Every production title mostly (>=50%) from the rejected pattern, in every \"not me\" evaluation (not only those with an alternative). Scarcity is arm-independent: a relevant replacement is a title outside production's six, under 50% from the rejected pattern, scoring at least half production's average main pick.", "");
    lines.push("| Arm | Titles | Pool-scarce | Same-medium scarce | Replaceable | Replaced (of replaceable) | Replaced across media (of same-medium scarce) | Replaced with no relevant alternative (of pool-scarce) | Kept: media turn | Kept: score | Kept: retrieval order | Kept: Surprise slot | Kept: pool |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of run.results[name]) {
      const x = r.numbers.round2.notMe;
      lines.push(`| ${r.arm} | ${x.titles} | ${t(x.scarcity, "pool")} | ${t(x.scarcity, "media")} | ${x.replaceable} | ${x.replaceableReplaced} (${pct(x.replaceableReplaced, x.replaceable)}%) | ${t(x.replacedBy, "media")} | ${t(x.replacedBy, "pool")} | ${t(x.outcome, "media turn")} | ${t(x.outcome, "score")} | ${t(x.outcome, "retrieval order")} | ${t(x.outcome, "surprise slot")} | ${t(x.outcome, "pool")} |`);
    }
    lines.push("");
    lines.push(`## Round 2: quality and safeguards (${name} set, every rejection scenario)`, "");
    lines.push("| Arm | Rejection titles kept→replaced (all classes) | Removed: intended / partly / wrong support / endorsed / unrelated | Added titles relevant | Expect replace met | Expect keep (endorsed) met | Medium kept when it could be | Sets with 3+ of one medium (prod → arm) | Sets losing a medium | Creator dupes (prod → arm) | Corrected-fit change | Yields (first-turn) |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of run.results[name]) {
      const x = r.numbers.round2;
      const rm = x.removed;
      lines.push(`| ${r.arm} | ${x.allRejections.titles - t(x.allRejections.outcome, "replaced")} / ${t(x.allRejections.outcome, "replaced")} | ${t(rm, "intended")} / ${t(rm, "partly")} / ${t(rm, "wrong support")} / ${t(rm, "endorsed")} / ${t(rm, "unrelated")} | ${x.addedRelevant}/${x.added} | ${x.expectReplace.met}/${x.expectReplace.n} | ${x.expectKeep.met}/${x.expectKeep.n} | ${x.mediumKept.met}/${x.mediumKept.n} | ${x.concentratedBase} → ${x.concentratedArm} | ${x.mediumDropped} | ${x.creatorDupesBase} → ${x.creatorDupesArm} | ${x.judgeGain}% | ${x.yields} (${x.firstYields}) |`);
    }
    lines.push("");
    lines.push(`## Round 2: Surprise Me (${name} set, rejection scenarios with a Surprise slot)`, "");
    lines.push("| Arm | Evaluations | Surprise changed | Mostly rejected (prod → arm) | Partly (>=20%) rejected (prod → arm) | Unrelated Surprise kept | Surprise lost | Top similarity to a rating (prod → arm; lower = more novel) |", "|---|---|---|---|---|---|---|---|");
    for (const r of run.results[name]) {
      const x = r.numbers.round2.surprise;
      lines.push(`| ${r.arm} | ${x.evaluations} | ${x.changed} | ${x.mostlyRejectedBase} → ${x.mostlyRejectedArm} | ${x.partlyRejectedBase} → ${x.partlyRejectedArm} | ${x.unrelatedKept}/${x.unrelatedBase} | ${x.lost} | ${x.topSimilarityBase} → ${x.topSimilarityArm} |`);
    }
    lines.push("");
  }
  lines.push("## Round 2: worked examples (round 1 of each case)", "");
  for (const e of run.spotlight) {
    lines.push(`### ${e.case}: ${e.scenario}`, "", `Production: ${e.production.join(", ")}`, "");
    for (const r of e.rows) {
      lines.push(`- **${r.arm}**: replaced ${r.replaced.join(", ") || "nothing"}; added ${r.added.join(", ") || "nothing"}. Surprise ${r.surprise[0] ?? "none"} → ${r.surprise[1] ?? "none"}.`);
      for (const x of r.targets) lines.push(`  - ${x}`);
    }
    lines.push("");
  }
  return lines;
}

export const LIMITATIONS = [
  "Attribution is the harness's own estimate (the share of a score from a pattern's supporting items). A title can be \"unattributed\" and still be what someone means by that pattern, and the reverse.",
  "Keeping production's titles is not the same as quality. Production's six are a reference, not ground truth: an arm can keep them all and still be worse for the person, or replace some and be better.",
  "Held-out recall uses the same similarity features the ranking uses, so it measures whether known-good items still surface, not satisfaction.",
  "The score drop is measured with production's uncorrected score, which is the thing a correction is meant to override; it is a guardrail, not a quality measure.",
  "Patterns for the stress profiles are shelf rules, cleaner than model-written patterns. Only the Example Profile's patterns are real model output.",
  "Pools are fixed and anchors are stand-ins (the most similar strong rating, same medium first). Live retrieval would keep fetching from the corrected pattern's items, which this cannot show.",
  "Diversity counts media and anchors, not whether the variety is good.",
  "The AI reorders most sets and picks its own Surprise (Nov 1 logs), so these numbers describe what is offered, not the final display order.",
  "Synthetic and curated profiles only; nothing here says how real people would react.",
  "Round 2: \"relevant replacement\", \"corrected fit\" and the expect-replace / expect-keep labels are rules over the harness's attribution and score, not human judgments. The corrected-fit judge (notMe 0.5, split, true supports) is close to some arms' own scorer, so a gain there is partly circular.",
  "Round 2: B's 10% margin and the 0.9 \"lowered\" cut-off were set before the run and not tuned. Production's Surprise slot is taken first and B never touches it."
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--out");
  const dir = at > 0 ? process.argv[at + 1] : join(HERE, "reports");
  const run = await runEval();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "latest.json"), JSON.stringify(run, null, 1) + "\n");
  writeFileSync(join(dir, "latest.md"), reportMarkdown(run));
  console.log(`wrote ${join(dir, "latest.md")}`);
  console.log(`parity with production: ${run.parity ? "yes" : "NO"}; fallback mismatches: ${run.fallbackMismatches.length}`);
  for (const r of run.results.core) console.log(`${r.arm}: ${Object.values(r.gates).filter((g) => g === false).length} core gate(s) failed`);
}
