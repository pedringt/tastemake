// Correction-aware ranking eval, slow part (#341 step 2, PR B): every round-2 structural arm must offer
// production's exact six when no correction (or only an ambiguous one) applies, and as many titles as
// production. Split out of scripts/qa/correction-eval-tests.mjs (npm test) because it takes ~30 s; run with
// `npm run test:corrections`.
// Free: no network, no model.
import { createSuite } from "../../qa/lib/assert.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { chooseCandidates } from "../../../src/ai/taste-score.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { offeredCandidates } from "../../../api/recommendations.mjs";
import { ROUNDS, conflictMatcher, loadCases, wireRecords } from "./fixtures.mjs";
import { armSelection, withAnchors } from "./rank.mjs";
import { ROUND2_ARMS, scenariosFor } from "./run.mjs";

const { eq, finish } = createSuite("correction-eval arms");

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

{
  const neutralDiffs = {}, sizeDiffs = {};
  // Three arms cover all three structural options at the strongest strength (run.mjs checks every arm).
  for (const arm of ROUND2_ARMS.filter((a) => ["notMe 0.25 / A global order", "notMe 0.25 / B one medium", "notMe 0.25 / C local + one medium"].includes(a.id))) {
    neutralDiffs[arm.id] = 0; sizeDiffs[arm.id] = 0;
    for (const { kase, ctx } of contexts) {
      const base = chooseCandidates(ctx.candidates, ctx.evidence, opts(ctx));
      for (const scenario of scenariosFor(kase)) {
        const six = armSelection(ctx.evidence, ctx.candidates, kase.patterns, scenario.statements, arm, { mode: ctx.recommendationFilter, curveball: ctx.curveball }).proto.chosen;
        if (!scenario.statements.some((x) => x.says === "not-me" || x.excludedDomains?.length) && ["none", "ambiguous"].includes(scenario.cls) && key(six) !== key(base)) neutralDiffs[arm.id] += 1;
        if (six.length !== base.length) sizeDiffs[arm.id] += 1;
      }
    }
  }
  eq("every structural arm offers production's exact six when no correction or only an ambiguous one applies", Object.values(neutralDiffs).reduce((a, b) => a + b, 0), 0);
  // Research arms don't apply production's post-#381 "Not me" rule, so this compares with production before
  // the answer (no statements); production after a "Not me" can offer fewer (round 5 measures that).
  eq("every structural arm offers as many titles as production before the answer, every case, round and scenario (incl. the last round's six-title pool)", Object.values(sizeDiffs).reduce((a, b) => a + b, 0), 0);
}

{
  // The "production" selection with the answers given is production post-#381: what offeredCandidates offers on
  // the request state with the case's patterns and the scenario's answers, every case, round and scenario.
  let checked = 0, diffs = 0;
  for (const { kase, round, ctx } of contexts) for (const scenario of scenariosFor(kase)) {
    const state = { ...kase.state(round), modelHypotheses: kase.patterns.map((p) => ({ id: p.id, title: p.label, domains: p.domains, supports: p.supports })), patternStatements: scenario.statements };
    const real = offeredCandidates(buildContext(hydrateState(JSON.parse(JSON.stringify(serializeAiState(state)))), ctx.candidates));
    const conflicts = conflictMatcher(kase, kase.state(round), scenario.statements);
    const six = armSelection(ctx.evidence, ctx.candidates, kase.patterns, scenario.statements, { select: "production" }, { mode: ctx.recommendationFilter, curveball: ctx.curveball, conflicts }).proto.chosen;
    checked += 1;
    if (key(six) !== key(real)) diffs += 1;
  }
  eq(`the "production" selection equals offeredCandidates with the answers given (${checked} case/round/scenario checks)`, diffs, 0);
}

finish();
