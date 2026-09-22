// Browser-side flow check for Bookmark + Keep discovering + the taste-evidence rule + keeping the
// user's place (focus, announcements) + the Taste Profile lean + the Library + Search + Blind Spots + the Taste Map
// + Looks (#25: the picker, first visit, and every screen in every look). No dependencies.
//
//   await (await import("/scripts/qa/bookmark-flow.js")).run()
//
// Drives the real UI (clicks) and checks the rules we decided:
//   - a bookmark is only offered on untried items, replaces Interested/Maybe, and is NOT taste evidence
//   - reactions to untried picks (plain More / Less / Wrong vibe) steer recommendations but are NOT taste evidence
//   - Keep discovering works without rating every card, never repeats a pick, and ends honestly
//   - trying a bookmarked item turns it into a real reaction (and only then counts as taste evidence)
//   - the Taste Profile shows reactions to untried picks as a separate "lean", never as taste
//   - keyboard focus stays on the control you used, and changes are announced to screen readers
// Run it on a fresh page load; it changes app state. Returns { passed, failed, results }.

export async function run() {
  const { state } = await import("/src/state.js");
  const taste = await import("/src/model/taste.js");
  const catalog = await import("/src/data/catalog.js");
  const blind = await import("/src/model/blindspots.js");
  const mapModel = await import("/src/model/tastemap.js");
  const layout = await import("/scripts/qa/layout-check.js");
  const libModel = await import("/src/model/library.js");
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail: String(detail) });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 100));
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const cardIds = () => $$(".editorial-rec").map((card) => card.dataset.recId);
  const bookmarksStep = () => $('[data-step-jump="bookmarks"]');
  // focus() first, like a keyboard user would have, so we can check focus survives the re-render
  const act = async (selector) => { const el = $(selector); if (!el) throw new Error(`missing ${selector}`); el.focus(); el.click(); await tick(); };
  const live = () => $("#live")?.textContent || "";
  // Text contrast is gated in the newer looks; Collage is the original look and keeps its known decorative low-contrast labels.
  const layoutClean = (r) => !r.stickerTextHits.length && !r.stickerBoxHits.length && !r.stickerOutside.length &&
    !r.titleCollisions.length && !r.textUnderControls.length && !r.topbarOverlaps.length && !r.mapOverlaps.length && !r.hScroll &&
    (state.look === "collage" || !r.lowContrast.length);
  const rate = (id, rating) => act(`[data-feedback-item="${id}"][data-rating="${rating}"]`);
  const detail = (id, value) => act(`[data-feedback-item="${id}"][data-feedback-detail="${value}"]`);

  await act('[data-step-jump="recommendations"]');
  let ids = cardIds();
  check("opening set has 5 picks", ids.length === 5, ids.length);
  check("Bookmarks tab hidden before anything is saved", bookmarksStep().hidden);

  await rate(ids[0], "not-tried");
  const chips = $$(`[data-feedback-item="${ids[0]}"][data-feedback-detail]`).map((chip) => chip.textContent.trim());
  check("Not tried offers only 'Bookmark it' (no Interested / Maybe)", chips.length === 1 && chips[0] === "Bookmark it", chips.join(","));
  await rate(ids[1], "more");
  check("focus stays on the More button after reacting", document.activeElement === $(`[data-feedback-item="${ids[1]}"][data-rating="more"]`), document.activeElement?.className);
  check("a live announcement region exists", Boolean($("#live")) && $("#live").getAttribute("aria-live") === "polite");
  const moreChips = $$(`[data-feedback-item="${ids[1]}"][data-feedback-detail]`).map((chip) => chip.textContent.trim());
  check("More offers only experience answers (Loved / Liked it before)", moreChips.join("|") === "Loved it before|Liked it before", moreChips.join("|"));
  const qualityChips = () => $$(`[data-feedback-item="${ids[1]}"][data-feedback-quality]`).map((chip) => chip.textContent.trim());
  check("'Surprised me' is NOT offered on an untried pick", qualityChips().join("|") === "Too predictable", qualityChips().join("|"));

  await rate(ids[0], "not-tried");
  await detail(ids[0], "bookmarked");
  check("focus stays on the chip after choosing it", document.activeElement === $(`[data-feedback-item="${ids[0]}"][data-feedback-detail="bookmarked"]`));
  check("bookmarking is announced with the running count", /Bookmarked\. 1 thing bookmarked\./.test(live()), live());
  check("Bookmarks tab appears with a count of 1", !bookmarksStep().hidden && bookmarksStep().querySelector("[data-bookmark-count]").textContent === "1");
  const first = state.feedbackByRecommendation[ids[0]];
  check("a bookmark carries NO taste evidence", taste.tasteDelta(first) === 0, taste.tasteDelta(first));
  check("a bookmark lightly steers recommendations (0.35)", taste.recommendationDelta(first) === 0.35, taste.recommendationDelta(first));

  await rate(ids[2], "less");
  check("plain More on an untried pick is NOT taste evidence", taste.tasteDelta(state.feedbackByRecommendation[ids[1]]) === 0, taste.tasteDelta(state.feedbackByRecommendation[ids[1]]));
  check("...but still steers what comes next", taste.recommendationDelta(state.feedbackByRecommendation[ids[1]]) === 1);
  check("plain Less on an untried pick is NOT taste evidence", taste.tasteDelta(state.feedbackByRecommendation[ids[2]]) === 0, taste.tasteDelta(state.feedbackByRecommendation[ids[2]]));
  const lessChips = $$(`[data-feedback-item="${ids[2]}"][data-feedback-detail]`).map((chip) => chip.textContent.trim());
  check("Less offers only 'Tried it and disliked it' / 'Not interested'", lessChips.join("|") === "Tried it and disliked it|Not interested", lessChips.join("|"));
  await detail(ids[2], "not-interested");
  check("'Not interested' is NOT taste evidence", taste.tasteDelta(state.feedbackByRecommendation[ids[2]]) === 0);
  await detail(ids[2], "tried-disliked");
  check("'Tried it and disliked' IS taste evidence (-2)", taste.tasteDelta(state.feedbackByRecommendation[ids[2]]) === -2);

  // ---- Taste Blind Spot (#20): a confident pick that was tried and disliked ----
  const spotItem = state.feedbackByRecommendation[ids[2]].item;
  const spotPatterns = blind.patternsFor(spotItem);
  const spotCard = () => $(`[data-rec-id="${ids[2]}"]`);
  const blindBtn = (action, value) => `[data-blind-item="${ids[2]}"][data-blind-action="${action}"]${value ? `[data-blind-value="${value}"]` : ""}`;
  const penalized = () => spotPatterns.map((p) => taste.modelUpdateFor(state, p).note !== null);
  check("the disliked pick leans on 2+ visible patterns", spotPatterns.length >= 2, spotPatterns.length);
  check("a confident pick that was tried and disliked offers to learn from it", Boolean(spotCard().querySelector(".blind-panel.is-offer")));
  check("...and the offer is announced", /tell it what it got wrong/.test(live()), live());
  check("before answering, every pattern it leaned on is counted against", penalized().every(Boolean));
  await act(blindBtn("dismiss"));
  check("'Not now' leaves a quiet way back, not a nag", Boolean(spotCard().querySelector(".blind-panel.is-quiet")) && !spotCard().querySelector(".blind-panel.is-offer"));
  await act(blindBtn("start"));
  check("starting opens question 1 and puts focus on it", document.activeElement?.dataset.blindFocus === ids[2] && /Which of the reasons/.test(document.activeElement.textContent), document.activeElement?.textContent.slice(0, 50));
  check("Next is disabled until something is chosen", $(blindBtn("next")).disabled);
  await act(blindBtn("toggle-pattern", spotPatterns[0].id));
  check("choosing a pattern keeps focus on that chip", document.activeElement?.dataset.blindValue === spotPatterns[0].id);
  await act(blindBtn("next"));
  check("question 2 asks what got in the way (focus on it)", /What got in the way/.test(document.activeElement?.textContent || ""));
  check("...and the step is announced", /Question 2 of 2/.test(live()), live());
  await act(blindBtn("toggle-reason", "tone"));
  await act(blindBtn("next"));
  check("the summary asks for confirmation; nothing is saved yet", /Does this sound right/.test(document.activeElement?.textContent || "") && !state.blindSpots[ids[2]]);
  await act(blindBtn("save"));
  check("'Yes, keep it' saves the blind spot with the answers", JSON.stringify(state.blindSpots[ids[2]]?.hypotheses) === JSON.stringify([spotPatterns[0].id]) && state.blindSpots[ids[2]].reasons.join() === "tone", JSON.stringify(state.blindSpots[ids[2]]));
  check("...the pattern that failed is still counted against", taste.modelUpdateFor(state, spotPatterns[0]).note !== null);
  check("...and the patterns that held up are NOT counted against", spotPatterns.slice(1).every((p) => taste.modelUpdateFor(state, p).note === null));
  check("...announced", /now a blind spot/.test(live()), live());
  await act('[data-step-jump="model"]');
  check("the Taste Profile lists it under 'Things Tastemake keeps getting wrong about you'", /keeps getting wrong/.test($(".blind-section h2")?.textContent || "") && /Noted once/.test($(".blind-card .blind-status")?.textContent || ""));
  check("...and the pattern that failed notes it", Boolean($(".signal-blind")) && /didn't hold up here/.test($(".signal-blind").textContent));
  const blindShot = layout.checkCurrentScreen();
  check("Taste Profile with a blind spot: layout clean", layoutClean(blindShot), JSON.stringify(blindShot).slice(0, 300));
  await act(blindBtn("edit"));
  check("editing reopens the questions with the earlier answers filled in", $(blindBtn("toggle-pattern", spotPatterns[0].id))?.getAttribute("aria-pressed") === "true");
  await act(blindBtn("discard"));
  check("cancelling an edit keeps the saved blind spot", Boolean(state.blindSpots[ids[2]]) && Boolean($(".blind-panel.is-saved")));
  await act(blindBtn("remove"));
  check("Remove takes it off the record and restores the original accounting", !state.blindSpots[ids[2]] && penalized().every(Boolean) && !$(".blind-section"));

  // ---- Taste Map (#21): the profile as a picture, backed by a written equivalent ----
  const viewBtn = (v) => `[data-profile-view="${v}"]`;
  check("the Taste Profile has a List / Map toggle, List selected", $(viewBtn("list"))?.getAttribute("aria-pressed") === "true" && $(viewBtn("map"))?.getAttribute("aria-pressed") === "false");
  await act(viewBtn("map"));
  check("Map view shows one card per pattern", $$(".taste-map-node").length === catalog.hypotheses.length, $$(".taste-map-node").length);
  check("...focus stays on the toggle and the change is announced", document.activeElement === $(viewBtn("map")) && /as a map/.test(live()), live());
  check("...with the written connections, tensions and thin areas under it", $$(".map-panel").length === 3 && $$("#map-connections ~ ul li").length === mapModel.patternLinks().length);
  const mapShot = layout.checkCurrentScreen();
  check("Taste Map: layout clean (cards don't overlap or leave the map)", layoutClean(mapShot), JSON.stringify(mapShot).slice(0, 300));
  check("every card states how sure Tastemake is, in words", $$(".taste-map-node").every((n) => n.querySelector(".map-node-conf")?.textContent.trim().length > 0));
  const pat0 = catalog.hypotheses[0];
  await act(`.taste-map-node[data-map-pattern="${pat0.id}"]`);
  check("choosing a card opens its detail and moves focus there", document.activeElement?.hasAttribute("data-map-focus") && document.activeElement.textContent === pat0.title, document.activeElement?.textContent.slice(0, 40));
  const mapEv = mapModel.patternEvidence(state, pat0);
  const mapEvCount = mapEv.supports.length + mapEv.against.length + mapEv.heldUp.length + mapEv.steers.length;
  check("the evidence listed is exactly what the model holds", $$(".map-evidence").length === mapEvCount && mapEvCount > 0, `${$$(".map-evidence").length} vs ${mapEvCount}`);
  check("every evidence row says it was told by you", $$(".map-evidence").every((row) => /Told by you/.test(row.textContent)));
  await act(".map-evidence");
  const pickPatterns = mapModel.patternsOfItem(state.feedbackByRecommendation[$(".map-evidence[aria-pressed='true']").dataset.mapItem].item);
  check("choosing a pick highlights every pattern it leans on", $$(".taste-map-node.is-linked").length === pickPatterns.length && pickPatterns.length > 0, `${$$(".taste-map-node.is-linked").length} vs ${pickPatterns.length}`);
  await act(`.taste-map-node[data-map-pattern="${pat0.id}"]`);
  check("choosing the same card again clears it", Boolean($(".map-detail.is-empty")));
  await act(viewBtn("list"));
  check("switching back restores the list", !$(".taste-map") && Boolean($(".profile-map")) && $(viewBtn("list")).getAttribute("aria-pressed") === "true");
  await act('[data-step-jump="recommendations"]');
  await detail(ids[1], "loved-before");
  check("'Loved it before' IS taste evidence (+2)", taste.tasteDelta(state.feedbackByRecommendation[ids[1]]) === 2);
  check("'Surprised me' appears once it is tried and loved", qualityChips().join("|") === "Too predictable|Surprised me", qualityChips().join("|"));
  await act(`[data-feedback-item="${ids[1]}"][data-feedback-quality="surprised-me"]`);
  const surprised = state.feedbackByRecommendation[ids[1]];
  check("'Surprised me' is recorded but adds no taste weight of its own", surprised.quality === "surprised-me" && taste.tasteDelta(surprised) === 2);
  await detail(ids[1], "loved-before");
  check("un-choosing 'Loved it before' also clears a stale 'Surprised me'", state.feedbackByRecommendation[ids[1]].quality === null && qualityChips().join("|") === "Too predictable");
  await detail(ids[1], "loved-before");

  // ---- Library: things tried and liked, derived from reactions ----
  check("Library tab is in the nav", Boolean($('[data-step-jump="library"]')) && !$('[data-step-jump="library"]').hidden);
  await act('[data-step-jump="library"]');
  const sections = $$(".library-section");
  check("Library shows the 6 starter favorites", sections[0].querySelectorAll(".library-card").length === 6, sections[0].querySelectorAll(".library-card").length);
  const lovedCard = () => $(`[data-library-id="${ids[1]}"]`);
  check("a pick marked Loved it before is in the Library", Boolean(lovedCard()) && sections[1].contains(lovedCard()), lovedCard()?.textContent.slice(0, 60));
  check("a bookmark or plain More is NOT in the Library", !$(`[data-library-id="${ids[0]}"]`));
  check("'Tried it and disliked' is kept out, but listed to correct", Boolean($(".library-disliked")) && /Things you didn't like \(1\)/.test($(".library-disliked summary").textContent));
  await act(`[data-library-item="${ids[1]}"][data-library-action="favorite"]`);
  check("'Add to Favorites' moves a loved pick into Favorites", $$(".library-section")[0].contains(lovedCard()) && $$(".library-section")[0].querySelectorAll(".library-card").length === 7);
  check("...and announces it", /added to Favorites/.test(live()), live());
  check("focus is not lost after acting", document.activeElement?.classList.contains("library-action"), document.activeElement?.tagName + "." + document.activeElement?.className);
  await act(`[data-library-item="${ids[1]}"][data-library-action="liked"]`);
  check("correcting Loved to Liked drops the star and keeps it in the Library", $$(".library-section")[1].contains(lovedCard()) && !$(`[data-library-item="${ids[1]}"][data-library-action="favorite"]`));
  check("...and 'Liked it' counts as taste evidence (+1.25)", taste.tasteDelta(state.feedbackByRecommendation[ids[1]]) === 1.25);
  const libShot = layout.checkCurrentScreen();
  check("Library page: layout clean", layoutClean(libShot), JSON.stringify(libShot).slice(0, 300));
  await act(`[data-library-item="${ids[2]}"][data-library-action="liked"]`);
  check("correcting a dislike to Liked brings it into the Library", Boolean($(`[data-library-id="${ids[2]}"]`)) && !$(".library-disliked"));
  await act(`[data-library-item="${ids[2]}"][data-library-action="disliked"]`);
  check("'Didn't like it' takes it back out (-2 taste evidence)", !$(`[data-library-id="${ids[2]}"]`) && taste.tasteDelta(state.feedbackByRecommendation[ids[2]]) === -2);
  await act(`[data-library-item="${ids[1]}"][data-library-action="loved"]`);

  // ---- Search / add something (#13): searching is not evidence, only explicit actions are ----
  const dlg = $("#search-dialog");
  const typeInto = async (selector, value) => { const el = $(selector); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); await tick(); };
  const snapshot = () => JSON.stringify([Object.keys(state.feedbackByRecommendation).sort(), [...state.libraryFavorites], Object.keys(state.customItems)]);
  const before = snapshot();
  check("a Search button is in the header", Boolean($("#open-search")));
  await act("#open-search");
  check("Search opens as a modal dialog with focus in the box", dlg.open && document.activeElement?.id === "search-input", document.activeElement?.id);
  await typeInto("#search-input", "fagro");
  check("a typo still finds the item (fagro -> Fargo)", $("#search-view .search-result b")?.textContent === "Fargo", $("#search-view")?.textContent.slice(0, 80));
  await typeInto("#search-input", "lotr");
  check("an acronym finds it (lotr -> The Lord of the Rings)", $("#search-view .search-result b")?.textContent === "The Lord of the Rings");
  await typeInto("#search-input", "fagro");
  await act("#search-view .search-result");
  check("opening a result lands on its title", document.activeElement?.id === "search-sheet-title", document.activeElement?.id);
  check("SEARCHING IS NOT EVIDENCE: typing and opening a result changed nothing", snapshot() === before);
  check("the dialog fits the screen (no sideways scroll, inside the viewport)", (() => { const r = dlg.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; })());
  const fargoId = "fargo";
  await act('[data-search-action="bookmark"]');
  check("Bookmark from search saves it as a bookmark (0 taste evidence)", taste.isBookmarked(state.feedbackByRecommendation[fargoId]) && taste.tasteDelta(state.feedbackByRecommendation[fargoId]) === 0, JSON.stringify(state.feedbackByRecommendation[fargoId]?.detail));
  check("...and announces it", /Fargo: bookmarked\./.test(live()), live());
  check("focus stays on the button that was used", document.activeElement === $('[data-search-action="bookmark"]'));
  await act('[data-search-action="loved"]');
  check("Loved from search counts as taste evidence (+2)", taste.tasteDelta(state.feedbackByRecommendation[fargoId]) === 2);
  check("...and lands in the Library behind the dialog", Boolean($(`[data-library-id="${fargoId}"]`)));
  await act('[data-search-action="favorite"]');
  check("a loved pick can be starred as a Favorite", $$(".library-section")[0].contains($(`[data-library-id="${fargoId}"]`)));
  await act('[data-search-action="remove"]');
  check("Remove from Tastemake forgets it completely", !state.feedbackByRecommendation[fargoId] && !$(`[data-library-id="${fargoId}"]`));
  check("...and focus is not lost", dlg.contains(document.activeElement), document.activeElement?.tagName);

  // something Tastemake does not know: added on the spot, only stored once acted on
  await act("[data-search-back]");
  await typeInto("#search-input", "the matrix");
  check("an unknown title finds nothing and offers to add it", !$("#search-view .search-result") && Boolean($("[data-search-add]")));
  await act("[data-search-add]");
  await typeInto("#search-add-name", "The Matrix");
  await act('input[name="search-medium"][value="movie"]');
  $("[data-search-addform]").requestSubmit(); await tick();
  check("adding shows the action sheet without saving anything yet", document.activeElement?.id === "search-sheet-title" && Object.keys(state.customItems).length === 0, JSON.stringify(Object.keys(state.customItems)));
  const profileOf = () => JSON.stringify(catalog.hypotheses.map((h) => [taste.modelUpdateFor(state, h), taste.untriedReactionLean(state, h)]));
  const profileBefore = profileOf();
  await act('[data-search-action]');   // Loved it: the first action button
  check("an added item is stored once acted on, and joins the Library", Object.keys(state.customItems).join() === "custom-the-matrix-movie" && Boolean($('[data-library-id="custom-the-matrix-movie"]')));
  check("...with no pattern tags, so it cannot move any Taste Profile card", profileOf() === profileBefore);
  await act("[data-search-back]");
  await typeInto("#search-input", "the matrix");
  await act("[data-search-add]");
  await typeInto("#search-add-name", "the matrix");
  $("[data-search-addform]").requestSubmit(); await tick();
  check("adding the same title again opens the existing one (no duplicate)", Object.keys(state.customItems).length === 1 && /The Matrix/.test($("#search-sheet-title")?.textContent || ""));
  check("...and announces that it was already there", /already in Tastemake/.test(live()), live());
  await act('[data-search-action="remove"]');
  check("removing an added item deletes it entirely", Object.keys(state.customItems).length === 0 && !$('[data-library-id="custom-the-matrix-movie"]'));
  check("...and returns to the search box, not a dead end", document.activeElement?.id === "search-input" && !$("#search-sheet-title"), document.activeElement?.id);
  await typeInto("#search-input", "circe");
  await act("#search-view .search-result");
  check("a starter favorite shows no action buttons here", !$("[data-search-action]") && /starter favorites/.test($(".search-note")?.textContent || ""));
  check("...and nothing was changed by any of that", snapshot() === before, snapshot());
  dlg.close(); await tick();
  check("closing returns focus to the Search button", document.activeElement === $("#open-search"), document.activeElement?.id);
  document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await tick();
  check("pressing / opens Search from anywhere", dlg.open);
  dlg.close(); await tick();

  await act('[data-step-jump="recommendations"]');

  await rate(ids[3], "not-tried");
  await rate(ids[4], "not-tried");
  await detail(ids[4], "bookmarked");
  check("finished set offers Keep discovering", Boolean($('[data-action="keep-discovering"]')));
  check("finished set mentions 2 bookmarks", /2 things bookmarked/.test($(".bookmark-note")?.textContent || ""));

  await act('[data-action="keep-discovering"]');
  check("Keep discovering announces the new set", /New set: 5 picks\./.test(live()), live());
  ids = cardIds();
  check("second set has 5 picks incl. one Surprise", ids.length === 5 && $$(".surprise-burst").length === 1, ids.length);
  check("second set does not repeat the opening set", !ids.some((id) => state.recommendationSets[0].some((item) => item.id === id)));
  check("Keep discovering hidden until something is reacted to", !$('[data-action="keep-discovering"]'));

  await rate(ids[0], "more");
  // Taste Profile: a plain More on a pick not yet tried shows as a separate lean, not as taste.
  await act('[data-step-jump="model"]');
  const leans = $$(".signal-lean");
  check("Taste Profile shows a lean from a reaction to an untried pick", leans.length >= 1 && /lean toward/.test(leans[0].textContent), leans.map((el) => el.textContent.trim().replace(/\s+/g, " ")).join(" || ").slice(0, 200));
  const profileShot = layout.checkCurrentScreen();
  check("Taste Profile with lean lines: layout clean", layoutClean(profileShot), JSON.stringify(profileShot).slice(0, 300));
  await act('[data-step-jump="recommendations"]');
  check("Keep discovering available after ONE reaction (not all 5)", Boolean($('[data-action="keep-discovering"]')));
  await act('[data-action="keep-discovering"]');
  ids = cardIds();
  check("third set is what is left (2 picks, no surprise)", ids.length === 2 && $$(".surprise-burst").length === 0, ids.length);
  const flat = state.recommendationSets.flat().map((item) => item.id);
  check("no pick is ever shown twice", new Set(flat).size === flat.length);

  await rate(ids[0], "more");
  await rate(ids[1], "less");
  check("no more picks: honest end-of-demo message", /every pick this demo has/.test($(".refresh-banner.is-finished")?.textContent || ""));
  check("no Keep discovering when out of picks", !$('[data-action="keep-discovering"]'));
  const endScreen = layout.checkCurrentScreen();
  check("end-of-demo banner: no text hidden behind its buttons, no sideways scroll",
    !endScreen.textUnderControls.length && !endScreen.hScroll, JSON.stringify(endScreen.textUnderControls));

  await act('[data-action="view-bookmarks"]');
  check("Bookmarks page lists both saved items", $$(".bookmark-card").length === 2, $$(".bookmark-card").length);
  check("Bookmarks tab shows 2", bookmarksStep().querySelector("[data-bookmark-count]").textContent === "2");
  const shot = layout.checkCurrentScreen();
  check("Bookmarks page: no sticker touches text/cards, no sideways scroll",
    !shot.stickerTextHits.length && !shot.stickerBoxHits.length && !shot.stickerOutside.length && !shot.hScroll,
    JSON.stringify({ text: shot.stickerTextHits, box: shot.stickerBoxHits, out: shot.stickerOutside, hScroll: shot.hScroll }));

  const lovedId = $$(".bookmark-card")[0].dataset.bookmarkId;
  await act(`[data-bookmark-item="${lovedId}"][data-bookmark-action="tried-loved"]`);
  check("after acting on a bookmark, focus moves to the next card (not lost)", document.activeElement?.classList.contains("bookmark-action"), document.activeElement?.tagName + "." + document.activeElement?.className);
  check("...and the change is announced", /marked Loved it before\. 1 thing left in Bookmarks\./.test(live()), live());
  const loved = state.feedbackByRecommendation[lovedId];
  check("'Loved it' becomes a real reaction", loved.rating === "more" && loved.detail === "loved-before", `${loved.rating}/${loved.detail}`);
  check("...that now counts as taste evidence", taste.tasteDelta(loved) === 2, taste.tasteDelta(loved));
  check("...and remembers it was bookmarked first", loved.wasBookmarked === true);
  check("card leaves Bookmarks; count drops to 1", $$(".bookmark-card").length === 1 && bookmarksStep().querySelector("[data-bookmark-count]").textContent === "1");

  const lastId = $$(".bookmark-card")[0].dataset.bookmarkId;
  await act(`[data-bookmark-item="${lastId}"][data-bookmark-action="remove"]`);
  check("removing the last bookmark shows the empty state", Boolean($(".bookmark-empty")));
  check("with nothing left, focus lands on the page, not nowhere", document.activeElement?.id === "app", document.activeElement?.tagName + "#" + document.activeElement?.id);
  check("...and is announced", /bookmark removed\. 0 things left in Bookmarks\./.test(live()), live());
  check("removed bookmark stays untried, no evidence", state.feedbackByRecommendation[lastId].rating === "not-tried" && taste.tasteDelta(state.feedbackByRecommendation[lastId]) === 0);
  await act('[data-action="show-recs"]');
  check("Bookmarks tab hides again when nothing is saved", bookmarksStep().hidden);



  // ---- My Tastemake (#8): the ledger of what you told it, areas, curveball, and start over ----
  const mineModel = await import("/src/model/mine.js");
  const searchModel = await import("/src/model/search.js");
  const beforeScreen = state.screen;
  check("a My Tastemake button is in the header", Boolean($("#open-mine")) && $("#open-mine").getAttribute("aria-label") === "My Tastemake");
  await act("#open-mine");
  check("the button opens My Tastemake", state.screen === "mine" && Boolean($(".mine-screen")));
  const told = mineModel.toldItems(state);
  const rowIds = $$(".mine-row[data-mine-id]").map((row) => row.dataset.mineId).sort().join();
  const expectedIds = [...told.counts, ...told.steers].filter((e) => !e.starter).map((e) => e.id).sort().join();
  check("the page lists exactly what the model says you told it (one row per item)", rowIds === expectedIds && expectedIds.length > 0, `${rowIds} vs ${expectedIds}`);
  check("starter favorites are one compact card, not one row each", $$(".mine-starters").length === 1 && $$(".mine-chips li").length === state.selectedFavorites.size);
  check("evidence is split into 'Counts as taste' and 'Only steers what comes next'", /Counts as taste/.test($(".mine-screen").textContent) && /Only steers what comes next/.test($(".mine-screen").textContent));
  check("every item shows where it came from", $$(".mine-row[data-mine-id]").every((row) => row.querySelector(".mine-source")?.textContent.trim().length > 3));
  check("settings are described as not being taste", /says nothing about what you like/.test($(".mine-screen").textContent) && /not what Tastemake thinks you like/.test($(".mine-screen").textContent));
  check("a blind spot you confirmed is listed, with a way to remove it", Object.keys(state.blindSpots).length === 0 || $$("[data-mine-blind]").length === blind.activeBlindSpots(state).length);

  // change what you told it (the same write search makes), and everything else follows
  const lovedRow = $$(".mine-row[data-mine-id]").find((row) => row.querySelector('[data-mine-action="loved"][aria-pressed="true"]'));
  if (lovedRow) {
    const id = lovedRow.dataset.mineId;
    const title = state.feedbackByRecommendation[id].item.title;
    await act(`[data-mine-item="${id}"][data-mine-action="liked"]`);
    check("changing Loved to Liked here changes the reaction", state.feedbackByRecommendation[id].detail === "liked-before", state.feedbackByRecommendation[id].detail);
    check("...keeps keyboard focus on the button you used", document.activeElement === $(`[data-mine-item="${id}"][data-mine-action="liked"]`), document.activeElement?.className);
    check("...and is announced by title", live().includes(title), live());
    check("...and the Library agrees (now Liked, not Loved)", libraryModelSource(id) === "liked");
    await act(`[data-mine-item="${id}"][data-mine-action="loved"]`);
    check("...and can be put back", state.feedbackByRecommendation[id].detail === "loved-before");
  } else check("(no Loved row to change)", false, "the flow left no Loved item");
  function libraryModelSource(id) { const all = libModel.libraryItems(state); return [...all.favorites, ...all.library].find((e) => e.id === id)?.source; }

  const tasteBefore = JSON.stringify(Object.values(state.feedbackByRecommendation).map((f) => [f.item.id, f.rating, f.detail]));
  const scoreBefore = Object.values(state.feedbackByRecommendation).reduce((sum, f) => sum + taste.tasteDelta(f), 0);
  // areas: a setting, not taste
  await act('[data-mine-area="play"]');
  check("turning Play off is stored and announced", state.areas.play === false && /Play is off for new sets/.test(live()), live());
  check("...keeps focus on the checkbox", document.activeElement === $('[data-mine-area="play"]'));
  check("...hides play-only picks from new sets", taste.nextRecommendations(state).every((p) => !p.domains.every((d) => d === "play")));
  check("...changes no reaction and no taste score", JSON.stringify(Object.values(state.feedbackByRecommendation).map((f) => [f.item.id, f.rating, f.detail])) === tasteBefore &&
    Object.values(state.feedbackByRecommendation).reduce((sum, f) => sum + taste.tasteDelta(f), 0) === scoreBefore);
  await act('[data-mine-area="watch"]');
  check("the last area left on cannot be turned off (its checkbox is disabled)", $('[data-mine-area="read"]').disabled === true);
  await act('[data-mine-area="watch"]'); await act('[data-mine-area="play"]');
  check("turning areas back on restores them all", Object.values(state.areas).every(Boolean));

  await act("[data-mine-curveball]");
  check("turning the curveball off is stored and announced", state.curveball === false && /Curveball is off/.test(live()), live());
  check("...and the checkbox reflects it (the pick logic itself is covered by model-rules.js)", $("[data-mine-curveball]").checked === false);
  await act("[data-mine-curveball]");
  check("...and back on restores it", state.curveball === true && $("[data-mine-curveball]").checked === true);

  // remove: focus moves on, the change ripples to Library / Bookmarks
  const removable = $$(".mine-row[data-mine-id]");
  const target = removable[Math.floor(removable.length / 2)];
  const targetId = target.dataset.mineId;
  const targetTitle = state.feedbackByRecommendation[targetId].item.title;
  const rowsBefore = removable.length;
  await act(`[data-mine-item="${targetId}"][data-mine-action="remove"]`);
  check("Remove takes the item off the ledger and out of Tastemake", !state.feedbackByRecommendation[targetId] && $$(".mine-row[data-mine-id]").length === rowsBefore - 1);
  check("...announces the removal by title", live().includes(targetTitle) && /removed/.test(live()), live());
  check("...and focus lands on another control, not nowhere", document.activeElement && document.activeElement !== document.body, document.activeElement?.tagName);
  check("the Bookmarks tab count still matches", (bookmarksStep().querySelector("[data-bookmark-count]").textContent || "0") === String(taste.bookmarkedFeedback(state).length || 0) || bookmarksStep().hidden);
  await act('[data-action="mine-back"]');
  check("Back returns to the page you came from", state.screen === beforeScreen, state.screen);

  // ---- Looks (#25): choosing a look is presentation only; every screen must work in every look ----
  const looksData = await import("/src/data/looks.js");
  const startLook = state.look;
  const startScreen = state.screen;
  const evidenceBefore = JSON.stringify(Object.entries(state.feedbackByRecommendation).map(([id, f]) => [id, f.rating, f.detail]));
  const favoritesBefore = [...state.selectedFavorites].sort().join(",");

  check("four looks are defined, with Clean editorial as the starting point",
    looksData.LOOKS.length === 4 && looksData.DEFAULT_LOOK === "editorial" && looksData.LOOKS.some((l) => l.id === "collage"),
    looksData.LOOKS.map((l) => l.id).join(","));
  check("the page's look and the app's look agree", document.documentElement.dataset.look === state.look, `${document.documentElement.dataset.look} vs ${state.look}`);
  check("a Look button is in the header", Boolean($("#open-look")) && /Look/.test($("#open-look").textContent + ($("#open-look").title || "")));

  await act("#open-look");
  check("the Look button opens the picker", Boolean($(".look-screen")) && state.screen === "look");
  check("the picker shows all four looks as visual previews", $$(".look-card .look-preview").length === 4 && $$('input[name="look"]').length === 4,
    `${$$(".look-card .look-preview").length} previews`);
  check("each preview is drawn in its own look", $$(".look-preview").map((p) => p.dataset.look).join(",") === looksData.LOOKS.map((l) => l.id).join(","));
  check("previews are hidden from screen readers; the labels carry the meaning", $$(".look-preview").every((p) => p.getAttribute("aria-hidden") === "true") &&
    $$(".look-card-name").every((n) => n.textContent.trim().length > 3));
  check("the current look is the checked one", $(`input[name="look"]:checked`)?.value === startLook, $(`input[name="look"]:checked`)?.value);
  check("the picker says choosing a look tells Tastemake nothing about taste", /doesn.t tell Tastemake anything about your taste/.test($(".look-note").textContent));
  const picked = startLook === "graphic" ? "analog" : "graphic";
  const pickedLabel = looksData.LOOKS.find((l) => l.id === picked).label;
  const radio = $(`input[name="look"][value="${picked}"]`);
  radio.focus(); radio.click(); await tick();
  check("picking a look applies it to the whole page straight away", document.documentElement.dataset.look === picked && state.look === picked);
  check("...and is announced", new RegExp(`Look: ${pickedLabel}\\.`).test(live()), live());
  check("...and keeps keyboard focus on the radio you used", document.activeElement === radio, document.activeElement?.tagName);
  check("...and moves the selected marker", $(".look-card.is-selected")?.dataset.lookChoice === picked && $$(".look-card.is-selected").length === 1);
  check("choosing a look changes no taste evidence and no favorites",
    JSON.stringify(Object.entries(state.feedbackByRecommendation).map(([id, f]) => [id, f.rating, f.detail])) === evidenceBefore &&
    [...state.selectedFavorites].sort().join(",") === favoritesBefore);
  check("the picker does not scroll sideways in this look", document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check("the button says Done when reopened from the header", $('[data-action="look-done"]').textContent.trim() === "Done");
  await act('[data-action="look-done"]');
  check("Done returns to the page you were on", state.screen === startScreen && !$(".look-screen"), state.screen);
  check("the chosen look stays after leaving the picker", document.documentElement.dataset.look === picked);

  // every main screen in every look: no overlaps, no sideways scroll, readable text (see layout-check.js)
  const screens = { favorites: "favorites", recommendations: "recommendations", model: "model", library: "library" };
  for (const look of looksData.LOOKS) {
    state.look = look.id; document.documentElement.dataset.look = look.id;
    for (const [name, jump] of Object.entries({ ...screens, mine: null })) {
      if (jump) await act(`.step[data-step-jump="${jump}"]`); else await act("#open-mine");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const r = layout.checkCurrentScreen();
      const problems = Object.entries(r).filter(([k, v]) => Array.isArray(v) && v.length && (k !== "lowContrast" || look.id !== "collage"));
      check(`${look.label}: ${name} screen has no overlaps, no sideways scroll and readable text`, layoutClean(r) && problems.length === 0,
        JSON.stringify(problems.map(([k, v]) => [k, v.slice(0, 2)])).slice(0, 400));
    }
  }
  // Map and Blind Spot panels only exist in the profile's Map view; check the Map in each look too
  await act('.step[data-step-jump="model"]');
  await act('[data-profile-view="map"]');
  for (const look of looksData.LOOKS) {
    state.look = look.id; document.documentElement.dataset.look = look.id;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const r = layout.checkCurrentScreen();
    check(`${look.label}: Taste Map has no overlaps and readable text`, layoutClean(r), JSON.stringify({ map: r.mapOverlaps, txt: r.lowContrast.slice(0, 2) }).slice(0, 300));
  }
  await act('[data-profile-view="list"]');
  state.look = startLook; document.documentElement.dataset.look = startLook;

  // first visit: the bare address shows "Choose a starting look" before Favorites; a ?look= link goes straight in
  const frameCheck = (src, work) => new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1200px;height:900px;border:0";
    frame.onload = () => setTimeout(async () => { try { resolve(await work(frame.contentDocument, frame.contentWindow)); } catch (e) { resolve({ error: String(e) }); } frame.remove(); }, 500);
    frame.src = src;
    document.body.appendChild(frame);
  });
  const firstVisit = await frameCheck("/", async (doc) => {
    const out = { picker: Boolean(doc.querySelector(".look-screen")), look: doc.documentElement.dataset.look, button: doc.querySelector('[data-action="look-done"]')?.textContent.trim() };
    doc.querySelector('[data-action="look-done"]').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    out.afterContinue = Boolean(doc.querySelector(".favorites-screen")) && !doc.querySelector(".look-screen");
    return out;
  });
  check("first visit shows the look picker before Favorites", firstVisit.picker === true && firstVisit.look === "editorial", JSON.stringify(firstVisit));
  check("...starting on Clean editorial, with a 'Continue with' button", /^Continue with Clean editorial$/.test(firstVisit.button || ""), firstVisit.button);
  check("...and Continue goes on to Favorites", firstVisit.afterContinue === true, JSON.stringify(firstVisit));
  const linked = await frameCheck("/?look=collage", async (doc) => ({ picker: Boolean(doc.querySelector(".look-screen")), look: doc.documentElement.dataset.look, favorites: Boolean(doc.querySelector(".favorites-screen")) }));
  check("a ?look= link skips the picker and uses that look", linked.picker === false && linked.look === "collage" && linked.favorites === true, JSON.stringify(linked));
  const bogus = await frameCheck("/?look=nonsense", async (doc) => ({ look: doc.documentElement.dataset.look }));
  check("an unknown ?look= value is ignored", bogus.look === "editorial", JSON.stringify(bogus));



  // ---- Confidence (#26): inferred is not validated; the Profile and the Map say which ----
  const tastemapModel = await import("/src/model/tastemap.js");
  await act('.step[data-step-jump="model"]');
  const cards = $$(".signal-row");
  check("every pattern card shows its computed confidence level", cards.length === catalog.hypotheses.length &&
    cards.every((card, i) => card.querySelector(".signal-status")?.textContent.trim() === tastemapModel.confidenceOf(state, catalog.hypotheses[i]).level),
    cards.map((c) => c.querySelector(".signal-status")?.textContent.trim()).join(","));
  check("every pattern card says where its confidence comes from", cards.every((card, i) => card.querySelector(".signal-provenance")?.textContent.trim() === tastemapModel.confidenceOf(state, catalog.hypotheses[i]).provenance));
  check("the confidence labels are explained (a legend the user can open)", Boolean($(".profile-legend summary")) && /Emerging/.test($(".profile-legend").textContent) && /Strong/.test($(".profile-legend").textContent) && /Less certain/.test($(".profile-legend").textContent));
  check("the page says the patterns are a fixed starting set and reactions are what changes them", /fixed starting set/.test($(".profile-evidence-note").textContent));
  check("the favorites strip is labeled as your starting favorites, not what the patterns were built from", /Your starting favorites/.test($(".profile-evidence-label").textContent) && !/Built from/.test($(".profile-screen").textContent));
  check("an authored conditional pattern still carries its 'Conditional' flag", $$(".signal-flag").length === catalog.hypotheses.filter((h) => h.status === "conditional").length && $$(".signal-flag").length > 0);
  await act('[data-profile-view="map"]');
  const nodes = $$(".taste-map-node");
  check("the Map shows the same level as the Profile for every pattern", nodes.length === catalog.hypotheses.length &&
    catalog.hypotheses.every((h) => nodes.some((n) => n.textContent.includes(h.title) && n.querySelector(".map-node-conf")?.textContent.trim() === tastemapModel.confidenceOf(state, h).level)));
  check("the Map legend uses the new meanings", /Emerging, Supported or Still learning/.test($(".map-key")?.textContent || document.body.textContent));
  await act('[data-profile-view="list"]');

  // a brand-new visit: nothing you tried yet, so nothing may look validated
  const coldStart = await frameCheck("/?look=editorial", async (doc) => {
    doc.querySelector('[data-action="peek"], [data-action="show-model"], [data-step-jump="model"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { chips: [...doc.querySelectorAll(".signal-status")].map((n) => n.textContent.trim()), lines: [...doc.querySelectorAll(".signal-provenance")].map((n) => n.textContent.trim()) };
  });
  check("cold start: every pattern is Emerging, none Strong or Supported", coldStart.chips?.length === catalog.hypotheses.length && coldStart.chips.every((c) => c === "Emerging"), JSON.stringify(coldStart));
  check("cold start: each says it is a starting pattern that nothing has tested", coldStart.lines?.every((l) => /starting pattern/.test(l) && /Nothing you've tried/.test(l)), JSON.stringify(coldStart.lines));


  // ---- Pattern corrections on the Taste Profile (user-confirmed; not taste evidence) ----
  await act('.step[data-step-jump="model"]');
  const firstId = catalog.hypotheses[0].id;
  const firstTitle = catalog.hypotheses[0].title;
  const levelBeforeSay = $(".signal-row .signal-status")?.textContent.trim();
  const sayNotMe = `[data-statement-pattern="${firstId}"][data-statement-field="says"][data-statement-value="not-me"]`;
  check("each pattern card asks 'Is this you?' and 'How much does it matter?'", $$(".signal-say").length === catalog.hypotheses.length && $$(".signal-say-group[role=group]").length === catalog.hypotheses.length * 2);
  await act(sayNotMe);
  check("'Not really me' is saved, pressed, keeps focus and is announced", state.patternStatements.some((s) => s.hypothesisId === firstId && s.says === "not-me") &&
    $(sayNotMe)?.getAttribute("aria-pressed") === "true" && document.activeElement === $(sayNotMe) && live().includes(firstTitle), live());
  check("the card says it's left out of picks, and the pattern stays visible", /leaves it out of what it picks/.test($(".signal-row")?.textContent || "") && $(".signal-row")?.classList.contains("is-excluded"));
  check("saying 'not me' does not change the confidence level", $(".signal-row .signal-status")?.textContent.trim() === levelBeforeSay);
  await act("#open-mine");
  check("My Tastemake lists what you said", $$("[data-mine-said]").length === 1 && /isn't you/.test($("[data-mine-said]")?.textContent || ""));
  await act(`[data-mine-said-remove="${firstId}"]`);
  check("...and Remove clears it", state.patternStatements.length === 0 && $$("[data-mine-said]").length === 0 && /removed/.test(live()), live());
  await act('.step[data-step-jump="model"]');
  check("after removing, the card is back to normal", !$(".signal-row")?.classList.contains("is-excluded"));

  // ---- Start over (last: it clears everything) ----
  await act("#open-mine");
  await act('[data-mine-reset="arm"]');
  check("Start over asks first, and focus goes to the safe choice (Cancel)", Boolean($('[data-mine-reset="confirm"]')) && document.activeElement === $('[data-mine-reset="cancel"]'), document.activeElement?.textContent);
  check("...and announces the question", /Are you sure/.test(live()), live());
  const beforeReset = Object.keys(state.feedbackByRecommendation).length;
  await act('[data-mine-reset="cancel"]');
  check("Cancel clears nothing and puts focus back on Start over", Object.keys(state.feedbackByRecommendation).length === beforeReset && document.activeElement === $('[data-mine-reset="arm"]'));
  await act('[data-mine-reset="arm"]');
  const lookKept = state.look;
  await act('[data-mine-reset="confirm"]');
  check("Yes, clear everything empties reactions, bookmarks, custom items, blind spots and statements",
    Object.keys(state.feedbackByRecommendation).length === 0 && Object.keys(state.customItems).length === 0 && Object.keys(state.blindSpots).length === 0 && state.libraryFavorites.size === 0 && state.patternStatements.length === 0);
  check("...restores the starter favorites and default settings", state.selectedFavorites.size === catalog.favorites.filter((f) => f.selected).length && state.areas.play === true && state.curveball === true);
  check("...keeps your look", state.look === lookKept && document.documentElement.dataset.look === lookKept);
  check("...goes back to Favorites and announces it", state.screen === "favorites" && /Started over/.test(live()), `${state.screen} / ${live()}`);
  check("...and the Bookmarks tab is hidden again", bookmarksStep().hidden);

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : undefined, total: results.length };
}
