#!/usr/bin/env node
// Free, no-network tests for the real-catalog recommendation endpoint.

import handler, { buildPickPrompt, liveConfig, produceRecommendations, selectPromptEvidence } from "../../api/recommendations.mjs";

let passed=0;
const failures=[];
const check=(name,ok,detail="")=>{if(ok) passed+=1; else failures.push(`${name}${detail?` (${detail})`:""}`);};
const eq=(name,got,want)=>check(name,got===want,`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const BASE={
  TASTEMAKE_TMDB_TOKEN:"tmdb-test",
  TASTEMAKE_AI_ENABLED:"0",
  TASTEMAKE_AI_MODEL:"claude-test",
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED:"1",
  TASTEMAKE_AI_SPEND_CAP_CONFIRMED:"1",
  VERCEL_ENV:"preview"
};
const ON={...BASE,TASTEMAKE_AI_ENABLED:"1",ANTHROPIC_API_KEY:"fake-key"};

const favorite={
  id:"tmdb-movie-1",provider:"tmdb",providerId:"1",title:"Favorite Film",type:"movie",
  domains:["watch"],about:"A favorite.",artwork:null,providerMeta:{genreIds:[18]}
};
const candidateTitles=["Amber Harbor","Glass Orchard","Night Signal","Paper Kingdom","Silent Atlas","Copper Sky"];
const relatedRows=Array.from({length:6},(_,i)=>({
  id:101+i,title:candidateTitles[i],overview:`Catalog item ${i+1}.`,
  release_date:`202${i}-01-01`,poster_path:`/p${i}.jpg`,genre_ids:[18]
}));
const rawState=(extra={})=>({
  selectedFavorites:[favorite.id],
  feedbackByRecommendation:{},
  recommendationSets:[],
  libraryFavorites:[],
  customItems:{[favorite.id]:favorite},
  blindSpots:{},blindSpotDrafts:{},blindSpotDismissed:[],patternStatements:[],
  areas:{watch:true,read:true,play:true},curveball:true,
  ...extra
});

const modelSays=(picks)=>({
  content:[{type:"text",text:JSON.stringify({picks})}],
  usage:{input_tokens:20,output_tokens:40},model:"claude-test"
});
const goodPicks=()=>relatedRows.slice(0,6).map((row,i)=>({
  itemId:`tmdb-movie-${row.id}`,
  why:`Related to a film you explicitly chose as a favorite; this tests a nearby catalog match ${i+1}.`,
  cites:[`ev:${favorite.id}`],tests:null,kind:i===5?"curveball":"pick"
}));

function routedFetch(aiPayload=modelSays(goodPicks()),opts={}){
  return async (url)=>{
    const u=String(url);
    if(u.includes("/movie/1/recommendations")) return {ok:true,status:200,json:async()=>({results:relatedRows})};
    if(u.includes("api.anthropic.com")){
      if(opts.abort){const e=new Error("aborted");e.name="AbortError";throw e;}
      if(opts.fail) throw new Error(opts.fail);
      if(opts.status && opts.status!==200) return {ok:false,status:opts.status,json:async()=>({error:{type:"test_error",message:"test"}})};
      return {ok:true,status:200,json:async()=>aiPayload};
    }
    throw new Error(`unexpected URL ${u}`);
  };
}

// Gates.
eq("AI gate enabled in non-production when all safeguards are present",liveConfig(ON).enabled,true);
for(const [key,reason] of [["TASTEMAKE_AI_ENABLED","off-switch"],["ANTHROPIC_API_KEY","missing-key"],["TASTEMAKE_AI_MODEL","missing-model"],["TASTEMAKE_AI_RATE_LIMIT_CONFIRMED","rate-limit-not-confirmed"],["TASTEMAKE_AI_SPEND_CAP_CONFIRMED","spend-cap-not-confirmed"]]){
  const env={...ON}; delete env[key];
  const config=liveConfig(env);
  check(`gate closes without ${key}`,!config.enabled&&config.reasons.includes(reason),config.reasons.join(","));
}
check("production needs explicit live approval",!liveConfig({...ON,VERCEL_ENV:"production"}).enabled);
eq("production approval opens the gate",liveConfig({...ON,VERCEL_ENV:"production",TASTEMAKE_AI_PRODUCTION_APPROVED:"1"}).enabled,true);

// Real-catalog fallback, including the first set.
let out=await produceRecommendations({rawState:rawState(),env:BASE,fetchImpl:routedFetch()});
eq("AI off uses real catalog fallback",out.source,"catalog");
eq("catalog fallback has six real provider picks",out.picks.length,6);
check("catalog fallback contains no legacy seed ids",out.picks.every(p=>p.id.startsWith("tmdb-movie-")),out.picks.map(p=>p.id).join(","));
eq("catalog fallback makes no paid call",out.meta.paidCallMade,false);
check("catalog fallback keeps implementation diagnostics out of card reasons",out.picks.every(p=>!/Live AI did not rank/.test(p.reason)));

// Valid live output.
out=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch()});
eq("valid model ranking is used",out.source,"model");
check("model picks keep real provider ids",out.picks.every(p=>p.provider==="tmdb"));
check("model picks carry validated citations",out.picks.every(p=>p.ai?.cites?.includes(`ev:${favorite.id}`)));
eq("model request is reported as paid",out.meta.paidCallMade,true);

// #120: keep full history in product state/validation, but send a bounded, compact, experienced-only
// working set to the ranking model. This is the scaling guard for a Library that can grow indefinitely.
{
  const manyEvidence = Array.from({ length: 40 }, (_, i) => ({
    ref: `ev:test-${i}`,
    itemId: `test-${i}`,
    title: `Evidence ${i}`,
    type: i % 2 ? "movie" : "book",
    domains: [i % 2 ? "watch" : "read"],
    kind: i % 7 === 0 ? "experienced-negative" : i % 5 === 0 ? "experienced-strong-positive" : "experienced-positive",
    class: "experienced",
    polarity: i % 7 === 0 ? -1 : 1,
    countsAsTaste: true,
    weight: i % 7 === 0 ? -2 : 1.25,
    authority: "user",
    context: null,
    source: "recommendations"
  }));
  manyEvidence.push({
    ref:"ev:intent-only",itemId:"intent-only",title:"Saved only",type:"movie",domains:["watch"],
    kind:"saved",class:"intent",polarity:1,countsAsTaste:false,weight:0,authority:"user",context:null,source:"recommendations"
  });
  const ctx = {
    evidence: manyEvidence,
    candidates: [
      {id:"c1",title:"Candidate 1",type:"movie",domains:["watch"],about:"x",hypotheses:[],provider:"tmdb",providerId:"1",year:2020,genres:["Drama"]},
      {id:"c2",title:"Candidate 2",type:"book",domains:["read"],about:"x",hypotheses:[],provider:"openlibrary",providerId:"OL1W",year:2020,genres:["Fiction"]}
    ],
    curveball:true,statements:[],contexts:[]
  };
  const selected = selectPromptEvidence(ctx);
  check("prompt evidence is bounded", selected.length <= 18, String(selected.length));
  check("prompt evidence excludes intent-only history", selected.every((row) => row.class === "experienced"), selected.map((row) => row.kind).join(","));
  check("prompt evidence keeps represented domains", selected.some((row) => row.domains.includes("watch")) && selected.some((row) => row.domains.includes("read")));
  const prompt = buildPickPrompt(ctx, 2);
  check("prompt omits redundant evidence fields", !prompt.includes('"authority":"user"') && !prompt.includes('"countsAsTaste"') && !prompt.includes('"itemId":"test-'));
  check("prompt excludes saved-only evidence", !prompt.includes("ev:intent-only"));
}

// #120 follow-up: soft domain-spread nudge, "All" filter only (Paige's explicit call: soft nudge,
// not a hard per-domain quota -- real, strongly-evidenced clustering in one domain should still be
// allowed to stand).
{
  const baseCtx = {
    evidence: [], candidates: [{id:"c1",title:"C1",type:"movie",domains:["watch"],about:"x",hypotheses:[],provider:"tmdb",providerId:"1",year:2020,genres:[]}],
    curveball:true, statements:[], contexts:[]
  };
  const allPrompt = buildPickPrompt({ ...baseCtx, recommendationFilter: "all" }, 1);
  const watchPrompt = buildPickPrompt({ ...baseCtx, recommendationFilter: "watch" }, 1);
  const defaultPrompt = buildPickPrompt(baseCtx, 1); // recommendationFilter unset -- must default to "all"'s behavior
  check("the domain-spread nudge appears when the filter is All", allPrompt.includes("Prefer a spread across the domains"));
  check("the domain-spread nudge is absent for a single-domain filter (nothing to spread across)", !watchPrompt.includes("Prefer a spread across the domains"));
  check("an unset recommendationFilter defaults to All's behavior", defaultPrompt.includes("Prefer a spread across the domains"));
  check("the nudge is explicitly soft, not a hard quota", allPrompt.includes("do not force in a weaker candidate"));
}

// #129: structured cites stay intact, but an internal evidence id echoed into natural-language why
// must be stripped before the response reaches a card.
{
  const leaked = goodPicks().map((pick, i) => i === 0
    ? { ...pick, why:`Because Favorite Film worked for you **(${pick.cites[0]}).**` }
    : pick);
  const result = await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(leaked))});
  eq("citation leak: valid model output is still usable", result.source, "model");
  check("citation leak: user-facing reason hides internal ref", !result.picks[0].reason.includes("ev:"), result.picks[0].reason);
  check("citation leak: structured cite remains available", result.picks[0].ai?.cites?.includes(`ev:${favorite.id}`));
}

// #120: stage-boundary timing instrumentation must fire for both the retrieval and live-AI
// paths, log server-side only in the sanitized style used elsewhere, and never leak the prompt,
// candidate contents, or the API key into a log line.
{
  const originalInfo = console.info;
  const lines = [];
  console.info = (...args) => { lines.push(args.map(String).join(" ")); };
  try {
    await produceRecommendations({ rawState: rawState(), env: ON, fetchImpl: routedFetch() });
  } finally {
    console.info = originalInfo;
  }
  const timingLines = lines.filter((line) => line.includes("[tastemake-recommendations-timing]"));
  const relatedLines = lines.filter((line) => line.includes("[tastemake-related]"));
  const stages = timingLines.map((line) => JSON.parse(line.split("[tastemake-recommendations-timing]")[1].trim()).stage);
  check("timing logs cover candidate retrieval", stages.includes("candidateRetrieval"), stages.join(","));
  check("timing logs cover the live AI call", stages.includes("liveAiCall"), stages.join(","));
  check("timing logs cover validation", stages.includes("validation"), stages.join(","));
  check("timing logs cover prompt size", stages.includes("promptSize"), stages.join(","));
  // promptSize is a size measurement, not a duration -- it has no "ms" field by design (#120 follow-up:
  // known even if the call that follows it errors/times out before returning any duration).
  const durationLines = timingLines.filter((line) => !line.includes('"stage":"promptSize"'));
  check("every duration-reporting stage has a numeric ms", durationLines.every((line) => typeof JSON.parse(line.split("[tastemake-recommendations-timing]")[1].trim()).ms === "number"));
  check("promptSize reports a numeric character count", timingLines.some((line) => {
    const parsed = JSON.parse(line.split("[tastemake-recommendations-timing]")[1].trim());
    return parsed.stage === "promptSize" && typeof parsed.promptChars === "number";
  }));
  check("promptSize breaks the prompt down without logging content", timingLines.some((line) => {
    const parsed = JSON.parse(line.split("[tastemake-recommendations-timing]")[1].trim());
    if (parsed.stage !== "promptSize") return false;
    const keys = ["fixedChars", "evidenceChars", "candidateChars", "statementsChars", "contextsChars", "controlChars", "framingChars"];
    return keys.every((key) => typeof parsed[key] === "number")
      && parsed.fixedChars + parsed.evidenceChars + parsed.candidateChars + parsed.statementsChars
        + parsed.contextsChars + parsed.controlChars + parsed.framingChars === parsed.promptChars
      && parsed.candidateCount === 6
      && parsed.evidenceCount === 1;
  }));
  check("per-provider related-catalog timing is logged", relatedLines.some((line) => line.includes('"provider":"tmdb"')));
  check("timing logs never include the API key", [...timingLines, ...relatedLines].every((line) => !line.includes("fake-key") && !line.includes(ON.ANTHROPIC_API_KEY)));
  check("timing logs never include prompt/candidate text", [...timingLines, ...relatedLines].every((line) => !line.includes("Favorite Film") && !line.includes(candidateTitles[0])));
}

// Invalid model output never invents a replacement.
const invalidCases=[
  ["invented id",goodPicks().map((p,i)=>i? p:{...p,itemId:"made-up"})],
  ["missing citation",goodPicks().map((p,i)=>i? p:{...p,cites:[]})],
  ["bad citation",goodPicks().map((p,i)=>i? p:{...p,cites:["ev:nope"]})],
  ["circular why",goodPicks().map((p,i)=>i? p:{...p,why:"This matches your taste."})],
  ["duplicate",goodPicks().map(p=>({...p,itemId:goodPicks()[0].itemId}))],
  ["too few",goodPicks().slice(0,1)]
];
for(const [name,picks] of invalidCases){
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(picks))});
  check(`${name}: falls back to real catalog`,result.source==="catalog"&&result.picks.every(p=>p.provider==="tmdb"),result.source);
}
const badText={content:[{type:"text",text:"not json"}]};
out=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(badText)});
eq("non-JSON model output falls back to catalog",out.source,"catalog");

for(const [name,opts] of [["timeout",{abort:true}],["network",{fail:"boom"}],["500",{status:500}]]){
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(goodPicks()),opts)});
  check(`${name}: transport failure keeps real catalog picks`,result.source==="catalog"&&result.picks.length===6,result.source);
}

// No provider candidates means an honest empty result, never a seed fallback.
const noCandidates=async (url)=>{
  if(String(url).includes("/movie/1/recommendations")) return {ok:true,status:200,json:async()=>({results:[]})};
  throw new Error("AI should not be called without candidates");
};
out=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:noCandidates});
eq("no real candidates returns zero picks",out.picks.length,0);
eq("no real candidates marks exhausted",out.meta.exhausted,true);

// HTTP shell.
const res=()=>{const r={code:null,body:null,headers:{}};r.status=(code)=>{r.code=code;return r;};r.json=(body)=>{r.body=body;return r;};r.setHeader=(k,v)=>{r.headers[k]=v;};return r;};
let rr=res(); await handler({method:"GET",headers:{}},rr); eq("GET refused",rr.code,405);
rr=res(); await handler({method:"POST",headers:{},body:{}},rr); eq("missing state refused",rr.code,400);
rr=res(); await handler({method:"POST",headers:{"content-length":"999999"},body:{}},rr); eq("oversized body refused",rr.code,413);

console.log(`api tests: ${passed} passed, ${failures.length} failed`);
failures.forEach(f=>console.log(`  x ${f}`));
process.exit(failures.length?1:0);
