#!/usr/bin/env node
// #318: a Taste Profile support can be structurally valid and still not show its pattern. Paige's Example
// Profile listed Resident Evil 7 under "Mythic and fantastical worlds". These checks keep the two apart:
// the validator owns structure (exists, tried, liked, in a claimed area); the support-fit eval
// (scripts/evals/run.mjs --suite support) measures fit on labelled pairs. Free, no browser, no model call.
//
//   node scripts/qa/support-fit-tests.mjs

import { readFileSync } from "node:fs";
import { buildContext } from "../../src/ai/context.js";
import { validateHypotheses } from "../../src/ai/validate.js";
import { evidenceRecords } from "../../src/model/evidence.js";
import { hydrateState } from "../../src/server/request-state.mjs";
import { SUPPORT_FIT, SUPPORT_FIXTURES } from "../evals/fixtures.mjs";
import { scoreFixture } from "../evals/scorers.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("support fit tests");

const backup = JSON.parse(readFileSync(new URL("../../data/example-profile.json", import.meta.url), "utf8")).state;
const RE7 = "ev:igdb-game-19562";
const CIRCE = "ev:openlibrary-book-OL18012166W";
const PIRANESI = "ev:openlibrary-book-OL20893680W";
const SILENT_HILL = "ev:igdb-game-222341";
const BIOSHOCK = "ev:igdb-game-20";
const exampleState = (patch = {}) => ({ ...hydrateState(backup), recommendationSets: [], modelHypotheses: [], ...patch });
const proposal = (label, claim, evidence, domains) => ({ label, claim, evidence, counter: [], domains, crossDomain: domains.length > 1 ? "tentative" : "untested", level: "emerging", conditional: false, context: null });
const MYTHIC = (evidence) => proposal("Mythic and fantastical worlds", "Tends toward fantasy and mythic or uncanny settings, showing up in both books and games.", evidence, ["read", "play"]);
const HORROR = proposal("Atmosphere-driven horror in games", "Responds strongly to games where mood and setting carry the experience, including survival horror.", [RE7, SILENT_HILL], ["play"]);
const EXPLORE = proposal("Exploration-heavy games with puzzles", "Favors games that combine atmospheric exploration with puzzle-solving over pure action.", [RE7, BIOSHOCK], ["play"]);

// ---- lineage: where the Example Profile's link came from -------------------------------------------------
{
  const mythic = backup.modelHypotheses.find((p) => p.id === "ai-genre-fantasy-mythic-worlds");
  const first = (backup.hypothesisHistory ?? []).find((rev) => rev.hypothesisId === "ai-genre-fantasy-mythic-worlds");
  check("(lineage) the pattern is stored model output, not hand-written", mythic?.aiGenerated === true && first?.origin === "model" && first?.reason === "Live Taste Profile refresh", JSON.stringify(first?.reason));
  check("(lineage) Resident Evil 7 was in its very first revision", first?.supports.includes(RE7));
  const record = evidenceRecords(exampleState()).find((r) => r.ref === RE7);
  eq("(lineage) what Tastemake knows about it: IGDB genres", record?.facts?.genres.join(", "), "Shooter, Puzzle, Adventure");
  eq("(lineage) and Paige's reasons, each on its own dimension", record?.refinements.map((r) => `${r.id}=${r.label}`).join(", "), "atmosphere-style=Atmosphere / style, exploration=Exploration");
}

// ---- structure: what the validator checks ---------------------------------------------------------------
const ctx = buildContext(exampleState());
{
  const out = validateHypotheses({ hypotheses: [MYTHIC([CIRCE, PIRANESI, RE7, BIOSHOCK])] }, ctx);
  check("structurally valid: the RE7 citation passes every structural check", out.accepted.length === 1, JSON.stringify(out.rejected[0]?.reasons));
  const both = validateHypotheses({ hypotheses: [HORROR, EXPLORE] }, ctx);
  eq("one item may support several patterns", both.accepted.length, 2);
}
{
  // The same item, structurally invalid three ways: each is the validator's to reject, not the fit eval's.
  const saved = exampleState();
  saved.feedbackByRecommendation[RE7.slice(3)] = { ...saved.feedbackByRecommendation[RE7.slice(3)], rating: "not-tried", detail: "bookmarked", refinements: [] };
  eq("saved, untried: intent is never support", validateHypotheses({ hypotheses: [MYTHIC([CIRCE, PIRANESI, RE7, BIOSHOCK])] }, buildContext(saved)).rejected[0]?.reasons.some((r) => /intent/.test(r)), true);
  const disliked = exampleState();
  disliked.feedbackByRecommendation[RE7.slice(3)] = { ...disliked.feedbackByRecommendation[RE7.slice(3)], rating: "less", detail: "tried-disliked" };
  eq("tried and disliked: never support", validateHypotheses({ hypotheses: [MYTHIC([CIRCE, PIRANESI, RE7, BIOSHOCK])] }, buildContext(disliked)).rejected[0]?.reasons.some((r) => /disliked/.test(r)), true);
  eq("a citation that doesn't exist", validateHypotheses({ hypotheses: [MYTHIC([CIRCE, "ev:igdb-game-0"])] }, ctx).rejected[0]?.reasons.some((r) => /does not exist/.test(r)), true);
}

// ---- fit: what the support-fit eval measures --------------------------------------------------------------
const fixture = SUPPORT_FIXTURES[0];
const scored = (accepted) => {
  const run = { hyp: { accepted, rejected: [], notes: [], fallback: false }, picks: { accepted: [], rejected: [] }, ctx };
  return Object.fromEntries(scoreFixture(fixture, run).map((s) => [s.name, s]));
};
const named = (start) => SUPPORT_FIT.find((pair) => pair.name.startsWith(start)).name;
const [notMythic, horror, explore, circe] = ["Resident Evil 7 is not", "Resident Evil 7 still supports an atmosphere", "Resident Evil 7 still supports an exploration", "Circe"].map(named);
{
  const accepted = validateHypotheses({ hypotheses: [MYTHIC([CIRCE, PIRANESI, RE7, BIOSHOCK]), HORROR, EXPLORE] }, ctx).accepted;
  const s = scored(accepted);
  eq("the reported link is a fit finding", s[notMythic]?.pass, false);
  check("and says which pattern cites it", /Mythic and fantastical worlds/.test(s[notMythic]?.detail ?? ""), s[notMythic]?.detail);
  check("a fit finding never fails a run", s[notMythic]?.kind === "quality");
  eq("RE7 under atmosphere / horror fits", s[horror]?.pass, true);
  eq("RE7 under exploration fits", s[explore]?.pass, true);
  eq("Circe under the mythic pattern fits", s[circe]?.pass, true);
}
{
  const accepted = validateHypotheses({ hypotheses: [MYTHIC([CIRCE, PIRANESI, BIOSHOCK]), HORROR] }, ctx).accepted;
  const s = scored(accepted);
  eq("without RE7 the mythic pattern is clean", s[notMythic]?.pass, true);
  eq("dropping it everywhere would be a finding too (over-pruning)", scored(validateHypotheses({ hypotheses: [proposal("Atmosphere-driven horror in games", "Responds strongly to games where mood and setting carry the experience.", [SILENT_HILL], ["play"])] }, ctx).accepted)[horror]?.pass, false);
  eq("no matching pattern is no verdict", s[explore]?.pass, null);
}
// Nov 6: Paige confirmed BioShock under the mythic pattern too (5cb61a7); those are the only two labelled pairs.
check("only Paige's two confirmed pairs are labelled as not fitting", SUPPORT_FIT.filter((pair) => pair.fits === false).map((pair) => pair.ref).sort().join() === "ev:igdb-game-19562,ev:igdb-game-20" && SUPPORT_FIT.every((pair) => pair.basis));
check("both eval fixtures ask for the profile only (no picks)", SUPPORT_FIXTURES.every((f) => Array.isArray(f.candidates) && f.candidates.length === 0));
check("the refresh fixture carries the stored patterns; the fresh one doesn't", SUPPORT_FIXTURES[0].build().modelHypotheses.length === backup.modelHypotheses.length && SUPPORT_FIXTURES[1].build().modelHypotheses.length === 0);

finish();
