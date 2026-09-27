#!/usr/bin/env node
import { buildContext } from "../../src/ai/context.js";
import { buildPickPrompt, callAnthropic } from "../../api/recommendations.mjs";
import { validatePicks } from "../../src/ai/validate.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(JSON.stringify({ error: "ANTHROPIC_API_KEY secret unavailable" }, null, 2));
  process.exit(2);
}
process.env.TASTEMAKE_AI_MODEL ||= "claude-sonnet-5";

const favorite = {
  id:"openlibrary-book-OL-WOK", provider:"openlibrary", providerId:"OL-WOK",
  title:"The Way of Kings", type:"book", domains:["read"], genres:["Fantasy","Epic fiction","Magic"]
};
const known=[
  ["Circe","book","read","loved-before"],["Piranesi","book","read","liked-before"],
  ["The Song of Achilles","book","read","liked-before"],["The Lies of Locke Lamora","book","read","liked-before"],
  ["The Witch's Heart","book","read","liked-before"],["The Night Circus","book","read","liked-before"],
  ["Six of Crows","book","read","liked-before"],["Gideon the Ninth","book","read","liked-before"],
  ["Ninth House","book","read","liked-before"],["Mexican Gothic","book","read","liked-before"],
  ["The Starless Sea","book","read","tried-disliked"],["The Green Knight","movie","watch","loved-before"],
  ["Pan's Labyrinth","movie","watch","loved-before"],["The Northman","movie","watch","liked-before"],
  ["Control","game","play","loved-before"],["Alan Wake 2","game","play","liked-before"],
  ["Portal 2","game","play","liked-before"],["Outer Wilds","game","play","tried-disliked"]
];
const feedbackByRecommendation={};
for(let i=0;i<58;i++){
  const [title,type,domain,detail]=known[i%known.length];
  const id=`eval-${domain}-${i}`;
  feedbackByRecommendation[id]={
    rating:detail==="tried-disliked"?"less":"more",detail,source:"recommendations",
    item:{id,title:i<known.length?title:`${title} variant ${i}`,type,domains:[domain],custom:true}
  };
}
const state={
  selectedFavorites:new Set([favorite.id]),libraryFavorites:new Set(),feedbackByRecommendation,recommendationSets:[],
  customItems:{[favorite.id]:favorite},blindSpots:{},blindSpotDrafts:{},blindSpotDismissed:new Set(),patternStatements:[],
  areas:{watch:true,read:true,play:true},curveball:true,recommendationFilter:"read",recommendationStyle:"balanced"
};
const candidates=Array.from({length:12},(_,i)=>({
  id:`openlibrary-book-AFTER${i+1}W`,provider:"openlibrary",providerId:`AFTER${i+1}W`,
  title:["The Spear Cuts Through Water","Black Sun","The Jasmine Throne","The Bone Ships","The Unspoken Name","The Priory of the Orange Tree","The Fifth Season","The Grace of Kings","The Blacktongue Thief","The Shadow of the Gods","A Memory Called Empire","The Goblin Emperor"][i],
  type:"book",domains:["read"],about:"An eligible fantasy catalog candidate.",hypotheses:[],year:String(2015+i%9),
  genres:["Fantasy","Epic fiction","Adventure"]
}));
const ctx=buildContext(state,candidates);
const prompt=buildPickPrompt(ctx,6);
const results=[];
for(let run=1;run<=3;run++){
  const started=Date.now();
  const model=await callAnthropic({prompt,env:{...process.env,TASTEMAKE_AI_MODEL:process.env.TASTEMAKE_AI_MODEL}});
  const validated=validatePicks(model.json,ctx);
  results.push({
    run,ms:Date.now()-started,promptChars:prompt.length,inputTokens:model.usage?.input_tokens??null,
    outputTokens:model.usage?.output_tokens??null,accepted:validated.accepted.length,rejected:validated.rejected.length,
    totalEvidence:ctx.evidence.length,promptHasIntent:/\"kind\":\"saved\"/.test(prompt),
    leakedInternalRef:model.json?.picks?.some((p)=>/ev:[\\w-]+/i.test(String(p.why??"")))??false
  });
}
console.log(JSON.stringify({model:process.env.TASTEMAKE_AI_MODEL,results},null,2));
