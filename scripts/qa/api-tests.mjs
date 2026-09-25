#!/usr/bin/env node
// Free, no-network tests for the real-catalog recommendation endpoint.

import handler, { liveConfig, produceRecommendations } from "../../api/recommendations.mjs";

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
