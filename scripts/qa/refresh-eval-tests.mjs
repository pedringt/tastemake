#!/usr/bin/env node
// #326/#318 (Nov 13): the --suite refresh eval (scripts/evals/run.mjs) measures what a Taste Profile refresh does
// with the stored Example Profile: whether it copies stored patterns as they were, finds a new, distinct
// preference, attaches a new dislike as a counter, cites new ratings under the patterns they fit, and keeps
// what the user confirmed. These checks pin, without a model call, that its fixtures build and that its scorers
// tell a copy from a re-check. (The refresh prompt change these were written for failed its paid check on
// Nov 13 and did not ship; the suite stays to test the next attempt.)
// Free, no browser, no model call.
//
//   node scripts/qa/refresh-eval-tests.mjs

import { buildContext } from "../../src/ai/context.js";
import { normalizeHypothesisResponse, validateHypotheses } from "../../src/ai/validate.js";
import { FITS_EXISTING, NEW_COUNTER, NEW_PREFERENCE, REFRESH_FIXTURES } from "../evals/fixtures.mjs";
import { scoreFixture } from "../evals/scorers.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("refresh eval tests");

const fixture = (id) => REFRESH_FIXTURES.find((f) => f.id === id);

// ---- the refresh suite and its scorers ------------------------------------------------------------------
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
