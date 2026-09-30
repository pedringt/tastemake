#!/usr/bin/env node
// Free, no-network tests for the real-catalog recommendation endpoint.

import { readFileSync } from "node:fs";
import handler, { buildPickPrompt, callAnthropic, liveConfig, parseModelJson, produceRecommendations, selectPromptEvidence } from "../../api/recommendations.mjs";

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

// Production regression: a model occasionally omitted the comma between adjacent objects in an
// otherwise-valid JSON array. Recover only that conservative syntax error; do not invent fields.
{
  const repaired = parseModelJson('{"hypotheses":[{"id":"a"} {"id":"b"}],"insufficientEvidence":false}');
  eq("model JSON repair recovers a missing comma between array objects", repaired.hypotheses.length, 2);
  eq("model JSON repair preserves the first object", repaired.hypotheses[0]?.id, "a");
  eq("model JSON repair preserves the second object", repaired.hypotheses[1]?.id, "b");
}

const favorite={
  id:"tmdb-movie-1",provider:"tmdb",providerId:"1",title:"Favorite Film",type:"movie",
  domains:["movies"],about:"A favorite.",artwork:null,providerMeta:{genreIds:[18]}
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
  areas:{movies:true,tv:true,read:true,play:true},curveball:true,
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

// QA pass regression: a successful Anthropic HTTP response is still a paid call even when its text
// cannot be parsed as JSON. Preserve that fact on the thrown error so callers can report cost/usage
// accurately instead of turning a paid malformed response into paidCallMade:false.
{
  const malformedFetch=async()=>({
    ok:true,status:200,json:async()=>({
      content:[{type:"text",text:'{"picks":[{"itemId":"broken"}'}],
      usage:{input_tokens:12,output_tokens:8},model:"claude-test"
    })
  });
  let err=null;
  try { await callAnthropic({prompt:"test",env:ON,fetchImpl:malformedFetch}); } catch (error) { err=error; }
  check("malformed successful Anthropic response is marked as a paid call",err?.paidCallMade===true);
  eq("malformed successful response preserves model for telemetry",err?.model,"claude-test");
  eq("malformed successful response preserves usage for telemetry",err?.usage?.output_tokens,8);
}

// QA pass regression: every client-side router path that is intended to survive a reload/bookmark
// must have a Vercel rewrite, and the static search shell should match the runtime domain registry
// instead of shipping the retired Watch/Read/Play markup before JS initializes.
{
  const vercel=JSON.parse(readFileSync(new URL("../../vercel.json",import.meta.url),"utf8"));
  const rewrites=new Set((vercel.rewrites??[]).map((row)=>row.source));
  for(const route of ["/favorites","/browse","/setup","/recommendations","/taste-profile","/library","/bookmarks","/try-next","/look","/my-tastemake"]){
    check(`Vercel rewrite exists for ${route}`,rewrites.has(route));
  }
  const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
  check("static search shell no longer ships retired Watch filter",!html.includes('data-search-filter="watch"'));
  check("static search shell includes Movies and TV filters",html.includes('data-search-filter="movies"')&&html.includes('data-search-filter="tv"'));
  check("static search shell labels Books and Games as nouns",html.includes('>Books</button>')&&html.includes('>Games</button>'));
}

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
    domains: [i % 2 ? "movies" : "read"],
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
    ref:"ev:intent-only",itemId:"intent-only",title:"Saved only",type:"movie",domains:["movies"],
    kind:"saved",class:"intent",polarity:1,countsAsTaste:false,weight:0,authority:"user",context:null,source:"recommendations"
  });
  const ctx = {
    evidence: manyEvidence,
    candidates: [
      {id:"c1",title:"Candidate 1",type:"movie",domains:["movies"],about:"x",hypotheses:[],provider:"tmdb",providerId:"1",year:2020,genres:["Drama"]},
      {id:"c2",title:"Candidate 2",type:"book",domains:["read"],about:"x",hypotheses:[],provider:"openlibrary",providerId:"OL1W",year:2020,genres:["Fiction"]}
    ],
    curveball:true,statements:[],contexts:[]
  };
  const selected = selectPromptEvidence(ctx);
  check("prompt evidence is bounded", selected.length <= 18, String(selected.length));
  check("prompt evidence excludes intent-only history", selected.every((row) => row.class === "experienced"), selected.map((row) => row.kind).join(","));
  check("prompt evidence keeps represented domains", selected.some((row) => row.domains.includes("movies")) && selected.some((row) => row.domains.includes("read")));
  const prompt = buildPickPrompt(ctx, 2);
  check("prompt omits redundant evidence fields", !prompt.includes('"authority":"user"') && !prompt.includes('"countsAsTaste"') && !prompt.includes('"itemId":"test-'));
  check("prompt excludes saved-only evidence", !prompt.includes("ev:intent-only"));
}

// #120 follow-up: soft domain-spread nudge, "All" filter only (Paige's explicit call: soft nudge,
// not a hard per-domain quota -- real, strongly-evidenced clustering in one domain should still be
// allowed to stand).
{
  const baseCtx = {
    evidence: [], candidates: [{id:"c1",title:"C1",type:"movie",domains:["movies"],about:"x",hypotheses:[],provider:"tmdb",providerId:"1",year:2020,genres:[]}],
    curveball:true, statements:[], contexts:[]
  };
  const allPrompt = buildPickPrompt({ ...baseCtx, recommendationFilter: "all" }, 1);
  const watchPrompt = buildPickPrompt({ ...baseCtx, recommendationFilter: "movies" }, 1);
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
  // Real report (2026-09-28): "after a few rounds I'm getting mostly books now" -- nothing logged
  // what the model actually picked, only the candidate pool it picked from. Sanitized domain counts
  // (never titles/ids) make a real skew visible instead of guessed.
  check("timing logs cover the actual picks' domain mix", stages.includes("picksDomains"), stages.join(","));
  check("picksDomains reports sanitized counts, not titles/ids", timingLines.some((line) => {
    const parsed = JSON.parse(line.split("[tastemake-recommendations-timing]")[1].trim());
    return parsed.stage === "picksDomains" && parsed.domains && typeof parsed.domains === "object"
      && Object.values(parsed.domains).every((count) => typeof count === "number")
      && !line.includes("Amber Harbor") && !line.includes(candidateTitles[0]);
  }));
  check("timing logs never include the API key", [...timingLines, ...relatedLines].every((line) => !line.includes("fake-key") && !line.includes(ON.ANTHROPIC_API_KEY)));
  check("timing logs never include prompt/candidate text", [...timingLines, ...relatedLines].every((line) => !line.includes("Favorite Film") && !line.includes(candidateTitles[0])));
}

// A fully-invalid model response never invents a replacement -- falls back to real catalog picks.
const invalidCases=[
  ["all invented ids",goodPicks().map(p=>({...p,itemId:"made-up"}))],
  ["all missing citations",goodPicks().map(p=>({...p,cites:[]}))],
  ["all bad citations",goodPicks().map(p=>({...p,cites:["ev:nope"]}))],
  ["all circular why",goodPicks().map(p=>({...p,why:"This matches your taste."}))]
];
for(const [name,picks] of invalidCases){
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(picks))});
  check(`${name}: falls back to real catalog`,result.source==="catalog"&&result.picks.every(p=>p.provider==="tmdb"),result.source);
}

// #120/QA-sweep (Paige's explicit call, 2026-09-28): one flawed pick among several good ones no
// longer discards the whole batch -- the valid subset is shown instead of falling back entirely.
const partialCases=[
  ["one invented id",goodPicks().map((p,i)=>i? p:{...p,itemId:"made-up"}),5],
  ["one missing citation",goodPicks().map((p,i)=>i? p:{...p,cites:[]}),5],
  ["one bad citation",goodPicks().map((p,i)=>i? p:{...p,cites:["ev:nope"]}),5],
  ["one circular why",goodPicks().map((p,i)=>i? p:{...p,why:"This matches your taste."}),5],
  // every pick shares the first pick's itemId: only the first occurrence is a real (non-duplicate) pick.
  ["all duplicates of one id",goodPicks().map(p=>({...p,itemId:goodPicks()[0].itemId})),1],
  // the model simply returned fewer picks than offered -- no longer treated as a failure on its own.
  ["fewer picks than requested",goodPicks().slice(0,1),1]
];
for(const [name,picks,expectedCount] of partialCases){
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(picks))});
  check(`${name}: accepted as a partial model result, not a full fallback`,result.source==="model",result.source);
  eq(`${name}: shows exactly the valid picks`,result.picks.length,expectedCount);
  check(`${name}: every shown pick is a real, validated item`,result.picks.every(p=>p.provider==="tmdb"));
}

// QA sweep (2026-09-28) real bug: validatePicks used .every() instead of .some() for the
// intent-evidence check, so a pick citing one real (experienced) item PLUS one intent-only item
// (a bookmark) still passed -- ai-contract.md bans citing intent as support outright, it isn't a
// majority vote. A pick that cites intent evidence at all, even alongside real evidence, must fail.
{
  const bookmarked={id:"tmdb-movie-9",provider:"tmdb",providerId:"9",title:"Bookmarked Film",type:"movie",domains:["movies"]};
  const mixedState=rawState({feedbackByRecommendation:{[bookmarked.id]:{item:bookmarked,rating:"not-tried",detail:"bookmarked"}}});
  const mixedCitationPicks=goodPicks().map((p,i)=>i?p:{...p,cites:[...p.cites,`ev:${bookmarked.id}`]});
  const result=await produceRecommendations({rawState:mixedState,env:ON,fetchImpl:routedFetch(modelSays(mixedCitationPicks))});
  // Partial-accept semantics (Paige's call, 2026-09-28): the one pick citing intent is excluded, but
  // the other 5 valid picks are still shown as a real model result rather than falling back entirely.
  check("the pick citing intent evidence is excluded from the result",!result.picks.some(p=>p.id===mixedCitationPicks[0].itemId));
  eq("the other 5 valid picks are still accepted",result.picks.length,5);
  check("still a real model result, not a full fallback",result.source==="model",result.source);
}
// QA sweep real bug: rank used to be the raw array index + 1, so a curveball landing anywhere but
// last left a gap in the visible rank sequence for the real picks (e.g. 1, null, 3 instead of
// 1, null, 2). The model's picks array order is whatever it returned -- nothing sorts curveballs to
// the end first -- so this puts the curveball at index 1 (not last) to prove the gap is gone.
{
  const midCurveballPicks=goodPicks().map((p,i)=>({...p,kind:i===1?"curveball":"pick"}));
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(midCurveballPicks))});
  eq("mid-array curveball: still a valid model result",result.source,"model");
  const ranks=result.picks.map(p=>p.rank);
  eq("the curveball itself has no rank",ranks[1],null);
  const realRanks=ranks.filter(r=>r!==null);
  check("non-curveball picks have a dense 1..N rank sequence with no gap",realRanks.every((r,i)=>r===i+1),realRanks.join(","));
}
const badText={content:[{type:"text",text:"not json"}]};
out=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(badText)});
eq("non-JSON model output falls back to catalog",out.source,"catalog");

for(const [name,opts] of [["timeout",{abort:true}],["network",{fail:"boom"}],["500",{status:500}]]){
  const result=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:routedFetch(modelSays(goodPicks()),opts)});
  check(`${name}: transport failure keeps real catalog picks`,result.source==="catalog"&&result.picks.length===6,result.source);
}

// QA sweep real bug: buildPickPrompt/validatePicks used to read ctx.candidates directly -- the full
// unsliced eligible pool -- instead of the 6 candidates the product actually offers. With more than 6
// eligible candidates, a model that picked an item outside the first 6 used to pass validation (the
// candidates map was built from the same unsliced pool); it must now be rejected as "not one of the
// eligible candidates" and the request must fall back to catalog picks.
{
  const manyTitles=["Amber Harbor","Glass Orchard","Night Signal","Paper Kingdom","Silent Atlas","Copper Sky","Velvet Transit","Winter Circuit","Crimson Static","Moss Cathedral"];
  const manyRows=Array.from({length:10},(_,i)=>({
    id:201+i,title:manyTitles[i],overview:`Catalog item ${i+1}.`,
    release_date:`202${i%9}-01-01`,poster_path:`/mp${i}.jpg`,genre_ids:[18]
  }));
  const manyFetch=(aiPayload)=>async(url)=>{
    const u=String(url);
    if(u.includes("/movie/1/recommendations")) return {ok:true,status:200,json:async()=>({results:manyRows})};
    if(u.includes("api.anthropic.com")) return {ok:true,status:200,json:async()=>aiPayload};
    throw new Error(`unexpected many-candidates URL ${u}`);
  };
  const seventhItemPick=modelSays([{
    itemId:`tmdb-movie-${manyRows[6].id}`,
    why:"Related to a film you explicitly chose as a favorite; this reaches past the offered set.",
    cites:[`ev:${favorite.id}`],tests:null,kind:"pick"
  }]);
  const outOfOffer=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:manyFetch(seventhItemPick)});
  check("a pick outside the 6 actually offered is rejected, falls back to catalog",outOfOffer.source==="catalog",`${outOfOffer.source}: ${outOfOffer.reason}`);
  check("the fallback never includes the out-of-offer item the model tried to pick",!outOfOffer.picks.some(p=>p.id===`tmdb-movie-${manyRows[6].id}`));

  const firstSixPicks=modelSays(manyRows.slice(0,6).map((row,i)=>({
    itemId:`tmdb-movie-${row.id}`,
    why:`Related to a film you explicitly chose as a favorite; this tests a nearby catalog match ${i+1}.`,
    cites:[`ev:${favorite.id}`],tests:null,kind:i===5?"curveball":"pick"
  })));
  const withinOffer=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:manyFetch(firstSixPicks)});
  eq("a pick within the 6 actually offered still passes",withinOffer.source,"model");
}

// No provider candidates means an honest empty result, never a seed fallback.
const noCandidates=async (url)=>{
  if(String(url).includes("/movie/1/recommendations")) return {ok:true,status:200,json:async()=>({results:[]})};
  throw new Error("AI should not be called without candidates");
};
out=await produceRecommendations({rawState:rawState(),env:ON,fetchImpl:noCandidates});
eq("no real candidates returns zero picks",out.picks.length,0);
eq("no real candidates marks exhausted",out.meta.exhausted,true);

// Real bug (2026-09-29): filtering to a domain with zero evidence in it (e.g. TV, when every real
// reaction is a movie) used to return the exact same generic "no eligible catalog picks remain"
// reason as genuine exhaustion -- no way to tell "you're out of picks" from "you've never rated a
// TV show," so the filter looked permanently broken instead of explaining what to do about it.
const tvFilterState=rawState({recommendationFilter:"tv"});
const tvNoAnchors=async(url)=>{throw new Error(`should not fetch with zero tv anchors: ${url}`);};
const tvOut=await produceRecommendations({rawState:tvFilterState,env:ON,fetchImpl:tvNoAnchors});
eq("filtering to a domain with zero evidence returns zero picks",tvOut.picks.length,0);
check("the reason names the real cause (no evidence in that domain), not a generic dead end",/haven't rated any TV/.test(tvOut.reason||""),tvOut.reason);

// HTTP shell.
const res=()=>{const r={code:null,body:null,headers:{}};r.status=(code)=>{r.code=code;return r;};r.json=(body)=>{r.body=body;return r;};r.setHeader=(k,v)=>{r.headers[k]=v;};return r;};
let rr=res(); await handler({method:"GET",headers:{}},rr); eq("GET refused",rr.code,405);
rr=res(); await handler({method:"POST",headers:{},body:{}},rr); eq("missing state refused",rr.code,400);
rr=res(); await handler({method:"POST",headers:{"content-length":"999999"},body:{}},rr); eq("oversized body refused",rr.code,413);

console.log(`api tests: ${passed} passed, ${failures.length} failed`);
failures.forEach(f=>console.log(`  x ${f}`));
process.exit(failures.length?1:0);
