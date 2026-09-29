#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  aggregateAiMetrics,
  aiOutcomeForError,
  estimateCostUsd,
  PRICING_AS_OF,
  recordAiCall
} from "../../src/server/ai-metrics.mjs";

assert.equal(
  estimateCostUsd({ model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
  6.1
);
assert.equal(
  estimateCostUsd({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
  12.2
);
assert.equal(estimateCostUsd({ model: "claude-unknown", inputTokens: 1, outputTokens: 1 }), null);
assert.equal(PRICING_AS_OF, "2026-09-29");

const timeout=new Error("aborted"); timeout.name="AbortError";
assert.equal(aiOutcomeForError(timeout),"timeout");
const malformed=new Error("bad json"); malformed.anthropicType="malformed-response";
assert.equal(aiOutcomeForError(malformed),"malformed_response");
const provider=new Error("500"); provider.status=500;
assert.equal(aiOutcomeForError(provider),"provider_error");
assert.equal(aiOutcomeForError(new Error("socket")),"transport_error");

// Write path owns schema setup/migration and records feature + outcome.
{
  const statements=[];
  const fakeRows=[];
  const query=async(text,params=[])=>{
    statements.push({text,params});
    if (/insert into ai_call_metrics/i.test(text)) fakeRows.push(params);
    return [];
  };
  assert.equal(await recordAiCall({
    operation:"taste_profile",
    outcome:"validation_fallback",
    model:"claude-sonnet-5",
    durationMs:1234,
    inputTokens:100,
    outputTokens:20,
    cacheReadTokens:10
  },{query}),true);
  assert.equal(fakeRows.length,1);
  assert.equal(fakeRows[0][0],"taste_profile");
  assert.equal(fakeRows[0][1],"validation_fallback");
  assert.equal(fakeRows[0][2],"claude-sonnet-5");
  assert.equal(fakeRows[0][3],1234);
  assert.equal(fakeRows[0][8],PRICING_AS_OF);
  assert.ok(statements.some(({text})=>/alter table ai_call_metrics add column if not exists operation/i.test(text)));
  assert.ok(statements.some(({text})=>/alter table ai_call_metrics add column if not exists outcome/i.test(text)));
}

// Current-schema aggregate: attempts include failures, latency is success-only, cost is reconstructed
// from stored model/token totals so historical rows with null stored cost become useful immediately.
{
  const statements=[];
  const query=async(text,params=[])=>{
    statements.push({text,params});
    if (/information_schema\.columns/i.test(text)) return [{column_name:"operation"},{column_name:"outcome"}];
    if (/group by coalesce\(outcome/i.test(text)) return [
      {outcome:"provider_error",count:1},
      {outcome:"success",count:3},
      {outcome:"timeout",count:1},
      {outcome:"validation_fallback",count:1}
    ];
    if (/group by coalesce\(operation/i.test(text) && /model,/i.test(text)) return [
      {operation:"recommendations",model:"claude-sonnet-5",input_tokens:1000,output_tokens:300,cache_read_tokens:0},
      {operation:"taste_profile",model:"claude-sonnet-5",input_tokens:500,output_tokens:100,cache_read_tokens:0}
    ];
    if (/group by coalesce\(operation/i.test(text)) return [
      {operation:"recommendations",attempts:4,successes:2,fallbacks:1,failures:1,p50_ms:8000,p95_ms:8800,input_tokens:1000,output_tokens:300,cache_read_tokens:0,last_call_at:"2026-09-29T12:00:00Z"},
      {operation:"taste_profile",attempts:2,successes:1,fallbacks:0,failures:1,p50_ms:6000,p95_ms:6000,input_tokens:500,output_tokens:100,cache_read_tokens:0,last_call_at:"2026-09-29T12:05:00Z"}
    ];
    if (/select\s+count\(\*\)::int as attempts/i.test(text)) return [{
      attempts:6,successes:3,fallbacks:1,failures:2,p50_ms:7000,p95_ms:8700,
      input_tokens:1500,output_tokens:400,cache_read_tokens:0,last_call_at:"2026-09-29T12:05:00Z"
    }];
    throw new Error("unexpected aggregate query: "+text);
  };

  const aggregate=await aggregateAiMetrics({query,days:30});
  assert.equal(aggregate.sample_count,6);
  assert.equal(aggregate.attempts,6);
  assert.equal(aggregate.successes,3);
  assert.equal(aggregate.fallbacks,1);
  assert.equal(aggregate.failures,2);
  assert.equal(aggregate.success_rate,0.5);
  assert.equal(aggregate.fallback_rate,0.1667);
  assert.equal(aggregate.latency_ms.p50,7000);
  assert.equal(aggregate.latency_scope,"successful model calls only");
  assert.equal(aggregate.operations.recommendations.attempts,4);
  assert.equal(aggregate.operations.taste_profile.failures,1);
  assert.equal(aggregate.outcomes.timeout,1);
  assert.ok(aggregate.estimated_cost_usd>0);
  assert.equal(aggregate.privacy.content_included,false);
  assert.equal(aggregate.scope,"live model calls for recommendations and taste profile");
  assert.ok(statements.every(({text})=>!/create table|alter table|create index/i.test(text)),"aggregate must stay read-only");
  assert.equal(JSON.stringify(statements).includes("prompt"),false);
}

// Legacy #166 schema: aggregate must stay readable before the first post-deploy write adds the new
// columns. Historical rows are interpreted as recommendations/success without mutating on GET.
{
  const statements=[];
  const query=async(text)=>{
    statements.push(text);
    if (/information_schema\.columns/i.test(text)) return [{column_name:"model"},{column_name:"duration_ms"}];
    if (/group by 'success'/i.test(text)) return [{outcome:"success",count:4}];
    if (/group by 'recommendations', model/i.test(text)) return [
      {operation:"recommendations",model:"claude-sonnet-5",input_tokens:12521,output_tokens:3270,cache_read_tokens:0}
    ];
    if (/group by 'recommendations'/i.test(text)) return [{
      operation:"recommendations",attempts:4,successes:4,fallbacks:0,failures:0,
      p50_ms:8221,p95_ms:8853,input_tokens:12521,output_tokens:3270,cache_read_tokens:0,last_call_at:"2026-09-29T03:06:15Z"
    }];
    if (/select\s+count\(\*\)::int as attempts/i.test(text)) return [{
      attempts:4,successes:4,fallbacks:0,failures:0,p50_ms:8221,p95_ms:8853,
      input_tokens:12521,output_tokens:3270,cache_read_tokens:0,last_call_at:"2026-09-29T03:06:15Z"
    }];
    throw new Error("unexpected legacy query: "+text);
  };
  const aggregate=await aggregateAiMetrics({query});
  assert.equal(aggregate.attempts,4);
  assert.equal(aggregate.operations.recommendations.successes,4);
  assert.ok(aggregate.estimated_cost_usd>0,"Sonnet 5 historical usage should now have an estimated cost");
  assert.ok(statements.every((text)=>!/create table|alter table|create index/i.test(text)),"legacy aggregate must also stay read-only");
}

console.log("AI metrics tests passed");
