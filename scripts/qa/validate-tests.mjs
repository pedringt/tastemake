#!/usr/bin/env node
// Context-qualified patterns (#36 v1): a user-confirmed "only in some contexts" statement must cap what a
// live-AI hypothesis may claim about that pattern's confidence, the same way "not me" fully excludes it.
// Free, no browser, no model call.
//
//   node scripts/qa/validate-tests.mjs

import { buildContext } from "../../src/ai/context.js";
import { validateHypotheses, validatePicks } from "../../src/ai/validate.js";
import { hypotheses, recommendations, followUpPool } from "./fixtures/catalog.js";
import { emptyState, react } from "../evals/fixtures.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("validate tests");

const catalogItems = [...recommendations, ...followUpPool];
const byId = (id) => catalogItems.find((item) => item.id === id);

// Same shape as the "about-10" eval fixture: three loved things on H04 reach Strong on their own.
const state = emptyState();
["eeaao", "barry", "wwdits"].forEach((id) => byId(id) && react(state, byId(id), "loved"));
const h04 = hypotheses.find((h) => h.id === "H04");

function proposal(refs) {
  return { label: h04.title, claim: h04.claim, evidence: refs, counter: [], domains: [], crossDomain: "untested", level: "strong", conditional: false, context: null };
}

// ---- baseline: no context statement, evidence alone reaches Strong ------------------------------------
{
  const ctx = buildContext(state);
  const refs = ctx.evidence.filter((r) => ["eeaao", "barry", "wwdits"].includes(r.itemId)).map((r) => r.ref);
  check("fixture actually has 3 refs to cite", refs.length === 3, `got ${refs.length}`);
  const result = validateHypotheses({ hypotheses: [proposal(refs)] }, ctx);
  eq("no context statement: accepted", result.accepted.length, 1);
  eq("no context statement: evidence alone allows Strong", result.accepted[0]?.level, "strong");
}

// ---- a context: "some" statement caps the claim to Supported, even though the same evidence exists ----
{
  state.patternStatements = [{ hypothesisId: "H04", label: h04.title, says: null, weight: null, context: "some" }];
  const ctx = buildContext(state);
  const refs = ctx.evidence.filter((r) => ["eeaao", "barry", "wwdits"].includes(r.itemId)).map((r) => r.ref);
  const result = validateHypotheses({ hypotheses: [proposal(refs)] }, ctx);
  eq("context-qualified: still accepted (not excluded like 'not me')", result.accepted.length, 1);
  eq("context-qualified: capped to Supported, not Strong", result.accepted[0]?.level, "supported");
  check("context-qualified: a note explains why it was lowered", result.notes.some((n) => /some contexts/.test(n)), result.notes.join(" | "));
}

// ---- distinguishable from a full "not me": that fully excludes, this only caps ------------------------
{
  state.patternStatements = [{ hypothesisId: "H04", label: h04.title, says: "not-me", weight: null, context: null }];
  const ctx = buildContext(state);
  const refs = ctx.evidence.filter((r) => ["eeaao", "barry", "wwdits"].includes(r.itemId)).map((r) => r.ref);
  const result = validateHypotheses({ hypotheses: [proposal(refs)] }, ctx);
  eq("'not me' rejects outright (context qualifier does not)", result.accepted.length, 0);
  check("'not me' rejection names the reason", result.rejected[0]?.reasons.some((r) => /not them/.test(r)), result.rejected[0]?.reasons.join(" | "));
}


{
  const candidate = { id:"candidate", title:"Alien: Earth", type:"tv", domains:["tv"], hypotheses:[] };
  const ctx = {
    evidence:[
      { ref:"ev:liked", itemId:"liked", title:"The X-Files", class:"experienced", polarity:1, domains:["tv"] },
      { ref:"ev:disliked", itemId:"disliked", title:"Marvel's Agents of S.H.I.E.L.D.", class:"experienced", polarity:-1, domains:["tv"] }
    ],
    candidates:[candidate],
    statements:[],
    curveball:true
  };

  const negativeOnly = validatePicks({ picks:[{
    itemId:"candidate",
    why:"From Marvel's Agents of S.H.I.E.L.D., this is the next thing to try.",
    cites:["ev:disliked"],
    tests:null,
    kind:"pick"
  }]}, ctx);
  eq("pick cannot use a dislike as its only positive support", negativeOnly.accepted.length, 0);

  const negativeAsReason = validatePicks({ picks:[{
    itemId:"candidate",
    why:"Marvel's Agents of S.H.I.E.L.D. makes Alien: Earth a good fit.",
    cites:["ev:liked","ev:disliked"],
    tests:null,
    kind:"pick"
  }]}, ctx);
  eq("pick cannot center a disliked title without explicit contrast", negativeAsReason.accepted.length, 0);

  const explicitContrast = validatePicks({ picks:[{
    itemId:"candidate",
    why:"Unlike Marvel's Agents of S.H.I.E.L.D., this leans on the darker sci-fi you liked in The X-Files.",
    cites:["ev:liked","ev:disliked"],
    tests:null,
    kind:"pick"
  }]}, ctx);
  eq("a dislike may appear as explicit contrast when positive evidence supports the pick", explicitContrast.accepted.length, 1);
}


// ---- #256: patterns must keep the user's reasons as given, on the items they cite ---------------------
// Rebuilt from a real books-only production profile (Oct 20): Katabasis was disliked for Story +
// Characters, The Darkest Minds for Story + Writing / prose: flat, and the model wrote "a flat or thin cast
// of characters". The Hero of Ages and Locke Lamora were tagged World / setting: rich detail.
{
  const book = (id, title) => ({ id, title, type: "book", domains: ["read"], provider: "openlibrary", providerId: id.toUpperCase() });
  const items = {
    circe: book("ol-circe", "Circe"), locke: book("ol-locke", "The Lies of Locke Lamora"), hero: book("ol-hero", "The Hero of Ages"),
    katabasis: book("ol-katabasis", "Katabasis"), minds: book("ol-minds", "The Darkest Minds")
  };
  const s = emptyState();
  react(s, items.circe, "loved");
  react(s, items.locke, "loved"); s.feedbackByRecommendation[items.locke.id].refinements = ["characters", "story", "world-setting:rich-detail", "pacing:kept-me-reading"];
  react(s, items.hero, "liked"); s.feedbackByRecommendation[items.hero.id].refinements = ["story", "writing-prose:clean", "world-setting:rich-detail"];
  react(s, items.katabasis, "disliked"); s.feedbackByRecommendation[items.katabasis.id].refinements = ["story", "characters"];
  react(s, items.minds, "disliked"); s.feedbackByRecommendation[items.minds.id].refinements = ["story", "writing-prose:flat"];
  const ctx = buildContext(s);
  const ref = (key) => `ev:${items[key].id}`;
  const hyp = (label, claim, evidence, counter = []) => ({ label, claim, evidence, counter, domains: ["read"], crossDomain: "untested", level: "emerging", conditional: false, context: null });

  const merged = validateHypotheses({ hypotheses: [hyp("Character investment over plot mechanics",
    "Engagement seems tied to strong characters; a flat or thin cast of characters has been a reason for disliking a book even when the premise is strong.",
    [ref("locke")])] }, ctx);
  eq("the real merged-reasons pattern is rejected", merged.accepted.length, 0);
  check("it is rejected because no cited item carries 'flat'", merged.rejected[0]?.reasons.some((r) => /no cited item carries/.test(r)), merged.rejected[0]?.reasons);

  const citedButMoved = validateHypotheses({ hypotheses: [hyp("Character investment",
    "Engagement seems tied to strong characters; a flat cast of characters has been part of a miss.",
    [ref("locke")], [ref("minds"), ref("katabasis")])] }, ctx);
  eq("citing the 'flat' book does not make 'flat characters' right", citedButMoved.accepted.length, 0);
  check("it names the dimension the user actually meant", citedButMoved.rejected[0]?.reasons.some((r) => /pairs "flat" with characters, but the user said it about writing-prose/.test(r)), citedButMoved.rejected[0]?.reasons);

  const faithful = validateHypotheses({ hypotheses: [hyp("Prose matters in a miss",
    "When the writing reads as flat prose, a promising premise has not been enough to carry the book.",
    [ref("hero"), ref("locke")], [ref("minds")])] }, ctx);
  check("a pattern that keeps 'flat' with the prose and cites that book is accepted", faithful.accepted.length === 1, JSON.stringify(faithful.rejected[0]?.reasons));

  const overreach = validateHypotheses({ hypotheses: [hyp("Rich world-building and immersive settings",
    "Strongly values richly built worlds and immersive settings, which carry the enjoyment even when other elements vary.",
    [ref("locke"), ref("hero")], [ref("katabasis")])] }, ctx);
  eq("a general rule from two items is kept (it may be right, and may be confirmed)", overreach.accepted.length, 1);
  check("but it is marked conditional, with a note", overreach.accepted[0]?.conditional === true && overreach.notes.some((n) => /marked conditional/.test(n)), overreach.notes);

  const plain = validateHypotheses({ hypotheses: [hyp("Lyrical, character-driven fantasy",
    "Enjoys fantasy that is literary and character-driven, with rich mythic or historical grounding such as reimagined myth.",
    [ref("circe"), ref("locke"), ref("hero")], [ref("minds"), ref("katabasis")])] }, ctx);
  check("a pattern that uses no reason words is unaffected", plain.accepted.length === 1 && plain.accepted[0].conditional === false);
}


// ---- #257: a curveball lands on explicitly adult-tagged content only if the user has tried that kind ----
{
  const { produceRecommendations } = await import("../../api/recommendations.mjs");
  const book = (id, title, genres) => ({ id, title, type: "book", domains: ["read"], provider: "openlibrary", providerId: id.toUpperCase(), genres });
  const loved = book("ol-circe", "Circe", ["Mythology", "Retellings"]);
  const adult = book("ol-neon", "Neon Gods", ["Romance", "Mythology", "Smut", "Retellings"]);
  const plainPick = book("ol-mythos", "Mythos", ["Mythology", "Greek"]);
  const s = emptyState();
  react(s, loved, "loved");
  const ctx = { ...buildContext(s, [adult, plainPick]), curveball: true };
  const pick = (item, kind) => ({ itemId: item.id, why: "A retelling that stretches toward darker territory.", cites: [`ev:${loved.id}`], tests: null, kind });

  const curve = validatePicks({ picks: [pick(adult, "curveball")] }, ctx);
  eq("an adult-tagged curveball is rejected when nothing like it was tried", curve.accepted.length, 0);
  check("with a reason that says so", curve.rejected[0]?.reasons.some((r) => /adult-tagged/.test(r)), curve.rejected[0]?.reasons);
  eq("the same book as a regular pick is unchanged", validatePicks({ picks: [pick(adult, "pick")] }, ctx).accepted.length, 1);
  eq("broad words (romance) alone are not adult tags", validatePicks({ picks: [pick(book("ol-romance", "A Romance", ["Romance", "Dark Romance"]), "curveball")] }, { ...buildContext(s, [book("ol-romance", "A Romance", ["Romance", "Dark Romance"])]), curveball: true }).accepted.length, 1);

  const tried = emptyState();
  react(tried, loved, "loved");
  react(tried, book("ol-tried-adult", "Tried Adult", ["Erotica", "Romance"]), "liked");
  eq("once the user has tried that kind of book, the curveball is allowed", validatePicks({ picks: [pick(adult, "curveball")] }, { ...buildContext(tried, [adult]), curveball: true }).accepted.length, 1);

  // The no-AI fallback: the 6th offered candidate is the curveball slot. Oct 27: the six are now chosen by
  // taste, so the pool is built to put the adult-tagged book 6th (five closer matches to Circe ahead of it,
  // one weaker match behind) and the titles are distinct (one per franchise).
  const pool = ["Stone Blind", "Elektra", "A Thousand Ships", "Pandora's Jar", "Lore Olympus"].map((title, n) => book(`ol-c${n + 1}`, title, ["Mythology", "Retellings"]));
  const out = await produceRecommendations({ rawState: { selectedFavorites: [], feedbackByRecommendation: { [loved.id]: s.feedbackByRecommendation[loved.id] }, curveball: true }, env: {}, retrieve: async () => [...pool, adult, plainPick] });
  const curveballPick = out.picks.find((p) => p.surprise);
  check("the fallback skips an adult-tagged curveball for the next eligible candidate", curveballPick?.id === plainPick.id && !out.picks.some((p) => p.id === adult.id), out.picks.map((p) => `${p.id}${p.surprise ? "*" : ""}`).join());
}


// ---- Oct 20: fallback picks (AI paused) say what they share with the item they came from -----------
{
  const { readableTag, sharedTags, fallbackReason } = await import("../../src/catalog/fallback-reasons.mjs");
  const { HEDGE, STOCK_FAMILIES } = await import("../evals/stress/metrics.mjs");
  eq("BISAC-style subjects read as plain words", readableTag("Fiction, fantasy, epic", "openlibrary"), "epic fantasy");
  eq("TMDb genre ids read as names", readableTag("878", "tmdb"), "sci-fi");
  eq("audience labels are never shown", readableTag("Juvenile fiction", "openlibrary"), null);
  eq("nationality and 'fiction' are trimmed", readableTag("American fantasy fiction", "openlibrary"), "fantasy");
  // Smoke test, Oct 20: production read "a american science fiction-leaning pick"; this module first cut it to "science".
  eq("'science fiction' keeps its second word", readableTag("American science fiction", "openlibrary"), "science fiction");
  eq("...also in BISAC order", readableTag("Science fiction, American", "openlibrary"), "science fiction");
  eq("children's fiction is an audience label, not a reason", readableTag("Children's fiction", "openlibrary"), null);
  const arrival = { title: "Arrival", provider: "tmdb", genres: ["18", "878", "9648"] };
  eq("a broad genre (drama) comes after a specific one (sci-fi)", sharedTags({ title: "Enemy Mine", provider: "tmdb", genres: ["18", "878"] }, arrival).join(), "sci-fi,drama");
  const anchor = { title: "Mistborn", provider: "openlibrary", genres: ["Fantasy fiction", "Magic", "Courts and courtiers", "Fiction, fantasy, epic"] };
  const book = { title: "A Darker Shade of Magic", provider: "openlibrary", type: "book", relatedTo: "Mistborn", genres: ["Magic", "Fantasy fiction", "quantum theory", "Fiction, fantasy, epic"] };
  eq("shared tags: the specific genre first, redundant ones dropped, unshared ones ignored", sharedTags(book, anchor).join(), "epic fantasy,magic");
  const reasons = [0, 1, 2, 3, 4].map((index) => fallbackReason(book, anchor, { index }));
  check("each reason names the anchor and a shared tag", reasons.every((r) => r.includes("Mistborn") && r.includes("epic fantasy")), reasons.join(" | "));
  check("no hedges or stock verbs (what the #28 measures flag)", reasons.every((r) => !HEDGE.test(r) && !STOCK_FAMILIES.some((f) => f.re.test(r))), reasons.join(" | "));
  check("'an' before a vowel", fallbackReason(book, anchor, { index: 3 }).startsWith("An epic fantasy book"));
  check("no shared tags: an honest line, no invented link", /no tags in common/.test(fallbackReason({ ...book, genres: ["Space opera"] }, anchor)));
  check("the curveball says it is a wider step", /wider step/.test(fallbackReason(book, anchor, { curveball: true })));

  const { produceRecommendations } = await import("../../api/recommendations.mjs");
  const anchorItem = { id: "ol-mistborn", ...anchor, type: "book", domains: ["read"], providerId: "OL1W" };
  const pool = [1, 2, 3, 4, 5, 6].map((n) => ({ ...book, id: `ol-c${n}`, providerId: `C${n}W`, title: `Candidate ${n}`, relatedToId: anchorItem.id, domains: ["read"] }));
  const out = await produceRecommendations({ rawState: { selectedFavorites: [anchorItem.id], customItems: { [anchorItem.id]: anchorItem }, feedbackByRecommendation: {}, curveball: true }, env: {}, retrieve: async () => pool });
  check("production's fallback uses the shared-tag reasons", out.source === "catalog" && out.picks.every((p) => p.reason.includes("Mistborn") && /epic fantasy/.test(p.reason)), out.picks.map((p) => p.reason).join(" | "));
}

finish();
