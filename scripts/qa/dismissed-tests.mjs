#!/usr/bin/env node
// #336: correcting the first choice (Tried it / Not tried) in Change, and recovering dismissed titles from
// Library's Dismissed view. Free, no browser, no network, no model call.
//
//   node scripts/qa/dismissed-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
const { state, resetState } = await import("../../src/state.js");
const { renderRecommendations } = await import("../../src/screens/recommendations.js");
const { renderBrowse } = await import("../../src/screens/browse.js");
const { renderLibrary, dismissedEntries } = await import("../../src/screens/library.js");
const { chooseExperiencePath, saveExperienceOutcome } = await import("../../src/actions/recommendations.js");
const { actOnNewRelease } = await import("../../src/ai/new-releases.js");
const { isDeclined, isExperienced } = await import("../../src/model/evidence.js");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("dismissed tests");

const show = (n, title) => ({ id: `tmdb-tv-${n}`, provider: "tmdb", providerId: String(n), title, type: "tv", domains: ["tv"], year: "2020", genres: ["35"], about: `${title}, a show.`, reason: `A reason for ${title}.` });
const setup = () => {
  resetState();
  state.onboarded = true;
  state.areas = { movies: true, tv: true, read: true, play: true };
};
const popover = (html) => html.match(/<div class="rec-feedback-popover[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] ?? html.slice(html.indexOf("rec-feedback-popover"));

// ---- 1. Change offers the first choice again -----------------------------------------------------------
{
  setup();
  const pick = show(1, "Picked Wrong");
  state.recommendationSets = [[pick]];
  state.screen = "recommendations";

  // Before any answer, the card's own rail asks; the editor doesn't repeat it.
  chooseExperiencePath(pick.id, "not-tried");
  state.recommendationFeedbackItemId = pick.id;
  check("before a reaction is saved, the editor doesn't repeat Tried it / Not tried", !popover(renderRecommendations()).includes("feedback-path-switch"));

  check("Not interested is saved", saveExperienceOutcome(pick.id, "not-interested") && isDeclined(state.feedbackByRecommendation[pick.id]));
  state.recommendationFeedbackItemId = pick.id;   // Change
  const editor = popover(renderRecommendations());
  check("Change offers Tried it / Not tried", editor.includes("feedback-path-switch") && /data-experience-path="tried"[^>]*aria-pressed="false"/.test(editor) && /data-experience-path="not-tried"[^>]*aria-pressed="true"/.test(editor), editor);

  check("choosing Tried it in Change is allowed", chooseExperiencePath(pick.id, "tried"));
  const tried = popover(renderRecommendations());
  check("...and shows Loved / Liked / Didn't like", /data-experience-outcome="loved"/.test(tried) && /data-experience-outcome="disliked"/.test(tried));
  check("...but the saved reaction isn't replaced until an answer is picked", isDeclined(state.feedbackByRecommendation[pick.id]));

  check("picking Liked it replaces the dismissal", saveExperienceOutcome(pick.id, "liked") && isExperienced(state.feedbackByRecommendation[pick.id]) && !isDeclined(state.feedbackByRecommendation[pick.id]));
}

// ---- 2. Switching away from Tried clears only structured answers that no longer apply ------------------
{
  setup();
  const pick = show(2, "Actually Never Watched");
  state.recommendationSets = [[pick]];
  saveExperienceOutcome(pick.id, "disliked");
  state.feedbackByRecommendation[pick.id].refinements = ["humor:not-my-style", "characters"];
  state.feedbackByRecommendation[pick.id].seriesExperience = "mixed";
  chooseExperiencePath(pick.id, "not-tried");
  saveExperienceOutcome(pick.id, "not-interested");
  const after = state.feedbackByRecommendation[pick.id];
  check("Tried → Not interested: the reaction is replaced", isDeclined(after));
  eq("its reasons are cleared (they were about having watched it)", JSON.stringify(after.refinements), "[]");
  eq("and its series answer too", after.seriesExperience, null);
  eq("the title itself is kept", after.item.title, pick.title);
}

// ---- 3. Browse's Change offers the same switch ---------------------------------------------------------
{
  setup();
  const item = show(3, "Browse Find");
  state.screen = "browse";
  state.browseItems = [item];
  saveExperienceOutcome(item.id, "not-interested");
  state.recommendationFeedbackItemId = item.id;
  const html = renderBrowse();
  check("Browse's Change offers Tried it / Not tried", html.includes("feedback-path-switch") && html.includes('data-experience-path="tried"'));
}

// ---- 4. Every dismissal lands in Dismissed, with Change -----------------------------------------------
{
  setup();
  const fromRecs = show(10, "From Recommendations"), fromBrowse = show(11, "From Browse"), fromNew = show(12, "From New This Week");
  state.recommendationSets = [[fromRecs]];
  state.browseItems = [fromBrowse];
  state.newReleases = { items: [fromNew] };
  saveExperienceOutcome(fromRecs.id, "not-interested");
  saveExperienceOutcome(fromBrowse.id, "not-interested");
  check("New this week stays one tap", Boolean(actOnNewRelease(state, fromNew.id, "not-interested")));
  saveExperienceOutcome(show(13, "Saved One").id, "save");   // not an item anywhere: ignored
  eq("all three are dismissed", dismissedEntries().map((f) => f.item.title).sort().join(" | "), "From Browse | From New This Week | From Recommendations");

  // A new recommendation set replaces the old one: the dismissed pick is no longer on screen.
  state.recommendationSets = [[show(20, "A New Pick")]];
  state.browseItems = [];
  state.screen = "library";
  state.libraryView = "saved";
  const saved = renderLibrary();
  check("Library links to Dismissed, with its count", /data-library-dismissed[^>]*>Dismissed <span>3<\/span>/.test(saved), saved.match(/library-dismissed-link[^\n]*/)?.[0]);
  check("Dismissed isn't a third tab", (saved.match(/role="tab"/g) ?? []).length === 2);

  state.libraryView = "dismissed";
  const view = renderLibrary();
  for (const title of ["From Recommendations", "From Browse", "From New This Week"]) check(`Dismissed lists "${title}" after the set changed`, view.includes(title));
  check("each row has Change", (view.match(/<summary>Change<\/summary>/g) ?? []).length === 3);
  check("Change offers Tried it answers and Save", view.includes('data-dismissed-outcome="loved"') && view.includes('data-dismissed-outcome="save"'));
  check("Not interested shows as the current answer", /data-dismissed-outcome="not-interested" aria-pressed="true"/.test(view));

  check("recovering one from Dismissed replaces the reaction", saveExperienceOutcome(fromRecs.id, "liked") && isExperienced(state.feedbackByRecommendation[fromRecs.id]));
  check("...and it leaves Dismissed", !renderLibrary().includes("From Recommendations"));
  check("Save moves one to Saved", saveExperienceOutcome(fromNew.id, "save") && !dismissedEntries().some((f) => f.item.id === fromNew.id));

  state.libraryFilter = "movies";
  check("the Library filter applies to Dismissed", renderLibrary().includes("Nothing dismissed in this category"));
  state.libraryFilter = "all";
}

// ---- 5. No dismissals, no link ---------------------------------------------------------------------------
{
  setup();
  state.screen = "library";
  state.libraryView = "saved";
  check("with nothing dismissed, Library shows no Dismissed link", !renderLibrary().includes("data-library-dismissed"));
}

finish();
