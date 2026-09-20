// Browser-side flow check for Bookmark + Keep discovering + the taste-evidence rule + keeping the
// user's place (focus, announcements) + the Taste Profile lean + the Library + Search. No dependencies.
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
  const layout = await import("/scripts/qa/layout-check.js");
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
  const layoutClean = (r) => !r.stickerTextHits.length && !r.stickerBoxHits.length && !r.stickerOutside.length &&
    !r.titleCollisions.length && !r.textUnderControls.length && !r.topbarOverlaps.length && !r.hScroll;
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

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : undefined, total: results.length };
}
