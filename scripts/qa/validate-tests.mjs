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


// ---- #28 Stage 1: a distinct anchor per pick ----------------------------------------------------------
{
  const { ANCHORS, MAX_PICKS_PER_ANCHOR } = await import("../../src/ai/contract.js");
  const { PICKS_OUTPUT_SCHEMA } = await import("../../src/server/output-schemas.mjs");
  const { buildPickPrompt } = await import("../../api/recommendations.mjs");
  const book = (id, title) => ({ id, title, type: "book", domains: ["read"], provider: "openlibrary", providerId: id.toUpperCase(), genres: ["Fantasy"] });
  const loved = book("ol-anchor-loved", "Piranesi");
  const pool = [1, 2, 3, 4, 5].map((n) => book(`ol-anchor-${n}`, `Candidate ${n}`));
  const s = emptyState();
  react(s, loved, "loved");
  const ctx = { ...buildContext(s, pool), curveball: true };
  const pick = (item, anchor) => ({ itemId: item.id, anchor, why: "A drowned house of statues, as patient as Piranesi's halls.", cites: [`ev:${loved.id}`], tests: null, kind: "pick" });

  eq("anchors are the seven agreed elements", ANCHORS.join(), "setting,character,structure,tone,theme,pacing,voice");
  const three = validatePicks({ picks: [pick(pool[0], "setting"), pick(pool[1], "setting"), pick(pool[2], "setting"), pick(pool[3], "tone")] }, ctx);
  eq(`no more than ${MAX_PICKS_PER_ANCHOR} picks in a set may share an anchor`, three.accepted.length, 3);
  check("the third same-anchor pick is rejected with a reason that says so", three.rejected[0]?.reasons.some((r) => /already used by 2 picks/.test(r)), three.rejected[0]?.reasons);
  check("other anchors are unaffected", three.accepted.some((p) => p.anchor === "tone"));
  const unknown = validatePicks({ picks: [pick(pool[0], "vibes")] }, ctx);
  check("an unknown anchor is rejected", unknown.accepted.length === 0 && unknown.rejected[0].reasons.some((r) => /anchor "vibes" not one of/.test(r)), unknown.rejected[0]?.reasons);
  eq("a pick without an anchor (non-model producers) is still accepted", validatePicks({ picks: [pick(pool[0], undefined)] }, ctx).accepted.length, 1);
  check("a rejected anchor does not use up the count", validatePicks({ picks: [pick(pool[0], "setting"), { ...pick(pool[1], "setting"), cites: ["ev:nope"] }, pick(pool[2], "setting")] }, ctx).accepted.length === 2);

  const item = PICKS_OUTPUT_SCHEMA.properties.picks.items;
  check("the output schema requires an anchor from the list", item.required.includes("anchor") && JSON.stringify(item.properties.anchor.enum) === JSON.stringify(ANCHORS));
  check("anchor comes before why in the schema, so it is chosen first", Object.keys(item.properties).indexOf("anchor") < Object.keys(item.properties).indexOf("why"));

  const prompt = buildPickPrompt({ ...ctx, recommendationFilter: "all" }, 5);
  check("the prompt asks for an anchor per pick", prompt.includes('"anchor":"setting"') && prompt.includes("first choose its anchor"));
  check("the prompt shows varied examples", (prompt.match(/<example>/g) ?? []).length >= 3);
  check("#247's banned-phrase list is gone", !/Avoid stock phrases|in the vein of|fans of/.test(prompt));
  check("every example fits the 14-word limit", [...prompt.matchAll(/<example>(.*?)<\/example>/g)].every((m) => m[1].split(/\s+/).length <= 14));
}

finish();
