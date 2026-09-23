// #39: focus restoration shared by every action group. Every action re-renders the screen, which
// would otherwise drop keyboard focus to the page; these two functions are how a handler says "put
// focus back here" without app.js needing to hold each feature's own markup knowledge.

export function focusSelectorFor(el) {
  const d = el?.dataset;
  if (!d) return null;
  if (d.feedbackItem && d.rating) return `[data-feedback-item="${d.feedbackItem}"][data-rating="${d.rating}"]`;
  if (d.feedbackItem && d.feedbackDetail) return `[data-feedback-item="${d.feedbackItem}"][data-feedback-detail="${d.feedbackDetail}"]`;
  if (d.feedbackItem && d.feedbackQuality) return `[data-feedback-item="${d.feedbackItem}"][data-feedback-quality="${d.feedbackQuality}"]`;
  if (d.bookmarkItem && d.bookmarkAction) return `[data-bookmark-item="${d.bookmarkItem}"][data-bookmark-action="${d.bookmarkAction}"]`;
  if (d.libraryItem && d.libraryAction) return `[data-library-item="${d.libraryItem}"][data-library-action="${d.libraryAction}"]`;
  if (d.blindItem && d.blindAction) return `[data-blind-item="${d.blindItem}"][data-blind-action="${d.blindAction}"]${d.blindValue ? `[data-blind-value="${d.blindValue}"]` : ""}`;
  if (d.mineItem && d.mineAction) return `[data-mine-item="${d.mineItem}"][data-mine-action="${d.mineAction}"]`;
  if (d.mineBlindRemove) return `[data-mine-blind-remove="${d.mineBlindRemove}"]`;
  if (d.mineReset) return `[data-mine-reset="${d.mineReset === "arm" ? "cancel" : "arm"}"]`;
  if (d.statementPattern) return `[data-statement-pattern="${d.statementPattern}"][data-statement-field="${d.statementField}"][data-statement-value="${d.statementValue}"]`;
  if (d.scopePattern) return `[data-scope-pattern="${d.scopePattern}"][data-scope-domain="${d.scopeDomain}"]`;
  if (d.mineSaidRemove) return null;
  if (d.profileView) return `[data-profile-view="${d.profileView}"]`;
  if (d.mapPattern) return `[data-map-pattern="${d.mapPattern}"]`;
  if (d.mapItem) return `[data-map-item="${d.mapItem}"]`;
  if (d.favorite) return `[data-favorite="${d.favorite}"]`;
  if (d.domainFilter && d.filterScope) return `[data-domain-filter="${d.domainFilter}"][data-filter-scope="${d.filterScope}"]`;
  return null;
}

export function restoreFocusIn(app, selector, fallback = app) {
  const target = (selector && app.querySelector(selector)) || fallback;
  target.focus({ preventScroll: true });
}
