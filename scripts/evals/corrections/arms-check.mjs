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
import { ROUNDS, loadCases, wireRecords } from "./fixtures.mjs";
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
  eq("every structural arm offers as many titles as production, every case, round and scenario (incl. the last round's six-title pool)", Object.values(sizeDiffs).reduce((a, b) => a + b, 0), 0);

}

finish();
