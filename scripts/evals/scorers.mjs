// Automatic scorers for the eval suite (#32). Each returns { name, kind, pass, detail }.
//   kind "rule"     a product rule; a failure fails the run
//   kind "quality"  a measured quality finding; reported, never fails the run
// They check what a machine can check; the human-review rubric (docs/ai-evals.md) covers specificity,
// usefulness and taste.

import { LEVELS, CROSS_DOMAIN } from "../../src/ai/contract.js";

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const trigrams = (s) => { const w = words(s); const out = new Set(); for (let i = 0; i + 2 < w.length; i += 1) out.add(w.slice(i, i + 3).join(" ")); return out; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => b.has(x) && (n += 1)); return n / (a.size + b.size - n); };

export function maxPairwiseOverlap(texts) {
  const sets = texts.map(trigrams);
  let max = 0;
  for (let i = 0; i < sets.length; i += 1) for (let j = i + 1; j < sets.length; j += 1) max = Math.max(max, jaccard(sets[i], sets[j]));
  return max;
}

export function scoreFixture(fixture, run) {
  const out = [];
  const { hyp, picks, ctx } = run;
  const refs = new Map(ctx.evidence.map((r) => [r.ref, r]));
  const e = fixture.expect ?? {};

  out.push({ kind: "quality", name: "all proposals valid", pass: hyp.rejected.length === 0 && picks.rejected.length === 0,
    detail: `${hyp.accepted.length} hypotheses kept, ${hyp.rejected.length} rejected; ${picks.accepted.length} picks kept, ${picks.rejected.length} rejected` });
  out.push({ kind: "rule", name: "every citation is real, experienced evidence", pass: [...hyp.accepted.flatMap((h) => h.evidence), ...picks.accepted.flatMap((p) => p.cites)].every((ref) => refs.has(ref)) && hyp.accepted.every((h) => h.evidence.every((ref) => refs.get(ref).class === "experienced")),
    detail: "checked every ref against the evidence records" });
  const intentUsed = [...hyp.rejected, ...picks.rejected].filter((r) => r.reasons.some((x) => /intent/.test(x))).length;
  out.push({ kind: "rule", name: "intent never used as taste", pass: intentUsed === 0, detail: intentUsed ? `${intentUsed} proposal(s) tried to` : "none tried to" });
  if (e.maxLevel) {
    const over = hyp.accepted.filter((h) => LEVELS.indexOf(h.level) > LEVELS.indexOf(e.maxLevel));
    out.push({ kind: "rule", name: `no claim above "${e.maxLevel}"`, pass: over.length === 0, detail: over.map((h) => `${h.label}: ${h.level}`).join("; ") || "ok" });
  }
  const lowered = hyp.notes.filter((n) => /level lowered/.test(n)).length;
  out.push({ kind: "quality", name: "calibrated (no overconfidence to correct)", pass: lowered === 0, detail: lowered ? `${lowered} level(s) had to be lowered by the product` : "none needed lowering" });
  if (e.maxCrossDomain) {
    const over = hyp.accepted.filter((h) => CROSS_DOMAIN.indexOf(h.crossDomain) > CROSS_DOMAIN.indexOf(e.maxCrossDomain));
    out.push({ kind: "rule", name: `cross-domain no further than "${e.maxCrossDomain}"`, pass: over.length === 0, detail: over.map((h) => `${h.label}: ${h.crossDomain}`).join("; ") || "ok" });
  }
  if (e.strongOnly) {
    const wrong = hyp.accepted.filter((h) => h.level === "strong" && !e.strongOnly.includes(h.id));
    out.push({ kind: "rule", name: `only ${e.strongOnly.join(", ")} may be Strong`, pass: wrong.length === 0, detail: wrong.map((h) => h.label).join("; ") || "ok" });
  }
  if (e.excluded) {
    const back = hyp.accepted.filter((h) => e.excluded.includes(h.id));
    out.push({ kind: "rule", name: "respects what the user said (user-confirmed outranks inference)", pass: back.length === 0, detail: back.length ? `returned ${back.map((h) => h.label).join(", ")}` : "excluded pattern stayed out" });
  }
  if (picks.accepted.length > 1) {
    const overlap = maxPairwiseOverlap(picks.accepted.map((p) => p.why));
    out.push({ kind: "quality", name: "explanations are not repetitive", pass: overlap < 0.35, detail: `max phrase overlap between two reasons: ${(overlap * 100).toFixed(0)}%` });
  }
  if (e.stableAfterMiss != null && run.before) {
    const beforeIds = new Set(run.before.accepted.map((h) => h.label));
    const kept = run.hyp.accepted.filter((h) => beforeIds.has(h.label)).length;
    const share = beforeIds.size ? kept / beforeIds.size : 1;
    out.push({ kind: "rule", name: "one miss does not rewrite the profile", pass: share >= e.stableAfterMiss, detail: `${kept} of ${beforeIds.size} hypotheses kept after the miss` });
  }
  // #335: what one disliked Friends did to the profile. Overreach is any accepted pattern that turns it into a
  // general rule against ensembles, sitcoms or comedy (Paige loves several). Quality findings, judged by hand too.
  if (e.friendsScope) {
    const FRIENDS = "ev:tmdb-tv-1668";
    const OVERREACH = /\b(?:avoid|avoids|dislike|dislikes|not drawn to|steers? clear of|turned off by|less interested in|rejects?)\b[^.;]*\b(?:ensemble|sitcom|comed|friend group|hangout)/i;
    const citing = hyp.accepted.filter((h) => h.evidence.includes(FRIENDS) || (h.counter ?? []).includes(FRIENDS));
    const overreach = hyp.accepted.filter((h) => OVERREACH.test(`${h.label} ${h.claim}`));
    out.push({ kind: "quality", name: "no pattern turns Friends into a rule against ensembles, sitcoms or comedy", pass: overreach.length === 0, detail: overreach.map((h) => h.claim).join(" | ") || "none" });
    out.push({ kind: "quality", name: "patterns citing Friends", pass: null, detail: citing.map((h) => `${h.label}: ${h.claim}`).join(" | ") || "none" });
  }

  // #318: labelled (pattern, item) pairs. A support can be structurally valid and still not show its pattern.
  // Quality findings, never a failed run: the labels are few, and matching patterns by words is rough.
  for (const pair of e.supportFit ?? []) {
    const matching = hyp.accepted.filter((h) => pair.pattern.test(`${h.label} ${h.claim}`));
    const citing = matching.filter((h) => h.evidence.includes(pair.ref));
    if (pair.fits === false) {
      out.push({ kind: "quality", name: pair.name, pass: citing.length === 0, detail: citing.length ? `cited by ${citing.map((h) => h.label).join("; ")}` : `${matching.length} matching pattern(s), none cite it` });
    } else {
      out.push({ kind: "quality", name: pair.name, pass: matching.length ? citing.length > 0 : null, detail: matching.length ? `${citing.length} of ${matching.length} matching pattern(s) cite it` : "no matching pattern this run" });
    }
  }
  // #318 (Nov 6) before/after: a confirmed pattern, its wording and the user's answer survive the refresh,
  // whatever happens to its evidence. Rule checks: these are product guarantees, not judgement calls.
  for (const id of e.keepsConfirmed ?? []) {
    const stored = (run.state?.modelHypotheses ?? []).find((h) => h.id === id);
    const kept = hyp.accepted.find((h) => h.id === id);
    out.push({ kind: "rule", name: `confirmed "${stored?.title ?? id}" is kept`, pass: Boolean(kept), detail: kept ? `level ${kept.level}${(hyp.needsReview ?? []).includes(id) ? `, needs another look (${hyp.reviewReasons?.[id] ?? "?"})` : ""}` : "dropped" });
    out.push({ kind: "rule", name: `confirmed "${stored?.title ?? id}" keeps its wording`, pass: Boolean(kept) && kept.claim === stored?.claim, detail: kept?.claim ?? "-" });
  }
  // What the refresh did to each earlier pattern's evidence: kept, newly cited (for human review: is the new
  // citation any better?) and not re-cited. Reported, not scored.
  for (const stored of e.supportFit ? (run.state?.modelHypotheses ?? []) : []) {
    const now = hyp.accepted.find((h) => h.id === stored.id);
    if (!now) { out.push({ kind: "quality", name: `evidence: ${stored.title}`, pass: null, detail: "pattern not in this refresh" }); continue; }
    const before = new Set(stored.supports ?? []);
    const added = now.evidence.filter((ref) => !before.has(ref));
    const dropped = [...before].filter((ref) => !now.evidence.includes(ref));
    out.push({ kind: "quality", name: `evidence: ${stored.title}`, pass: null, detail: `${now.evidenceSource === "carried" ? "carried (not re-checked)" : "re-cited"}; kept ${before.size - dropped.length}/${before.size}${dropped.length ? `; not re-cited ${dropped.join(", ")}` : ""}${added.length ? `; newly cited ${added.join(", ")}` : ""}` });
  }
  const grounded = hyp.accepted.length;
  out.push({ kind: "quality", name: "grounding coverage", pass: null, detail: `${grounded} hypothesis(es) could cite this user's own evidence; fallback ${hyp.fallback ? "used" : "not needed"}` });
  return out;
}
