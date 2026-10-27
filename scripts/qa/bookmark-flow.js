// Browser flow for the seed-free product. Network calls are deterministic local stubs;
// product code still exercises the real search/recommendation/profile async paths.

export async function run() {
  const { state } = await import("/src/state.js");
  const results=[];
  const check=(name,ok,detail="")=>results.push({name,ok:Boolean(ok),detail:String(detail)});
  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  // Oct 27: waits for a condition instead of a fixed time. The why popover hides with a .12s visibility
  // transition, and a fixed 120 ms wait raced it under load (computed visibility stays "visible" until the
  // transition ends). Returns as soon as the condition holds, or after `ms` with the last result.
  const until=async (fn,ms=1000)=>{const end=Date.now()+ms; while(!fn()&&Date.now()<end) await sleep(20); return fn();};
  const $=(s)=>document.querySelector(s);
  const $$=(s)=>[...document.querySelectorAll(s)];
  const act=async(s,wait=120)=>{const el=$(s);if(!el) throw new Error(`missing ${s}`);el.focus();el.click();await sleep(wait);};
  const type=async(s,value,wait=420)=>{const el=$(s);if(!el) throw new Error(`missing ${s}`);el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));await sleep(wait);};

  const favs=[
    {id:"tmdb-movie-501",provider:"tmdb",providerId:"501",title:"Moon Garden",type:"movie",domains:["movies"],about:"A strange but structured film.",artwork:null},
    {id:"openlibrary-book-502",provider:"openlibrary",providerId:"502",title:"Glass City",type:"book",domains:["read"],about:"A literary speculative novel.",artwork:null},
    {id:"igdb-game-503",provider:"igdb",providerId:"503",title:"Signal Room",type:"game",domains:["play"],about:"A deduction game.",artwork:null},
    {id:"tmdb-tv-504",provider:"tmdb",providerId:"504",title:"Night Shift",type:"tv",domains:["tv"],about:"A dark comedy series.",artwork:null}
  ];
  const mixed=[
    {id:"tmdb-movie-601",provider:"tmdb",providerId:"601",title:"Test Movie",type:"movie",domains:["movies"],about:"Movie.",artwork:null},
    {id:"openlibrary-book-602",provider:"openlibrary",providerId:"602",title:"Test Book",type:"book",domains:["read"],about:"Book.",artwork:null},
    {id:"igdb-game-603",provider:"igdb",providerId:"603",title:"Test Game",type:"game",domains:["play"],about:"Game.",artwork:null},
    {id:"tmdb-tv-604",provider:"tmdb",providerId:"604",title:"Test Show",type:"tv",domains:["tv"],about:"Show.",artwork:null}
  ];
  const recSet=(offset)=>Array.from({length:5},(_,i)=>({
    id:`tmdb-movie-${offset+i}`,provider:"tmdb",providerId:String(offset+i),
    title:`Catalog Pick ${offset+i}`,type:"movie",domains:["movies"],about:`Real catalog recommendation ${i+1}.`,
    artwork:null,genres:i===1?["27"]:[],rank:i===4?null:i+1,fit:i===4?"Exploratory fit":"Catalog match",prediction:"Worth testing",
    surprise:i===4,reason:"Related to a favorite from the real catalog. Live AI did not rank this fallback set.",ai:null
  }));
  let recCalls=0, newReleaseCalls=0;
  // "off": catalog fallback (the default); "paused": the AI budget is used up (#263); "model": live AI answered.
  let aiMode="off";
  // #120: candidate warm-ups (src/ai/prefetch.js) are counted apart from real recommendation requests.
  let warmCalls=0, warmBodies=[];
  // The first real request is held open until the test releases it, so the loading state can be checked.
  let releaseFirst=null;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});

  window.fetch=async(input,init={})=>{
    const url=new URL(String(input),location.href);
    if(url.pathname==="/api/catalog"){
      const q=(url.searchParams.get("q")||"").toLowerCase();
      // Search speed (Oct 24): the book half answers late, the rest at once.
      if(q==="failbooks"){
        const fast=[{id:"tmdb-movie-891",provider:"tmdb",providerId:"891",title:"Failbooks The Movie",type:"movie",domains:["movies"],about:"A film.",artwork:null}];
        return {ok:true,status:200,json:async()=>({items:fast,providers:{tmdb:{configured:true,available:true,error:null},openlibrary:{configured:true,available:false,error:"timeout"}},degraded:false})};
      }
      if(q==="slowbooks"){
        const fast=[{id:"tmdb-movie-881",provider:"tmdb",providerId:"881",title:"Slowbooks The Movie",type:"movie",domains:["movies"],about:"A film.",artwork:null}];
        if(url.searchParams.get("skip")==="read") return {ok:true,status:200,json:async()=>({items:fast,providers:{},degraded:false})};
        await new Promise(r=>setTimeout(r,500));
        return {ok:true,status:200,json:async()=>({items:[...fast,{id:"openlibrary-book-882",provider:"openlibrary",providerId:"882",title:"Slowbooks The Novel",type:"book",domains:["read"],about:"A book.",artwork:null}],providers:{},degraded:false})};
      }
      const domain=url.searchParams.get("domain")||"all";
      let items=q==="test"?mixed:favs.filter(x=>x.title.toLowerCase().includes(q));
      if(domain!=="all") items=items.filter(x=>x.domains.includes(domain));
      return {ok:true,status:200,json:async()=>({items,providers:{qa:{available:true,configured:true,error:null}},degraded:false})};
    }
    if(url.pathname==="/api/recommendations"){
      const body=JSON.parse(init.body||"{}");
      if(body.warm===true){
        warmCalls++; warmBodies.push(body);
        return {ok:true,status:200,json:async()=>({warmed:true,candidates:5,ms:1,meta:{paidCallMade:false}})};
      }
      const call=recCalls++;
      if(call===0) await firstGate;
      const picks=recSet(call ? 710 : 700);
      if(aiMode==="paused") return {ok:true,status:200,json:async()=>({source:"catalog",reason:"AI features are paused for now.",picks,meta:{paidCallMade:false,budgetPaused:true,catalogCandidates:picks.length}})};
      if(aiMode==="model") return {ok:true,status:200,json:async()=>({source:"model",reason:null,picks,meta:{paidCallMade:false,catalogCandidates:picks.length}})};
      return {ok:true,status:200,json:async()=>({source:"catalog",reason:"live AI off in browser QA",picks,meta:{paidCallMade:false,catalogCandidates:picks.length}})};
    }
    if(url.pathname==="/api/new-releases"){
      newReleaseCalls++;
      return {ok:true,status:200,json:async()=>({items:[{id:"tmdb-movie-990",provider:"tmdb",providerId:"990",title:"Signal From Vega",type:"movie",domains:["movies"],about:"Astronomers hear something.",artwork:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1170"><rect width="780" height="1170" fill="#345"/></svg>'),genres:["878"],releaseDate:"2026-10-24",reason:"Shares sci-fi with Moon Garden."}]})};
    }
    if(url.pathname==="/api/hypotheses"){
      if(aiMode==="paused") return {ok:true,status:200,json:async()=>({source:"unavailable",reason:"AI features are paused for now.",hypotheses:[],meta:{budgetPaused:true,paidCallMade:false}})};
      const firstFav=[...state.selectedFavorites][0];
      const experienced=Object.values(state.feedbackByRecommendation).find(f=>f.detail==="loved-before"||f.detail==="liked-before");
      const evidence=[`ev:${firstFav}`,...(experienced?[`ev:${experienced.item.id}`]:[])];
      return {ok:true,status:200,json:async()=>({
        source:"model",reason:null,
        hypotheses:[
          {id:"ai-structured-weirdness",label:"Structure helps unusual ideas land",claim:"Unusual material seems to work better when a clear structure keeps it moving.",evidence,counter:[],domains:["movies"],crossDomain:"untested",level:"supported",conditional:false,context:null,authority:"inferred",source:"model"},
          {id:"ai-dark-playfulness",label:"Darkness works with some playfulness",claim:"Darker material seems stronger when humor or play keeps it from becoming flat.",evidence,counter:[],domains:["movies"],crossDomain:"untested",level:"emerging",conditional:true,context:null,authority:"inferred",source:"model"}
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
  check("All search includes a video game",$$("[data-search-favorite]").some(el=>el.dataset.searchFavorite==="igdb-game-603"),$("#search-view")?.textContent.slice(0,160));
  await act('[data-search-filter="play"]',420);
  check("Play narrows to game results",$$("[data-search-favorite]").length===1&&$("[data-search-favorite]")?.dataset.searchFavorite==="igdb-game-603",$$("[data-search-favorite]").map(x=>x.dataset.searchFavorite).join(","));
  await act('[data-search-filter="all"]',420);

  // Build real favorites through the external search path: one click per result while picking.
  for(const item of favs){
    await type("#search-input",item.title);
    check(`search finds ${item.title}`,Boolean($(`[data-search-favorite="${item.id}"]`)));
    check(`search result for ${item.title} includes artwork slot`,Boolean($(`[data-search-favorite="${item.id}"] .search-artwork`)));
    await act(`[data-search-favorite="${item.id}"]`);
    check(`one click adds ${item.title}`,state.selectedFavorites.has(item.id));
    check(`${item.title} row shows Added and keeps focus`,$(`[data-search-favorite="${item.id}"]`)?.getAttribute("aria-pressed")==="true"&&document.activeElement===$(`[data-search-favorite="${item.id}"]`));
  }
  // A second click on the same row takes it back out; a third puts it back.
  await act(`[data-search-favorite="${favs[3].id}"]`);
  check("second click removes a picked Favorite",!state.selectedFavorites.has(favs[3].id));
  await act(`[data-search-favorite="${favs[3].id}"]`);
  check("third click adds it again",state.selectedFavorites.has(favs[3].id));
  check("four real favorites selected",state.selectedFavorites.size===4,[...state.selectedFavorites].join(","));
  check("selected favorites are persisted provider items",[...state.selectedFavorites].every(id=>state.customItems[id]?.provider));

  // An already-selected favorite stays in the results, marked Added, so the same click can undo it.
  await type("#search-input",favs[0].title);
  check("an already-selected favorite shows as Added",$('[data-search-favorite="tmdb-movie-501"]')?.getAttribute("aria-pressed")==="true",$("#search-view")?.textContent.slice(0,100));
  $("#search-dialog")?.close();
  await sleep(120);

  check("Favorites screen shows exactly four chosen cards",$$(".starter-card").length===4,$$(".starter-card").length);
  check("Recommendations is unlocked",$('[data-step-jump="recommendations"]')?.getAttribute("aria-disabled")==="false");

  // #120: four favorites chosen -> one candidate warm-up, retrieval only, before any real request.
  await sleep(700);
  check("four favorites trigger exactly one candidate warm-up",warmCalls===1,warmCalls);
  check("warm-up is flagged warm and carries the four favorites",warmBodies[0]?.warm===true&&warmBodies[0]?.state?.selectedFavorites?.length===4,JSON.stringify(warmBodies[0]?.state?.selectedFavorites));
  check("warm-up did not count as a recommendation request",recCalls===0,recCalls);

  // First recommendations must call the real-catalog endpoint, not appear from a local seed.
  await act('[data-action="show-recs"]',200);
  check("loading state shows skeleton cards immediately",$$(".editorial-rec-skeleton").length===6,$$(".editorial-rec-skeleton").length);
  check("loading state names the favorites it starts from",/Starting from your favorites: .*Moon Garden/.test($(".loading-basis")?.textContent||""),$(".loading-basis")?.textContent);
  releaseFirst();
  await sleep(300);
  check("first recommendation request happened",recCalls===1,recCalls);
  check("no second warm-up after onboarding",warmCalls===1,warmCalls);
  check("click-to-first-pick is measured",performance.getEntriesByName("tastemake:recommendations:click-to-first-pick").length>=1,performance.getEntriesByName("tastemake:recommendations:click-to-first-pick").length);
  check("first set has five real-catalog QA ids",state.recommendationSets[0]?.length===5&&state.recommendationSets[0].every(x=>x.id.startsWith("tmdb-movie-7")),JSON.stringify(state.recommendationSets[0]?.map(x=>x.id)));
  check("legacy seeded recommendation is absent",!document.body.textContent.includes("Everything Everywhere All at Once"));
  check("five recommendation cards render",$$(".editorial-rec").length===5,$$(".editorial-rec").length);
  check("every recommendation exposes a Favorite star",$$("[data-rec-favorite]").length===5,$$("[data-rec-favorite]").length);

  // Favorite is a one-tap Tried + Loved shortcut and should collapse the large binary controls.
  const favoriteShortcutId=state.recommendationSets[0][1].id;
  await act(`[data-rec-favorite="${favoriteShortcutId}"]`);
  check("Favorite shortcut records Loved",state.feedbackByRecommendation[favoriteShortcutId]?.detail==="loved-before",state.feedbackByRecommendation[favoriteShortcutId]?.detail);
  check("Favorite shortcut sets Favorite flag",state.libraryFavorites.has(favoriteShortcutId));
  check("completed Favorite card shows Change instead of Tried/Not tried buttons",Boolean(`[data-feedback-edit="${favoriteShortcutId}"]`)&&Boolean($(`[data-feedback-edit="${favoriteShortcutId}"]`))&&!$(`[data-feedback-item="${favoriteShortcutId}"][data-experience-path]`));
  await sleep(180);
  check("first experienced reaction primes a Taste Profile in the background",state.modelHypotheses.length>0,state.modelHypotheses.length);

  // #248: touch swipe is a shortcut for the two untried outcomes only; the buttons stay the main path.
  const swipe=async(id,dx)=>{
    const card=$(`[data-rec-id="${id}"] h3`)||$(`[data-rec-id="${id}"]`);
    const r=card.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2;
    card.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:7,pointerType:"touch",clientX:x,clientY:y}));
    card.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:7,pointerType:"touch",clientX:x+dx,clientY:y+4}));
    await sleep(150);
  };
  const [swipeRight,swipeLeft]=state.recommendationSets[0].map(x=>x.id).filter(id=>!state.feedbackByRecommendation[id]).slice(-2);
  await swipe(swipeRight,120);
  check("swipe right saves an untried pick (intent only)",state.feedbackByRecommendation[swipeRight]?.rating==="not-tried"&&state.feedbackByRecommendation[swipeRight]?.detail==="bookmarked",JSON.stringify(state.feedbackByRecommendation[swipeRight]));
  await swipe(swipeLeft,-120);
  check("swipe left marks an untried pick Not interested (intent only)",state.feedbackByRecommendation[swipeLeft]?.detail==="not-interested",JSON.stringify(state.feedbackByRecommendation[swipeLeft]));
  await swipe(favoriteShortcutId,-120);
  check("a swipe never overwrites a tried reaction",state.feedbackByRecommendation[favoriteShortcutId]?.detail==="loved-before",state.feedbackByRecommendation[favoriteShortcutId]?.detail);
  check("Recommendations surfaces the first insight",Boolean($(".first-insight-nudge")));

  // React to one as experienced so profile has more than starter-favorite evidence.
  const firstId=state.recommendationSets[0][0].id;
  await act(`[data-feedback-item="${firstId}"][data-experience-path="tried"]`);
  await act(`[data-feedback-item="${firstId}"][data-experience-outcome="loved"]`);
  check("experienced reaction is recorded",state.feedbackByRecommendation[firstId]?.detail==="loved-before",state.feedbackByRecommendation[firstId]?.detail);

  // Taste Profile may only show model output. No demo hypotheses.
  await act('[data-action="view-model"]',350);
  check("profile requested/generated live hypotheses",state.modelHypotheses.length===2,state.modelHypotheses.length);
  check("profile renders generated cards",$$(".signal-row").length===2,$$(".signal-row").length);
  check("old seeded profile copy is absent",!document.body.textContent.includes("Comedy works better when it has teeth"));
  check("profile describes active patterns without internal validation language",/patterns currently shaping the overview|patterns Tastemake is leaning on most/i.test(document.body.textContent)&&!/validated AI patterns/.test(document.body.textContent));
  check("profile learning panel explains consequences",/What that means:/.test($(".profile-learning")?.textContent||""));

  // User corrections explain their consequence immediately, then remain reversible.
  await act('[data-statement-pattern="ai-structured-weirdness"][data-statement-field="says"][data-statement-value="accurate"]');
  check("confirming a pattern shows what it changes",/What this changes/.test($('[data-profile-pattern="ai-structured-weirdness"]')?.textContent||""));
  await act('[data-statement-pattern="ai-structured-weirdness"][data-statement-field="says"][data-statement-value="not-me"]');
  check("correction stored on generated pattern",state.patternStatements.some(s=>s.hypothesisId==="ai-structured-weirdness"&&s.says==="not-me"));
  check("rejected pattern leaves the active profile list",!$(`[data-profile-pattern="ai-structured-weirdness"].signal-row`));
  check("rejected pattern moves into corrected patterns",Boolean($(`.corrected-patterns [data-profile-pattern="ai-structured-weirdness"]`)));
  check("rejecting a pattern restores focus without throwing", Boolean(document.activeElement?.closest?.('[data-profile-pattern="ai-dark-playfulness"]') || document.activeElement?.closest?.(".corrected-patterns")));

  // Tried becomes a useful memory view, not just a storage bucket.
  await act('[data-step-jump="library"]');
  await act('[data-library-tab="tried"]');
  check("Tried exposes five reaction filters",$$("[data-library-reaction-filter]").length===5,$$("[data-library-reaction-filter]").length);
  await act('[data-library-reaction-filter="favorites"]');
  check("Favorites reaction filter becomes active",$('[data-library-reaction-filter="favorites"]')?.getAttribute("aria-pressed")==="true");
  await act('[data-step-jump="recommendations"]');

  // Keep discovering also stays on the real-catalog endpoint.
  if($('[data-action="keep-discovering"]')) await act('[data-action="keep-discovering"]',300);
  check("Keep discovering makes a second catalog request",recCalls===2,recCalls);
  check("second request never uses a seeded local pool",state.recommendationSets.length===2&&state.recommendationSets.flat().every(x=>/^tmdb-movie-7/.test(x.id)),state.recommendationSets.flat().map(x=>x.id).join(","));

  // #103 (Paige, Oct 12): a returning user who opens /favorites directly lands on their Favorites in
  // the Library, not the first-run "0 of 4" setup step. Back/forward goes through the same path.
  check("this user is onboarded by now",state.onboarded===true);
  history.pushState({}, "", "/favorites");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await sleep(150);
  check("returning /favorites opens the Library",state.screen==="library",state.screen);
  check("on Tried, filtered to Favorites",state.libraryView==="tried"&&state.libraryReactionFilter==="favorites",`${state.libraryView}/${state.libraryReactionFilter}`);
  check("the address no longer reads /favorites",location.pathname.replace(/\/$/,"")!=="/favorites",location.pathname);
  check("no first-run '0 of 4' screen",!/0 of 4/.test(document.body.textContent));

  // After setup, clicking a search result is a lookup; the row's own star adds a Favorite in one click.
  await act("#open-search");
  await type("#search-input","test");
  check("after setup, results open the reaction sheet instead of adding",Boolean($('[data-search-pick="igdb-game-603"]'))&&!$("[data-search-favorite]"));
  check("after setup, each result has a Favorite star",Boolean($('[data-search-row-favorite="igdb-game-603"]')));
  check("the star starts unpressed and nothing was recorded by searching",$('[data-search-row-favorite="igdb-game-603"]')?.getAttribute("aria-pressed")==="false"&&!state.feedbackByRecommendation["igdb-game-603"]);
  await act('[data-search-row-favorite="igdb-game-603"]');
  check("row star adds a Favorite in one click",state.libraryFavorites.has("igdb-game-603"));
  check("row star marks it Tried · Loved",state.feedbackByRecommendation["igdb-game-603"]?.detail==="loved-before");
  check("row star shows pressed and keeps focus",$('[data-search-row-favorite="igdb-game-603"]')?.getAttribute("aria-pressed")==="true"&&document.activeElement===$('[data-search-row-favorite="igdb-game-603"]'));
  // Oct 24: after setup the add action is a labeled button, and stars are drawn shapes, not text characters.
  check("the row's Favorite button says so",/Favorited/.test($('[data-search-row-favorite="igdb-game-603"]')?.textContent||"")&&/Favorite/.test($('[data-search-row-favorite="tmdb-movie-601"]')?.textContent||""));
  check("stars are SVG shapes, never ☆/★ text",Boolean($('[data-search-row-favorite] svg.star-icon'))&&!/[☆★]/.test(document.body.textContent));
  await act('[data-search-pick="tmdb-movie-601"]');
  check("clicking a result row opens its sheet without recording anything",Boolean($("#search-sheet-title"))&&!state.feedbackByRecommendation["tmdb-movie-601"]);
  $("#search-dialog")?.close();
  await sleep(120);

  // Oct 24: an onboarded user who finishes setup lands on their Favorites in Library, never on the empty
  // four-slot first-run screen (their Favorites live in Library after onboarding).
  history.pushState({}, "", "/setup");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await sleep(150);
  state.setupReturn="favorites";
  if($('[data-action="setup-done"]')) await act('[data-action="setup-done"]',200);
  check("finishing setup after onboarding opens Favorites in Library",state.screen==="library"&&state.libraryView==="tried"&&state.libraryReactionFilter==="favorites",`${state.screen}/${state.libraryView}/${state.libraryReactionFilter}`);
  check("not the empty first-run screen",!$(".starter-placeholder")&&!/0 of 4/.test(document.body.textContent));

  // Look picker reflects the two replacement concepts and retained skins.
  document.querySelector("[data-open-look]")?.click();
  await sleep(120);
  const lookText=$(".look-picker")?.textContent||"";
  check("look picker keeps Clean Editorial",/Clean editorial/i.test(lookText));
  check("look picker keeps Bold Graphic",/Bold graphic/i.test(lookText));
  check("Studio Cutouts was replaced",/Soft circuit/i.test(lookText)&&!/Studio cutouts/i.test(lookText));
  check("Night Ledger was replaced",/Electric night/i.test(lookText)&&!/Night ledger/i.test(lookText));

  // Oct 20 smoke test: "More about why" opened upward over the pick's title and reason.
  await act('[data-step-jump="recommendations"]',200);
  const whyCard=$(".editorial-rec");
  if(whyCard){
    await act('.editorial-rec .why-trigger',200);
    const pop=whyCard.querySelector(".why-popover").getBoundingClientRect();
    const covers=[whyCard.querySelector("h3"),whyCard.querySelector(".editorial-rationale")].map(el=>el.getBoundingClientRect()).some(r=>r.bottom>pop.top&&r.top<pop.bottom);
    check("the why popover opens without covering the pick's title or reason",whyCard.querySelector(".editorial-why").classList.contains("is-pinned")&&!covers,`${Math.round(pop.top)}`);
    check("its card is lifted above the next row while it is open",getComputedStyle(whyCard).zIndex==="40",getComputedStyle(whyCard).zIndex);
    await act('.editorial-rec .why-trigger',120);
    // Oct 23 smoke test: the second click unpinned it, but focus (and the pointer) kept it on screen over the reaction buttons.
    const shown=()=>getComputedStyle(whyCard.querySelector(".why-popover")).visibility==="visible";
    await until(()=>!shown());
    check("a second click hides it even though the link still has focus",document.activeElement===whyCard.querySelector(".why-trigger")&&!shown(),getComputedStyle(whyCard.querySelector(".why-popover")).visibility);
    check("a preview that is not pinned never takes clicks",getComputedStyle(whyCard.querySelector(".why-popover")).pointerEvents==="none");
    // Headless pages are not the focused window, so focus events are sent by hand (a real browser sends them).
    const trigger=whyCard.querySelector(".why-trigger");
    trigger.blur(); trigger.dispatchEvent(new FocusEvent("focusout",{bubbles:true,relatedTarget:null})); await sleep(30);
    trigger.focus(); trigger.dispatchEvent(new FocusEvent("focusin",{bubbles:true,relatedTarget:null}));
    const wrap=whyCard.querySelector(".editorial-why");
    await until(()=>wrap.matches(".editorial-why:not(.is-dismissed):focus-within"));
    check("focusing the link again allows the preview",wrap.matches(".editorial-why:not(.is-dismissed):focus-within"),wrap.className);
    state.recommendationFeedbackItemId=null;   // an open feedback panel takes Escape first; this check is about the popover
    document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
    await until(()=>wrap.classList.contains("is-dismissed"));
    check("Escape hides a focused preview and keeps focus on the link",wrap.classList.contains("is-dismissed")&&!wrap.matches(".editorial-why:not(.is-dismissed):focus-within")&&document.activeElement===trigger,wrap.className);
    whyCard.querySelector(".why-trigger").blur();
  } else check("a recommendation card exists for the why popover check",false);

  // Search speed (Oct 24): movies/TV/games show first, books join when they arrive.
  await act("#open-search");
  await type("#search-input","slowbooks",330);
  check("fast results show before books arrive",Boolean($('[data-search-pick="tmdb-movie-881"]'))&&!$('[data-search-pick="openlibrary-book-882"]'),$("#search-view")?.textContent.slice(0,160));
  check("with a note that books are still coming",/Still finding books/.test($("#search-view")?.textContent||""));
  await sleep(600);
  check("books join the list when they arrive",Boolean($('[data-search-pick="openlibrary-book-882"]'))&&Boolean($('[data-search-pick="tmdb-movie-881"]')));
  check("and the note goes away",!/Still finding books/.test($("#search-view")?.textContent||""));
  await type("#search-input","failbooks",500);
  check("when books fail, the other results stay and a note says so",Boolean($('[data-search-pick="tmdb-movie-891"]'))&&/Books are slow to load right now/.test($("#search-view")?.textContent||""),$("#search-view")?.textContent.slice(0,200));
  $("#search-dialog")?.close();
  await sleep(120);

  // #6: New this week for you, under the set; fetched once per visit.
  await act('[data-step-jump="recommendations"]',250);
  {
    // Oct 24: the poster rendered at its full size inside the 56x84 box, showing only a corner.
    const box=$('.new-this-week [data-new-release="tmdb-movie-990"] .new-release-artwork'), img=box?.querySelector("img");
    if(img && !img.complete) await new Promise(r=>{img.onload=r; img.onerror=r; setTimeout(r,500);});
    const b=box?.getBoundingClientRect(), i=img?.getBoundingClientRect();
    check("the release poster fills its box instead of overflowing it",Boolean(img)&&Math.round(i.width)===Math.round(b.width)&&Math.round(i.height)<=Math.round(b.height)+1,img?`${Math.round(i.width)}x${Math.round(i.height)} in ${Math.round(b.width)}x${Math.round(b.height)}`:"no img");
  }
  check("the new-this-week strip shows under the set",Boolean($('.new-this-week [data-new-release="tmdb-movie-990"]'))&&/Shares sci-fi with Moon Garden/.test($(".new-this-week")?.textContent||""),$(".new-this-week")?.textContent?.slice(0,120));
  await act('[data-step-jump="library"]',150);
  await act('[data-step-jump="recommendations"]',200);
  check("it is fetched once per visit, not on every render",newReleaseCalls===1,newReleaseCalls);
  await act('[data-new-release-item="tmdb-movie-990"][data-new-release-action="bookmark"]',150);
  check("Save puts the release in Saved",state.feedbackByRecommendation["tmdb-movie-990"]?.detail==="bookmarked");
  check("and the strip hides once it's empty",!$(".new-this-week"));
  // #48: "Don't recommend…" is a boundary, not a reaction.
  await act('[data-step-jump="recommendations"]',200);
  const horrorCard=[...document.querySelectorAll(".editorial-rec")].find(card=>card.querySelector('[data-exclude-key="horror"]'));
  check("a horror pick offers 'All horror'",Boolean(horrorCard));
  if(horrorCard){
    const horrorId=horrorCard.dataset.recId;
    const before=Object.keys(state.feedbackByRecommendation).length;
    horrorCard.querySelector(".exclude-menu > summary").click();
    await sleep(60);
    await act(`.editorial-rec[data-rec-id="${horrorId}"] [data-exclude-key="horror"]`,200);
    check("the card leaves the set right away",!document.querySelector(`.editorial-rec[data-rec-id="${horrorId}"]`)&&!state.recommendationSets.at(-1).some(x=>x.id===horrorId));
    check("the block is saved",state.exclusions.some(e=>e.id==="genre:horror"));
    check("nothing is recorded about the pick",Object.keys(state.feedbackByRecommendation).length===before&&!state.feedbackByRecommendation[horrorId]);
    check("focus stays on the page, not lost",document.activeElement&&document.activeElement!==document.body);
    document.querySelector("[data-open-mine]")?.click();
    await sleep(250);
    check("My Tastemake shows Horror as blocked",$('[data-mine-never-genre="horror"]')?.checked===true,state.screen);
    const box=$('[data-mine-never-genre="horror"]');
    if(box){ box.click(); await sleep(200); }
    check("unchecking it allows horror again",!state.exclusions.some(e=>e.id==="genre:horror"));
    const input=$("#mine-never-creator");
    if(input){ input.value="Stephen King"; $("[data-mine-never-form]").requestSubmit(); await sleep(200); }
    check("a creator can be added by name",state.exclusions.some(e=>e.id==="creator:stephen king")&&Boolean($('[data-mine-never-remove="creator:stephen king"]')));
    await act('[data-mine-never-remove="creator:stephen king"]',200);
    check("and removed again",!state.exclusions.length);
  }

  // No-AI mode (Oct 20 smoke test): when the AI budget is used up, every surface says so calmly.
  const badge=()=>$(".prototype-label");
  check("header says Live AI before any pause",badge()?.textContent.trim()==="Live AI"&&!badge()?.classList.contains("is-paused"),badge()?.textContent);
  aiMode="paused";
  await act('[data-step-jump="recommendations"]',200);
  await act('[data-action="keep-discovering"]',700);
  check("paused: Recommendations explains the pause",/AI picks are paused/.test($(".ai-paused-notice")?.textContent||"")&&/personal AI budget/.test($(".ai-paused-notice")?.textContent||""),$(".ai-paused-notice")?.textContent);
  check("paused: the notice says the picks are still real catalog matches",/straight from the catalog/.test($(".ai-paused-notice")?.textContent||""));
  check("paused: the generic catalog line is replaced, not repeated",!$(".ai-inline-status"));
  check("paused: header badge reads AI paused",badge()?.textContent.trim()==="AI paused"&&badge()?.classList.contains("is-paused")&&/personal AI budget/.test(badge()?.title||""),badge()?.textContent);
  check("paused: the pause is never saved with the user's data",!/aiPaused/.test(localStorage.getItem("tastemake:test-state:v1")||""));
  state.modelHypotheses=[];
  await act('[data-step-jump="model"]',300);
  if($('[data-action="retry-profile"]')) await act('[data-action="retry-profile"]',400);
  const empty=$(".profile-empty")?.textContent||"";
  check("paused: empty Profile blames the pause, not missing ratings",/waiting on AI/.test(empty)&&!/needs more ratings/.test(empty),empty.trim().slice(0,160));
  check("paused: Profile status line stays short",/AI is paused/.test($(".profile-ai-status")?.textContent||"")&&!/portfolio project/.test($(".profile-ai-status")?.textContent||""),$(".profile-ai-status")?.textContent);
  aiMode="model";
  await act('[data-step-jump="recommendations"]',200);
  await act('[data-action="keep-discovering"]',700);
  check("a live-AI answer clears the pause",badge()?.textContent.trim()==="Live AI"&&!$(".ai-paused-notice"),badge()?.textContent);

  const failed=results.filter(r=>!r.ok);
  return {passed:results.length-failed.length,failed:failed.length,total:results.length,results:failed.length?failed:undefined};
}
