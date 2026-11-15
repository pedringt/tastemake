// #323 reason-generation eval (scripts/evals/reasons): fixtures, prompt, shape checks and caps. Free: the model
// call is a stub, so nothing reaches the network.
import { createSuite } from "./lib/assert.mjs";
import { CASES, caseContext, readableGenres } from "../evals/reasons/fixtures.mjs";
import { MAX_WORDS, REASON_COUNT, buildReasonsPrompt, checkReasons } from "../evals/reasons/prompt.mjs";
import { APPROVED_CALLS, plan, runPlan } from "../evals/reasons/run.mjs";

const { check, eq, finish } = createSuite("reason-eval");

// ---- fixtures ----
{
  eq("10 cases", CASES.length, 10);
  eq("3 of them carry Paige's round-3 picks as gold", CASES.filter((c) => c.gold).map((c) => c.id).join(","), "comedy-office,mythic-obra-dinn,horror-leftovers");
  check("every case has a pattern, a flagged title and at least two others", CASES.every((c) => c.pattern.name && c.pattern.claim && c.flagged && c.others.length >= 2));
  check("the flagged title is never among the others", CASES.every((c) => !c.others.some((t) => t.startsWith(c.flagged))));
  const office = caseContext(CASES[0]);
  eq("The Office is the US show Paige meant (2005), not the stored 2001 UK series", `${office.flagged.year} ${/Dunder Mifflin/.test(office.flagged.about)}`, "2005 true");
  const leftovers = caseContext(CASES[2]);
  eq("other facts come from the Example Profile", leftovers.flagged.title, "The Leftovers");
  check("TMDb genre ids become names", leftovers.flagged.genres.includes("Drama") && !leftovers.flagged.genres.some((g) => /^\d+$/.test(g)));
  check("the flagged title carries its synopsis; the others don't", Boolean(leftovers.flagged.about) && leftovers.others.every((o) => !("about" in o)));
  eq("book subject tags are dropped", readableGenres({ genres: ["Fantasy", "nyt:combined-print=2018", "form:novel", "Fantasy"] }).join(","), "Fantasy");
}

// ---- prompt ----
{
  const context = caseContext(CASES[1]);
  const prompt = buildReasonsPrompt(context);
  check("instructions come before CONTEXT, data after", prompt.indexOf("Rules:") < prompt.indexOf("\n\nCONTEXT\n") && prompt.endsWith(JSON.stringify(context)));
  check("asks for exactly three short reasons", prompt.includes(`exactly ${REASON_COUNT}`) && prompt.includes(`At most ${MAX_WORDS} words`));
  check("forbids invented facts and title names", /Never invent facts/.test(prompt) && /No title names/.test(prompt));
  check("never shows the gold answer", !CASES.filter((c) => c.gold).some((c) => c.gold.some((g) => buildReasonsPrompt(caseContext(c)).includes(g))));
}

// ---- shape checks ----
{
  const context = caseContext(CASES[0]);
  const good = { reasons: [{ label: "Traditional sitcom format", basis: "classic sitcom vs docu/sketch" }, { label: "Warmer, less cringe", basis: "tone" }, { label: "Workplace ensemble cast", basis: "about: office workers" }] };
  eq("a good answer passes", checkReasons(good, context).ok, true);
  const bad = { reasons: [{ label: "A much warmer and kinder style of comedy overall", basis: "x" }, { label: "Unlike Nathan for You", basis: "x" }, { label: "unlike nathan for you", basis: "" }, { label: "you like it", basis: "x" }] };
  const problems = checkReasons(bad, context).problems.join(" / ");
  check("catches the wrong count", problems.includes("expected 3"));
  check("catches too many words", problems.includes("over 6 words"));
  check("catches a title name", problems.includes("names a title"));
  check("catches a repeat", problems.includes("repeats another"));
  check("catches a missing basis", problems.includes("no basis"));
  check("catches 'you'", problems.includes('says "you"'));
}

// ---- plan and caps ----
{
  const calls = plan();
  eq(`the plan is ${APPROVED_CALLS} calls (10 cases x 3 reps)`, calls.length, APPROVED_CALLS);
  eq("reps are interleaved: the first 10 calls cover every case once", new Set(calls.slice(0, 10).map((c) => c.kase.id)).size, 10);
  const answer = { reasons: [{ label: "One", basis: "a" }, { label: "Two", basis: "b" }, { label: "Three", basis: "c" }] };
  let made = 0;
  const stub = async () => { made += 1; return { json: answer, usage: { input_tokens: 600, output_tokens: 60 } }; };
  const capped = await runPlan(calls, { call: stub, maxUsd: 1, maxCalls: 4 });
  check("the call cap stops the run before the next call", made === 4 && capped.results.length === 4 && /call cap/.test(capped.stopped));
  made = 0;
  const tiny = await runPlan(calls, { call: stub, maxUsd: 0.000001 });
  check("the spend cap stops before a call whose worst case could cross it", made === 0 && /spend cap/.test(tiny.stopped));
  made = 0;
  const failing = await runPlan(calls.slice(0, 2), { call: async () => { made += 1; throw new Error("boom"); }, maxUsd: 1 });
  check("a failed call is recorded, counted at its worst case, and the run goes on", made === 2 && failing.results.every((r) => r.error === "boom" && !r.check.ok) && failing.spend.usd > 0);
  const full = await runPlan(calls, { call: stub, maxUsd: 1 });
  eq("an uncapped stub run answers every planned call", full.results.length, APPROVED_CALLS);
}

finish();
