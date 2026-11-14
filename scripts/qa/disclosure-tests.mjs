// #358 (Nov 13, 2026): progressive disclosure on Taste Profile patterns. An unanswered pattern shows its
// statement, one example and the question, with nothing preselected; follow-ups appear only after an answer;
// an answered pattern collapses to a compact summary ("Confirmed · Important · Usually") with Change; the
// consequence line shows only right after the answer that changed something. Renders the real Profile
// screen. No model call.
import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { check, eq, finish } = createSuite("disclosure tests");
const { state, resetState } = await import("../../src/state.js");
const { closePattern, noteAnswer, openPattern, renderProfile, resetDisclosure, toggleRefine } = await import("../../src/screens/profile.js");
const { setStatement, statementSummary, toggleDomainExclusion } = await import("../../src/model/statements.js");

const pattern = {
  id: "ai-dread", title: "Quiet dread", label: "Quiet dread",
  claim: "Responds to slow, quiet dread more than jump scares across films and books.",
  evidence: "Arrival, Annihilation", supports: ["ev:m-arrival", "ev:m-annihilation"], counters: [], domains: ["movies", "read"],
  strength: "Supported", status: "supported"
};
const other = { ...pattern, id: "ai-other", title: "Other pattern", label: "Other pattern", supports: [] };
const loved = (id, title) => ({ item: { id, title, type: "movie", domains: ["movies"] }, rating: "more", detail: "loved-before" });

function setup() {
  resetState();
  resetDisclosure();
  Object.assign(state, { displayName: "Test", setupComplete: true, onboarded: true, profileView: "list" });
  state.modelHypotheses = [{ ...pattern }, { ...other }];
  state.feedbackByRecommendation = { "m-arrival": loved("m-arrival", "Arrival"), "m-annihilation": loved("m-annihilation", "Annihilation") };
  state.hypothesisHistory = [];
  state.patternStatements = [];
}
// What the person does on screen: the answer is saved, then the pattern opens with that answer noted.
const answer = (field, value, id = pattern.id) => { setStatement(state, id, field, value); noteAnswer(id, field); };
const row = (html, id = pattern.id) => {
  const start = html.indexOf(`data-profile-pattern="${id}"`);
  if (start < 0) return "";
  const end = html.indexOf("</article>", start);
  return html.slice(start, end < 0 ? undefined : end);
};
const corrected = (html) => html.match(/<details class="corrected-patterns"[\s\S]*?<\/details>\s*$/m)?.[0] ?? (html.split('class="corrected-patterns"')[1] ?? "");
const summaryOf = (html) => [...(html.match(/<span class="signal-summary-label">([\s\S]*?)<\/span>\s*<button/)?.[1] ?? "").matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]).join(" · ");
const pressed = (html) => [...html.matchAll(/data-statement-field="(\w+)" data-statement-value="([\w-]+)" aria-pressed="true"/g)].map((m) => `${m[1]}=${m[2]}`);
const CONSEQUENCE = "What this changes";

// ---- summary labels (the issue's label table) ----
{
  eq("plain Yes reads just Confirmed", statementSummary({ says: "accurate" }).join(" · "), "Confirmed");
  eq("Yes + Important + Usually", statementSummary({ says: "accurate", weight: "lot", context: "broad" }).join(" · "), "Confirmed · Important · Usually");
  eq("Nice, but not important reads Not essential", statementSummary({ says: "accurate", weight: "little", context: "some" }).join(" · "), "Confirmed · Not essential · Depends");
  eq("Partly", statementSummary({ says: "partial" }).join(" · "), "Partly");
  eq("Partly + Depends + an excluded area", statementSummary({ says: "partial", context: "some", excludedDomains: ["read"] }, (id) => ({ read: "Books" })[id]).join(" · "), "Partly · Depends · Not for Books");
  eq("Partly + Not sure yet", statementSummary({ says: "partial", context: "unsure" }).join(" · "), "Partly · Not sure why");
  eq("No reads Not me", statementSummary({ says: "not-me" }).join(" · "), "Not me");
  eq("Not sure", statementSummary({ says: "unsure" }).join(" · "), "Not sure");
  eq("no answer, no summary", statementSummary(null).length, 0);
  eq("a refinement alone is not an answer", statementSummary({ says: null, weight: "lot" }).length, 0);
  // #333 / shownContext: an answer the person can't see or change never appears.
  eq("Yes with a stored Partly-only Not sure yet shows just Confirmed", statementSummary({ says: "accurate", context: "unsure" }).join(" · "), "Confirmed");
  eq("a stale importance under Partly is not shown", statementSummary({ says: "partial", weight: "lot" }).join(" · "), "Partly");
  eq("a stale context under No is not shown", statementSummary({ says: "not-me", context: "some" }).join(" · "), "Not me");
}

// ---- default view: statement, one example, the question, nothing preselected ----
{
  setup();
  const html = row(renderProfile());
  check("unanswered: the question is shown", html.includes("Does this sound right?"));
  eq("unanswered: nothing is preselected", pressed(html).length, 0);
  check("unanswered: one supporting example up front", /<p class="signal-example"><span>For example<\/span> Arrival<\/p>/.test(html), html.slice(0, 1600));
  check("unanswered: the rest of the evidence expands, closed", /<details class="signal-more">\s*<summary>What this comes from<\/summary>/.test(html));
  check("unanswered: no follow-ups", !html.includes("How important is it?") && !html.includes("Refine this") && !html.includes("What makes it only partly true?"));
  check("unanswered: no consequence, summary or Done", !html.includes(CONSEQUENCE) && !html.includes("signal-summary") && !html.includes('data-disclosure-action="done"'));
}

// ---- Yes: optional Refine this, closed, nothing preselected ----
{
  setup();
  answer("says", "accurate");
  let html = row(renderProfile());
  check("Yes: Refine this is offered, closed", /data-disclosure-action="refine" aria-expanded="false"/.test(html));
  check("Yes: its options aren't rendered until opened", !html.includes("How important is it?") && !html.includes('data-statement-field="weight"'));
  check("Yes: the consequence shows right after the answer", html.includes(CONSEQUENCE) && html.includes("Confirmed. Refreshes keep this wording."));
  toggleRefine(pattern.id);
  html = row(renderProfile());
  check("Refine this opens importance and Usually / Depends", html.includes("How important is it?") && html.includes("How often is this true for you?") && /aria-expanded="true"/.test(html));
  eq("opened refinements: nothing preselected", pressed(html).join(), "says=accurate");

  answer("weight", "lot");
  html = row(renderProfile());
  check("Important: the copy describes an instruction to AI, not a result", html.includes("When AI chooses your picks, it’s told this matters more to you.") && html.includes("Your ratings still decide which titles it can choose from."));
  check("Important: never promises more weight in recommendations", !/more weight/i.test(html));
  answer("context", "some");
  html = row(renderProfile());
  check("Depends: says the level is capped at Supported", html.includes("Marked as depending on context. From the next refresh, its level can’t go above Supported."));
  check("only the latest change's consequence shows", !html.includes("matters more to you"));
  answer("context", "broad");
  check("Usually changes nothing visible, so no consequence line", !row(renderProfile()).includes(CONSEQUENCE));

  // Done collapses to the summary; Change reopens with the same answers and Refine this open.
  closePattern(pattern.id);
  html = row(renderProfile());
  eq("Done: compact summary", summaryOf(html), "Confirmed · Important · Usually");
  check("Done: Change is offered, with an accessible name", /data-disclosure-action="change" aria-label="Change your answer about “Quiet dread”">Change</.test(html));
  check("Done: no answer buttons and no consequence", !html.includes("data-statement-field") && !html.includes(CONSEQUENCE));
  check("Done: evidence still expandable", html.includes('<details class="signal-more">'));
  openPattern(pattern.id, { refine: true });
  html = row(renderProfile());
  eq("Change: the controls reopen with the saved answers pressed", pressed(html).sort().join(), "context=broad,says=accurate,weight=lot");
  check("Change: no consequence until something changes", !html.includes(CONSEQUENCE));
  answer("weight", "lot"); // choose again to clear
  closePattern(pattern.id);
  eq("Change round trip: the summary reflects the new answer", summaryOf(row(renderProfile())), "Confirmed · Usually");
  const before = JSON.stringify(state.patternStatements);
  openPattern(pattern.id);
  closePattern(pattern.id);
  eq("Change then Done without answering changes nothing saved", JSON.stringify(state.patternStatements), before);
}

// ---- after a reload (fresh screen state) every answered pattern is its summary, with no consequence ----
{
  setup();
  answer("says", "accurate");
  answer("context", "some");
  resetDisclosure();
  const html = renderProfile();
  eq("reload: summary only", summaryOf(row(html)), "Confirmed · Depends");
  check("reload: the consequence isn't repeated on collapsed patterns", !html.includes(CONSEQUENCE));
  // A profile saved before #333 (Yes + Partly-only Not sure yet) never shows the hidden answer.
  state.patternStatements = [{ hypothesisId: pattern.id, label: pattern.title, says: "accurate", context: "unsure" }];
  const stale = row(renderProfile());
  eq("shownContext: the summary hides the stale answer", summaryOf(stale), "Confirmed");
  openPattern(pattern.id, { refine: true });
  const reopened = row(renderProfile());
  eq("shownContext: Change shows no hidden answer pressed", pressed(reopened).join(), "says=accurate");
}

// ---- Partly: only the existing context and area options ----
{
  setup();
  answer("says", "partial");
  let html = row(renderProfile());
  check("Partly: context options", html.includes("Depends on context") && html.includes("Not sure yet"));
  check("Partly: area options for a pattern backed in more than one area", html.includes('data-scope-domain="read"'));
  check("Partly: no importance and no which-part control", !html.includes('data-statement-field="weight"') && !/which part/i.test(html));
  eq("Partly: nothing preselected beyond the answer", pressed(html).join(), "says=partial");
  check("Partly: the consequence", html.includes("Kept, but the AI is told to use it cautiously and not broaden it."));
  toggleDomainExclusion(state, pattern.id, "read");
  noteAnswer(pattern.id, "scope");
  html = row(renderProfile());
  check("an excluded area: says what the Taste Profile does", html.includes("Your Taste Profile won’t apply it to Books."));
  closePattern(pattern.id);
  html = row(renderProfile());
  eq("Partly summary names the excluded area", summaryOf(html), "Partly · Not for Books");
  check("the excluded area stays expandable in the summary", /<details class="signal-carried"><summary>Where it doesn’t apply<\/summary>/.test(html));
}

// ---- Not sure: nothing more is asked ----
{
  setup();
  answer("says", "unsure");
  const html = row(renderProfile());
  check("Not sure: no follow-ups", !html.includes("Refine this") && !html.includes("What makes it only partly true?") && !html.includes('data-scope-domain'));
  check("Not sure: the Nov 9 copy", html.includes("Tastemake won’t present this pattern to its AI as something you agreed with. Its level still reflects the evidence."));
}

// ---- No: acknowledged in place, then Not me · Change under Corrected patterns ----
{
  setup();
  answer("says", "not-me");
  let html = renderProfile();
  check("No: stays in place until Done", row(html).includes("data-pattern-state=\"open\"") && !html.includes('class="corrected-patterns"'));
  check("No: acknowledges the correction truthfully", row(html).includes("Removed from your Taste Profile. Picks can still resemble these titles, because your ratings still count."));
  check("No: asks nothing more", !row(html).includes("Refine this") && !row(html).includes("What makes it only partly true?"));
  closePattern(pattern.id);
  html = renderProfile();
  check("No, Done: leaves the active list", !/<article class="signal-row[^"]*" data-profile-pattern="ai-dread"/.test(html));
  const section = corrected(html);
  check("No, Done: listed under Corrected patterns, closed", /<details class="corrected-patterns">/.test(html) && section.includes('data-profile-pattern="ai-dread"'));
  eq("corrected pattern summary", summaryOf(section), "Not me");
  check("corrected pattern has Change", section.includes('data-disclosure-pattern="ai-dread" data-disclosure-action="change"'));
  openPattern(pattern.id);
  html = renderProfile();
  check("Change on a corrected pattern opens the section and the controls there", /<details class="corrected-patterns" open>/.test(html) && pressed(corrected(html)).join() === "says=not-me");
  answer("says", "accurate");
  html = renderProfile();
  check("undo: answering Yes moves it back to the active list, open", row(html).includes("data-pattern-state=\"open\"") && pressed(row(html)).join() === "says=accurate" && !html.includes('class="corrected-patterns"'));
}

finish();
