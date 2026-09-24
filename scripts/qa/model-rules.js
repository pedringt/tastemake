// Browser-side model rules: the evidence, Library and Search rules we decided, checked against the real
// source files (no copies, no build). No dependencies.
//
//   await (await import("/scripts/qa/model-rules.js")).run()
//
// Returns { passed, failed, total, failures }. A clean run has failed === 0.

export async function run() {
  const catalog = await import("/src/data/catalog.js");
  const T = await import("/src/model/taste.js");
  const LIB = await import("/src/model/library.js");
  const S = await import("/src/model/search.js");
  const B = await import("/src/model/blindspots.js");
  const M = await import("/src/model/tastemap.js");
  const MINE = await import("/src/model/mine.js");
  const ST = await import("/src/state.js");
  const DOM = await import("/src/data/domains.js");
  const EV = await import("/src/model/evidence.js");
  const INT = await import("/src/model/interpretations.js");
  const SAY = await import("/src/model/statements.js");
  const { favorites, recommendations, followUpPool, hypotheses } = catalog;
  const NEW = T;
  const TASTE = T;
  const failures = [];
  let total = 0;

  function suite(name, run) {
    const eq = (label, got, want) => {
      total += 1;
      if (got !== want) failures.push(`${name}: ${label} (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`);
    };
    run(eq);
  }

  suite("taste rules", (eq) => {
    const fb = (rating, detail = null) => ({ rating, detail, item: recommendations[0] });

    // taste evidence table (what counts as taste), per the decided rule
    eq("plain more", NEW.tasteDelta(fb("more")), 0);
    eq("more/loved-before", NEW.tasteDelta(fb("more", "loved-before")), 2);
    eq("more/liked-before", NEW.tasteDelta(fb("more", "liked-before")), 1.25);
    eq("removed chip exactly-my-taste is 0", NEW.tasteDelta(fb("more", "exactly-my-taste")), 0);
    eq("removed chip surprising-fit is 0", NEW.tasteDelta(fb("more", "surprising-fit")), 0);
    eq("plain less", NEW.tasteDelta(fb("less")), 0);
    eq("less/wrong-vibe", NEW.tasteDelta(fb("less", "wrong-vibe")), 0);
    eq("less/not-interested", NEW.tasteDelta(fb("less", "not-interested")), 0);
    eq("less/tried-disliked", NEW.tasteDelta(fb("less", "tried-disliked")), -2);
    eq("not-tried", NEW.tasteDelta(fb("not-tried")), 0);
    eq("not-tried/bookmarked", NEW.tasteDelta(fb("not-tried", "bookmarked")), 0);

    // steering is untouched
    eq("steer more", NEW.recommendationDelta(fb("more")), 1);
    eq("steer less", NEW.recommendationDelta(fb("less")), -1);
    eq("steer not-interested", NEW.recommendationDelta(fb("less", "not-interested")), -1.5);
    eq("quality: surprised-me changes nothing", NEW.recommendationQualityDelta({ quality: "surprised-me" }), 0);
    eq("positive experience", NEW.isPositiveExperience(fb("more", "liked-before")) && !NEW.isPositiveExperience(fb("more")) && !NEW.isPositiveExperience(fb("less", "tried-disliked")), true);
    eq("steer bookmark", NEW.recommendationDelta(fb("not-tried", "bookmarked")), 0.35);

    // profile: reacting to every opening pick with plain More/Less leaves EVERY hypothesis unchanged
    const state = { feedbackByRecommendation: {}, recommendationSets: [recommendations] };
    recommendations.forEach((item, i) => { state.feedbackByRecommendation[item.id] = { item, rating: i % 2 ? "less" : "more", detail: null }; });
    const changed = hypotheses.filter((h) => NEW.modelUpdateFor(state, h).note !== null);
    eq("hypotheses changed by plain reactions", changed.length, 0);
    // ...but Loved it before / Tried it and disliked DO move it
    const st2 = { feedbackByRecommendation: {}, recommendationSets: [recommendations] };
    recommendations.forEach((item) => { st2.feedbackByRecommendation[item.id] = { item, rating: "more", detail: "loved-before" }; });
    eq("hypotheses changed by loved-before (expect some)", hypotheses.filter((h) => NEW.modelUpdateFor(st2, h).note !== null).length > 0, true);

    // --- the Taste Profile "lean" (reactions to untried picks), kept separate from taste ---
    const hyp = { id: recommendations[0].hypotheses[0] };
    const item = recommendations.find((r) => r.hypotheses.includes(hyp.id));
    const mk = (n, rating, detail = null) => { const f = {}; for (let i = 0; i < n; i++) f["x" + i] = { rating, detail, item }; return { feedbackByRecommendation: f, recommendationSets: [recommendations] }; };
    eq("plain More leans toward", NEW.untriedReactionLean(mk(1, "more"), hyp).direction, "toward");
    eq("plain Less leans away", NEW.untriedReactionLean(mk(1, "less"), hyp).direction, "away");
    eq("Not interested leans away", NEW.untriedReactionLean(mk(1, "less", "not-interested"), hyp).direction, "away");
    eq("one bookmark is too light to lean", NEW.untriedReactionLean(mk(1, "not-tried", "bookmarked"), hyp).direction, null);
    eq("three bookmarks lean toward", NEW.untriedReactionLean(mk(3, "not-tried", "bookmarked"), hyp).direction, "toward");
    eq("Loved it before is NOT a lean (it is taste)", NEW.untriedReactionLean(mk(1, "more", "loved-before"), hyp).count, 0);
    eq("Tried it and disliked is NOT a lean (it is taste)", NEW.untriedReactionLean(mk(1, "less", "tried-disliked"), hyp).count, 0);
    eq("a lean never moves the taste notes (plain More)", NEW.modelUpdateFor(mk(1, "more"), hyp).note, null);
    eq("unrelated hypothesis: no lean", NEW.untriedReactionLean(mk(2, "more"), { id: "H99" }).direction, null);
  });

  suite("library rules", (eq) => {
    const mkState = () => ({ selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)), feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set() });
    const react = (st, item, rating, detail = null, extra = {}) => { st.feedbackByRecommendation[item.id] = { item, rating, detail, ...extra }; };
    const [a, b, c, d] = recommendations;

    let st = mkState();
    let lib = LIB.libraryItems(st);
    eq("starters are Favorites", lib.favorites.length, 6);
    eq("starters flagged as starter picks", lib.favorites.every((e) => e.source === "starter" && e.isFavorite), true);
    eq("library starts empty", lib.library.length, 0);

    react(st, a, "more", "loved-before");
    react(st, b, "more", "liked-before", { wasBookmarked: true });
    react(st, c, "more");                         // plain More on an untried pick
    react(st, d, "not-tried", "bookmarked");
    lib = LIB.libraryItems(st);
    eq("loved + liked land in the Library", lib.library.map((e) => e.id).join(","), a.id + "," + b.id);
    eq("sources are labeled", lib.library.map((e) => e.source).join(","), "loved,liked");
    eq("bookmark history is carried", lib.library[1].wasBookmarked, true);
    eq("plain More is NOT in the Library", lib.library.some((e) => e.id === c.id), false);
    eq("a bookmark is NOT in the Library", lib.library.some((e) => e.id === d.id), false);

    st.libraryFavorites.add(a.id);
    lib = LIB.libraryItems(st);
    eq("starring a loved pick moves it to Favorites", lib.favorites.some((e) => e.id === a.id && e.isFavorite), true);
    eq("...and out of the Library list", lib.library.some((e) => e.id === a.id), false);

    st.libraryFavorites.add(b.id);                // a Liked (not Loved) pick can never be a Favorite
    lib = LIB.libraryItems(st);
    eq("a Liked pick cannot be a Favorite even if flagged", lib.library.some((e) => e.id === b.id && !e.isFavorite), true);

    st.feedbackByRecommendation[a.id].detail = "liked-before";   // corrected Loved -> Liked while starred
    lib = LIB.libraryItems(st);
    eq("correcting Loved -> Liked drops the star", lib.favorites.some((e) => e.id === a.id), false);

    st.feedbackByRecommendation[a.id] = { item: a, rating: "less", detail: "tried-disliked" };
    lib = LIB.libraryItems(st);
    eq("Tried it and disliked leaves the Library", lib.library.some((e) => e.id === a.id), false);
    eq("...and is kept, correctable, as disliked", LIB.dislikedItems(st).map((e) => e.id).join(","), a.id);

    // starring changes nothing about taste evidence (a decision for later)
    eq("taste: Loved is still +2 regardless of stars", TASTE.tasteDelta({ rating: "more", detail: "loved-before" }), 2);

    st.selectedFavorites.delete("lotr");
    eq("unselecting a starter removes it from Favorites", LIB.libraryItems(st).favorites.some((e) => e.id === "lotr"), false);
  });

  suite("search rules", (eq) => {
    const mk = () => ({ selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)), feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {} });
    const top = (st, q, d = "all") => (S.searchItems(st, q, d)[0] || {}).title;
    let st = mk();

    // ---- finding things ----
    eq("exact title", top(st, "Fargo"), "Fargo");
    eq("case + punctuation", top(st, "  FARGO!! "), "Fargo");
    eq("prefix", top(st, "far"), "Fargo");
    eq("typo (swapped letters)", top(st, "fagro"), "Fargo");
    eq("typo (missing letter)", top(st, "inscrption"), "Inscryption");
    eq("acronym LOTR", top(st, "lotr"), "The Lord of the Rings");
    eq("acronym EEAAO", top(st, "eeaao"), "Everything Everywhere All at Once");
    eq("word order / partial words", top(st, "vampire buffy"), "Buffy the Vampire Slayer");
    eq("domain filter keeps only reads", S.searchItems(st, "circe", "watch").length, 0);
    eq("domain filter finds it in read", top(st, "circe", "read"), "Circe");
    eq("nonsense finds nothing", S.searchItems(st, "zzzzqqq").length, 0);
    eq("empty query finds nothing", S.searchItems(st, "").length, 0);
    eq("never more than 8", S.searchItems(st, "e").length <= 8, true);

    // ---- searching is not evidence ----
    const before = JSON.stringify(st.feedbackByRecommendation) + st.libraryFavorites.size + Object.keys(st.customItems).length;
    S.searchItems(st, "fargo"); S.searchItems(st, "matrix"); S.findExisting(st, "Fargo"); S.itemStatus(st, followUpPool[0]);
    eq("searching / status checks change nothing", JSON.stringify(st.feedbackByRecommendation) + st.libraryFavorites.size + Object.keys(st.customItems).length, before);

    // ---- actions ----
    const fargo = followUpPool.find((i) => i.title === "Fargo");
    eq("Loved message", S.applySearchAction(st, fargo, "loved"), "Fargo: marked Loved it before.");
    eq("Loved is +2 taste evidence", T.tasteDelta(st.feedbackByRecommendation[fargo.id]), 2);
    eq("shows in Library", LIB.libraryItems(st).library.some((e) => e.id === fargo.id), true);
    eq("status says Loved", S.itemStatus(st, fargo).key, "loved");
    eq("star a loved pick", S.applySearchAction(st, fargo, "favorite"), "Fargo added to Favorites.");
    eq("...it is a Favorite", LIB.libraryItems(st).favorites.some((e) => e.id === fargo.id), true);
    S.applySearchAction(st, fargo, "liked");
    eq("Loved -> Liked drops the star", st.libraryFavorites.has(fargo.id), false);
    eq("cannot star a Liked pick", S.applySearchAction(st, fargo, "favorite"), null);
    S.applySearchAction(st, fargo, "disliked");
    eq("Disliked is -2 and leaves Library", T.tasteDelta(st.feedbackByRecommendation[fargo.id]) === -2 && !LIB.libraryItems(st).library.some((e) => e.id === fargo.id), true);
    eq("...and is listed as disliked", LIB.dislikedItems(st).some((e) => e.id === fargo.id), true);
    S.applySearchAction(st, fargo, "bookmark");
    eq("Bookmark: 0 taste evidence", T.tasteDelta(st.feedbackByRecommendation[fargo.id]), 0);
    eq("Bookmark: shows as bookmarked", T.isBookmarked(st.feedbackByRecommendation[fargo.id]), true);
    S.applySearchAction(st, fargo, "loved");
    eq("bookmark then tried remembers it was bookmarked", st.feedbackByRecommendation[fargo.id].wasBookmarked, true);
    S.applySearchAction(st, fargo, "not-interested");
    eq("Not interested: 0 taste evidence", T.tasteDelta(st.feedbackByRecommendation[fargo.id]), 0);
    eq("remove forgets it", S.applySearchAction(st, fargo, "remove"), "Fargo removed from Tastemake.");
    eq("...gone", st.feedbackByRecommendation[fargo.id], undefined);
    eq("starters are managed elsewhere", S.applySearchAction(st, favorites[0], "disliked"), null);

    // ---- adding something that is not in the catalog ----
    const matrix = S.makeCustomItem("  The   Matrix ", "movie");
    eq("custom id", matrix.id, "custom-the-matrix-movie");
    eq("custom domains", matrix.domains.join(","), "watch");
    eq("not stored until acted on", Object.keys(st.customItems).length, 0);
    S.applySearchAction(st, matrix, "loved");
    eq("stored once acted on", Object.keys(st.customItems).join(","), matrix.id);
    eq("now searchable", top(st, "matrix"), "The Matrix");
    eq("custom item in Library with a blurb", LIB.libraryItems(st).library.find((e) => e.id === matrix.id).blurb, "Added by you.");
    eq("custom item has no pattern tags and cannot crash the model", T.modelUpdateFor(st, { id: "H04", strength: "x", status: "y" }).note, null);
    eq("...lean helper is safe too", T.untriedReactionLean(st, { id: "H04" }).direction, null);
    eq("duplicate title is found, not re-added", S.findExisting(st, "the matrix").id, matrix.id);
    eq("catalog duplicate is found", S.findExisting(st, "FARGO").id, fargo.id);
    eq("same title, other medium gets its own id", S.makeCustomItem("The Matrix", "game").id, "custom-the-matrix-game");
    S.applySearchAction(st, matrix, "remove");
    eq("removing a custom item deletes it entirely", Object.keys(st.customItems).length, 0);

    // ---- recommendations respect what search recorded ----
    st = mk();
    const opening = recommendations.map((r) => r.id);
    S.applySearchAction(st, fargo, "loved");
    const next = T.nextRecommendations(st);
    eq("an item already reacted to is never recommended", next.some((r) => r.id === fargo.id), false);
    eq("...but the rest still fill the set", next.length, 5);
    // with NO search reactions the set is unchanged
    const clean = T.nextRecommendations(mk());
    eq("clean state still offers all of the pool it can", clean.length, 5);
  });


  suite("blind spot rules", (eq) => {
    const mk = () => ({
      selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)),
      feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {},
      blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set()
    });
    const disliked = (item) => ({ item, rating: "less", detail: "tried-disliked" });
    const item = recommendations.find((r) => B.patternsFor(r).length >= 2);
    const patterns = B.patternsFor(item);
    const penalized = (st) => patterns.map((p) => T.modelUpdateFor(st, p).note !== null);

    eq("test pick leans on 2+ visible patterns", patterns.length >= 2, true);
    eq("tried + disliked + confident = a blind spot candidate", B.isBlindSpotCandidate(disliked(item)), true);
    eq("an untried 'Not interested' is not (no prediction failed)", B.isBlindSpotCandidate({ item, rating: "less", detail: "not-interested" }), false);
    eq("a liked pick is not", B.isBlindSpotCandidate({ item, rating: "more", detail: "liked-before" }), false);
    const surprise = recommendations.find((r) => r.prediction === "Worth testing");
    eq("a 'Worth testing' pick was never confident, so it is not", B.isBlindSpotCandidate(disliked(surprise)), false);

    let st = mk();
    st.feedbackByRecommendation[item.id] = disliked(item);
    eq("before answering, every pattern it leaned on is counted against", penalized(st).every(Boolean), true);

    B.saveBlindSpot(st, item.id, { broken: [patterns[0].id], reasons: ["tone"] });
    eq("the pattern the user says failed is still counted against", T.modelUpdateFor(st, patterns[0]).note !== null, true);
    eq("patterns the user says held up are no longer counted against", patterns.slice(1).every((p) => T.modelUpdateFor(st, p).note === null), true);
    eq("the blind spot is on record", B.activeBlindSpots(st).length, 1);
    eq("...and names the failed pattern", B.blindSpotsFor(st, patterns[0].id).length, 1);
    eq("...but not the ones that held up", B.blindSpotsFor(st, patterns[1].id).length, 0);
    eq("one blind spot is 'noted once', not recurring", B.isRecurring(st, B.activeBlindSpots(st)[0]), false);

    B.saveBlindSpot(st, item.id, { none: true, reasons: ["other"] });
    eq("'none of these' stops counting every pattern against them", penalized(st).every((p) => p === false), true);

    B.saveBlindSpot(st, item.id, { broken: [patterns[0].id], reasons: ["tone"] });
    st.feedbackByRecommendation[item.id] = { item, rating: "more", detail: "liked-before" };
    eq("if the reaction is corrected (Liked), the blind spot no longer applies", B.blindSpotFor(st, item.id), null);
    st.feedbackByRecommendation[item.id] = disliked(item);
    eq("...and comes back if it is disliked again", Boolean(B.blindSpotFor(st, item.id)), true);
    B.removeBlindSpot(st, item.id);
    eq("removing it restores the original accounting", penalized(st).every(Boolean), true);

    // a second miss that shares a pattern or a specific reason is 'recurring'; vague reasons never count
    st = mk();
    const other = recommendations.find((r) => r.id !== item.id && B.patternsFor(r).some((p) => patterns.some((q) => q.id === p.id)));
    st.feedbackByRecommendation[item.id] = disliked(item);
    B.saveBlindSpot(st, item.id, { broken: [patterns[0].id], reasons: ["not-for-me"] });
    if (other) {
      st.feedbackByRecommendation[other.id] = disliked(other);
      const shared = B.patternsFor(other).find((p) => patterns.some((q) => q.id === p.id));
      B.saveBlindSpot(st, other.id, { broken: [shared.id], reasons: ["not-for-me"] });
      eq("two blind spots that share a pattern are recurring", B.recurringThemes(st).patterns.length >= 1, true);
      eq("'Fine, just not for me' never counts as a recurring reason", B.recurringThemes(st).reasons.length, 0);
    }
    eq("saving a blind spot for a non-candidate does nothing", B.saveBlindSpot(mk(), item.id, { broken: [patterns[0].id] }), null);
  });


  suite("taste map rules", (eq) => {
    const mk = () => ({
      selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)),
      feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {},
      blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set()
    });
    const react = (st, item, rating, detail) => { st.feedbackByRecommendation[item.id] = { item, rating, detail }; };
    const pattern = (id) => hypotheses.find((h) => h.id === id);
    const [eeaao, barry, shadows] = recommendations;   // all lean on comedy-with-teeth (H04)

    // structure: links are coarse and always explained by real picks
    const links = M.patternLinks();
    const key = (l) => [l.a, l.b].sort().join("|");
    eq("links are unique pairs", new Set(links.map(key)).size, links.length);
    eq("every link is explained by at least one shared pick", links.every((l) => l.items.length > 0), true);
    eq("link strength only comes in three steps", links.every((l) => ["weak", "some", "strong"].includes(l.level)), true);
    eq("comedy + moral messiness share many picks: a strong link", links.find((l) => key(l) === "H03|H04")?.level, "strong");
    const layout = M.nodeLayout(5);
    eq("five cards sit inside the map with room to spare", layout.length === 5 && layout.every((n) => n.x > 8 && n.x < 92 && n.y > 8 && n.y < 92), true);
    eq("cards do not share a spot", new Set(layout.map((n) => `${n.x},${n.y}`)).size, 5);

    // confidence looks
    let st = mk();
    eq("with no reactions no pattern looks solid: they are all starting patterns (dashed)", hypotheses.every((h) => M.confidenceOf(st, h).look === "tentative"), true);
    eq("a conditional pattern looks dashed", M.confidenceOf(st, pattern("H01/H07")).look, "tentative");

    // evidence classification (H04)
    react(st, eeaao, "more", "loved-before");
    react(st, barry, "less", "tried-disliked");
    react(st, shadows, "not-tried", "bookmarked");
    let ev = M.patternEvidence(st, pattern("H04"));
    eq("Loved counts as support", ev.supports.length, 1);
    eq("Tried and disliked counts against", ev.against.length, 1);
    eq("a bookmark only steers (not taste)", ev.steers.length, 1);
    eq("nothing is held up yet", ev.heldUp.length, 0);
    eq("one supported + one counted against nets out: 'still learning' (dashed), not shaky", M.confidenceOf(st, pattern("H04")).look, "tentative");
    const onlyDislike = mk();
    react(onlyDislike, barry, "less", "tried-disliked");
    eq("ONE dislike is not enough to weaken a pattern: still learning (dashed)", M.confidenceOf(onlyDislike, pattern("H04")).look, "tentative");
    eq("...and says so", /more than one/.test(T.modelUpdateFor(onlyDislike, pattern("H04")).note), true);
    react(onlyDislike, shadows, "less", "tried-disliked");
    eq("TWO dislikes on the same pattern do weaken it (dotted)", M.confidenceOf(onlyDislike, pattern("H04")).look, "shaky");
    eq("...as 'Less certain'", T.modelUpdateFor(onlyDislike, pattern("H04")).label, "Less certain");
    const twoWithBlindSpot = mk();
    react(twoWithBlindSpot, barry, "less", "tried-disliked");
    react(twoWithBlindSpot, shadows, "less", "tried-disliked");
    B.saveBlindSpot(twoWithBlindSpot, shadows.id, { broken: ["H03"] });
    eq("if a blind spot says the pattern held up for one of them, only one counts against: not weakened", M.confidenceOf(twoWithBlindSpot, pattern("H04")).look, "tentative");
    eq("supported and counted against = a mixed-evidence tension", M.tensions(st).some((t) => t.patternId === "H04" && t.kind === "mixed"), true);

    // a blind spot says which pattern actually failed: the others held up
    B.saveBlindSpot(st, barry.id, { broken: ["H03"], reasons: ["tone"] });
    ev = M.patternEvidence(st, pattern("H04"));
    eq("after a blind spot naming H03, H04 is 'held up', not against", ev.heldUp.length === 1 && ev.against.length === 0, true);
    eq("...so the mixed-evidence tension goes away", M.tensions(st).some((t) => t.patternId === "H04" && t.kind === "mixed"), false);
    eq("...and a blind-spot tension names the pattern that failed", M.tensions(st).some((t) => t.patternId === "H03" && t.kind === "blind-spot"), true);
    eq("a conditional pattern is always listed as a tension", M.tensions(mk()).some((t) => t.patternId === "H01/H07" && t.kind === "conditional"), true);

    // thin areas
    const empty = M.thinAreas(mk());
    eq("with no reactions every pattern is 'no reactions yet'", empty.quietPatterns.length, 5);
    eq("starter favorites count as things you told it: watch 3, read 2, play 2", `${empty.coverage.watch},${empty.coverage.read},${empty.coverage.play}`, "3,2,2");
    eq("read and play are thin at 2", empty.thinDomains.map((d) => d.domain).sort().join(), "play,read");
    eq("reacting to a pick removes its patterns from the quiet list", M.thinAreas(st).quietPatterns.length < 5, true);
    eq("evidenceCount adds up", M.evidenceCount(M.patternEvidence(st, pattern("H04"))), 3);
  });


  // ---- My Tastemake (#8): areas and curveball are settings (not taste); the ledger is derived ----
  suite("my tastemake", (eq) => {
    const mk = () => ({
      selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)),
      feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {},
      blindSpots: {}, blindSpotDrafts: {}, areas: { watch: true, read: true, play: true }, curveball: true
    });
    const ids = (list) => list.map((p) => p.id).join(",");

    // defaults change nothing (the old behavior, exactly)
    const plain = mk(); delete plain.areas; delete plain.curveball;
    eq("with everything on, picks are identical to having no settings at all", ids(T.nextRecommendations(mk())), ids(T.nextRecommendations(plain)));
    eq("...and the default set is four picks plus one curveball", T.nextRecommendations(mk()).filter((p) => p.surprise).length, 1);

    // areas: an item is offered while at least one of its areas is on
    const noWatch = mk(); noWatch.areas.watch = false;
    const offered = T.nextRecommendations(noWatch);
    eq("turning Watch off hides items that are only Watch", offered.every((p) => p.domains.some((d) => d !== "watch")), true);
    const onlyPlay = mk(); onlyPlay.areas = { watch: false, read: false, play: true };
    eq("with only Play on, every pick is a game", T.nextRecommendations(onlyPlay).every((p) => p.domains.includes("play")), true);
    eq("areaOn is true for an item with no areas listed", T.areaOn(noWatch, { id: "x" }), true);
    eq("areas never change what is already reacted to or its evidence", Object.keys(noWatch.feedbackByRecommendation).length, 0);
    const allOff = mk(); allOff.areas = { watch: false, read: false, play: false };
    eq("with every area off nothing is offered", T.nextRecommendations(allOff).length, 0);
    eq("...and it is reported as hidden by areas, not as running out", T.picksHiddenByAreas(allOff), true);
    eq("running out with everything on is not 'hidden by areas'", T.picksHiddenByAreas(mk()), false);

    // curveball
    const noCurve = mk(); noCurve.curveball = false;
    eq("curveball off: no exploratory pick", T.nextRecommendations(noCurve).some((p) => p.surprise), false);
    eq("curveball off: the same five titles, just none marked as the curveball", ids(T.nextRecommendations(noCurve)), ids(T.nextRecommendations(mk())));
    eq("curveball off: still five picks", T.nextRecommendations(noCurve).length, 5);
    eq("curveball off keeps the rank order", T.nextRecommendations(noCurve).map((p) => p.rank).join(), "1,2,3,4,5");

    // the ledger
    const s = mk();
    const item = recommendations[0], other = recommendations[1], third = recommendations[2], custom = S.makeCustomItem("Severance", "tv");
    S.applySearchAction(s, item, "loved"); S.applySearchAction(s, other, "bookmark"); S.applySearchAction(s, third, "not-interested"); S.applySearchAction(s, custom, "liked");
    const told = MINE.toldItems(s);
    eq("starter favorites are listed once each", told.counts.filter((e) => e.starter).length, s.selectedFavorites.size);
    eq("Loved and Liked count as taste", told.counts.filter((e) => !e.starter).map((e) => e.id).sort().join(), [item.id, custom.id].sort().join());
    eq("a bookmark and Not interested only steer", told.steers.map((e) => e.id).sort().join(), [other.id, third.id].sort().join());
    eq("nothing is in both groups", told.counts.filter((e) => told.steers.some((x) => x.id === e.id)).length, 0);
    eq("total is everything told", told.total, told.counts.length + told.steers.length);
    eq("provenance: told through search", told.counts.find((e) => e.id === item.id).source, "Told through search");
    eq("provenance: added by you", told.counts.find((e) => e.id === custom.id).source, "Added by you in search");
    eq("status wording for Try Next", told.steers.find((e) => e.id === other.id).status, "Try Next (haven't tried)");
    const bookmarked = mk(); S.applySearchAction(bookmarked, other, "bookmark"); S.applySearchAction(bookmarked, other, "loved");
    eq("provenance: Try Next, then tried", MINE.toldItems(bookmarked).counts.find((e) => e.id === other.id).source, "Try Next, then tried");
    const listedTwice = mk(); listedTwice.selectedFavorites.add(item.id); S.applySearchAction(listedTwice, item, "loved");
    eq("a starter favorite is never listed twice", [...MINE.toldItems(listedTwice).counts, ...MINE.toldItems(listedTwice).steers].filter((e) => e.id === item.id).length <= 1, true);
    eq("the ledger agrees with the Library", LIB.libraryItems(s).library.map((e) => e.id).sort().join(), told.counts.filter((e) => !e.starter && e.positive).map((e) => e.id).sort().join());

    // removing from here is the same removal search makes, and the ledger follows
    S.applySearchAction(s, item, "remove");
    eq("removing an item takes it off the ledger", MINE.toldItems(s).total, told.total - 1);

    // start over keeps the look and clears everything else
    ST.state.look = "analog"; ST.state.feedbackByRecommendation.x = { rating: "more" }; ST.state.areas.play = false; ST.state.curveball = false;
    ST.state.selectedFavorites.add(favorites[0].id);
    ST.resetState();
    eq("start over clears reactions", Object.keys(ST.state.feedbackByRecommendation).length, 0);
    // #59: a real visitor starts with 0 favorites selected, not a pre-seeded set; Start Over goes back to that.
    eq("start over clears favorites too (no seeded set to restore)", ST.state.selectedFavorites.size, 0);
    eq("start over restores areas and curveball", `${ST.state.areas.play},${ST.state.curveball}`, "true,true");
    eq("start over keeps your look", ST.state.look, "analog");
    ST.state.look = "editorial";
  });


  // ---- Confidence (#26): inferred is not validated. Levels are computed from what the user tried. ----
  suite("confidence levels", (eq) => {
    const mk = () => ({
      selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)),
      feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {},
      blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set()
    });
    const react = (st, item, rating, detail) => { st.feedbackByRecommendation[item.id] = { item, rating, detail }; };
    const h04 = hypotheses.find((h) => h.id === "H04");
    const lvl = (st) => M.patternConfidence(st, h04);
    const items = [...recommendations, ...followUpPool].filter((item) => item.hypotheses.some((id) => id === "H04" || id.split("/").includes("H04")));
    eq("there are enough H04 picks to test with", items.length >= 4, true);
    const [a, b, c, d] = items;

    eq("cold start: every pattern is Emerging, none Strong", hypotheses.every((h) => M.patternConfidence(mk(), h).level === "Emerging"), true);
    eq("cold start says it is a starting pattern that nothing has tested", /starting pattern.*Nothing you've tried/.test(lvl(mk()).provenance), true);
    eq("the authored strength labels no longer decide anything", hypotheses.some((h) => h.strength === "Strong") && M.patternConfidence(mk(), h04).level !== "Strong", true);

    const one = mk(); react(one, a, "more", "liked-before");
    eq("one thing tried and liked: Supported", lvl(one).level, "Supported");
    eq("...and it says how many backed it", /Backed by 1 thing you've tried/.test(lvl(one).provenance), true);
    const two = mk(); react(two, a, "more", "loved-before"); react(two, b, "more", "liked-before");
    eq("two backing it: still Supported, not Strong", lvl(two).level, "Supported");
    const three = mk(); react(three, a, "more", "loved-before"); react(three, b, "more", "liked-before"); react(three, c, "more", "liked-before");
    eq("three backing it: Strong", lvl(three).level, "Strong");
    eq("...with solid look and status 'strong'", `${lvl(three).look},${lvl(three).status}`, "firm,strong");
    const threeOneMiss = mk(); [a, b, c].forEach((x) => react(threeOneMiss, x, "more", "liked-before")); react(threeOneMiss, d, "less", "tried-disliked");
    eq("three backing it and one miss: still Strong (a miss does not undo three)", lvl(threeOneMiss).level, "Strong");
    const e = items[4];
    if (e) {
      const threeTwoMisses = mk(); [a, b, c].forEach((x) => react(threeTwoMisses, x, "more", "liked-before")); react(threeTwoMisses, d, "less", "tried-disliked"); react(threeTwoMisses, e, "less", "tried-disliked");
      eq("three backing it but two misses: only Supported (Strong needs to stay two clear)", lvl(threeTwoMisses).level, "Supported");
    } else eq("(a fifth H04 pick exists to test two misses against three)", false, true);
    const oneMiss = mk(); react(oneMiss, a, "less", "tried-disliked");
    eq("one miss and nothing backing it: Still learning, never weakened", lvl(oneMiss).level, "Still learning");
    const mixed = mk(); react(mixed, a, "more", "liked-before"); react(mixed, b, "less", "tried-disliked");
    eq("one backs it, one counts against: Still learning", lvl(mixed).level, "Still learning");
    const twoMisses = mk(); react(twoMisses, a, "less", "tried-disliked"); react(twoMisses, b, "less", "tried-disliked");
    eq("two misses: Less certain (the existing weakening rule)", lvl(twoMisses).level, "Less certain");

    // things that must NOT move confidence: intent and untried reactions
    const intent = mk(); react(intent, a, "not-tried", "bookmarked"); react(intent, b, "more", null); react(intent, c, "less", "not-interested");
    eq("bookmarks and untried More/Less/Not interested leave it Emerging", lvl(intent).level, "Emerging");
    eq("...and the starter favorites alone never make anything Supported or Strong", hypotheses.every((h) => ["Emerging"].includes(M.patternConfidence(mk(), h).level)), true);

    // a blind spot that says the pattern held up: that miss is not counted against it
    const held = mk(); react(held, a, "less", "tried-disliked"); B.saveBlindSpot(held, a.id, { broken: ["H03"] });
    eq("a miss the user says this pattern survived is not counted against it (back to Emerging)", lvl(held).level, "Emerging");

    // across areas
    const playPick = [...recommendations, ...followUpPool].find((item) => item.domains.includes("play") && !item.domains.includes("watch") && item.hypotheses.some((id) => id === "H04" || id.split("/").includes("H04")));
    const watchPick = items.find((item) => item.domains.includes("watch") && !item.domains.includes("play"));
    if (playPick && watchPick) {
      const spread = mk(); react(spread, watchPick, "more", "liked-before"); react(spread, playPick, "more", "liked-before");
      eq("provenance mentions areas when backing spans more than one", /across 2 areas/.test(M.patternConfidence(spread, h04).provenance), true);
    } else eq("an H04 pick in each of two areas exists to test spread (the catalog changed?)", false, true);

    // every level has a defined look, and the map/profile use the same one
    eq("confidenceOf agrees with patternConfidence", M.confidenceOf(three, h04).label, "Strong");
    eq("modelUpdateFor is untouched (ranking and old wording unchanged)", T.modelUpdateFor(twoMisses, h04).label, "Less certain");
  });


  // ---- Data model (#35): one domain registry; item vs evidence vs interpretation; scope ----
  suite("data model", (eq) => {
    const allItems = [...favorites, ...recommendations, ...followUpPool];
    // registry
    eq("visible domains are still exactly Watch, Read, Play", DOM.visibleDomains().map((d) => d.id).join(), "watch,read,play");
    eq("future domains exist in the registry but are not visible", ["listen", "wear", "home"].every((id) => DOM.domainById(id) && !DOM.domainById(id).visible), true);
    eq("the area toggles come from the registry", T.AREAS.map((a) => a.id).join(), "watch,read,play");
    eq("filter chips come from the registry", catalog.domainFilters.map((f) => f.id).join(), "all,watch,read,play");
    eq("only visible-domain types can be added by hand", Object.keys(S.MEDIA).join(), "movie,tv,book,game");
    eq("new state starts with every visible area on", Object.entries(ST.state.areas).map(([k, v]) => `${k}:${v}`).join(), "watch:true,read:true,play:true");
    // items
    eq("every catalog item has a type", allItems.every((item) => DOM.typeById(item.type)), true);
    eq("no catalog item carries the old overloaded 'medium' field", allItems.some((item) => "medium" in item), false);
    eq("every item's type belongs to one of its domains", allItems.every((item) => item.domains.includes(DOM.typeById(item.type).domain)), true);
    eq("display label: explicit where it differs", DOM.displayLabel(favorites.find((f) => f.id === "lotr")), "Book + film");
    eq("display label: falls back to the type label", DOM.displayLabel({ type: "tv" }), "TV");
    eq("an older item that still has 'medium' still displays", DOM.displayLabel({ medium: "Film" }), "Film");
    const added = S.makeCustomItem("Severance", "tv");
    eq("an added item has a type and domains, and no 'medium'", `${added.type}|${added.domains.join()}|${"medium" in added}`, "tv|watch|false");
    const chair = { id: "chair-1", title: "Aged oak chair", type: "furniture" };
    eq("a future-domain item resolves its domain from its type", DOM.domainsOf(chair).join(), "home");
    eq("...and is never offered while its domain is not visible", T.areaOn({ areas: ST.state.areas }, { ...chair, domains: DOM.domainsOf(chair) }), false);

    // evidence kinds: the old taste weights, exactly, from the new single table
    const oldTaste = (f) => f.rating === "more" ? (f.detail === "loved-before" ? 2 : f.detail === "liked-before" ? 1.25 : 0) : f.rating === "less" ? (f.detail === "tried-disliked" ? -2 : 0) : 0;
    const ratings = ["more", "less", "not-tried", null];
    const details = [null, "loved-before", "liked-before", "tried-disliked", "not-interested", "bookmarked", "too-obvious", "exactly-my-taste", "wrong-vibe"];
    let same = true;
    ratings.forEach((rating) => details.forEach((detail) => { if (T.tasteDelta({ rating, detail }) !== oldTaste({ rating, detail })) same = false; }));
    eq("taste weights are unchanged for every rating x detail combination", same, true);
    eq("every intent kind carries zero taste weight", Object.values(EV.EVIDENCE_KINDS).filter((k) => k.class === "intent").every((k) => k.taste === 0), true);
    eq("Not interested is intent, not a dislike", EV.evidenceKind({ rating: "less", detail: "not-interested" }), "intent-declined");
    eq("plain Less is intent, not a dislike", EV.evidenceKind({ rating: "less", detail: null }), "intent-negative");
    eq("a bookmark is 'saved' (intent)", EV.EVIDENCE_KINDS[EV.evidenceKind({ rating: "not-tried", detail: "bookmarked" })].class, "intent");
    eq("kinds have no media words in them", Object.keys(EV.EVIDENCE_KINDS).some((k) => /tried|watch|read|play|movie|book|game/.test(k)), false);

    // evidence records
    const st = { selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)), feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {}, blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set() };
    const [r0, r1, r2, r3] = recommendations;
    S.applySearchAction(st, r0, "loved"); S.applySearchAction(st, r1, "bookmark"); S.applySearchAction(st, r2, "not-interested"); S.applySearchAction(st, added, "liked");
    const recs = EV.evidenceRecords(st);
    eq("one record per thing told (starters + reactions)", recs.length, st.selectedFavorites.size + 4);
    eq("refs are unique and stable (ev:<itemId>)", new Set(recs.map((r) => r.ref)).size === recs.length && recs.every((r) => r.ref === `ev:${r.itemId}`), true);
    eq("every record's authority is the user", recs.every((r) => r.authority === "user"), true);
    eq("Favorites are experienced strong-positive evidence", recs.filter((r) => r.kind === "starter-favorite").every((r) => r.countsAsTaste && r.weight === 2 && r.polarity === 1), true);
    eq("a bookmark record does not count as taste", recs.find((r) => r.itemId === r1.id).countsAsTaste, false);
    eq("a Loved record counts, with its weight", `${recs.find((r) => r.itemId === r0.id).countsAsTaste}|${recs.find((r) => r.itemId === r0.id).weight}`, "true|2");
    eq("provenance: search / added", `${recs.find((r) => r.itemId === r0.id).source}|${recs.find((r) => r.itemId === added.id).source}`, "search|added");
    eq("records carry domain and type, not 'medium'", recs.every((r) => Array.isArray(r.domains) && "type" in r && !("medium" in r)), true);

    // interpretations are separate from evidence and traceable to it
    const cold = INT.hypothesisRecords({ ...st, feedbackByRecommendation: {} });
    eq("cold start: every hypothesis is inferred, from the starting set, with no evidence refs", cold.every((h) => h.authority === "inferred" && h.source === "starting-set" && h.evidence.length === 0), true);
    eq("cold start: nothing is cross-domain yet", cold.every((h) => h.crossDomain === "untested"), true);
    const hs = INT.hypothesisRecords(st);
    const refs = new Set(recs.map((r) => r.ref));
    eq("every hypothesis's evidence and counter-evidence refs point at real evidence records", hs.every((h) => [...h.evidence, ...h.counter, ...h.heldUp].every((ref) => refs.has(ref))), true);
    eq("hypotheses only cite experienced evidence (never a bookmark or Not interested)", hs.every((h) => [...h.evidence, ...h.counter].every((ref) => recs.find((r) => r.ref === ref).class === "experienced")), true);
    eq("interpretations are never stored as evidence", recs.some((r) => /^H\d/.test(r.itemId)), false);
    eq("confidence in the record matches the Profile", hs.every((h) => h.confidence === M.patternConfidence(st, hypotheses.find((p) => p.id === h.id)).level), true);
    // scope and cross-domain status (synthetic rows, so every status is exercised)
    const row = (domains) => ({ item: { id: Math.random().toString(36), domains } });
    const s1 = INT.domainScope({ supports: [row(["watch"]), row(["watch"])], against: [], heldUp: [] });
    eq("backed in one domain only: cross-domain untested", `${s1.crossDomain}|${s1.scope.supported.join()}`, "untested|watch");
    const s2 = INT.domainScope({ supports: [row(["watch"]), row(["watch"]), row(["play"])], against: [], heldUp: [] });
    eq("backed in two domains, one thinly: tentative", s2.crossDomain, "tentative");
    const s3 = INT.domainScope({ supports: [row(["watch"]), row(["watch"]), row(["play"]), row(["play"])], against: [], heldUp: [] });
    eq("backed twice in each of two domains: supported", s3.crossDomain, "supported");
    const s4 = INT.domainScope({ supports: [row(["watch"])], against: [row(["play"]), row(["play"])], heldUp: [] });
    eq("a domain where it misses more than it lands is 'contradicted', not supported", `${s4.scope.contradicted.join()}|${s4.scope.supported.join()}|${s4.crossDomain}`, "play|watch|untested");
    eq("domains with nothing either way are 'untested'", s4.scope.untested.join(), "read");
  });


  // ---- Pattern corrections: user-confirmed statements outrank inference, but are not taste evidence ----
  suite("pattern corrections", (eq) => {
    const mk = () => ({ selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)), feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {}, blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(), patternStatements: [] });
    const ids = (s) => T.nextRecommendations(s).map((p) => p.id).join();
    const base = mk(); S.applySearchAction(base, recommendations[0], "loved"); S.applySearchAction(base, recommendations[1], "liked");
    const h04 = hypotheses.find((h) => h.id === "H04");
    const before = ids(base);
    const levelBefore = M.patternConfidence(base, h04).level;
    eq("no statements: ranking unchanged", ids({ ...base, patternStatements: [] }), before);
    SAY.setStatement(base, "H04", "says", "accurate");
    eq("'accurate' is recorded as user-confirmed", `${SAY.statementFor(base, "H04").authority}|${INT.hypothesisRecord(base, h04).authority}`, "user-confirmed|user-confirmed");
    eq("'accurate' does not raise the confidence level", M.patternConfidence(base, h04).level, levelBefore);
    eq("'accurate' alone does not change ranking", ids(base), before);
    SAY.setStatement(base, "H04", "says", "not-me");
    eq("'not me' replaces 'accurate' (one fit answer per pattern)", SAY.statementFor(base, "H04").says, "not-me");
    eq("'not me' marks the interpretation excluded, and it is not user-confirmed", `${INT.hypothesisRecord(base, h04).excluded}|${INT.hypothesisRecord(base, h04).authority}`, "true|inferred");
    eq("'not me' changes no evidence and no confidence", `${EV.evidenceRecords(base).length}|${M.patternConfidence(base, h04).level}`, `${EV.evidenceRecords(mk()).length + 2}|${levelBefore}`);
    eq("statements never appear as evidence records", EV.evidenceRecords(base).some((r) => /^H\d/.test(r.itemId)), false);
    SAY.setStatement(base, "H04", "says", "not-me");
    eq("choosing the same answer again clears it", SAY.statementFor(base, "H04"), null);
    eq("...and ranking is back to the original", ids(base), before);
    SAY.setStatement(base, "H04", "weight", "little");
    SAY.setStatement(base, "H04", "weight", "lot");
    eq("weight is its own answer and can change", SAY.statementFor(base, "H04").weight, "lot");
    SAY.clearStatement(base, "H04");
    eq("clearStatement removes it", SAY.activeStatements(base).length, 0);
    const excluded = mk(); S.applySearchAction(excluded, recommendations[0], "loved");
    const withoutStatement = ids(excluded);
    SAY.setStatement(excluded, "H04", "says", "not-me");
    eq("'not me' on a pattern changes what gets ranked when that pattern was steering", ids(excluded) !== withoutStatement || T.nextRecommendations(excluded).length === 0, true);
    eq("an unknown pattern id is ignored", SAY.setStatement(mk(), "H99", "says", "accurate"), null);
    ST.state.patternStatements = [{ hypothesisId: "H04", label: "x", says: "not-me", weight: null, authority: "user-confirmed" }];
    ST.resetState();
    eq("Start over clears statements", ST.state.patternStatements.length, 0);
  });


  // ---- Centralized evidence predicates (#40): the canonical bucket for a reaction, in one place ----
  suite("evidence predicates", (eq) => {
    const item = recommendations[0];
    const fb = (rating, detail) => ({ rating, detail, item });
    const loved = fb("more", "loved-before");
    const liked = fb("more", "liked-before");
    const disliked = fb("less", "tried-disliked");
    const bookmarked = fb("not-tried", "bookmarked");
    const notInterested = fb("less", "not-interested");
    const plainMore = fb("more", null);
    const plainLess = fb("less", null);
    const notTried = fb("not-tried", null);

    // isExperienced / isIntentOnly partition every real reaction
    eq("loved is experienced", EV.isExperienced(loved), true);
    eq("liked is experienced", EV.isExperienced(liked), true);
    eq("disliked is experienced", EV.isExperienced(disliked), true);
    eq("bookmarked is NOT experienced (interest is not experience)", EV.isExperienced(bookmarked), false);
    eq("not-interested is NOT experienced", EV.isExperienced(notInterested), false);
    eq("plain more is NOT experienced", EV.isExperienced(plainMore), false);
    [loved, liked, disliked].forEach((f) => eq(`isIntentOnly is false for ${f.detail}`, EV.isIntentOnly(f), false));
    [bookmarked, notInterested, plainMore, plainLess].forEach((f) => eq(`isIntentOnly is true for rating=${f.rating} detail=${f.detail}`, EV.isIntentOnly(f), true));

    // strong positive vs positive
    eq("loved is strong positive", EV.isStrongPositive(loved), true);
    eq("liked is NOT strong positive", EV.isStrongPositive(liked), false);
    eq("loved counts as experienced-positive too", EV.isExperiencedPositive(loved), true);
    eq("liked counts as experienced-positive", EV.isExperiencedPositive(liked), true);
    eq("disliked is not experienced-positive", EV.isExperiencedPositive(disliked), false);
    eq("plain more (untried) is not experienced-positive", EV.isExperiencedPositive(plainMore), false);

    // negative / saved / declined
    eq("disliked is experienced-negative", EV.isExperiencedNegative(disliked), true);
    eq("plain less (untried) is not experienced-negative", EV.isExperiencedNegative(plainLess), false);
    eq("bookmark is 'saved'", EV.isSaved(bookmarked), true);
    eq("a loved pick is not 'saved'", EV.isSaved(loved), false);
    eq("not-interested is 'declined'", EV.isDeclined(notInterested), true);
    eq("...and declined is NOT experienced-negative (not a dislike)", EV.isExperiencedNegative(notInterested), false);

    // countsAsTaste matches the #27 rule exactly (loved/liked/disliked only)
    eq("counts as taste: loved", EV.countsAsTaste(loved), true);
    eq("counts as taste: liked", EV.countsAsTaste(liked), true);
    eq("counts as taste: disliked", EV.countsAsTaste(disliked), true);
    eq("does NOT count as taste: bookmarked", EV.countsAsTaste(bookmarked), false);
    eq("does NOT count as taste: not-interested", EV.countsAsTaste(notInterested), false);
    eq("does NOT count as taste: plain more", EV.countsAsTaste(plainMore), false);
    eq("does NOT count as taste: plain less", EV.countsAsTaste(plainLess), false);
    eq("does NOT count as taste: not tried, no detail", EV.countsAsTaste(notTried), false);
    eq("undefined feedback counts as nothing", EV.countsAsTaste(undefined), false);

    // taste.js's re-exports agree with evidence.js exactly (no drift between the two)
    eq("taste.js isPositiveExperience === evidence.js isExperiencedPositive (loved)", T.isPositiveExperience(loved), EV.isExperiencedPositive(loved));
    eq("...same for liked", T.isPositiveExperience(liked), EV.isExperiencedPositive(liked));
    eq("...same for disliked", T.isPositiveExperience(disliked), EV.isExperiencedPositive(disliked));
    eq("taste.js isBookmarked === evidence.js isSaved (bookmarked)", T.isBookmarked(bookmarked), EV.isSaved(bookmarked));
    eq("...same for loved (false)", T.isBookmarked(loved), EV.isSaved(loved));

    // library.js, mine.js, search.js, tastemap.js, blindspots.js agree with the predicates on real state
    const st = { selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)), feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {}, blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(), patternStatements: [] };
    const [r0, r1, r2, r3] = recommendations;
    S.applySearchAction(st, r0, "loved"); S.applySearchAction(st, r1, "liked"); S.applySearchAction(st, r2, "disliked"); S.applySearchAction(st, r3, "bookmark");
    const lib = LIB.libraryItems(st);
    eq("library: a loved pick is source 'loved'", lib.library.find((e) => e.id === r0.id)?.source, "loved");
    eq("library: a liked pick is source 'liked'", lib.library.find((e) => e.id === r1.id)?.source, "liked");
    eq("library: disliked stays out, in dislikedItems instead", lib.library.some((e) => e.id === r2.id), false);
    eq("...and shows up there", LIB.dislikedItems(st).some((e) => e.id === r2.id), true);
    const told = MINE.toldItems(st);
    eq("mine: loved/liked/disliked all count as taste", [r0.id, r1.id, r2.id].every((id) => told.counts.some((e) => e.id === id)), true);
    eq("mine: a bookmark only steers", told.steers.some((e) => e.id === r3.id) && !told.counts.some((e) => e.id === r3.id), true);
    eq("search: itemStatus agrees with the predicates", `${S.itemStatus(st, r0).key},${S.itemStatus(st, r1).key},${S.itemStatus(st, r2).key},${S.itemStatus(st, r3).key}`, "loved,liked,disliked,bookmarked");
    const pattern = hypotheses.find((h) => h.id === r0.hypotheses[0]);
    const ev = M.patternEvidence(st, pattern);
    eq("taste map: a loved pick on this pattern is in supports", ev.supports.some((row) => row.item.id === r0.id) || !r0.hypotheses.includes(pattern.id), true);
  });

  return { passed: total - failures.length, failed: failures.length, total, failures: failures.length ? failures : undefined };
}
