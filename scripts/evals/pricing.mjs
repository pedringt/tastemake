// Shared by the eval runners (run.mjs, stress/run-stress.mjs). Cost uses the same verified per-model
// rates as production telemetry (src/server/ai-metrics.mjs); TASTEMAKE_AI_PRICE_IN / _OUT ($ per M)
// override them for a model those rates don't know.
import { estimateCostUsd } from "../../src/server/ai-metrics.mjs";

export const priceFor = (model, inputTokens, outputTokens) => {
  if (process.env.TASTEMAKE_AI_PRICE_IN || process.env.TASTEMAKE_AI_PRICE_OUT) {
    return (inputTokens / 1e6) * Number(process.env.TASTEMAKE_AI_PRICE_IN || 0) + (outputTokens / 1e6) * Number(process.env.TASTEMAKE_AI_PRICE_OUT || 0);
  }
  return estimateCostUsd({ model, inputTokens, outputTokens }) ?? 0;
};
