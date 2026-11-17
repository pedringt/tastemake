#!/usr/bin/env node
// #323 phase 2 (docs/proposals/323-partly-plan.md, sections 3, 4 and 6): element-level Partly without AI.
// "Doesn't fit this description" takes a title off a pattern for good (excludedRefs), with history and Undo; the
// refresh validator, the browser's full refresh, Design A placement, corrections.js and the Taste Profile all honor
// it; `elements` and `excludedRefs` survive reload, backup and export, and old saves load unchanged; "Fits a
// different side" is stored only, behind its flag (on since phase 3); nothing new reaches the picks prompt.
// Free: no network, no browser, no model call (every model answer is canned).
//
//   node scripts/qa/partly-elements-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { PARTLY_DIFFERENT_SIDE, canMarkDoesntFit, carryExcludedRefs, markBelongs, markDifferentSide, markDoesntFit, setDifferentSideNote, undoDoesntFit, withoutElements } = await import("../../src/model/partly-elements.js");
const { setStatement } = await import("../../src/model/statements.js");
const { checkStateShape } = await import("../../src/model/state-shape.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup, buildHtmlExport, parseBackupText } = await import("../../src/model/export.js");
const { dropExcludedCitations, preserveExistingHypotheses, settleConfirmedHypotheses, validateHypotheses } = await import("../../src/ai/validate.js");
const { buildContext } = await import("../../src/ai/context.js");
const { correctionKinds, notMeConflict } = await import("../../src/ai/corrections.js");
const { serializeAiState } = await import("../../src/ai/live-client.js");
const { evidenceFingerprint } = await import("../../src/ai/requests.js");
const { applyPlacementResult } = await import("../../src/model/placement-apply.js");
const { ledgerAfterFullRefresh, readLedger } = await import("../../src/model/refresh-ledger.js");
const { refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { produceHypotheses } = await import("../../api/hypotheses.mjs");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("partly elements tests");

// ---- a small profile: a "mythic worlds" pattern that cites two survival-horror games by mistake (#318) -------
const item = (id, title, domains, genres, provider = "tmdb") => ({ id, title, type: domains[0] === "play" ? "game" : domains[0] === "read" ? "book" : "movie", domains, genres, provider, providerId: id.split("-").pop(), year: "2000" });
const ref = (it) => `ev:${it.id}`;
const MYTH = [item("tmdb-movie-1", "Princess Mononoke", ["movies"], [14]), item("tmdb-movie-2", "Spirited Away", ["movies"], [14]), item("tmdb-movie-3", "Pan's Labyrinth", ["movies"], [14])];
const RE7 = item("tmdb-movie-7", "Resident Evil 7", ["movies"], [27]);
const SCARE = item("tmdb-movie-8", "The Descent", ["movies"], [27]);
const P_MYTH = {
  id: "ai-mythic-worlds", title: "Mythic and fantastical worlds", claim: "Drawn to stories set in mythic, fantastical worlds with their own rules and spirits.",
  supports: [...MYTH, RE7].map(ref), counters: [], domains: ["movies"], strength: "strong", status: "strong", crossDomain: "untested",
  evidence: [...MYTH, RE7].map((it) => it.title).join(", "), aiGenerated: true, provenance: "Based on your reactions so far."
};
const PARTLY = { hypothesisId: P_MYTH.id, label: P_MYTH.title, says: "partial", weight: null, context: null, authority: "user-confirmed" };

function profile() {
  const s = { ...emptyState([]), recommendationSets: [], hypothesisHistory: [], hypothesisAiStatus: "idle", hypothesisAiKey: null, hypothesisAiChecked: null, hypothesisAiMessage: null };
  [...MYTH, RE7, SCARE].forEach((it) => react(s, it, "loved"));
  s.modelHypotheses = [{ ...P_MYTH, supports: [...P_MYTH.supports], counters: [] }];
  s.patternStatements = [{ ...PARTLY }];
  return s;
}
const myth = (s) => s.modelHypotheses.find((p) => p.id === P_MYTH.id);

// ---- 1. "Doesn't fit this description": save, history, Undo ---------------------------------------------------
{
  const s = profile();
  check("offered for a cited title under Partly", canMarkDoesntFit(s, P_MYTH.id, ref(RE7)));
  const before = s.hypothesisHistory.length;
  const message = markDoesntFit(s, P_MYTH.id, ref(RE7));
  eq("the live-region sentence says what happened", message, "Mythic and fantastical worlds: “Resident Evil 7” is no longer cited by this pattern, because you said it doesn’t fit this description.");
  check("the title is off the pattern's supports", !myth(s).supports.includes(ref(RE7)) && myth(s).supports.length === 3);
  eq("…and in excludedRefs", JSON.stringify(myth(s).excludedRefs), JSON.stringify([ref(RE7)]));
  eq("the evidence line no longer names it", myth(s).evidence, "Princess Mononoke, Spirited Away, Pan's Labyrinth");
  eq("the wording stays", myth(s).claim, P_MYTH.claim);
  eq("the answer is recorded in elements", s.patternStatements[0].elements.titles[ref(RE7)].verdict, "doesnt-fit");
  const rev = s.hypothesisHistory.at(-1);
  check("one history entry, user-confirmed, with the reason", s.hypothesisHistory.length === before + 1 && rev.origin === "user-confirmed" && rev.reason === message && rev.hypothesisId === P_MYTH.id);
  check("…recording the supports it has now", !rev.supports.includes(ref(RE7)) && rev.supports.length === 3);
  eq("saving it twice does nothing", markDoesntFit(s, P_MYTH.id, ref(RE7)), null);

  const undo = undoDoesntFit(s, P_MYTH.id, ref(RE7));
  eq("Undo says so", undo, "Mythic and fantastical worlds: you undid “Doesn’t fit this description”, so “Resident Evil 7” can be cited by this pattern again.");
  check("Undo puts it back on the supports (still a title you loved)", myth(s).supports.includes(ref(RE7)));
  check("…and takes it out of excludedRefs", !("excludedRefs" in myth(s)));
  check("…and out of elements", !(ref(RE7) in (s.patternStatements[0].elements?.titles ?? {})));
  check("…and history notes the undo", s.hypothesisHistory.at(-1).reason === undo && s.hypothesisHistory.at(-1).origin === "user-confirmed");
  eq("Undo twice does nothing", undoDoesntFit(s, P_MYTH.id, ref(RE7)), null);

  const t = profile();
  t.patternStatements = [{ ...PARTLY, says: "accurate" }];
  check("not offered without Partly", !canMarkDoesntFit(t, P_MYTH.id, ref(RE7)) && markDoesntFit(t, P_MYTH.id, ref(RE7)) === null);
  check("not offered for a title the pattern doesn't cite", !canMarkDoesntFit(profile(), P_MYTH.id, ref(SCARE)));
  const u = profile();
  u.modelHypotheses[0].supports = [ref(RE7)];
  check("not offered for the last title a pattern rests on", !canMarkDoesntFit(u, P_MYTH.id, ref(RE7)));

  // Leaving Partly keeps the exclusion (it's on the pattern) and the doesn't-fit record; a cleared answer keeps
  // the exclusion too, and Undo still works from the pattern.
  const v = profile();
  markDoesntFit(v, P_MYTH.id, ref(RE7));
  setStatement(v, P_MYTH.id, "says", "accurate");
  check("changing Partly to Yes keeps the exclusion", myth(v).excludedRefs?.includes(ref(RE7)) && v.patternStatements[0].elements.titles[ref(RE7)].verdict === "doesnt-fit");
  setStatement(v, P_MYTH.id, "says", "accurate");
  check("clearing the answer keeps the exclusion on the pattern", !v.patternStatements.length && myth(v).excludedRefs?.includes(ref(RE7)));
  check("…and Undo still works", Boolean(undoDoesntFit(v, P_MYTH.id, ref(RE7))) && myth(v).supports.includes(ref(RE7)));
}

// ---- 2. "Fits a different side of my taste": behind its flag (on since phase 3), stored only ---------------------
{
  eq("the flag is on (#323 phase 3, Paige Nov 16)", PARTLY_DIFFERENT_SIDE, true);
  const s = profile();
  eq("with the flag off nothing is stored", markDifferentSide(s, P_MYTH.id, ref(RE7), { enabled: false }), null);
  check("…and the statement has no elements", !("elements" in s.patternStatements[0]));
  const before = JSON.stringify(s.modelHypotheses);
  check("with it on, the verdict is stored", Boolean(markDifferentSide(s, P_MYTH.id, ref(RE7))) && s.patternStatements[0].elements.titles[ref(RE7)].verdict === "different");
  eq("…and the pattern is untouched (no effect yet)", JSON.stringify(s.modelHypotheses), before);
  check("own words are saved as a note", Boolean(setDifferentSideNote(s, P_MYTH.id, ref(RE7), "  survival horror, not myth ")) && s.patternStatements[0].elements.titles[ref(RE7)].note === "survival horror, not myth");
  check("Belongs clears it", Boolean(markBelongs(s, P_MYTH.id, ref(RE7))) && !(ref(RE7) in s.patternStatements[0].elements.titles));
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  setStatement(s, P_MYTH.id, "says", "unsure");
  check("leaving Partly drops a different-side answer", !s.patternStatements[0].elements);
}

// ---- 3. Saved state: old saves, round trips, bad data ----------------------------------------------------------
{
  const old = { patternStatements: [{ ...PARTLY }], modelHypotheses: [{ ...P_MYTH }] };
  const checked = checkStateShape(old);
  eq("a save from before #323 drops nothing", checked.dropped.length, 0);
  eq("…and loads unchanged", JSON.stringify(checked.state), JSON.stringify(old));

  const s = profile();
  markDoesntFit(s, P_MYTH.id, ref(RE7));
  s.patternStatements[0].elements.titles[ref(SCARE)] = { verdict: "different", reasons: ["survival, not myth"], note: "my words" };
  eq("the new fields pass the shape check", checkStateShape({ patternStatements: s.patternStatements, modelHypotheses: s.modelHypotheses }).dropped.join(","), "");
  persistState(s);
  const loaded = loadPersistedState();
  eq("reload keeps excludedRefs", JSON.stringify(loaded.modelHypotheses[0].excludedRefs), JSON.stringify([ref(RE7)]));
  eq("reload keeps elements", JSON.stringify(loaded.patternStatements[0].elements), JSON.stringify(s.patternStatements[0].elements));
  const restored = parseBackupText(JSON.stringify(buildBackup(s)));
  eq("backup/restore keeps excludedRefs", JSON.stringify(restored.modelHypotheses[0].excludedRefs), JSON.stringify([ref(RE7)]));
  eq("backup/restore keeps elements", JSON.stringify(restored.patternStatements[0].elements), JSON.stringify(s.patternStatements[0].elements));
  const html = buildHtmlExport(s, "2026-11-16T00:00:00.000Z");
  check("the HTML export lists the title as no longer cited", html.includes("No longer cited, because you said it doesn’t fit this description: Resident Evil 7"));

  const bad = {
    patternStatements: [{ ...PARTLY, elements: { words: "x", titles: { [ref(RE7)]: { verdict: "maybe" }, [ref(SCARE)]: { verdict: "doesnt-fit" } }, grouped: "yes" } }],
    modelHypotheses: [{ ...P_MYTH, excludedRefs: [ref(RE7), 4] }, { ...P_MYTH, id: "ai-other", excludedRefs: "nope" }]
  };
  const { state: kept, dropped } = checkStateShape(bad);
  eq("bad parts are reported", dropped.sort().join(","), ["modelHypotheses.0.excludedRefs.1", "modelHypotheses.1.excludedRefs", "patternStatements.0.elements.grouped", `patternStatements.0.elements.titles.${ref(RE7)}`, "patternStatements.0.elements.words"].sort().join(","));
  check("…the usable parts stay", kept.patternStatements[0].elements.titles[ref(SCARE)].verdict === "doesnt-fit" && kept.modelHypotheses[0].excludedRefs.join() === ref(RE7));
  check("…the entries themselves stay", kept.patternStatements.length === 1 && kept.modelHypotheses.length === 2 && !("excludedRefs" in kept.modelHypotheses[1]));
  let refused = false;
  try { parseBackupText(JSON.stringify({ format: "tastemake-backup", version: 1, state: bad })); } catch { refused = true; }
  check("a backup with bad parts is refused, like any other bad data", refused);
}

// ---- 4. The refresh validator drops excluded citations ----------------------------------------------------------
{
  const s = profile();
  markDoesntFit(s, P_MYTH.id, ref(RE7));
  const ctx = { ...buildContext(s), presentRefs: [] };
  const proposal = { id: P_MYTH.id, label: P_MYTH.title, claim: P_MYTH.claim, evidence: [...MYTH, RE7].map(ref), counter: [], domains: ["movies"], crossDomain: "untested", level: "strong", conditional: false, context: null };
  const [dropped] = dropExcludedCitations([proposal], s.modelHypotheses, ctx);
  check("a refreshed version citing the title drops it", !dropped.evidence.includes(ref(RE7)) && dropped.evidence.length === 3);
  const renamed = { ...proposal, id: "ai-new-id" };
  check("…matched by name too", !dropExcludedCitations([renamed], s.modelHypotheses, ctx)[0].evidence.includes(ref(RE7)));
  const other = { ...proposal, id: "ai-horror", label: "Survival horror", claim: "Likes tense survival horror where resources are scarce and dread builds." };
  check("…another pattern may still cite it", dropExcludedCitations([other], s.modelHypotheses, ctx)[0].evidence.includes(ref(RE7)));
  const unchanged = [{ ...proposal }];
  check("nothing changes when no pattern has exclusions", dropExcludedCitations(unchanged, [P_MYTH], ctx) === unchanged);

  const settled = settleConfirmedHypotheses(validateHypotheses(preserveExistingHypotheses({ hypotheses: [proposal] }, ctx, s.modelHypotheses), ctx), ctx, s.modelHypotheses);
  const accepted = settled.accepted.find((h) => h.id === P_MYTH.id);
  check("the confirmed pattern is accepted without the title", accepted && !accepted.evidence.includes(ref(RE7)) && accepted.evidence.length === 3);
  eq("…and isn't flagged for review over it", settled.needsReview.join(","), "");

  const carried = carryExcludedRefs([{ id: P_MYTH.id, title: P_MYTH.title, supports: [...MYTH, RE7].map(ref), counters: [ref(RE7)] }], s.modelHypotheses);
  check("the browser carries excludedRefs to the refreshed pattern (Decision 7)", carried[0].excludedRefs.join() === ref(RE7) && !carried[0].supports.includes(ref(RE7)) && !carried[0].counters.includes(ref(RE7)));
}

// ---- 5. Full refresh, end to end through the endpoint (canned model answer) -------------------------------------
{
  const ENV = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
  const answer = { hypotheses: [{ id: P_MYTH.id, label: P_MYTH.title, claim: P_MYTH.claim, evidence: [...MYTH, RE7].map(ref), counter: [], domains: ["movies"], crossDomain: "untested", level: "strong", conditional: false, context: null }], insufficientEvidence: false };
  const canned = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) });
  let rawAnswer = false;   // true: the browser gets the model's answer as is (as if the server hadn't dropped it)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const quiet = [console.log, console.info, console.error];
    console.log = () => {}; console.info = () => {}; console.error = () => {};
    try {
      const payload = rawAnswer ? { source: "model", hypotheses: answer.hypotheses, meta: {} } : await produceHypotheses({ rawState: body.state, env: ENV, fetchImpl: canned });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) };
    } finally { [console.log, console.info, console.error] = quiet; }
  };
  for (const raw of [false, true]) {
    rawAnswer = raw;
    const s = profile();
    markDoesntFit(s, P_MYTH.id, ref(RE7));
    await refreshProfileHypotheses(s, { placement: false, force: true });
    const label = raw ? "browser check alone" : "server and browser";
    check(`full refresh (${label}): the model cites the title, the pattern doesn't`, !myth(s).supports.includes(ref(RE7)) && myth(s).supports.length === 3);
    check(`…the exclusion persists across the refresh (${label})`, myth(s).excludedRefs?.includes(ref(RE7)));
    check(`…and the evidence line leaves it out (${label})`, !myth(s).evidence.includes("Resident Evil 7"));
  }
}

// ---- 6. Design A placement never places an excluded title on that pattern ---------------------------------------
{
  const s = profile();
  markDoesntFit(s, P_MYTH.id, ref(RE7));
  s.profileLedger = ledgerAfterFullRefresh(s);
  const queue = { items: [ref(RE7)], waiting: 0, pool: [], changed: [], removed: [], firstRun: false };
  const result = applyPlacementResult(s, queue, { placements: [{ ref: ref(RE7), place: "supports", patternId: P_MYTH.id }], invalid: [], newPatterns: [], notSent: [] });
  check("a placement as its support is refused", !myth(s).supports.includes(ref(RE7)) && myth(s).excludedRefs.includes(ref(RE7)));
  eq("…the message says it isn't part of a pattern", result.message, "1 new rating: 1 isn’t part of a pattern yet.");
  check("…a liked title joins the pool, so it can start a new pattern (Paige, Nov 16)", readLedger(s.profileLedger).pool.includes(ref(RE7)));
  check("…and the pattern isn't touched", !result.changed.includes(P_MYTH.id));
  const t = profile();
  markDoesntFit(t, P_MYTH.id, ref(RE7));
  applyPlacementResult(t, queue, { placements: [{ ref: ref(RE7), place: "counter", patternId: P_MYTH.id }], invalid: [], newPatterns: [], notSent: [] });
  check("…nor as its counter", !myth(t).counters.includes(ref(RE7)));
  const u = profile();
  const placed = applyPlacementResult(u, { ...queue, items: [ref(SCARE)] }, { placements: [{ ref: ref(SCARE), place: "supports", patternId: P_MYTH.id }], invalid: [], newPatterns: [], notSent: [] });
  check("other titles are still placed as before", myth(u).supports.includes(ref(SCARE)) && placed.changed.includes(P_MYTH.id));
}

// ---- 7. corrections.js leaves an excluded title out of the pattern's labels -------------------------------------
{
  // A "Not me" pattern that cites two fantasy films and two horror ones: both kinds define it. Taking the horror
  // titles off it leaves fantasy only, so a horror candidate no longer conflicts through it.
  const s = profile();
  const HORROR2 = item("tmdb-movie-9", "Grave Encounters", ["movies"], [27]);
  react(s, HORROR2, "loved");
  delete s.feedbackByRecommendation[SCARE.id];
  delete s.feedbackByRecommendation[MYTH[2].id];
  s.modelHypotheses[0].supports = [MYTH[0], MYTH[1], RE7, HORROR2].map(ref);
  s.patternStatements = [{ ...PARTLY, says: "not-me" }];
  const horrorPick = item("tmdb-movie-50", "A New Horror", ["movies"], [27]);
  const before = correctionKinds(s).rejected[0].labels;
  check("before: horror is one of the pattern's labels", before.includes("horror") && notMeConflict(s)(horrorPick));
  // As stored by the app: supports already without the title. Here the defensive check is tested on its own: the
  // supports still list them, and only excludedRefs says otherwise.
  s.modelHypotheses[0].excludedRefs = [ref(RE7), ref(HORROR2)];
  const after = correctionKinds(s).rejected[0].labels;
  check("after: the excluded titles don't shape its labels", !after.includes("horror") && after.includes("fantasy"));
  check("…so a horror pick no longer conflicts through it", !notMeConflict(s)(horrorPick));
  const wire = serializeAiState(s);
  check("the request leaves them out of the pattern's supports too", !wire.correctionPatterns[0].supports.includes(ref(RE7)) && !wire.correctionPatterns[0].supports.includes(ref(HORROR2)));
  const fp = evidenceFingerprint(s);
  s.modelHypotheses[0].excludedRefs = [ref(RE7)];
  check("a changed exclusion makes an in-flight pick request stale", evidenceFingerprint(s) !== fp);
}

// ---- 8. Nothing new reaches the picks prompt -------------------------------------------------------------------
{
  const s = profile();
  markDoesntFit(s, P_MYTH.id, ref(RE7));
  s.patternStatements[0].elements.titles[ref(SCARE)] = { verdict: "different", reasons: [], note: "my words" };
  check("buildContext statements carry no elements", buildContext(s).statements.every((st) => !("elements" in st)));
  check("the wire statements carry no elements", serializeAiState(s).patternStatements.every((st) => !("elements" in st)));
  eq("…otherwise the statement is the same", JSON.stringify(serializeAiState(s).patternStatements[0]), JSON.stringify(withoutElements(s.patternStatements[0])));
  check("the saved statement keeps its elements", Boolean(s.patternStatements[0].elements));
}

// ---- 9. The Taste Profile: framing question, title rows, the honest line, Undo ----------------------------------
{
  const { state } = await import("../../src/state.js");
  const { renderProfile, setPartlyFraming, openPattern, resetDisclosure, NOT_CITED_TEXT, WRONG_FOR_ALL_TEXT, LAST_TITLE_TEXT } = await import("../../src/screens/profile.js");
  const s = profile();
  Object.assign(state, s, { screen: "model", profileView: "full", onboarded: true });
  resetDisclosure();
  openPattern(P_MYTH.id);
  let html = renderProfile();
  check("Partly asks: wrong for all of them, or just certain ones?", html.includes("Wrong for all of them, or just certain ones?") && html.includes("Just certain ones"));
  check("…with nothing chosen yet", !html.includes('data-partly-value="all" aria-pressed="true"') && !html.includes('data-partly-value="titles" aria-pressed="true"'));
  check("the existing Partly controls are still there", html.includes("What makes it only partly true?") && html.includes("Depends on context") && html.includes("Not sure yet"));
  setPartlyFraming(P_MYTH.id, "all");
  html = renderProfile();
  check("“Wrong for all of them” says what the Partly answer already does", html.includes(WRONG_FOR_ALL_TEXT.replaceAll("’", "’")) && !html.includes("data-partly-action=\"doesnt-fit\""));
  setPartlyFraming(P_MYTH.id, "titles");
  html = renderProfile();
  check("“Just certain ones” lists each cited title", [...MYTH, RE7].every((it) => html.includes(`data-partly-ref="${ref(it)}"`)));
  check("…with Belongs (the default) and Doesn’t fit", html.includes(">Belongs</button>") && html.includes("Doesn’t fit this description"));
  check("…and the different-side choice, now that its flag is on", html.includes("Fits a different side of my taste"));

  markDoesntFit(state, P_MYTH.id, ref(RE7));
  html = renderProfile();
  check("after Doesn’t fit: the honest line and Undo", html.includes("No longer cited by this pattern, because you said it doesn’t fit this description.") && html.includes('data-partly-action="undo"'));
  check("…the line says the rating still counts and the wording stays", NOT_CITED_TEXT.includes("still counts everywhere else") && NOT_CITED_TEXT.includes("wording stays the same"));
  check("…the title is gone from the cited rows and the evidence line", !html.includes(`data-partly-action="doesnt-fit" data-partly-ref="${ref(RE7)}"`) && !html.includes("Princess Mononoke, Spirited Away, Pan&#39;s Labyrinth, Resident Evil 7"));
  check("…and “What this comes from” offers Undo too", html.includes("No longer cited here, because you said it doesn’t fit this description"));

  state.modelHypotheses = [{ ...myth(state), supports: [ref(MYTH[0])] }];
  html = renderProfile();
  check("the last title left can't be taken off; the row says to answer No", html.includes(LAST_TITLE_TEXT) && !html.includes(`data-partly-action="doesnt-fit"`));
  resetDisclosure();
}

finish();
