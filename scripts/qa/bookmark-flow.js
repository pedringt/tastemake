// Browser flow for the seed-free product. Network calls are deterministic local stubs;
// product code still exercises the real search/recommendation/profile async paths.

export async function run() {
  const { state } = await import("/src/state.js");
  const results=[];
  const check=(name,ok,detail="")=>results.push({name,ok:Boolean(ok),detail:String(detail)});
  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const $=(s)=>document.querySelector(s);
  const $$=(s)=>[...document.querySelectorAll(s)];
  const act=async(s,wait=120)=>{const el=$(s);if(!el) throw new Error(`missing ${s}`);el.focus();el.click();await sleep(wait);};
  const type=async(s,value,wait=420)=>{const el=$(s);if(!el) throw new Error(`missing ${s}`);el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));await sleep(wait);};

  const favs=[
    {id:"tmdb-movie-501",provider:"tmdb",providerId:"501",title:"Moon Garden",type:"movie",domains:["watch"],about:"A strange but structured film.",artwork:null},
    {id:"openlibrary-book-502",provider:"openlibrary",providerId:"502",title:"Glass City",type:"book",domains:["read"],about:"A literary speculative novel.",artwork:null},
    {id:"igdb-game-503",provider:"igdb",providerId:"503",title:"Signal Room",type:"game",domains:["play"],about:"A deduction game.",artwork:null},
    {id:"tmdb-tv-504",provider:"tmdb",providerId:"504",title:"Night Shift",type:"tv",domains:["watch"],about:"A dark comedy series.",artwork:null}
  ];
  const mixed=[
    {id:"tmdb-movie-601",provider:"tmdb",providerId:"601",title:"Test Movie",type:"movie",domains:["watch"],about:"Movie.",artwork:null},
    {id:"openlibrary-book-602",provider:"openlibrary",providerId:"602",title:"Test Book",type:"book",domains:["read"],about:"Book.",artwork:null},
    {id:"igdb-game-603",provider:"igdb",providerId:"603",title:"Test Game",type:"game",domains:["play"],about:"Game.",artwork:null},
    {id:"tmdb-tv-604",provider:"tmdb",providerId:"604",title:"Test Show",type:"tv",domains:["watch"],about:"Show.",artwork:null}
  ];
  const recSet=(offset)=>Array.from({length:5},(_,i)=>({
    id:`tmdb-movie-${offset+i}`,provider:"tmdb",providerId:String(offset+i),
    title:`Catalog Pick ${offset+i}`,type:"movie",domains:["watch"],about:`Real catalog recommendation ${i+1}.`,
    artwork:null,rank:i===4?null:i+1,fit:i===4?"Exploratory fit":"Catalog match",prediction:"Worth testing",
    surprise:i===4,reason:"Related to a favorite from the real catalog. Live AI did not rank this fallback set.",ai:null
  }));
  let recCalls=0;

  window.fetch=async(input)=>{
    const url=new URL(String(input),location.href);
    if(url.pathname==="/api/catalog"){
      const q=(url.searchParams.get("q")||"").toLowerCase();
      const domain=url.searchParams.get("domain")||"all";
      let items=q==="test"?mixed:favs.filter(x=>x.title.toLowerCase().includes(q));
      if(domain!=="all") items=items.filter(x=>x.domains.includes(domain));
      return {ok:true,status:200,json:async()=>({items,providers:{qa:{available:true,configured:true,error:null}},degraded:false})};
    }
    if(url.pathname==="/api/recommendations"){
      const picks=recSet(recCalls++ ? 710 : 700);
      return {ok:true,status:200,json:async()=>({source:"catalog",reason:"live AI off in browser QA",picks,meta:{paidCallMade:false,catalogCandidates:picks.length}})};
    }
    if(url.pathname==="/api/hypotheses"){
      const firstFav=[...state.selectedFavorites][0];
      const experienced=Object.values(state.feedbackByRecommendation).find(f=>f.detail==="loved-before"||f.detail==="liked-before");
      const evidence=[`ev:${firstFav}`,...(experienced?[`ev:${experienced.item.id}`]:[])];
      return {ok:true,status:200,json:async()=>({
        source:"model",reason:null,
        hypotheses:[
          {id:"ai-structured-weirdness",label:"Structure helps unusual ideas land",claim:"Unusual material seems to work better when a clear structure keeps it moving.",evidence,counter:[],domains:["watch"],crossDomain:"untested",level:"supported",conditional:false,context:null,authority:"inferred",source:"model"},
          {id:"ai-dark-playfulness",label:"Darkness works with some playfulness",claim:"Darker material seems stronger when humor or play keeps it from becoming flat.",evidence,counter:[],domains:["watch"],crossDomain:"untested",level:"emerging",conditional:true,context:null,authority:"inferred",source:"model"}
        ],
        meta:{paidCallMade:false}
      })};
    }
    throw new Error(`unexpected QA fetch ${url.pathname}`);
  };

  // Force a known configuration, then ask the app to re-render Favorites through normal navigation.
  state.displayName="QA";
  state.setupComplete=true;
  state.setupAreas=new Set(["all"]);
  state.screen="favorites";
  await act('[data-step-jump="favorites"]');

  check("fresh Favorites has four empty slots",$$(".starter-placeholder").length===4,$$(".starter-placeholder").length);
  check("no favorites are preseeded",state.selectedFavorites.size===0,state.selectedFavorites.size);

  // Search All must include Play before the Play filter is selected.
  await act("#open-search");
  await type("#search-input","test");
  check("All search includes a video game",$$("[data-search-pick]").some(el=>el.dataset.searchPick==="igdb-game-603"),$("#search-view")?.textContent.slice(0,160));
  await act('[data-search-filter="play"]',420);
  check("Play narrows to game results",$$("[data-search-pick]").length===1&&$("[data-search-pick]")?.dataset.searchPick==="igdb-game-603",$$("[data-search-pick]").map(x=>x.dataset.searchPick).join(","));
  await act('[data-search-filter="all"]',420);

  // Build real favorites through the external search path.
  for(const item of favs){
    await type("#search-input",item.title);
    check(`search finds ${item.title}`,Boolean(`[data-search-pick="${item.id}"]`)&&Boolean($(`[data-search-pick="${item.id}"]`)));
    await act(`[data-search-pick="${item.id}"]`);
    await act('[data-search-starter="add"]');
  }
  check("four real favorites selected",state.selectedFavorites.size===4,[...state.selectedFavorites].join(","));
  check("selected favorites are persisted provider items",[...state.selectedFavorites].every(id=>state.customItems[id]?.provider));

  // Already-selected favorite should not repopulate the result list.
  await type("#search-input",favs[0].title);
  check("search omits an already-selected favorite",!$('[data-search-pick="tmdb-movie-501"]'),$("#search-view")?.textContent.slice(0,100));
  $("#search-dialog")?.close();
  await sleep(120);

  check("Favorites screen shows exactly four chosen cards",$$(".starter-card").length===4,$$(".starter-card").length);
  check("Recommendations is unlocked",$('[data-step-jump="recommendations"]')?.getAttribute("aria-disabled")==="false");

  // First recommendations must call the real-catalog endpoint, not appear from a local seed.
  await act('[data-action="show-recs"]',300);
  check("first recommendation request happened",recCalls===1,recCalls);
  check("first set has five real-catalog QA ids",state.recommendationSets[0]?.length===5&&state.recommendationSets[0].every(x=>x.id.startsWith("tmdb-movie-7")),JSON.stringify(state.recommendationSets[0]?.map(x=>x.id)));
  check("legacy seeded recommendation is absent",!document.body.textContent.includes("Everything Everywhere All at Once"));
  check("five recommendation cards render",$$(".editorial-rec").length===5,$$(".editorial-rec").length);

  // React to one as experienced so profile has more than starter-favorite evidence.
  const firstId=state.recommendationSets[0][0].id;
  await act(`[data-feedback-item="${firstId}"][data-rating="more"]`);
  await act(`[data-feedback-item="${firstId}"][data-feedback-detail="loved-before"]`);
  check("experienced reaction is recorded",state.feedbackByRecommendation[firstId]?.detail==="loved-before",state.feedbackByRecommendation[firstId]?.detail);

  // Taste Profile may only show model output. No demo hypotheses.
  await act('[data-action="view-model"]',350);
  check("profile requested/generated live hypotheses",state.modelHypotheses.length===2,state.modelHypotheses.length);
  check("profile renders generated cards",$$(".signal-row").length===2,$$(".signal-row").length);
  check("old seeded profile copy is absent",!document.body.textContent.includes("Comedy works better when it has teeth"));
  check("profile says patterns are validated AI output",/validated AI patterns/.test(document.body.textContent));

  // User corrections still work on a generated pattern.
  await act('[data-statement-pattern="ai-structured-weirdness"][data-statement-field="says"][data-statement-value="not-me"]');
  check("correction stored on generated pattern",state.patternStatements.some(s=>s.hypothesisId==="ai-structured-weirdness"&&s.says==="not-me"));

  // Keep discovering also stays on the real-catalog endpoint.
  if($('[data-action="keep-discovering"]')) await act('[data-action="keep-discovering"]',300);
  check("Keep discovering makes a second catalog request",recCalls===2,recCalls);
  check("second request never uses a seeded local pool",state.recommendationSets.length===2&&state.recommendationSets.flat().every(x=>/^tmdb-movie-7/.test(x.id)),state.recommendationSets.flat().map(x=>x.id).join(","));

  // Look picker reflects the two replacement concepts and retained skins.
  document.querySelector("[data-open-look]")?.click();
  await sleep(120);
  const lookText=$(".look-picker")?.textContent||"";
  check("look picker keeps Clean Editorial",/Clean editorial/i.test(lookText));
  check("look picker keeps Bold Graphic",/Bold graphic/i.test(lookText));
  check("Studio Cutouts was replaced",/Soft circuit/i.test(lookText)&&!/Studio cutouts/i.test(lookText));
  check("Night Ledger was replaced",/Electric night/i.test(lookText)&&!/Night ledger/i.test(lookText));

  const failed=results.filter(r=>!r.ok);
  return {passed:results.length-failed.length,failed:failed.length,total:results.length,results:failed.length?failed:undefined};
}
