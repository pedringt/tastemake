#!/usr/bin/env node
// #326/#318 (Nov 13): a Taste Profile refresh used to tell the model to "Return each of them again, with the
// same id and label" (#229), and it did, verbatim: no new citation, no new counter, and a support that never
// fitted (Resident Evil 7 under "Mythic and fantastical worlds") re-cited every time. The refresh prompt now asks
// for a re-check instead. These checks pin, without a model call:
//   1. a refresh asks for a re-check, not a copy; a fresh profile keeps its earlier wording;
//   2. n:1 marks exactly the rows no earlier pattern cites, and only on a refresh;
//   3. film and TV genres reach the model as names, book and game genres as they are;
//   4. the --suite refresh fixtures build, and its scorers tell a copy from a re-check.
// Free, no browser, no model call.
//
//   node scripts/qa/refresh-prompt-tests.mjs

import { buildContext } from "../../src/ai/context.js";
import { buildHypothesisRequest } from "../../api/hypotheses.mjs";
import { normalizeHypothesisResponse, validateHypotheses } from "../../src/ai/validate.js";
import { FITS_EXISTING, NEW_COUNTER, NEW_PREFERENCE, REFRESH_FIXTURES } from "../evals/fixtures.mjs";
import { scoreFixture } from "../evals/scorers.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("refresh prompt tests");

const contextOf = (prompt) => JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8));
const rowsOf = (context) => Object.values(context.evidence).flatMap((byDomain) => Object.values(byDomain).flat());
const fixture = (id) => REFRESH_FIXTURES.find((f) => f.id === id);
const requestFor = (state, existing = state.modelHypotheses) => buildHypothesisRequest(buildContext(state), existing);

// ---- 1. a refresh asks for a re-check ----------------------------------------------------------------------
{
  const state = fixture("refresh-new-preference").build();
  const refresh = requestFor(state).prompt;
  const fresh = requestFor(state, []).prompt;
  check("a refresh no longer asks for the stored patterns back as they were", !refresh.includes("Return each of them again"));
  check("a refresh asks for a re-check, not a copy", refresh.includes("earlier interpretations to re-check against the evidence, not text to copy"));
  check("a refresh asks that each citation show what the label names", refresh.includes("keep an earlier citation only when that item itself shows what the pattern's label names"));
  check("a refresh asks for new counter-evidence", refresh.includes("cite in counter what the user tried and disliked that pulls against it"));
  check("a refresh keeps a confirmed pattern's label and claim word for word", refresh.includes("If the user answered a pattern accurate or partial, keep its label and claim word for word"));
  check("a refresh says nothing new is a valid answer", refresh.includes("nothing new is a valid answer"));
  check("a refresh drops the soft quota", !refresh.includes("4 to 6 is enough"));
  check("a refresh keeps the one-miss rule", refresh.includes("One thing the user tried and disliked never removes or weakens a pattern"));
  check("a fresh profile keeps the earlier existing-pattern wording", fresh.includes("Return each of them again, with the same id and label"));
  check("a fresh profile keeps the soft quota", fresh.includes("With thinner evidence, 4 to 6 is enough"));
  check("a fresh profile is not told about n:1", !fresh.includes("n:1"));
}

// ---- 2. n:1 marks what no earlier pattern cites --------------------------------------------------------------
{
  const state = fixture("refresh-new-preference").build();
  const { prompt, refs } = requestFor(state);
  const rows = rowsOf(contextOf(prompt));
  const cited = new Set(state.modelHypotheses.flatMap((h) => [...(h.supports ?? []), ...(h.counters ?? [])]));
  check("rows are marked n:1 exactly when no earlier pattern cites them", rows.every((row) => Boolean(row.n) === !cited.has(refs.get(row.id))));
  for (const entry of [...NEW_PREFERENCE, NEW_COUNTER]) check(`${entry.item.title} (new since the stored profile) is marked n:1`, rows.find((row) => refs.get(row.id) === `ev:${entry.item.id}`)?.n === 1);
  check("a cited row is not marked", rows.some((row) => cited.has(refs.get(row.id)) && !row.n));
  const fresh = rowsOf(contextOf(requestFor(state, []).prompt));
  check("no row is marked n:1 on a fresh profile", fresh.every((row) => !("n" in row)));
}

// ---- 3. genre names --------------------------------------------------------------------------------------
{
  const state = fixture("refresh-new-preference").build();
  const { prompt, refs } = requestFor(state);
  const rows = rowsOf(contextOf(prompt));
  const row = (title) => rows.find((r) => r.t === title);
  eq("a TMDb film's genre ids become names", JSON.stringify(row("Ocean's Eleven")?.g), JSON.stringify(["Crime", "Thriller"]));
  eq("a TMDb series' genre ids become names (Documentary was 99)", JSON.stringify(row("Nathan for You")?.g), JSON.stringify(["Comedy", "Documentary"]));
  eq("TV-only genre ids become names (Sci-fi & fantasy was 10765)", JSON.stringify(row("The Leftovers")?.g), JSON.stringify(["Sci-fi & fantasy", "Drama"]));
  check("no film or TV row sends a bare genre id", rows.every((r) => !(r.g ?? []).some((g) => /^\d+$/.test(String(g)))));
  eq("game genres are sent as they are", JSON.stringify(row("Resident Evil 7: Biohazard")?.g), JSON.stringify(["Shooter", "Puzzle", "Adventure"]));
  check("book genres are sent as they are", (row("Circe")?.g ?? []).includes("Mythology"));
  check("short ids still map back to evidence refs", rows.every((r) => refs.get(r.id)?.startsWith("ev:")));
}

// ---- 4. the refresh suite and its scorers ------------------------------------------------------------------
eq("the refresh suite has the three #318 refresh fixtures and the two #326 ones", REFRESH_FIXTURES.map((f) => f.id).join(","), "example-refresh,example-refresh-confirmed,example-refresh-partly,refresh-new-preference,refresh-nothing-new");
{
  const f = fixture("refresh-new-preference");
  const state = f.build();
  const ctx = buildContext(state);
  const has = (ref) => ctx.evidence.some((r) => r.ref === ref && r.class === "experienced");
  check("every new rating is experienced evidence", [...NEW_PREFERENCE, NEW_COUNTER].every((e) => has(`ev:${e.item.id}`)));
  check("the counter is a tried-and-disliked row", ctx.evidence.find((r) => r.ref === `ev:${NEW_COUNTER.item.id}`)?.polarity < 0);
  check("the stored profile has confirmed patterns to protect", f.expect.keepsConfirmed.length >= 1);
  const asProposal = (h) => ({ id: h.id, label: h.title, claim: h.claim, evidence: h.supports, counter: h.counters ?? [], domains: h.domains, crossDomain: "untested", level: "emerging", conditional: false, context: null });
  const run = (hypotheses) => ({ state, ctx, hyp: { ...validateHypotheses(normalizeHypothesisResponse({ hypotheses }, ctx), ctx), needsReview: [] }, picks: { accepted: [], rejected: [] } });
  const score = (r, name) => scoreFixture(f, r).find((s) => s.name === name);

  // A copy: every stored pattern back as it was.
  const copy = run(state.modelHypotheses.map(asProposal));
  eq("a copy scores every stored pattern as copied", score(copy, "stored patterns returned with exactly their stored citations").detail, `${state.modelHypotheses.length} of ${state.modelHypotheses.length}`);
  eq("a copy finds no new preference", score(copy, "finds the new, distinct preference").pass, false);
  eq("a copy attaches no new counter", score(copy, "new dislike attached as counter where it pulls against the pattern").pass, false);
  check("a copy keeps confirmed patterns and their wording", scoreFixture(f, copy).filter((s) => s.kind === "rule" && /confirmed/.test(s.name)).every((s) => s.pass));

  // A re-check: the counter attached, and a new pattern for the heist films. (Production order: normalize, then
  // validate. With The Witch, that makes two films against the slow-burn pattern and two for it, so the
  // normalizer narrows it to TV, the #228 rule; it is still kept.)
  const slowBurn = state.modelHypotheses.find((h) => /slow-burn/i.test(h.title));
  const rechecked = run([
    ...state.modelHypotheses.filter((h) => h !== slowBurn).map(asProposal),
    { ...asProposal(slowBurn), counter: [...(slowBurn.counters ?? []), `ev:${NEW_COUNTER.item.id}`] },
    { id: "ai-heist-capers", label: "Heist and con capers on film", claim: "Enjoys films built around an elaborate heist or con, where the plan and its reveal carry the fun.", evidence: NEW_PREFERENCE.map((e) => `ev:${e.item.id}`), counter: [], domains: ["movies"], crossDomain: "untested", level: "emerging", conditional: false, context: null }
  ]);
  eq("a re-check finds the new preference", score(rechecked, "finds the new, distinct preference").pass, true);
  eq("a re-check attaches the counter", score(rechecked, "new dislike attached as counter where it pulls against the pattern").pass, true);
  eq("the new pattern is not redundant", score(rechecked, "no redundant new pattern").pass, true);

  // A redundant new pattern: one resting on a stored pattern's own supports.
  const horror = state.modelHypotheses.find((h) => /horror in games/i.test(h.title));
  const redundant = run([...state.modelHypotheses.map(asProposal), { ...asProposal(horror), id: "ai-scary-games", label: "Scary games with mood" }]);
  eq("a new pattern on a stored pattern's supports is redundant", score(redundant, "no redundant new pattern").pass, false);
}
{
  const f = fixture("refresh-nothing-new");
  const state = f.build();
  const ctx = buildContext(state);
  check("every rating that fits a stored pattern is experienced evidence", FITS_EXISTING.every((e) => ctx.evidence.some((r) => r.ref === `ev:${e.item.id}` && r.class === "experienced")));
  const asProposal = (h, extra = []) => ({ id: h.id, label: h.title, claim: h.claim, evidence: [...h.supports, ...extra], counter: h.counters ?? [], domains: h.domains, crossDomain: "untested", level: "emerging", conditional: false, context: null });
  const run = (hypotheses) => ({ state, ctx, hyp: { ...validateHypotheses(normalizeHypothesisResponse({ hypotheses }, ctx), ctx), needsReview: [] }, picks: { accepted: [], rejected: [] } });
  const score = (r, name) => scoreFixture(f, r).find((s) => s.name === name);
  const fitting = run(state.modelHypotheses.map((h) => asProposal(h, FITS_EXISTING.filter((e) => e.item.domains.every((d) => h.domains.includes(d)) && e.pattern.test(`${h.title} ${h.claim}`)).map((e) => `ev:${e.item.id}`))));
  for (const e of FITS_EXISTING) eq(`${e.item.title} cited by its stored pattern scores as a pass`, score(fitting, `${e.item.title} cited by the stored pattern it fits`).pass, true);
  eq("no new pattern scores as nothing new", score(fitting, "nothing new: no new pattern built on the new ratings").pass, true);
  const extra = run([...state.modelHypotheses.map((h) => asProposal(h)), { id: "ai-new-dread", label: "Dread across media", claim: "Likes dread that builds slowly in a film, a game and a myth retelling alike.", evidence: FITS_EXISTING.map((e) => `ev:${e.item.id}`), counter: [], domains: ["movies", "play", "read"], crossDomain: "tentative", level: "emerging", conditional: false, context: null }]);
  eq("a new pattern built on them is flagged", score(extra, "nothing new: no new pattern built on the new ratings").pass, false);
}

finish();
