#!/usr/bin/env node
// #228: the live Taste Profile broke two eval rules on both Sonnet 5.5 and Haiku 5.5. These are the
// deterministic guarantees software now owns, checked without a model call:
//   1. cross-domain links resting only on starter favorites are "untested" (cold-4, starter-6), and one
//      tried thing in each of two areas is at most "tentative";
//   2. one miss never removes an earlier pattern (single-miss); two misses in its area may;
//   3. a reply with text after the JSON still parses;
//   4. confidence level counts only things the user tried: a pattern resting only on starter favorites
//      stays "emerging" (cold-4, starter-6), however many it cites.
// Free, no browser, no model call.
//
//   node scripts/qa/profile-rules-tests.mjs

import { buildContext } from "../../src/ai/context.js";
import { allowedCrossDomain, allowedLevel, normalizeHypothesisResponse, preserveExistingHypotheses, validateHypotheses } from "../../src/ai/validate.js";
import { buildHypothesisPrompt, produceHypotheses } from "../../api/hypotheses.mjs";
import { parseModelJson } from "../../src/server/anthropic.mjs";
import { recommendations, followUpPool } from "./fixtures/catalog.js";
import { emptyState, react } from "../evals/fixtures.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const catalogItems = [...recommendations, ...followUpPool];
const byId = (id) => catalogItems.find((item) => item.id === id);
const pattern = (fields) => ({ counter: [], conditional: false, context: null, level: "emerging", crossDomain: "untested", ...fields });

// ---- 1. cross-domain: starter favorites do not test a link between areas -------------------------------
{
  // cold-4: starter favorites in read+movies (lotr), read (circe), play (portal2), movies (thefall).
  const ctx = buildContext(emptyState(["lotr", "circe", "portal2", "thefall"]));
  const refs = ["ev:lotr", "ev:circe", "ev:portal2"];
  check("cold-4 refs exist as starter favorites", refs.every((ref) => ctx.evidence.find((r) => r.ref === ref)?.kind === "starter-favorite"));
  const response = { hypotheses: [pattern({
    id: "ai-mythic", label: "Mythic fantasy worlds", claim: "Mythic fantasy worlds with real weight seem to land across books and games.",
    evidence: refs, domains: ["read", "movies", "play"], crossDomain: "tentative"
  })] };
  const normalized = normalizeHypothesisResponse(response, ctx);
  eq("a link resting only on starter favorites is capped to untested", normalized.hypotheses[0].crossDomain, "untested");
  const validated = validateHypotheses(normalized, ctx);
  eq("the capped pattern is still accepted", validated.accepted.length, 1);
  eq("accepted crossDomain stays untested", validated.accepted[0]?.crossDomain, "untested");
  check("the domains the starter favorites back are kept", ["read", "play"].every((d) => validated.accepted[0]?.domains.includes(d)), validated.accepted[0]?.domains.join(","));
  const unnormalized = validateHypotheses(response, ctx);
  check("without normalization, tentative from starter favorites alone is overreach", unnormalized.rejected[0]?.reasons.some((r) => /cross-domain overreach/.test(r)), JSON.stringify(unnormalized.rejected[0]?.reasons));
}
{
  // cross-domain fixture: one loved thing in movies and one in play allows tentative, not supported.
  const s = emptyState();
  const play = catalogItems.find((i) => i.domains.includes("play") && !i.domains.includes("movies") && i.hypotheses.includes("H04"));
  const watch = catalogItems.find((i) => i.domains.includes("movies") && !i.domains.includes("play") && i.hypotheses.includes("H04"));
  react(s, watch, "loved"); react(s, play, "loved");
  const ctx = buildContext(s);
  const supports = [`ev:${watch.id}`, `ev:${play.id}`].map((ref) => ctx.evidence.find((r) => r.ref === ref));
  eq("one tried thing in each of two areas allows tentative", allowedCrossDomain(supports, []), "tentative");
  const normalized = normalizeHypothesisResponse({ hypotheses: [pattern({
    id: "ai-x", label: "Pattern across two areas", claim: "This pattern holds in a film and a game the user tried and loved.",
    evidence: supports.map((r) => r.ref), domains: ["movies", "play"], crossDomain: "supported"
  })] }, ctx);
  eq("supported is capped to tentative", normalized.hypotheses[0].crossDomain, "tentative");
  // Mixed: one tried thing plus a starter favorite in another area does not test the link.
  const mixed = [ctx.evidence.find((r) => r.ref === `ev:${watch.id}`), ctx.evidence.find((r) => r.ref === "ev:portal2")];
  eq("a tried thing in one area plus a starter favorite in another stays untested", allowedCrossDomain(mixed, []), "untested");
}
{
  const prompt = buildHypothesisPrompt({ evidence: [], statements: [], contexts: [] }, []);
  check("prompt says starter favorites never count toward crossDomain", prompt.includes("rows with kind starter-favorite never do") && prompt.includes("A pattern resting only on starter favorites is always \"untested\""));
  check("prompt says one miss never removes or weakens an existing pattern", prompt.includes("One thing the user tried and disliked never removes or weakens a pattern"));
  check("prompt asks for nothing after the closing brace", prompt.includes("nothing after the closing brace"));
}

// ---- 2. one miss does not rewrite the profile ------------------------------------------------------------
const lovedBefore = () => { const s = emptyState(); ["eeaao", "barry"].forEach((id) => react(s, byId(id), "loved")); return s; };
const earlierProfile = [
  { id: "ai-teeth", title: "Comedy with teeth", claim: "Comedy lands when it has real stakes and a dark edge underneath.", supports: ["ev:eeaao", "ev:barry"], counters: [], domains: [...new Set([...byId("eeaao").domains, ...byId("barry").domains])], strength: "supported", status: "supported", crossDomain: "untested", context: null },
  { id: "ai-myth", title: "Serious myth", claim: "Mythic material works when it stays adult and character-driven.", supports: ["ev:lotr", "ev:circe"], counters: [], domains: ["read"], strength: "emerging", status: "emerging", crossDomain: "untested", context: null },
  { id: "ai-puzzles", title: "Puzzles with a voice", claim: "Puzzle games stick when the puzzles come with a specific comic voice.", supports: ["ev:portal2"], counters: [], domains: ["play"], strength: "emerging", status: "emerging", crossDomain: "untested", context: null }
];
{
  const s = lovedBefore();
  const missed = byId("wwdits");
  react(s, missed, "disliked");
  s.modelHypotheses = earlierProfile;
  const ctx = buildContext(s);
  // The model returns a brand-new set after one miss, as the eval saw on both models.
  const fresh = { hypotheses: [pattern({ id: "ai-new", label: "Something new entirely", claim: "A brand new pattern that replaces everything the profile said before.", evidence: ["ev:eeaao"], domains: byId("eeaao").domains })] };
  const result = validateHypotheses(preserveExistingHypotheses(normalizeHypothesisResponse(fresh, ctx), ctx, s.modelHypotheses), ctx);
  const labels = result.accepted.map((h) => h.label);
  check("after one miss every earlier pattern is still on the profile", earlierProfile.every((p) => labels.includes(p.title)), labels.join(" | "));
  check("the model's new pattern is kept too", labels.includes("Something new entirely"));
  check("carried patterns keep their ids", earlierProfile.every((p) => result.accepted.some((h) => h.id === p.id)));
  check("carried patterns stay inferred/model authority", result.accepted.every((h) => h.authority === "inferred" && h.source === "model"));

  // A revision the model returned (same id) is used as-is, not duplicated.
  const revised = { hypotheses: [pattern({ id: "ai-teeth", label: "Comedy with teeth, revised", claim: "Comedy lands when it has real stakes, though one dark comedy missed.", evidence: ["ev:eeaao", "ev:barry"], counter: [`ev:${missed.id}`], domains: byId("eeaao").domains })] };
  const revisedResult = validateHypotheses(preserveExistingHypotheses(normalizeHypothesisResponse(revised, ctx), ctx, s.modelHypotheses), ctx);
  eq("a returned revision is not duplicated by its earlier version", revisedResult.accepted.filter((h) => h.id === "ai-teeth").length, 1);
  eq("the revision's label wins", revisedResult.accepted.find((h) => h.id === "ai-teeth")?.label, "Comedy with teeth, revised");
}
{
  // Two misses in a pattern's area: the model may drop it.
  const s = lovedBefore();
  const watchMisses = catalogItems.filter((i) => !["eeaao", "barry"].includes(i.id) && i.domains.some((d) => earlierProfile[0].domains.includes(d))).slice(0, 2);
  watchMisses.forEach((item) => react(s, item, "disliked"));
  s.modelHypotheses = earlierProfile;
  const ctx = buildContext(s);
  const result = preserveExistingHypotheses({ hypotheses: [] }, ctx, s.modelHypotheses);
  check("two misses in a pattern's area let the model drop it", !result.hypotheses.some((h) => h.id === "ai-teeth"), result.hypotheses.map((h) => h.id).join(","));
  check("patterns in other areas are still carried", result.hypotheses.some((h) => h.id === "ai-puzzles"));
}
{
  // A "not me" statement still removes a pattern, and evidence that no longer exists cannot be carried.
  const s = lovedBefore();
  s.patternStatements = [{ hypothesisId: "ai-myth", label: "Serious myth", says: "not-me" }];
  s.modelHypotheses = [...earlierProfile, { id: "ai-gone", title: "Rests on a removed reaction", claim: "This pattern cites a reaction the user has since removed.", supports: ["ev:not-there"], counters: [], domains: ["movies"], strength: "emerging" }];
  const ctx = buildContext(s);
  const result = validateHypotheses(preserveExistingHypotheses({ hypotheses: [] }, ctx, s.modelHypotheses), ctx);
  check("a not-me pattern is never carried forward", !result.accepted.some((h) => h.id === "ai-myth"));
  check("a pattern whose evidence is gone is not accepted", !result.accepted.some((h) => h.id === "ai-gone"));
}
{
  // The profile keeps its usual size: new proposals give way before earlier patterns do.
  const s = lovedBefore();
  s.modelHypotheses = earlierProfile;
  const ctx = buildContext(s);
  const many = { hypotheses: Array.from({ length: 12 }, (_, i) => pattern({ id: `ai-n${i}`, label: `New pattern ${i}`, claim: `New pattern number ${i} that rests on one loved film.`, evidence: ["ev:eeaao"], domains: byId("eeaao").domains })) };
  const result = preserveExistingHypotheses(normalizeHypothesisResponse(many, ctx), ctx, s.modelHypotheses);
  eq("the profile stays at 12 patterns", result.hypotheses.length, 12);
  check("every earlier pattern survives the cap", earlierProfile.every((p) => result.hypotheses.some((h) => h.id === p.id)));
}
{
  // End to end through the production endpoint with a faked provider: one miss, a fresh answer.
  const s = lovedBefore();
  react(s, byId("wwdits"), "disliked");
  const rawState = {
    ...s,
    selectedFavorites: [...s.selectedFavorites],
    libraryFavorites: [],
    blindSpotDismissed: [],
    modelHypotheses: earlierProfile
  };
  const fresh = { hypotheses: [pattern({ id: "ai-new", label: "Something new entirely", claim: "A brand new pattern that replaces everything the profile said before.", evidence: ["ev:eeaao"], domains: byId("eeaao").domains })], insufficientEvidence: false };
  const env = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
  let sentPrompt = "";
  const fetchImpl = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) throw new Error(`unexpected URL ${url}`);
    sentPrompt = JSON.parse(init.body).messages[0].content;
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: `${JSON.stringify(fresh)}\n\nNote: I kept {braces} out of the JSON.` }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-test" }) };
  };
  const originalLog = console.log; const originalInfo = console.info;
  console.log = () => {}; console.info = () => {};
  let payload;
  try { payload = await produceHypotheses({ rawState, env, fetchImpl }); }
  finally { console.log = originalLog; console.info = originalInfo; }
  eq("endpoint answer with trailing text is still a model answer", payload.source, "model");
  check("endpoint keeps every earlier pattern after one miss", earlierProfile.every((p) => payload.hypotheses.some((h) => h.id === p.id)), payload.hypotheses.map((h) => h.id).join(","));
  check("the earlier patterns are sent with their evidence", sentPrompt.includes('"id":"ai-teeth"') && sentPrompt.includes('"evidence":["ev:eeaao","ev:barry"]'));
}

// ---- 3. tolerant JSON extraction -------------------------------------------------------------------------
{
  eq("trailing prose containing a brace is ignored", parseModelJson('{"a":1}\n\nI hope this helps {really}.').a, 1);
  eq("a second object after the first is ignored", parseModelJson('{"a":1}\n{"b":2}').a, 1);
  eq("braces inside strings do not end the object", parseModelJson('{"a":"x } y","b":{"c":2}} trailing }').b.c, 2);
  eq("leading prose and trailing prose together", parseModelJson('Here you go: {"a":[1,2]} Done.').a.length, 2);
  let threw = false;
  try { parseModelJson("no json here"); } catch { threw = true; }
  check("text with no object still fails", threw);
}

// ---- 4. level: starter favorites do not test a pattern ---------------------------------------------------
{
  // starter-6 / cold-4: only starter favorites exist. The contract (evidence-contract.md) allows at most
  // "emerging" -- "Nothing the user tried has tested it yet" -- however many favorites a pattern cites.
  const ctx = buildContext(emptyState(["lotr", "circe", "portal2", "thefall"]));
  const starters = ["ev:lotr", "ev:circe", "ev:portal2", "ev:thefall"].map((ref) => ctx.evidence.find((r) => r.ref === ref));
  check("cold-4 evidence is all starter favorites", starters.every((r) => r?.kind === "starter-favorite"));
  eq("one starter favorite allows emerging, not supported", allowedLevel(starters.slice(0, 1), []), "emerging");
  eq("four starter favorites allow emerging, not strong", allowedLevel(starters, []), "emerging");
  for (const claimed of ["supported", "strong"]) {
    const result = validateHypotheses({ hypotheses: [pattern({
      id: `ai-cold-${claimed}`, label: "Mythic fantasy worlds", claim: "Mythic fantasy worlds with real weight seem to land across books and games.",
      evidence: starters.map((r) => r.ref), domains: ["read"], level: claimed
    })] }, ctx);
    eq(`a starter-only pattern claimed ${claimed} is still accepted`, result.accepted.length, 1);
    eq(`a starter-only pattern claimed ${claimed} is lowered to emerging`, result.accepted[0]?.level, "emerging");
    check(`the product notes why a ${claimed} claim was lowered`, result.notes.some((n) => /level lowered from .* to emerging \(evidence allows emerging\)/.test(n)), result.notes.join(" | "));
  }
}
{
  // Tried things still count, and starter favorites cited alongside them add nothing to the level.
  const s = emptyState(["lotr", "circe", "portal2", "thefall"]);
  react(s, byId("eeaao"), "loved");
  const ctx = buildContext(s);
  const loved = ctx.evidence.find((r) => r.ref === "ev:eeaao");
  const starters = ["ev:lotr", "ev:circe", "ev:portal2"].map((ref) => ctx.evidence.find((r) => r.ref === ref));
  eq("one loved thing allows supported", allowedLevel([loved], []), "supported");
  eq("one loved thing plus three starter favorites is still only supported", allowedLevel([loved, ...starters], []), "supported");
  const missed = byId("wwdits");
  react(s, missed, "disliked");
  const ctx2 = buildContext(s);
  const counter = ctx2.evidence.find((r) => r.ref === `ev:${missed.id}`);
  eq("one loved + starters against one miss is emerging (starters do not outvote a miss)", allowedLevel([loved, ...starters], [counter]), "emerging");
}
{
  // Three tried things, two clear of misses, still reach strong.
  const s = emptyState();
  ["eeaao", "barry", "wwdits"].forEach((id) => react(s, byId(id), "loved"));
  const ctx = buildContext(s);
  const tried = ["ev:eeaao", "ev:barry", "ev:wwdits"].map((ref) => ctx.evidence.find((r) => r.ref === ref));
  eq("three loved things allow strong", allowedLevel(tried, []), "strong");
}

console.log(`profile rules tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
