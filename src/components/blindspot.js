import { state } from "../state.js";
import { REASONS, blindSpotFor, isBlindSpotCandidate, patternsFor, reasonLabel } from "../model/blindspots.js";
import { esc } from "../lib/html.js";

// The Blind Spot panel (#20): offered on a pick Tastemake was confident about that the user tried and
// disliked. Two tappable questions, then a summary the user can keep, change or discard. The steps live in
// state.blindSpotDrafts, so re-rendering a screen never loses your place.


function chip(itemId, action, value, label, pressed) {
  return `<button class="detail-chip blind-chip" type="button" data-blind-item="${itemId}" data-blind-action="${action}" data-blind-value="${value}" aria-pressed="${pressed}">${esc(label)}</button>`;
}
function control(itemId, action, label, className = "button button-secondary", disabled = false) {
  return `<button class="${className} blind-button" type="button" data-blind-item="${itemId}" data-blind-action="${action}"${disabled ? " disabled" : ""}>${label}</button>`;
}
const heading = (itemId, text) => `<p class="blind-title" tabindex="-1" data-blind-focus="${itemId}">${text}</p>`;

function summaryText(item, draft) {
  const patterns = patternsFor(item);
  const named = patterns.filter((pattern) => draft.broken.includes(pattern.id)).map((pattern) => `\u201c${esc(pattern.title)}\u201d`);
  const why = draft.reasons.length ? ` It got in the way mostly because of ${draft.reasons.map((id) => esc(reasonLabel(id).toLowerCase())).join(", ")}.` : "";
  const which = draft.none
    ? "None of the patterns it leaned on seem to be the problem, so Tastemake may be missing something else about you."
    : `You said ${named.join(" and ")} didn't hold up for this one.`;
  return `Tastemake expected you to like ${esc(item.title)} (${esc(item.prediction)}). ${which}${why}`;
}

export function renderBlindSpotPanel(itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!isBlindSpotCandidate(feedback)) return "";
  const { item } = feedback;
  const draft = state.blindSpotDrafts[itemId];
  const saved = blindSpotFor(state, itemId);

  if (draft) {
    const patterns = patternsFor(item);
    const head = `<div class="blind-panel" data-blind-panel="${itemId}" role="group" aria-label="What did Tastemake get wrong about ${esc(item.title)}?">`;
    if (draft.step === 1) {
      return `${head}
        ${heading(itemId, "Which of the reasons Tastemake picked this didn't hold up for you?")}
        <div class="detail-chip-row">
          ${patterns.map((pattern) => chip(itemId, "toggle-pattern", pattern.id, pattern.title, draft.broken.includes(pattern.id))).join("")}
          ${chip(itemId, "toggle-pattern", "none", "None of these. It was something else.", draft.none)}
        </div>
        <div class="blind-actions">${control(itemId, "next", "Next", "button button-primary", !draft.broken.length && !draft.none)}${control(itemId, "discard", "Cancel", "button button-quiet")}</div>
      </div>`;
    }
    if (draft.step === 2) {
      return `${head}
        ${heading(itemId, "What got in the way? Pick any that fit, or skip.")}
        <div class="detail-chip-row">
          ${REASONS.map((reason) => chip(itemId, "toggle-reason", reason.id, reason.label, draft.reasons.includes(reason.id))).join("")}
        </div>
        <div class="blind-actions">${control(itemId, "next", "Next", "button button-primary")}${control(itemId, "back", "Back", "button button-quiet")}</div>
      </div>`;
    }
    return `${head}
      ${heading(itemId, "Does this sound right?")}
      <p class="blind-summary">${summaryText(item, draft)}</p>
      <p class="blind-note">Tastemake keeps this as evidence about its own guesses. One miss won't rewrite what it thinks of you.</p>
      <div class="blind-actions">${control(itemId, "save", "Yes, keep it", "button button-primary")}${control(itemId, "edit", "Change my answers", "button button-secondary")}${control(itemId, "discard", "Discard", "button button-quiet")}</div>
    </div>`;
  }

  if (saved) {
    return `<div class="blind-panel is-saved" data-blind-panel="${itemId}">
      ${heading(itemId, "Noted as a blind spot.")}
      <p class="blind-summary">${summaryText(item, { broken: saved.hypotheses, none: saved.none, reasons: saved.reasons })}</p>
      <div class="blind-actions">${control(itemId, "edit", "Change my answers", "button button-secondary")}${control(itemId, "remove", "Remove", "button button-quiet")}</div>
    </div>`;
  }

  if (state.blindSpotDismissed.has(itemId)) {
    return `<div class="blind-panel is-quiet" data-blind-panel="${itemId}">${control(itemId, "start", "Tell Tastemake what it got wrong", "button button-quiet")}</div>`;
  }

  return `<div class="blind-panel is-offer" data-blind-panel="${itemId}" role="group" aria-label="Help Tastemake learn from this miss">
    ${heading(itemId, `Tastemake expected you to like this (${esc(item.prediction)}). Want to help it see what it got wrong?`)}
    <p class="blind-note">Two quick taps. A miss like this tells Tastemake more than a hit.</p>
    <div class="blind-actions">${control(itemId, "start", "Yes, ask me", "button button-primary")}${control(itemId, "dismiss", "Not now", "button button-quiet")}</div>
  </div>`;
}
