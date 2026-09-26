// Browser-side rules for the post-seed Tastemake model.
// Uses synthetic objects only. Production catalog/profile data must come from providers/model output.

export async function run() {
  const T = await import("/src/model/taste.js");
  const S = await import("/src/model/search.js");
  const ST = await import("/src/model/starters.js");
  const EV = await import("/src/model/evidence.js");
  const INT = await import("/src/model/interpretations.js");
  const SAY = await import("/src/model/statements.js");
  const B = await import("/src/model/blindspots.js");
  const DOM = await import("/src/data/domains.js");

  const failures=[];
  let total=0;
  const eq=(name,got,want)=>{total+=1;if(got!==want) failures.push(`${name} (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`);};
  const ok=(name,value)=>eq(name,Boolean(value),true);

  const favorite={
    id:"tmdb-movie-1",provider:"tmdb",providerId:"1",title:"Favorite Film",type:"movie",
    domains:["watch"],about:"Favorite",artwork:"https://example.invalid/f.jpg"
  };
  const book={
    id:"openlibrary-book-2",provider:"openlibrary",providerId:"2",title:"Favorite Book",type:"book",
    domains:["read"],about:"Book"
  };
  const pattern={
    id:"ai-structured-weirdness",title:"Structure makes strangeness land",label:"Structure makes strangeness land",
    claim:"Unusual material seems to work better when a clear structure keeps the experience moving.",
    supports:[`ev:${favorite.id}`],counters:[],domains:["watch"],strength:"Supported",status:"supported",
    crossDomain:"untested",provenance:"Live AI interpretation, validated against your experienced evidence."
  };
  const pick={
    id:"tmdb-movie-20",provider:"tmdb",providerId:"20",title:"Candidate",type:"movie",domains:["watch"],
    about:"Candidate",prediction:"Likely to fit",ai:{tests:pattern.id,cites:[`ev:${favorite.id}`],kind:"pick"}
  };
  const base=()=>({
    selectedFavorites:new Set([favorite.id,book.id]),
    feedbackByRecommendation:{},
    recommendationSets:[],
    recommendationExhausted:false,
    libraryFavorites:new Set(),
    customItems:{[favorite.id]:favorite,[book.id]:book},
    blindSpots:{},blindSpotDrafts:{},blindSpotDismissed:new Set(),
    patternStatements:[],modelHypotheses:[pattern],
    areas:{watch:true,read:true,play:true},curveball:true
  });

  // Taste vs intent.
  const fb=(rating,detail=null,item=pick)=>({rating,detail,item});
  eq("plain More is not taste",T.tasteDelta(fb("more")),0);
  eq("Loved it before is taste",T.tasteDelta(fb("more","loved-before")),2);
  eq("Liked it before is taste",T.tasteDelta(fb("more","liked-before")),1.25);
  eq("Tried and disliked is negative taste",T.tasteDelta(fb("less","tried-disliked")),-2);
  eq("bookmark is not taste",T.tasteDelta(fb("not-tried","bookmarked")),0);
  eq("plain More steers",T.recommendationDelta(fb("more")),1);
  eq("not interested steers away",T.recommendationDelta(fb("less","not-interested")),-1.5);
  eq("bookmark lightly steers",T.recommendationDelta(fb("not-tried","bookmarked")),0.35);

  // No production seed inventory.
  const st=base();
  eq("searchableItems contains only persisted real/custom items",S.searchableItems(st).length,2);
  ok("selected real favorite is available through starterItems",ST.starterItems(st).some(x=>x.id===favorite.id));
  eq("fresh recommendation state can be empty",T.activeRecommendations(st).length,0);
  eq("empty recommendations are not falsely complete",T.currentRoundComplete(st),false);
  eq("no hand-written pool means not exhausted until endpoint says so",T.outOfPicks(st),false);
  st.recommendationExhausted=true;
  eq("endpoint exhaustion flag is authoritative",T.outOfPicks(st),true);

  // Search itself does nothing; explicit action persists provider item.
  const lookup=base();
  lookup.customItems={};
  lookup.selectedFavorites=new Set();
  eq("unknown provider result is not present before action",S.searchableItems(lookup).length,0);
  S.applySearchAction(lookup,pick,"bookmark");
  ok("explicit bookmark stores provider item",Boolean(lookup.customItems[pick.id]));
  eq("bookmark remains intent",T.tasteDelta(lookup.feedbackByRecommendation[pick.id]),0);

  // Live profile only.
  eq("interpretations come only from state model hypotheses",INT.hypothesisRecords(st).length,1);
  st.modelHypotheses=[];
  eq("no model hypotheses means no inferred profile records",INT.hypothesisRecords(st).length,0);
  st.modelHypotheses=[pattern];

  // User correction authority.
  const msg=SAY.setStatement(st,pattern.id,"says","not-me");
  ok("user can correct a live pattern",/isn't you/.test(msg));
  eq("correction is stored as user-confirmed",SAY.statementFor(st,pattern.id).authority,"user-confirmed");
  eq("correction to unknown/non-live pattern is refused",SAY.setStatement(st,"seed-H04","says","not-me"),null);
  ok("context can be explicitly marked broad",/usually holds/.test(SAY.setStatement(st,pattern.id,"context","broad")));
  eq("broad context is not confidence-limiting",SAY.contextQualifiedFor(st,pattern.id),false);
  ok("context can be narrowed to some contexts",/only applies in some contexts/.test(SAY.setStatement(st,pattern.id,"context","some")));
  eq("some-context refinement caps confidence",SAY.contextQualifiedFor(st,pattern.id),true);
  ok("context can be left explicitly uncertain",/not sure yet/.test(SAY.setStatement(st,pattern.id,"context","unsure")));
  eq("uncertain context does not claim a narrow scope",SAY.contextQualifiedFor(st,pattern.id),false);

  // Blind spots only attach to live, validated patterns named by a model pick.
  st.feedbackByRecommendation[pick.id]=fb("less","tried-disliked");
  eq("validated model-tested miss can become blind spot",B.isBlindSpotCandidate(st.feedbackByRecommendation[pick.id],st),true);
  eq("pattern resolution comes from live profile",B.patternsFor(pick,st)[0]?.id,pattern.id);
  const ungrounded={...pick,id:"tmdb-movie-21",ai:null,hypotheses:["H04"]};
  st.feedbackByRecommendation[ungrounded.id]=fb("less","tried-disliked",ungrounded);
  eq("legacy seeded tag alone cannot create a blind spot",B.isBlindSpotCandidate(st.feedbackByRecommendation[ungrounded.id],st),false);

  // Domain registry remains product-owned and complete.
  const filters=DOM.domainFilterOptions();
  eq("domain filters are All Watch Read Play",filters.map(x=>x.id).join(","),"all,watch,read,play");

  const failed=failures.length;
  return {passed:total-failed,failed,total,results:failed?failures:undefined};
}
