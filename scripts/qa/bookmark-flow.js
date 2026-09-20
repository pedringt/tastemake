// Browser-side flow check for Bookmark + Keep discovering + the taste-evidence rule + keeping the
// user's place (focus, announcements) + the Taste Profile lean. No dependencies.
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
    !r.titleCollisions.length && !r.textUnderControls.length && !r.hScroll;
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
