#!/usr/bin/env node
// "What put you off?" after Not interested (Paige, Nov 14): an optional note, stored apart from the dismissal,
// shown back in the card and in Library → Dismissed, and read by nothing that ranks or explains picks or
// builds the Taste Profile. Free, no browser, no network, no model call.
//
//   node scripts/qa/dismissal-note-tests.mjs

const stored = new Map();
let failWrites = false;
globalThis.localStorage = {
  getItem: (k) => stored.get(k) ?? null,
  setItem: (k, v) => { if (failWrites) throw new Error("QuotaExceededError"); stored.set(k, String(v)); },
  removeItem: (k) => stored.delete(k)
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { state, resetState } = await import("../../src/state.js");
const { renderRecommendations } = await import("../../src/screens/recommendations.js");
const { renderLibrary } = await import("../../src/screens/library.js");
const { saveExperienceOutcome } = await import("../../src/actions/recommendations.js");
const { closeDismissalPrompt, openDismissalPrompt, setDismissalDraft, submitDismissalNote } = await import("../../src/actions/dismissal-note.js");
const { DISMISSAL_NOTE_MAX, dismissalNoteFor, saveDismissalNote } = await import("../../src/model/dismissal-notes.js");
const { loadPersistedState, persistState } = await import("../../src/persistence.js");
const { evidenceRecords, isDeclined } = await import("../../src/model/evidence.js");
const { serializeAiState } = await import("../../src/ai/live-client.js");
const { hypothesisEvidenceKey } = await import("../../src/ai/hypothesis-profile.js");
const { buildBackup } = await import("../../src/model/export.js");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("dismissal note tests");

const show = (n, title) => ({ id: `tmdb-tv-${n}`, provider: "tmdb", providerId: String(n), title, type: "tv", domains: ["tv"], year: "2020", genres: ["35"], about: `${title}, a show.`, reason: `Because you liked Show ${n}.` });
const A = show(1, "Alpha"), B = show(2, "Bravo"), C = show(3, "Charlie");
function setup() {
  resetState();
  stored.clear();
  failWrites = false;
  Object.assign(state, { onboarded: true, setupComplete: true, screen: "recommendations", areas: { movies: true, tv: true, read: true, play: true } });
  state.recommendationSets = [[A, B, C]];
}
const effects = () => {
  const log = { renders: [], said: [] };
  let ok = true;
  return {
    log,
    failNext(value = true) { ok = !value; },
    persist: () => { const result = ok && persistState(state); return result; },
    rerender: (itemId, focus) => log.renders.push({ itemId, focus }),
    announce: (message) => log.said.push(message)
  };
};
const dismiss = (item) => { saveExperienceOutcome(item.id, "not-interested"); return openDismissalPrompt(item.id); };
const card = (html, item) => {
  const start = html.indexOf(`data-rec-id="${item.id}"`);
  const end = html.indexOf("</article>", start);
  return start < 0 ? "" : html.slice(start, end);
};

// ---- 1. Not interested dismisses straight away; the prompt is optional and offered after ----------------
{
  setup();
  const prompted = dismiss(A);
  check("Not interested dismisses the title immediately", isDeclined(state.feedbackByRecommendation[A.id]));
  check("…and the prompt is offered on Recommendations", prompted);
  const html = card(renderRecommendations(), A);
  check("the prompt sits on that pick's card", html.includes(`data-dismiss-note-form="${A.id}"`));
  check("a labelled multiline field", html.includes(`<label class="dismiss-note-label" for="dismiss-note-${A.id}">What put you off?`) && html.includes(`<textarea class="dismiss-note-input" id="dismiss-note-${A.id}"`));
  check("Submit and Skip", html.includes(`data-dismiss-note-submit="${A.id}"`) && html.includes(`data-dismiss-note-skip="${A.id}"`));
  check(`the field is capped at ${DISMISSAL_NOTE_MAX} characters`, html.includes(`maxlength="${DISMISSAL_NOTE_MAX}"`));
  check("the hint says it doesn't change picks or the profile", /doesn’t change your picks or Taste Profile/.test(html));
  check("the dismissal shows before any answer", html.includes("reaction-complete"));
  check("no prompt on another pick", !card(renderRecommendations(), B).includes("dismiss-note-form"));
  setup();
  state.screen = "browse";
  saveExperienceOutcome(A.id, "not-interested");
  check("not offered outside Recommendations (this first version)", !openDismissalPrompt(A.id));
}

// ---- 2. Submit saves against the right title, once ---------------------------------------------------
{
  setup();
  dismiss(A);
  const fx = effects();
  setDismissalDraft(A.id, "  Too dark for me.  ");
  eq("Submit saves", submitDismissalNote(A.id, fx), "saved");
  eq("…the note, trimmed, against that title", dismissalNoteFor(state, A.id)?.note, "Too dark for me.");
  eq("…with the title, its set and the reason it was shown with", JSON.stringify([state.dismissalNotes[A.id].title, state.dismissalNotes[A.id].setIndex, state.dismissalNotes[A.id].why]), JSON.stringify(["Alpha", 0, A.reason]));
  check("…the prompt closes", !state.dismissalPrompts[A.id]);
  check("…focus goes back to Change, and it's announced", fx.log.renders.at(-1)?.focus === `[data-feedback-edit="${A.id}"]` && fx.log.said.at(-1) === "Note saved with Alpha.");
  eq("a second Submit after saving does nothing", submitDismissalNote(A.id, fx), "ignored");
  eq("…so there is one note", Object.keys(state.dismissalNotes).length, 1);
  check("the dismissal is unchanged by the note", isDeclined(state.feedbackByRecommendation[A.id]) && !("note" in state.feedbackByRecommendation[A.id]));
  check("the card shows the note back", card(renderRecommendations(), A).includes("Your note:</span> “Too dark for me.”"));
  check("…and no longer asks", !card(renderRecommendations(), A).includes("dismiss-note-form"));
  check("not offered again for a title that already has a note", !openDismissalPrompt(A.id));

  // A press while a save is in flight is ignored.
  setup();
  dismiss(B);
  setDismissalDraft(B.id, "Not now.");
  state.dismissalPrompts[B.id].status = "saving";
  eq("a press while saving does nothing", submitDismissalNote(B.id, effects()), "ignored");
  check("…and stores nothing", !state.dismissalNotes[B.id]);
}

// ---- 3. Skip, blank and closing keep the dismissal and store nothing ----------------------------------
{
  setup();
  dismiss(A);
  closeDismissalPrompt(A.id);   // Skip
  check("Skip: still dismissed", isDeclined(state.feedbackByRecommendation[A.id]));
  check("Skip: no note", !state.dismissalNotes[A.id]);
  check("Skip: the prompt is gone", !card(renderRecommendations(), A).includes("dismiss-note-form"));

  dismiss(B);
  setDismissalDraft(B.id, "   \n  ");
  eq("whitespace-only Submit is treated as no note", submitDismissalNote(B.id, effects()), "blank");
  check("…nothing stored, still dismissed", !state.dismissalNotes[B.id] && isDeclined(state.feedbackByRecommendation[B.id]));

  dismiss(C);
  setDismissalDraft(C.id, "unsent words");
  persistState(state);
  const reloaded = loadPersistedState();
  check("leaving with an unsent draft: the dismissal survives a reload", isDeclined(reloaded.feedbackByRecommendation[C.id]));
  check("…and the unsent text is not saved", !JSON.stringify(reloaded).includes("unsent words") && !("dismissalPrompts" in reloaded));
}

// ---- 4. Rapid dismissals can't cross notes -----------------------------------------------------------
{
  setup();
  dismiss(A);
  dismiss(B);
  dismiss(C);
  setDismissalDraft(B.id, "The explanation didn't sell it.");
  setDismissalDraft(A.id, "I'm tired of this right now.");
  const html = renderRecommendations();
  check("three dismissals, three prompts, each on its own card", [A, B, C].every((item) => card(html, item).includes(`data-dismiss-note-form="${item.id}"`)));
  check("each draft stays on its own card", card(html, B).includes("The explanation didn&#39;t sell it.") || card(html, B).includes("The explanation didn't sell it."));
  submitDismissalNote(B.id, effects());
  eq("submitting one saves only that title's note", Object.keys(state.dismissalNotes).join(","), B.id);
  eq("…with its own words", state.dismissalNotes[B.id].note, "The explanation didn't sell it.");
  check("…the other prompts stay open with their drafts", state.dismissalPrompts[A.id]?.draft === "I'm tired of this right now." && state.dismissalPrompts[C.id]);
}

// ---- 5. A failed save keeps the dismissal and the text, and can be retried ------------------------------
{
  setup();
  dismiss(A);
  setDismissalDraft(A.id, "Too long.");
  const fx = effects();
  failWrites = true;
  eq("a save that can't be written reports an error", submitDismissalNote(A.id, fx), "error");
  check("…no note is kept", !state.dismissalNotes[A.id]);
  check("…the title is still dismissed", isDeclined(state.feedbackByRecommendation[A.id]));
  check("…the text is still in the open prompt", state.dismissalPrompts[A.id]?.draft === "Too long.");
  check("…focus returns to the field, and it's announced", fx.log.renders.at(-1)?.focus === `[data-dismiss-note-input="${A.id}"]` && /Couldn’t save your note\. Alpha is still dismissed\./.test(fx.log.said.at(-1)));
  const html = card(renderRecommendations(), A);
  check("…the card says so with a retry, and shows no success", html.includes('role="alert"') && html.includes("Try again") && !html.includes("Your note:"));
  failWrites = false;
  eq("retry succeeds", submitDismissalNote(A.id, fx), "saved");
  eq("…once", Object.keys(state.dismissalNotes).length, 1);
  eq("persistState reports a failed write", (() => { failWrites = true; const r = persistState(state); failWrites = false; return r; })(), false);
}

// ---- 6. Persistence, backup, recovery -----------------------------------------------------------------
{
  setup();
  dismiss(A);
  setDismissalDraft(A.id, "I don't know, just not interested.");
  submitDismissalNote(A.id, effects());
  const reloaded = loadPersistedState();
  eq("the note survives a reload", reloaded.dismissalNotes?.[A.id]?.note, "I don't know, just not interested.");
  stored.set("tastemake:test-state:v1", JSON.stringify({ version: 1, state: { ...JSON.parse(stored.get("tastemake:test-state:v1")).state, dismissalNotes: { x: 3, [A.id]: { note: "ok" } } } }));
  const checked = loadPersistedState();
  check("a malformed note entry is dropped on load, a good one kept", !checked.dismissalNotes.x && checked.dismissalNotes[A.id]?.note === "ok");
  check("the backup includes notes", JSON.stringify(buildBackup(state)).includes("I don't know, just not interested."));

  state.screen = "library";
  state.libraryView = "dismissed";
  check("Library → Dismissed shows the note with the title", renderLibrary().includes("Your note:</span> “I don&#39;t know, just not interested.”") || renderLibrary().includes("Your note:</span> “I don't know, just not interested.”"));
  saveExperienceOutcome(A.id, "save");
  check("recovering the title from Dismissed still works", !isDeclined(state.feedbackByRecommendation[A.id]));
  check("…and its note is no longer shown, since it isn't dismissed", dismissalNoteFor(state, A.id) === null);
}

// ---- 7. The note teaches nothing yet: no evidence, no profile input, nothing sent ----------------------
{
  setup();
  saveExperienceOutcome(A.id, "liked");
  saveExperienceOutcome(B.id, "not-interested");
  const evidenceBefore = JSON.stringify(evidenceRecords(state));
  const keyBefore = hypothesisEvidenceKey(state);
  const wireBefore = JSON.stringify(serializeAiState(state));
  const exclusionsBefore = JSON.stringify(state.exclusions);
  saveDismissalNote(state, B.id, "Too dark for me. Never show me superheroes.");
  eq("taste evidence is unchanged by a note", JSON.stringify(evidenceRecords(state)), evidenceBefore);
  eq("the Taste Profile's evidence key is unchanged, so no refresh is triggered", hypothesisEvidenceKey(state), keyBefore);
  eq("the recommendations request is byte-identical (the note is never sent)", JSON.stringify(serializeAiState(state)), wireBefore);
  eq("no exclusion is created, whatever the note says", JSON.stringify(state.exclusions), exclusionsBefore);
  check("a dismissal with no note adds no note", !state.dismissalNotes[A.id]);
  eq("the note text is stored as written", state.dismissalNotes[B.id].note, "Too dark for me. Never show me superheroes.");
  check("only a dismissed title can hold a note", saveDismissalNote(state, A.id, "words") === null);
}

// ---- 8. The note is escaped wherever it shows --------------------------------------------------------
{
  setup();
  dismiss(A);
  setDismissalDraft(A.id, `<img src=x onerror=alert(1)>`);
  const draftHtml = card(renderRecommendations(), A);
  check("an unsent draft is escaped in the field", !draftHtml.includes("<img src=x") && draftHtml.includes("&lt;img"));
  submitDismissalNote(A.id, effects());
  const savedHtml = card(renderRecommendations(), A);
  check("a saved note is escaped on the card", !savedHtml.includes("<img src=x") && savedHtml.includes("&lt;img"));
}

finish();
