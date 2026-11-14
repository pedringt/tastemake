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

// #341 step 2: what a call actually cost, counting prompt-cache reads and writes (production telemetry does the
// same; priceFor above ignores them and undercounts a cached call by about half).
export const usageCostUsd = (model, usage = {}) => {
  if (process.env.TASTEMAKE_AI_PRICE_IN || process.env.TASTEMAKE_AI_PRICE_OUT) {
    const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    return priceFor(model, input, usage.output_tokens ?? 0);
  }
  return estimateCostUsd({ model, inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0, perCall: true }) ?? 0;
};

// The most a call could cost before it's made: about 3 characters per token (tokenizers average closer to 4),
// every prompt token at the cache-write rate (the highest input rate), and the whole output cap used.
// Infinity for a model without known rates, so a spend cap refuses the call instead of counting it as free.
export const worstCaseUsd = (model, promptChars, maxOutputTokens) => {
  const promptTokens = Math.ceil(Number(promptChars || 0) / 3);
  if (process.env.TASTEMAKE_AI_PRICE_IN || process.env.TASTEMAKE_AI_PRICE_OUT) return priceFor(model, Math.ceil(promptTokens * 1.25), maxOutputTokens);
  return estimateCostUsd({ model, inputTokens: 0, outputTokens: maxOutputTokens, cacheWriteTokens: promptTokens, perCall: true }) ?? Infinity;
};
