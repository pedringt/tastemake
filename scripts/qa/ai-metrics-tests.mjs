#!/usr/bin/env node
import assert from "node:assert/strict";
import { aggregateAiMetrics, estimateCostUsd, PRICING_AS_OF, recordAiCall } from "../../src/server/ai-metrics.mjs";

assert.equal(
  estimateCostUsd({ model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
  6.1
);
assert.equal(estimateCostUsd({ model: "claude-unknown", inputTokens: 1, outputTokens: 1 }), null);

const statements=[];
const fakeRows=[];
const query=async (text,params=[])=>{
  statements.push({text,params});
  if (/insert into ai_call_metrics/i.test(text)) {
    fakeRows.push(params);
    return [];
  }
  if (/select\s+count\(\*\)/i.test(text)) {
    return [{
      sample_count:2,p50_ms:1500,p95_ms:1950,input_tokens:300,output_tokens:80,
      cache_read_tokens:20,estimated_cost_usd:0.00072,last_call_at:"2026-09-28T12:00:00Z"
    }];
  }
  return [];
};

assert.equal(await recordAiCall({
  model:"claude-haiku-4-5-20251001",durationMs:1234,inputTokens:100,outputTokens:20,cacheReadTokens:10
},{query}),true);
assert.equal(fakeRows.length,1);
assert.equal(fakeRows[0][0],"claude-haiku-4-5-20251001");
assert.equal(fakeRows[0][1],1234);
assert.equal(fakeRows[0][6],PRICING_AS_OF);

const aggregate=await aggregateAiMetrics({query,days:30});
assert.equal(aggregate.sample_count,2);
assert.equal(aggregate.latency_ms.p50,1500);
assert.equal(aggregate.latency_ms.p95,1950);
assert.equal(aggregate.estimated_cost_usd,0.00072);
assert.equal(aggregate.privacy.content_included,false);
assert.equal(JSON.stringify(statements).includes("prompt"),false);

console.log("AI metrics tests passed");
