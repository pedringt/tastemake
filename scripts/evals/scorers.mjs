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
  const grounded = hyp.accepted.length;
  out.push({ kind: "quality", name: "grounding coverage", pass: null, detail: `${grounded} hypothesis(es) could cite this user's own evidence; fallback ${hyp.fallback ? "used" : "not needed"}` });
  return out;
}
