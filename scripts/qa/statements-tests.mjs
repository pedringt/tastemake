import { setStatement, toggleDomainExclusion } from "../../src/model/statements.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

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

console.log(`statements tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
