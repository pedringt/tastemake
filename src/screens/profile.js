import { state } from "../state.js";
import { canKeepDiscovering } from "../model/taste.js";
import { CONTEXT, RECONFIRM_LABEL, canReconfirm, needsReviewText, patternDisplayStatus, reconfirmText, statementFor, statementSummary } from "../model/statements.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { activeBlindSpots, blindSpotsFor, isRecurring, recurringThemes } from "../model/blindspots.js";
import { displayLabel, domainById, visibleDomains } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { libraryItems } from "../model/library.js";
import { evidenceRecords } from "../model/evidence.js";
import { renderTasteMap } from "./tastemap.js";
import { AI_PAUSED_EXPLAINER } from "../ai/ai-status.js";
import { levelChangeConsequence } from "../model/history.js";
import { exampleLinkHtml, isViewingExample } from "../example-profile.js";
import { featuredCorrection } from "../model/featured-correction.js";
import { partlyAreasReachPicks } from "../ai/corrections.js";
import { NOTE_MAX, PARTLY_DIFFERENT_SIDE, canMarkDoesntFit, excludedRefsOf } from "../model/partly-elements.js";

// #358: progressive disclosure. An unanswered pattern shows its statement, one supporting example and the
// question; follow-ups appear only after an answer, and an answered pattern collapses to a summary with
// Change. This is screen state for this visit only (never saved), so a reload shows every answered pattern
// as its summary. `changed` is the answer just given on a pattern: its consequence line shows only then.
// #323 phase 2: `framing` is the answer to "Wrong for all of them, or just certain ones?" on a Partly pattern, for
// this visit only (what it leads to is saved; the question itself isn't).
const disclosure = { open: new Set(), refine: new Set(), changed: new Map(), framing: new Map(), correctedShown: false };

export function openPattern(id, { refine = false } = {}) {
  disclosure.open.add(id);
  if (refine) disclosure.refine.add(id);
}
export function closePattern(id) {
  disclosure.open.delete(id);
  disclosure.refine.delete(id);
  disclosure.changed.delete(id);
  disclosure.framing.delete(id);
}
export function setPartlyFraming(id, value) {
  if (!["all", "titles"].includes(value)) return false;
  disclosure.framing.set(id, value);
  disclosure.open.add(id);
  return true;
}
export function toggleRefine(id) {
  if (disclosure.refine.has(id)) disclosure.refine.delete(id);
  else disclosure.refine.add(id);
}
export function noteAnswer(id, field) {
  disclosure.open.add(id);
  disclosure.changed.set(id, field);
}
export function resetDisclosure() {
  disclosure.open.clear();
  disclosure.refine.clear();
  disclosure.changed.clear();
  disclosure.framing.clear();
  disclosure.correctedShown = false;
}
const isOpen = (item, said) => !said?.says || disclosure.open.has(item.id);
// A pattern just answered "No" stays where it is until Done, so the acknowledgement is seen where it was given.
const keptInPlace = (statements) => new Set((statements ?? [])
  .filter((s) => s?.says === "not-me" && disclosure.open.has(s.hypothesisId) && disclosure.changed.get(s.hypothesisId) === "says")
  .map((s) => s.hypothesisId));

const areaLabel = (id) => domainById(id)?.label ?? id;

function sayButton(item, field, value, label, said) {
  const pressed = said?.[field] === value;
  return `<button type="button" class="button button-secondary signal-say-button" data-statement-pattern="${item.id}" data-statement-field="${field}" data-statement-value="${value}" aria-pressed="${pressed}">${label}</button>`;
}

function disclosureButton(item, action, label, extra = "") {
  return `<button type="button" class="button button-quiet signal-disclosure-button signal-${action}-button" data-disclosure-pattern="${item.id}" data-disclosure-action="${action}"${extra}>${label}</button>`;
}

// #36: a lighter correction than "Not really me" — scope a pattern out of one domain without
// rejecting it everywhere. Only shown when the pattern has been backed in more than one domain,
// since a single-domain pattern has nothing to scope down from.
function domainScopeControls(item, record) {
  const domains = [...new Set([...record.scope.supported, ...record.scope.excluded])];
  if (domains.length < 2) return "";
  const excluded = record.scope.excluded;
  return `
    <div class="signal-say signal-scope" role="group" aria-label="Where does “${esc(item.title)}” apply?">
      <span class="signal-say-label signal-scope-label">This pattern applies to</span>
      <div class="signal-scope-options">
        ${domains.map((domainId) => {
          const label = domainById(domainId)?.label ?? domainId;
          const isExcluded = excluded.includes(domainId);
          return `<button type="button" class="signal-scope-option" data-scope-pattern="${item.id}" data-scope-domain="${domainId}" aria-pressed="${!isExcluded}" aria-label="${esc(label)}: ${isExcluded ? "not included" : "included"}">
            <span class="signal-scope-check" aria-hidden="true">${isExcluded ? "" : "✓"}</span>
            <span>${esc(label)}</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
}

// Pattern corrections: what the user says here is user-confirmed and outranks inference, but it is not taste
// evidence, so it never changes the confidence level (see src/model/statements.js).
// #252: after "Yes", the user can say the pattern also holds in areas it has no evidence in yet.
function alsoAppliesControls(item, said) {
  // A pattern with no area yet (PR #329: reconfirming never invents one) has nothing to be "also" true beyond.
  if (!(item.domains ?? []).length) return "";
  const others = visibleDomains().filter((domain) => !(item.domains ?? []).includes(domain.id) && state.areas?.[domain.id] !== false);
  if (!others.length) return "";
  const chosen = said?.alsoAppliesTo ?? [];
  return `
            <div class="signal-say-group" role="group" aria-label="Is “${esc(item.title)}” also true for other areas?">
              <span class="signal-say-label">Also true for</span>
              ${others.map((domain) => `<button type="button" class="button button-secondary signal-say-button" data-also-pattern="${item.id}" data-also-domain="${domain.id}" aria-pressed="${chosen.includes(domain.id)}">${esc(domain.label)}</button>`).join("")}
            </div>`;
}

// #358: after Yes, refining is optional and closed until asked for; Partly offers only the context and area
// options that exist today (which part fits waits for #323); No and Not sure ask nothing more.
function sayControls(item, said, record, records = new Map()) {
  const fit = said?.says ?? null;
  const primary = `
    <div class="signal-say-primary" role="group" aria-label="Does “${esc(item.title)}” sound right?">
      <span class="signal-say-label">Does this sound right?</span>
      ${sayButton(item, "says", "accurate", "Yes", said)}
      ${sayButton(item, "says", "partial", "Partly", said)}
      ${sayButton(item, "says", "not-me", "No", said)}
      ${sayButton(item, "says", "unsure", "Not sure", said)}
    </div>`;

  if (fit === "accurate") {
    const refining = disclosure.refine.has(item.id);
    return `
      <div class="signal-say">
        ${primary}
        <div class="signal-refine">
          ${disclosureButton(item, "refine", "Refine this <span class=\"signal-optional\">(optional)</span>", ` aria-expanded="${refining}" aria-controls="refine-${esc(item.id)}"`)}
          <div class="signal-followups" id="refine-${esc(item.id)}"${refining ? "" : " hidden"}>
            ${refining ? `
            <div class="signal-say-group" role="group" aria-label="How important is “${esc(item.title)}” to your taste?">
              <span class="signal-say-label">How important is it?</span>
              ${sayButton(item, "weight", "lot", "Important to my taste", said)}
              ${sayButton(item, "weight", "little", "Nice, but not important", said)}
            </div>
            <div class="signal-say-group" role="group" aria-label="How often is “${esc(item.title)}” true for you?">
              <span class="signal-say-label">How often is this true for you?</span>
              ${sayButton(item, "context", "broad", "Usually", said)}
              ${sayButton(item, "context", "some", "Depends", said)}
            </div>
            ${alsoAppliesControls(item, said)}` : ""}
          </div>
        </div>
      </div>`;
  }

  if (fit === "partial") {
    return `
      <div class="signal-say">
        ${primary}
        <div class="signal-followups signal-followups-partial">
          <span class="signal-followup-heading">What makes it only partly true?</span>
          <div class="signal-say-group" role="group" aria-label="What makes “${esc(item.title)}” only partly true?">
            ${sayButton(item, "context", "some", "Depends on context", said)}
            ${sayButton(item, "context", "unsure", "Not sure yet", said)}
          </div>
          ${domainScopeControls(item, record)}
          ${partlyFraming(item, said, records)}
        </div>
      </div>`;
  }

  return `<div class="signal-say">${primary}</div>`;
}

// #323 phase 2 (docs/proposals/323-partly-plan.md, section 3): after Partly, whether the whole pattern is off or
// only certain titles. "Just certain ones" lists the titles the pattern cites. "Doesn't fit this description" is
// live and needs no AI (src/model/partly-elements.js); "Fits a different side of my taste" is only offered while
// PARTLY_DIFFERENT_SIDE is on, and is saved without changing anything yet. "Wrong for all of them" has nothing
// new to save until the suggestion step (phase 4), so it says what the Partly answer already does.
const partlyButton = (item, action, label, { ref = "", value = "", pressed = null, extra = "" } = {}) =>
  `<button type="button" class="button button-secondary signal-say-button" data-partly-pattern="${esc(item.id)}" data-partly-action="${action}"${ref ? ` data-partly-ref="${esc(ref)}"` : ""}${value ? ` data-partly-value="${value}"` : ""}${pressed === null ? "" : ` aria-pressed="${pressed}"`}${extra}>${label}</button>`;

export const NOT_CITED_TEXT = "No longer cited by this pattern, because you said it doesn’t fit this description. Your rating of it still counts everywhere else, and the pattern’s wording stays the same.";
export const WRONG_FOR_ALL_TEXT = "Your Partly answer covers that for now: the pattern is kept, and the AI is told to use it cautiously and not broaden it. Its wording stays as it is.";
export const DIFFERENT_SIDE_TEXT = "Saved with your answer. Tastemake doesn’t use it yet: this pattern still cites the title, and your picks and Taste Profile don’t change.";
export const LAST_TITLE_TEXT = "This is the only title left behind this pattern. If the pattern doesn’t describe you, answer No instead.";

function excludedTitleRow(item, ref, records) {
  const title = records.get(ref)?.title ?? "A title you rated";
  return `
    <li class="signal-partly-title is-not-cited">
      <span class="signal-partly-title-name">${esc(title)}</span>
      <span class="signal-partly-title-note">${esc(NOT_CITED_TEXT)}</span>
      ${partlyButton(item, "undo", "Undo", { ref, extra: ` aria-label="Undo: cite “${esc(title)}” in this pattern again"` })}
    </li>`;
}

function citedTitleRow(item, ref, said, records) {
  const title = records.get(ref)?.title;
  if (!title) return "";
  const answer = said?.elements?.titles?.[ref] ?? null;
  const different = PARTLY_DIFFERENT_SIDE && answer?.verdict === "different";
  const canExclude = canMarkDoesntFit(state, item.id, ref);
  return `
    <li class="signal-partly-title">
      <span class="signal-partly-title-name">${esc(title)}</span>
      <div class="signal-partly-options" role="group" aria-label="Does “${esc(title)}” fit “${esc(item.title)}”?">
        ${partlyButton(item, "belongs", "Belongs", { ref, pressed: !different })}
        ${canExclude ? partlyButton(item, "doesnt-fit", "Doesn’t fit this description", { ref, pressed: false }) : ""}
        ${PARTLY_DIFFERENT_SIDE ? partlyButton(item, "different", "Fits a different side of my taste", { ref, pressed: different }) : ""}
      </div>
      ${canExclude ? "" : `<span class="signal-partly-title-note">${esc(LAST_TITLE_TEXT)}</span>`}
      ${different ? `
      <span class="signal-partly-title-note">${esc(DIFFERENT_SIDE_TEXT)}</span>
      <form class="signal-partly-note" data-partly-note-form="${esc(item.id)}" data-partly-ref="${esc(ref)}" novalidate>
        <label for="partly-note-${esc(item.id)}-${esc(ref)}">What’s different about it? <span class="signal-optional">(optional)</span></label>
        <textarea id="partly-note-${esc(item.id)}-${esc(ref)}" rows="2" maxlength="${NOTE_MAX}">${esc(answer.note ?? "")}</textarea>
        <button class="button button-secondary" type="submit">Save note</button>
      </form>` : ""}
    </li>`;
}

function partlyFraming(item, said, records) {
  const excluded = excludedRefsOf(item);
  const answered = Object.keys(said?.elements?.titles ?? {}).length > 0 || excluded.length > 0;
  const framing = disclosure.framing.get(item.id) ?? (answered ? "titles" : null);
  const cited = (item.supports ?? []).filter((ref) => records.get(ref)?.title);
  return `
          <div class="signal-say-group signal-partly-framing" role="group" aria-label="Is “${esc(item.title)}” wrong for all of its titles, or just certain ones?">
            <span class="signal-say-label">Wrong for all of them, or just certain ones?</span>
            ${partlyButton(item, "framing", "Wrong for all of them", { value: "all", pressed: framing === "all" })}
            ${partlyButton(item, "framing", "Just certain ones", { value: "titles", pressed: framing === "titles" })}
          </div>
          ${framing === "all" ? `<p class="signal-partly-explainer">${esc(WRONG_FOR_ALL_TEXT)}</p>` : ""}
          ${framing === "titles" ? `
          <div class="signal-partly-titles">
            <span class="signal-say-label">Which titles are off? Each one belongs unless you say otherwise.</span>
            <ul>
              ${cited.map((ref) => citedTitleRow(item, ref, said, records)).join("")}
              ${excluded.map((ref) => excludedTitleRow(item, ref, records)).join("")}
            </ul>
          </div>` : ""}`;
}

export function partitionProfilePatterns(patterns = [], statements = [], keep = new Set()) {
  const rejectedIds = new Set(
    (statements ?? []).filter((entry) => entry?.says === "not-me" && !keep.has(entry.hypothesisId)).map((entry) => entry.hypothesisId)
  );
  return {
    active: (patterns ?? []).filter((item) => !rejectedIds.has(item.id)),
    corrected: (patterns ?? []).filter((item) => rejectedIds.has(item.id))
  };
}

// Nov 3, 2026 (T1): say only what the software does. Corrections are enforced in the Taste Profile; for
// recommendations they are passed to the AI as instructions, and they do not reach candidate scoring or the
// catalog fallback (#334). So no line here promises that future picks will change, and an AI instruction is
// described as an instruction. #358: plainer wording, shown only right after the answer that changed something.
const CONSEQUENCE = {
  says: {
    accurate: "Confirmed. Refreshes keep this wording.",
    partial: "Kept, but the AI is told to use it cautiously and not broaden it.",
    "not-me": "Removed from your Taste Profile. Picks can still resemble these titles, because your ratings still count. When you’re done, it’s listed under Corrected patterns, where you can change it.",
    // Nov 9 (feedback semantics D6): "Not sure" means unconfirmed, not weaker. Nothing caps the level.
    unsure: "Tastemake won’t present this pattern to its AI as something you agreed with. Its level still reflects the evidence."
  },
  // When AI is paused, picks come from the catalog, which doesn't read this answer.
  weight: {
    lot: "When AI chooses your picks, it’s told this matters more to you. Your ratings still decide which titles it can choose from.",
    little: "When AI chooses your picks, it’s told this matters less to you. Your ratings still decide which titles it can choose from."
  },
  // The refresh check caps a context-dependent pattern at Supported (src/ai/validate.js); the level shown now
  // changes only when the profile is next refreshed.
  context: { some: "Marked as depending on context. From the next refresh, its level can’t go above Supported." }
};

// Nov 15: a Partly's unticked areas also move matching titles down the shortlist (src/ai/corrections.js),
// but only when the pattern's kind can be read from its titles' labels; otherwise nothing is promised.
const picksLine = (areas) => ` In ${areas.join(", ")}, titles like this also move lower in your picks.`;

function statementConsequence(said, field, reachesPicks = false) {
  if (!said?.says || !field) return "";
  let text = "";
  if (field === "scope") {
    const excluded = (said.excludedDomains ?? []).map(areaLabel);
    if (excluded.length) text = `Your Taste Profile won’t apply it to ${excluded.join(", ")}.${reachesPicks ? picksLine(excluded) : ""}`;
  } else if (field === "also") {
    // #252: passed to the picks prompt only (catalog fallback doesn't read it), and never evidence there.
    const also = (said.alsoAppliesTo ?? []).map(areaLabel);
    text = also.length
      ? `When AI chooses your picks, it’s told this also holds for ${also.join(", ")}. That’s your word, not something you’ve tried there, so its level doesn’t change.`
      : "No longer marked as true for another area.";
  } else {
    text = CONSEQUENCE[field]?.[said[field]] ?? "";
  }
  if (!text) return "";
  return `<div class="signal-consequence"><strong>What this changes</strong><span>${esc(text)}</span></div>`;
}

function summaryLine(item, said) {
  const parts = statementSummary(said, areaLabel);
  return `
    <div class="signal-summary">
      <span class="signal-summary-label"><span class="visually-hidden">Your answer: </span>${parts.map((part) => `<span>${esc(part)}</span>`).join(`<span aria-hidden="true"> · </span>`)}</span>
      ${disclosureButton(item, "change", "Change", ` aria-label="Change your answer about “${esc(item.title)}”"`)}
    </div>`;
}

// #250: the reasons the user gave on items this pattern cites, in their own words and per item. These
// describe one experience each; the line never restates them as a conclusion about the user.
const lowerFirst = (text) => String(text ?? "").charAt(0).toLowerCase() + String(text ?? "").slice(1);

function saidReasonsLine(item, records) {
  const refs = [...new Set([...(item.supports ?? []), ...(item.counters ?? [])])];
  const rows = refs
    .map((ref) => records.get(ref))
    .filter((record) => record?.refinements?.length)
    .map((record) => `<span class="signal-said-reason"><em>${esc(record.title)}</em>: ${esc(record.refinements.map((r) => lowerFirst(r.label)).join(", "))}</span>`);
  if (!rows.length) return "";
  // Nov 6 (#318): these are the reasons given for each title, not for this pattern. "You said" under
  // "Mythic and fantastical worlds" read as if atmosphere/exploration had been said about mythic settings.
  return `<div class="signal-evidence signal-said-reasons"><span>Your reasons for these titles</span> ${rows.join(" · ")}</div>`;
}

// #323 phase 2: titles taken off this pattern ("Doesn't fit this description"), each with Undo, whatever the
// current answer is, so an exclusion can always be undone from the pattern.
function notCitedLine(item, records) {
  const refs = excludedRefsOf(item);
  if (!refs.length) return "";
  return `<div class="signal-evidence signal-not-cited"><span>No longer cited here, because you said ${refs.length === 1 ? "it doesn’t" : "they don’t"} fit this description</span> ${refs.map((ref) => {
    const title = records.get(ref)?.title ?? "A title you rated";
    return `<span class="signal-not-cited-title"><em>${esc(title)}</em> ${partlyButton(item, "undo", "Undo", { ref, extra: ` aria-label="Undo: cite “${esc(title)}” in this pattern again"` }).replace("button-secondary", "button-quiet")}</span>`;
  }).join(" · ")}</div>`;
}

// #358: one short supporting example up front; the full evidence, the reasons and the blind spots expand.
function evidenceBlock(item, records, blindLine) {
  const example = (item.supports ?? []).map((ref) => records.get(ref)?.title).find(Boolean);
  return `
    ${example ? `<p class="signal-example"><span>For example</span> ${esc(example)}</p>` : ""}
    <details class="signal-more">
      <summary>What this comes from</summary>
      <div class="signal-evidence">${esc(item.evidence)}</div>
      ${saidReasonsLine(item, records)}
      ${notCitedLine(item, records)}
      <div class="signal-provenance">${esc(item.provenance ?? "Live AI interpretation.")}</div>
      ${blindLine}
    </details>`;
}

function hypothesisCard(item, index, records = new Map()) {
  const update = { level: item.strength ?? "Emerging", status: item.status ?? "emerging" };
  const said = statementFor(state, item.id);
  const shown = patternDisplayStatus(item, said);
  const record = { scope: { supported: item.domains ?? [], excluded: said?.excludedDomains ?? [] } };
  const open = isOpen(item, said);
  const spots = blindSpotsFor(state, item.id);
  const blindLine = spots.length
    ? `<div class="signal-blind">Blind spot: ${spots.map((spot) => `\u201c${esc(spot.item.title)}\u201d`).join(", ")} didn't hold up here.${spots.length === 1 ? " It takes more than one to change what Tastemake thinks." : ""}</div>`
    : "";
  const excluded = (said?.says === "partial" ? said.excludedDomains ?? [] : []).map(areaLabel);
  return `
    <article class="signal-row signal-row-${index + 1}" data-profile-pattern="${item.id}" data-pattern-state="${open ? "open" : "answered"}">
      <div class="signal-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-main">
        <div class="signal-title-row">
          <h3>${esc(item.title)}</h3>
          <span class="signal-badges">
            ${item.status === "conditional" ? `<span class="signal-flag" title="This pattern holds in some picks and not others.">Conditional</span>` : ""}
            ${shown.kind === "level" ? `<span class="signal-status ${update.status}">${esc(update.level)}</span>` : `<span class="signal-flag">${esc(shown.label)}</span>`}
          </span>
        </div>
        <p class="signal-claim">${esc(item.claim)}</p>
        ${evidenceBlock(item, records, blindLine)}
        ${shown.kind === "needs-review" ? `<details class="signal-carried"><summary>Why it needs another look</summary>
          <div class="signal-said">${esc(needsReviewText(item))}</div>
          ${canReconfirm(state, item.id) ? `<div class="signal-said signal-reconfirm"><span>${esc(reconfirmText(item))}</span> <button type="button" class="button button-secondary signal-say-button" data-reconfirm-pattern="${esc(item.id)}">${esc(RECONFIRM_LABEL)}</button></div>` : ""}
        </details>` : ""}
        ${!open && excluded.length ? `<details class="signal-carried"><summary>Where it doesn’t apply</summary>
          <div class="signal-said">Your Taste Profile won’t apply it to ${esc(excluded.join(", "))}.${partlyAreasReachPicks(state, item.id) ? esc(picksLine(excluded)) : ""} Change it to include an area again.</div>
        </details>` : ""}
        ${open ? `
          ${sayControls(item, said, record, records)}
          ${statementConsequence(said, disclosure.changed.get(item.id), partlyAreasReachPicks(state, item.id))}
          ${said?.says ? `<div class="signal-done-row">${disclosureButton(item, "done", "Done")}</div>` : ""}` : summaryLine(item, said)}
      </div>
    </article>`;
}

// #358: a corrected pattern carries the same summary ("Not me · Change"), so it can be undone from here.
function correctedPatternsSection(items, records = new Map()) {
  if (!items.length) return "";
  // Once a corrected pattern is reopened here, the section stays open, so Done keeps focus in view.
  if (items.some((item) => disclosure.open.has(item.id))) disclosure.correctedShown = true;
  return `
    <details class="corrected-patterns"${disclosure.correctedShown ? " open" : ""}>
      <summary>Corrected patterns <span class="corrected-pattern-count">${items.length}</span></summary>
      <p class="corrected-patterns-note">Patterns you said do not fit you. Tastemake leaves them out of your Taste Profile. Picks can still resemble the titles behind them, because your ratings still count. You can revisit them.</p>
      <div class="corrected-pattern-list">
        ${items.map((item) => {
          const said = statementFor(state, item.id);
          return disclosure.open.has(item.id) ? `
          <div class="corrected-pattern-row is-open" data-profile-pattern="${item.id}">
            <strong>${esc(item.title)}</strong>
            ${sayControls(item, said, { scope: { supported: item.domains ?? [], excluded: [] } }, records)}
            <div class="signal-done-row">${disclosureButton(item, "done", "Done")}</div>
          </div>` : `
          <div class="corrected-pattern-row" data-profile-pattern="${item.id}">
            <strong>${esc(item.title)}</strong>
            ${summaryLine(item, said)}
          </div>`;
        }).join("")}
      </div>
    </details>`;
}

function learningPanel(patterns = []) {
  if (!patterns.length) return "";

  const history = state.hypothesisHistory ?? [];
  const evidence = new Map(evidenceRecords(state).map((row) => [row.ref, row]));
  const changes = [];

  for (const pattern of patterns) {
    const revisions = history.filter((entry) => entry.hypothesisId === pattern.id);
    if (revisions.length < 2) continue;
    const current = revisions[revisions.length - 1];

    // Nov 4, 2026 (R-1): a user answer (Taste Profile correction or Tastebreak) is recorded without the
    // pattern's categories, supports or level. Compared field by field, it read as "Where this pattern
    // applies changed" on every correction, and the next refresh after one read as a new supporting
    // example. So a user answer is reported as itself, and a refresh is compared only with the previous
    // refresh. Only the latest change per pattern is shown, so a later refresh replaces the answer here.
    if (current.origin === "user-confirmed") {
      if (current.reason) changes.push({ title: pattern.title, sourceLine: "", changed: current.reason, consequence: "Tastemake keeps your answer alongside its own read of this pattern." });
      continue;
    }
    const previous = revisions.slice(0, -1).reverse().find((entry) => entry.origin !== "user-confirmed");
    if (!previous) continue;

    const addedSupport = (current.supports ?? []).find((ref) => !(previous.supports ?? []).includes(ref));
    const source = addedSupport ? evidence.get(addedSupport) : null;
    const sourceLine = source ? `You told Tastemake: ${source.title} → ${source.polarity > 0 ? "positive signal" : "didn’t work for you"}.` : "";

    let changed = "";
    let consequence = "";
    if (previous.level && current.level && previous.level !== current.level) {
      changed = `${previous.level} → ${current.level}.`;
      consequence = levelChangeConsequence(previous.level, current.level);
    } else if (String(previous.claim ?? "") !== String(current.claim ?? "")) {
      changed = "The pattern became more specific.";
      consequence = "Your Taste Profile now uses the narrower version instead of the older, broader one.";
    } else if ((current.supports?.length ?? 0) > (previous.supports?.length ?? 0)) {
      changed = "This pattern gained another supporting example.";
      consequence = "This gives Tastemake another example to consider when assessing the pattern.";
    } else if (JSON.stringify(previous.domains ?? []) !== JSON.stringify(current.domains ?? [])) {
      changed = "Where this pattern applies changed.";
      consequence = "Your Taste Profile has updated which kinds of titles this pattern covers.";
    } else {
      continue;
    }

    changes.push({ title: pattern.title, sourceLine, changed, consequence });
  }

  const hasChanges = changes.length > 0;
  const items = hasChanges
    ? changes.slice(-3).reverse()
    : patterns.slice(0, 3).map((pattern) => ({
        title: pattern.title,
        sourceLine: "",
        changed: pattern.claim,
        consequence: "This is one of the patterns Tastemake sees in what you’ve rated so far. If it’s wrong, you can correct it."
      }));

  return `
    <section class="profile-learning" aria-labelledby="profile-learning-title">
      <div class="profile-learning-head">
        <div>
          <p class="kicker">Learning out loud</p>
          <h2 id="profile-learning-title">${hasChanges ? "What changed" : "What Tastemake learned"}</h2>
          <p>${hasChanges
            ? "Your recent reactions and corrections changed your Taste Profile. Your corrections are also passed to Tastemake’s AI when it orders and explains future picks."
            : "A few patterns Tastemake is starting to see in what you love."}</p>
        </div>
      </div>
      <div class="profile-learning-list">
        ${items.map((item) => `
          <article class="profile-learning-item">
            <strong>${esc(item.title)}</strong>
            ${item.sourceLine ? `<span class="profile-learning-source">${esc(item.sourceLine)}</span>` : ""}
            <span><b>${hasChanges ? "So Tastemake changed:" : "Current read:"}</b> ${esc(item.changed)}</span>
            <span><b>What that means:</b> ${esc(item.consequence)}</span>
          </article>`).join("")}
      </div>
    </section>`;
}

// #319: in Paige's Example Profile, one real correction gets its own panel on the Overview, apart from the
// strongest six (their selection is unchanged). Every line comes from the saved record: what was inferred
// before her answer, the answer itself, and what the code does with it. Nothing claims picks got better:
// the example makes no AI calls and no effect on recommendations has been measured. Example-only, so
// nobody else's profile is ever shown a sample.
const SAID = { partial: "partly accurate", "not-me": "not her", unsure: "not sure yet" };
// Nov 7: separate the shortlist (built in software) from what live AI is told. Nov 14 (#334): "Not me" now
// down-ranks clearly matching titles in the shortlist; Partly and Not sure still don't touch it. Partly matches the shipped "more cautiously" wording. A pick's validator check for "not me" isn't
// claimed: live picks arrive without a tested pattern, so it doesn't run on them.
const USE = {
  partial: "Tastemake builds its shortlist without using her answer. When AI chooses and explains picks, it's told to treat this pattern more cautiously.",
  "not-me": "Titles that clearly match this pattern move to the back of her shortlist, but aren't removed. Live AI is told not to use the pattern, and Tastemake keeps it out of her Taste Profile when the profile is refreshed.",
  unsure: "Her answer doesn't change Tastemake's shortlist. Live AI is told it isn't a confirmed preference."
};
const shortDate = (iso) => {
  const date = new Date(iso ?? "");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

function featuredCorrectionPanel(activeHypotheses) {
  if (!isViewingExample()) return "";
  const featured = featuredCorrection(state);
  if (!featured) return "";
  const { pattern, said, answer, inferred, later } = featured;
  const titles = new Map(evidenceRecords(state).map((row) => [row.ref, row.title]));
  const inferredFrom = (inferred?.supports ?? []).map((ref) => titles.get(ref)).filter(Boolean);
  const position = activeHypotheses.findIndex((item) => item.id === pattern.id);
  const where = position < 0
    ? "It is listed under Corrected patterns."
    : position < 6
      ? "It is also one of the patterns below."
      : `It is pattern ${position + 1} of ${activeHypotheses.length} in her full profile, so it isn't one of the strongest six below.`;
  // #323: titles she said don't fit this description are part of her answer, so they're named here.
  const doesntFit = Object.entries(said.elements?.titles ?? {}).filter(([, answer]) => answer?.verdict === "doesnt-fit").map(([ref]) => titles.get(ref)).filter(Boolean);
  const details = [
    said.context ? `${CONTEXT[said.context] ?? "She refined when it applies"}.` : "",
    said.excludedDomains?.length ? `Not for ${said.excludedDomains.map((id) => domainById(id)?.label ?? id).join(", ")}.` : "",
    doesntFit.length ? `She said ${doesntFit.length === 1 ? "this title doesn’t" : "these titles don’t"} fit the description: ${doesntFit.join(", ")}.` : ""
  ].filter(Boolean).join(" ") || "No further detail was recorded with it.";
  const since = later.length
    ? `Tastemake has revised the pattern ${later.length === 1 ? "once" : `${later.length} times`} since; the Full profile shows the current version.`
    : "No change to the pattern has been recorded since her answer: its wording, evidence and level are the same.";
  return `
    <section class="profile-featured-correction" aria-labelledby="featured-correction-title" data-featured-correction="${esc(pattern.id)}">
      <p class="kicker">A correction Paige made</p>
      <h2 id="featured-correction-title">She said “${esc(pattern.title)}” is ${SAID[said.says]}.</h2>
      <p class="featured-correction-intro">You’re viewing Paige’s Example Profile, so this is her own answer, taken from her saved profile.</p>
      <p class="featured-correction-where">${esc(where)}</p>
      <dl class="featured-correction-steps">
        <div>
          <dt>What Tastemake inferred</dt>
          <dd>${inferred
            ? `“${esc(inferred.claim)}”${inferred.level ? ` <span class="featured-correction-meta">${esc(inferred.level.charAt(0).toUpperCase() + inferred.level.slice(1))}${inferredFrom.length ? `, from ${inferredFrom.length} thing${inferredFrom.length === 1 ? "" : "s"} she tried: ${inferredFrom.map((title) => esc(title)).join(", ")}` : ""}.</span>` : ""}`
            : "The pattern as Tastemake had it before her answer wasn't saved."}</dd>
        </div>
        <div>
          <dt>What Paige said${shortDate(answer.createdAt) ? ` <span class="featured-correction-meta">${esc(shortDate(answer.createdAt))}</span>` : ""}</dt>
          <dd>${esc(`${SAID[said.says].charAt(0).toUpperCase()}${SAID[said.says].slice(1)}.`)} ${esc(details)}</dd>
        </div>
        <div>
          <dt>What it changes</dt>
          <dd>${esc(since)} ${esc(USE[said.says])} This example makes no AI calls, and no effect on recommendations has been measured.</dd>
        </div>
      </dl>
      <button class="button button-secondary" type="button" data-profile-view="full">See it in the full profile</button>
    </section>`;
}

function blindSpotSection() {
  const spots = activeBlindSpots(state);
  if (!spots.length) return "";
  const themes = recurringThemes(state);
  const lines = [
    ...themes.patterns.map((theme) => `\u201c${esc(theme.title)}\u201d (${theme.n} times)`),
    ...themes.reasons.map((theme) => `${esc(theme.label.toLowerCase())} (${theme.n} times)`)
  ];
  return `
    <section class="blind-section" aria-labelledby="blind-heading">
      <h2 id="blind-heading">Things Tastemake keeps getting wrong about you</h2>
      <p class="blind-intro">When Tastemake was confident you'd like something and you tried it and didn't, that is evidence about the model, not just a thumbs-down. These stay on record so it can see where it overreaches. Nothing here rewrites your patterns until the same thing keeps happening.</p>
      ${lines.length ? `<p class="blind-themes"><strong>Keeps coming up:</strong> ${lines.join("; ")}.</p>` : ""}
      <ul class="blind-list">
        ${spots.map((spot) => `
          <li class="blind-card">
            <div class="blind-card-head">
              <h3>${esc(spot.item.title)} <em>${esc(displayLabel(spot.item))}</em></h3>
              <span class="blind-status ${isRecurring(state, spot) ? "is-recurring" : ""}">${isRecurring(state, spot) ? "Recurring" : "Noted once"}</span>
            </div>
            ${renderBlindSpotPanel(spot.itemId)}
          </li>`).join("")}
      </ul>
    </section>`;
}

export function renderProfile() {
  const favoriteTitles = libraryItems(state).favorites.map((entry) => entry.item.title);
  const visibleFavoriteTitles = favoriteTitles.slice(0, 12);
  const hiddenFavoriteTitles = favoriteTitles.slice(12);
  const triedEvidence = evidenceRecords(state).filter((record) => record.class === "experienced");
  const evidenceByRef = new Map(triedEvidence.map((record) => [record.ref, record]));
  const evidenceMix = {
    favorites: triedEvidence.filter((record) => ["starter-favorite", "experienced-favorite"].includes(record.kind)).length,
    loved: triedEvidence.filter((record) => record.kind === "experienced-strong-positive").length,
    liked: triedEvidence.filter((record) => record.kind === "experienced-positive").length,
    disliked: triedEvidence.filter((record) => record.kind === "experienced-negative").length
  };
  const triedCount = evidenceMix.favorites + evidenceMix.loved + evidenceMix.liked + evidenceMix.disliked;
  const workingHypotheses = state.modelHypotheses ?? [];
  const { active: activeHypotheses, corrected: correctedHypotheses } = partitionProfilePatterns(workingHypotheses, state.patternStatements, keptInPlace(state.patternStatements));
  const liveProfile = workingHypotheses.length > 0;
  const profileView = ["list", "full", "map"].includes(state.profileView) ? state.profileView : "list";
  const primaryHypotheses = activeHypotheses.slice(0, 6);
  const hasMorePatterns = activeHypotheses.length > primaryHypotheses.length;
  const shownHypotheses = profileView === "full" ? activeHypotheses : primaryHypotheses;

  return `
    <section class="profile-screen">
      ${renderStickerField("profile")}
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1><span class="profile-headline-lead">Less "you like fantasy."</span><br class="profile-headline-break" /><span class="profile-headline-highlight">More "this is what tends to click."</span></h1>
          <p class="lede profile-compact-lede">Working patterns based on what you’ve actually tried. Refine them when Tastemake gets you wrong.</p>
          ${state.hypothesisAiMessage ? `<div class="profile-ai-status profile-ai-status-compact ${state.hypothesisAiStatus === "loading" ? "is-loading" : ""}" role="status" tabindex="-1" aria-busy="${state.hypothesisAiStatus === "loading"}"><span class="profile-ai-status-dot" aria-hidden="true"></span><span>${esc(state.hypothesisAiMessage)}</span>${state.hypothesisAiStatus !== "loading" ? `<button class="button button-quiet profile-retry" type="button" data-action="retry-profile">${liveProfile ? "Refresh" : "Try again"}</button>` : ""}</div>` : ""}
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

      ${liveProfile ? `<div class="profile-view-toolbar">
        <div class="profile-view-toggle" role="group" aria-label="Taste Profile views">
          <button type="button" class="button button-secondary profile-view-button" data-profile-view="list" aria-pressed="${profileView === "list"}">Overview</button>
          <button type="button" class="button button-secondary profile-view-button" data-profile-view="full" aria-pressed="${profileView === "full"}">Full profile</button>
          <button type="button" class="button button-secondary profile-view-button" data-profile-view="map" aria-pressed="${profileView === "map"}">Taste Map</button>
        </div>
      </div>` : ""}

      ${liveProfile ? (
        profileView === "map"
          ? renderTasteMap(activeHypotheses, state.patternStatements)
          : `
            ${profileView === "list" ? featuredCorrectionPanel(activeHypotheses) : ""}
            <div class="profile-depth-head">
              <div>
                <p class="kicker">${profileView === "full" ? "Full profile" : "Current read"}</p>
                <h2>${profileView === "full" ? "All the patterns Tastemake is tracking." : "The patterns Tastemake is leaning on most."}</h2>
                <p>${profileView === "full"
                  ? "Refine any active pattern here."
                  : "The overview keeps the strongest six easy to scan."}</p>
              </div>
            </div>
            <h2 class="visually-hidden">Patterns Tastemake is working with</h2>
            <div class="profile-map">
              <aside class="profile-map-aside">
                <span class="profile-aside-number">${shownHypotheses.length}</span>
                <p>${profileView === "full" ? "active patterns in your full profile" : "patterns currently shaping the overview"}</p>
                <div class="profile-aside-note">working patterns, not one aesthetic &nearr;</div>
              </aside>
              <div class="signal-stack">${shownHypotheses.length ? shownHypotheses.map((item, index) => hypothesisCard(item, index, evidenceByRef)).join("") : `<div class="profile-no-active-patterns">No active patterns right now. Tastemake will keep learning from what you try.</div>`}</div>
            </div>
            <details class="profile-legend profile-legend-inline">
              <summary>What do the confidence labels mean?</summary>
              <ul>
                <li><strong>Emerging:</strong> an early pattern with limited support.</li>
                <li><strong>Supported:</strong> experienced evidence backs it.</li>
                <li><strong>Strong:</strong> several experienced items back it without stronger counterevidence.</li>
                <li><strong>Still learning:</strong> the evidence is mixed.</li>
                <li><strong>Less certain:</strong> repeated misses outweigh the support.</li>
              </ul>
            </details>
            ${profileView === "list" && hasMorePatterns ? `<div class="profile-more-callout">
              <div><strong>There’s more underneath the overview.</strong><span>Tastemake is tracking ${activeHypotheses.length} active patterns in total.</span></div>
              <div class="profile-more-actions">
                <button class="button button-secondary" type="button" data-profile-view="full">Explore full profile</button>
                <button class="button button-quiet" type="button" data-profile-view="map">See Taste Map</button>
              </div>
            </div>` : ""}
          `
      ) : state.aiPaused ? `
        <div class="profile-empty" role="status">
          <strong>Patterns are waiting on AI.</strong>
          <p>Patterns are built by AI. ${AI_PAUSED_EXPLAINER} Your favorites and ratings are saved, and your patterns will appear when it’s back.</p>
          <button class="button button-primary" type="button" data-action="browse">Keep rating</button>
        </div>` : `
        <div class="profile-empty" role="status">
          <strong>No generated patterns yet.</strong>
          <p>Tastemake needs more ratings from things you have actually tried before it can infer patterns responsibly. Favorites seed the profile; your reactions keep teaching it.</p>
          <button class="button button-primary" type="button" data-action="browse">Rate more things</button>
          ${exampleLinkHtml("Want to see one with lots of data?")}
        </div>`}

      ${liveProfile && profileView === "list" ? learningPanel(primaryHypotheses) : ""}

      ${liveProfile && profileView !== "map" ? `<details class="profile-evidence-strip profile-evidence-collapsed">
        <summary>Built from your favorites and ratings</summary>
        <div class="profile-evidence-summary">
          <strong>${triedCount} thing${triedCount === 1 ? "" : "s"} you’ve tried</strong>
          <span>${evidenceMix.favorites} favorite${evidenceMix.favorites === 1 ? "" : "s"} · ${evidenceMix.loved} loved · ${evidenceMix.liked} liked · ${evidenceMix.disliked} disliked</span>
        </div>
        ${favoriteTitles.length ? `<div class="profile-evidence-track">
          <span class="profile-evidence-label">Favorites that helped seed the profile</span>
          ${visibleFavoriteTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${esc(title)}</span>`).join("")}
          ${hiddenFavoriteTitles.length ? `<details class="profile-evidence-more"><summary>+${hiddenFavoriteTitles.length} more</summary><span class="profile-evidence-more-items">${hiddenFavoriteTitles.map((title, index) => `<span class="profile-evidence-item evidence-${((index + visibleFavoriteTitles.length) % 4) + 1}">${esc(title)}</span>`).join("")}</span></details>` : ""}
        </div>` : ""}
      </details>` : ""}

      ${liveProfile && profileView !== "map" ? correctedPatternsSection(correctedHypotheses, evidenceByRef) : ""}
      ${profileView !== "map" ? blindSpotSection() : ""}

      <div class="profile-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">working patterns, not a fixed identity.</span>
        <div class="page-actions-right">
          ${canKeepDiscovering(state) ? `<button class="button button-primary" type="button" data-action="keep-discovering">Keep discovering &rarr;</button>` : `<button class="button button-primary" type="button" data-action="show-recs">Recommendations &rarr;</button>`}
        </div>
      </div>
    </section>`;
}
