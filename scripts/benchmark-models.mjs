import { buildContext } from "../src/ai/context.js";
import { validateHypotheses, validatePicks } from "../src/ai/validate.js";
import * as baseline from "../src/ai/baseline.js";
import { buildPickPrompt, parseModelJson } from "../api/recommendations.mjs";
import { FIXTURES } from "./evals/fixtures.mjs";
import { scoreFixture } from "./evals/scorers.mjs";
import { recommendations as qaRecommendations, followUpPool as qaFollowUps } from "./qa/fixtures/catalog.js";

const CANDIDATES=[...qaRecommendations,...qaFollowUps];
const FIXTURE_IDS=["starter-6","about-10","intent-heavy","cross-domain","scale-100"];
const CONFIGS=[
  {key:"sonnet5",label:"Claude Sonnet 5 (current)",model:"claude-sonnet-5",thinking:{type:"disabled"}},
  {key:"sonnet55low",label:"Claude Sonnet 5.5 low effort",model:"claude-sonnet-5-5",thinking:{type:"between_tools"},effort:"low"},
  {key:"haiku45",label:"Claude Haiku 4.5",model:"claude-haiku-4-5",thinking:{type:"disabled"}}
];

if(!process.env.ANTHROPIC_API_KEY){
  console.log("[model-benchmark] missing ANTHROPIC_API_KEY");
  process.exit(1);
}

function normalize(json){
  if(!json||!Array.isArray(json.picks)) return json;
  return {...json,picks:json.picks.map(p=>({...p,tests:p.tests??null,kind:p.kind??(json.curveballItemId&&p.itemId===json.curveballItemId?"curveball":"pick")}))};
}

async function callModel(prompt,config){
  const started=Date.now();
  const response=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body:JSON.stringify({
      model:config.model,
      ...(config.effort?{effort:config.effort}:{}),
      thinking:config.thinking,
      max_tokens:1000,
      system:[{type:"text",text:prompt.includes("\n\nCONTEXT\n")?prompt.split("\n\nCONTEXT\n",1)[0]:prompt,cache_control:{type:"ephemeral"}}],
      messages:[{role:"user",content:prompt.includes("\n\nCONTEXT\n")?`CONTEXT\n${prompt.slice(prompt.indexOf("\n\nCONTEXT\n")+"\n\nCONTEXT\n".length)}`:prompt}]
    })
  });
  const body=await response.json();
  if(!response.ok) throw new Error(`${response.status} ${body?.error?.type??"error"}: ${body?.error?.message??""}`);
  const text=body.content?.find(b=>b.type==="text")?.text;
  if(!text) throw new Error(`no text block; stop_reason=${body.stop_reason??"?"}`);
  return {json:parseModelJson(text),ms:Date.now()-started,usage:body.usage??{}};
}

for(const config of CONFIGS){
  const rows=[];
  for(const id of FIXTURE_IDS){
    const fixture=FIXTURES.find(f=>f.id===id);
    const state=fixture.build();
    const ctx=buildContext(state,CANDIDATES);
    const count=Math.min(5,ctx.candidates.length);
    if(!count) continue;
    const promptCtx={...ctx,candidates:ctx.candidates.slice(0,count)};
    const hyp=validateHypotheses(baseline.inferHypotheses(state),ctx);
    try{
      const result=await callModel(buildPickPrompt(promptCtx,count),config);
      const picks=validatePicks(normalize(result.json),promptCtx);
      const scores=scoreFixture(fixture,{ctx:promptCtx,hyp,picks,before:null});
      rows.push({
        fixture:id,ms:result.ms,
        inputTokens:result.usage?.input_tokens??null,
        outputTokens:result.usage?.output_tokens??null,
        cacheReadTokens:result.usage?.cache_read_input_tokens??null,
        accepted:picks.accepted.length,rejected:picks.rejected.length,
        ruleFailures:scores.filter(s=>s.kind==="rule"&&s.pass===false).map(s=>s.name),
        qualityFindings:scores.filter(s=>s.kind==="quality"&&s.pass===false).map(s=>s.name)
      });
    }catch(error){rows.push({fixture:id,error:String(error?.message??error)});}
  }
  const ok=rows.filter(r=>!r.error);
  const mean=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
  const sorted=ok.map(r=>r.ms).sort((a,b)=>a-b);
  const summary={
    config:config.key,label:config.label,model:config.model,
    successful:ok.length,failed:rows.length-ok.length,
    meanMs:mean(ok.map(r=>r.ms)),
    p50Ms:sorted.length?sorted[Math.floor((sorted.length-1)*.5)]:null,
    meanInputTokens:mean(ok.map(r=>r.inputTokens??0)),
    meanOutputTokens:mean(ok.map(r=>r.outputTokens??0)),
    totalAccepted:ok.reduce((s,r)=>s+r.accepted,0),
    totalRejected:ok.reduce((s,r)=>s+r.rejected,0),
    totalRuleFailures:ok.reduce((s,r)=>s+r.ruleFailures.length,0),
    totalQualityFindings:ok.reduce((s,r)=>s+r.qualityFindings.length,0)
  };
  console.log("[model-benchmark-summary] "+JSON.stringify(summary));
  for(const row of rows) console.log("[model-benchmark-row] "+JSON.stringify({config:config.key,...row}));
}
