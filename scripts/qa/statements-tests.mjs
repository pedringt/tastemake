import { setStatement, toggleDomainExclusion } from "../../src/model/statements.js";
import { createSuite } from "./lib/assert.mjs";
import { isTastebreakCandidate, startTastebreak, tastebreakPatterns } from "../../src/model/tastebreak.js";

const { check, eq, finish } = createSuite("statements tests");

const pattern = { id:"ai-one", title:"Pattern one", claim:"A specific working claim" };
const fresh = () => ({ modelHypotheses:[pattern], patternStatements:[], hypothesisHistory:[] });

{
  const state = fresh();
  setStatement(state, pattern.id, "says", "accurate");
  setStatement(state, pattern.id, "weight", "lot");
  setStatement(state, pattern.id, "context", "broad");
  const entry = state.patternStatements[0];
  eq("yes can record importance", entry.weight, "lot");
  eq("yes can record breadth", entry.context, "broad");

  setStatement(state, pattern.id, "says", "not-me");
  eq("no clears stale importance", entry.weight, null);
  eq("no clears stale breadth", entry.context, null);
  eq("no clears domain refinements", (entry.excludedDomains ?? []).length, 0);
}

{
  const state = fresh();
  setStatement(state, pattern.id, "says", "partial");
  eq("partly is stored as the primary fit answer", state.patternStatements[0]?.says, "partial");
  eq("partly refuses an importance answer", setStatement(state, pattern.id, "weight", "lot"), null);
  eq("partly refuses usually/broad", setStatement(state, pattern.id, "context", "broad"), null);
  check("partly allows depends-on-context", Boolean(setStatement(state, pattern.id, "context", "some")));
}

{
  const state = fresh();
  setStatement(state, pattern.id, "says", "partial");
  check("partly allows domain refinement", Boolean(toggleDomainExclusion(state, pattern.id, "movies")));
  eq("domain refinement is recorded", state.patternStatements[0].excludedDomains.join(","), "movies");
  setStatement(state, pattern.id, "says", "unsure");
  eq("not sure clears domain refinement", (state.patternStatements[0].excludedDomains ?? []).length, 0);
  eq("not sure clears context follow-up", state.patternStatements[0].context, null);
}

{
  const state = fresh();
  setStatement(state, pattern.id, "says", "not-me");
  eq("no refuses importance follow-up", setStatement(state, pattern.id, "weight", "little"), null);
  eq("no refuses context follow-up", setStatement(state, pattern.id, "context", "some"), null);
  eq("no refuses domain refinement", toggleDomainExclusion(state, pattern.id, "movies"), null);
}


// ---- #19: Tastebreak is offered for items a Taste Profile pattern cites (Oct 20) -------------------
{
  const book = { id: "ol-hero", title: "The Hero of Ages", type: "book", domains: ["read"] };
  const loved = { item: book, rating: "more", detail: "loved-before" };
  const citing = { id: "ai-world", title: "Rich world-building", claim: "Richly built worlds carry the enjoyment.", supports: ["ev:ol-hero"], counters: [] };
  const other = { id: "ai-other", title: "Other", claim: "Something else entirely.", supports: ["ev:ol-other"], counters: [] };
  const state = { modelHypotheses: [citing, other], patternStatements: [], hypothesisHistory: [], feedbackByRecommendation: { [book.id]: loved }, tastebreaks: {}, tastebreakDrafts: {} };

  eq("a pick with no ai.tests is offered Tastebreak when a pattern cites it", isTastebreakCandidate(loved, state), true);
  eq("only the citing pattern is asked about", tastebreakPatterns(book, state).map((p) => p.id).join(), "ai-world");
  check("starting one works", typeof startTastebreak(state, book.id) === "string" && state.tastebreakDrafts[book.id]);
  eq("a counter-citing pattern counts too (a dislike's 'why it didn't land')", tastebreakPatterns(book, { ...state, modelHypotheses: [{ ...citing, supports: [], counters: ["ev:ol-hero"] }] }).length, 1);
  eq("a pattern the user said is 'not me' is left out", isTastebreakCandidate(loved, { ...state, patternStatements: [{ hypothesisId: "ai-world", says: "not-me" }] }), false);
  eq("an untried item is never offered", isTastebreakCandidate({ item: book, rating: "not-tried", detail: "bookmarked" }, state), false);
  eq("no citing pattern, no Tastebreak", isTastebreakCandidate(loved, { ...state, modelHypotheses: [other] }), false);
}

finish();
