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

  return { passed: total - failures.length, failed: failures.length, total, failures: failures.length ? failures : undefined };
}
