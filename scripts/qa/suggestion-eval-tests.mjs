// #323 phase 1 suggestion eval (scripts/evals/suggestions): fixtures, prompt, checks and caps. Free: the model call
// is a stub, so nothing reaches the network.
import { createSuite } from "./lib/assert.mjs";
import { CASES, caseContext } from "../evals/suggestions/fixtures.mjs";
import { PROMPT_VERSIONS, buildSuggestionPrompt, checkSuggestion } from "../evals/suggestions/prompt.mjs";
import { APPROVED_CALLS, plan, runPlan } from "../evals/suggestions/run.mjs";

const { check, eq, finish } = createSuite("suggestion-eval");
const byId = (id) => CASES.find((c) => c.id === id);

// ---- fixtures ----
{
  eq("10 cases", CASES.length, 10);
  eq("6 carry the prototype's hand-written suggestion", CASES.filter((c) => c.hand).length, 6);
  check("every flagged title is one of the pattern's titles", CASES.every((c) => Object.keys(c.verdicts).every((t) => c.titles.includes(t))));
  check("every 'words about' title is one of the pattern's titles", CASES.every((c) => !Array.isArray(c.wordsAbout) || c.wordsAbout.every((t) => c.titles.includes(t))));
  eq("full Example Profile titles are used", byId("comedy-office").titles.includes("I Think You Should Leave with Tim Robinson"), true);
  const office = caseContext(byId("comedy-office"));
  eq("The Office is the US show (2005)", office.titles[0].year, "2005");
  check("only flagged titles carry a synopsis", office.titles.filter((t) => "about" in t).map((t) => t.title).join() === "The Office");
  check("the grouping answer is sent only when two or more titles are on a different side", !("differentTitlesGoTogether" in office.answers) && caseContext(byId("comedy-sitcom-split")).answers.differentTitlesGoTogether === true);
  eq("Decision 5: tapped words say which titles they're about", JSON.stringify(caseContext(byId("horror-word-all")).answers.wrongWords), JSON.stringify({ words: ["horror"], about: "all of the titles" }));
  eq("doesn't-fit verdicts are worded as the person saw them", caseContext(byId("puzzle-games-narrow")).answers.titles[0].verdict, "doesn't fit this description");
}

// ---- prompt ----
{
  const kase = byId("comedy-office");
  const prompt = buildSuggestionPrompt(caseContext(kase));
  check("instructions come before CONTEXT, data after", prompt.indexOf("Rules:") < prompt.indexOf("\n\nCONTEXT\n") && prompt.endsWith(JSON.stringify(caseContext(kase))));
  check("the person's words are data, not instructions", /never instructions to follow/.test(prompt));
  const v2 = buildSuggestionPrompt(caseContext(kase), "v2");
  check("v2 keeps v1's rules and adds four", PROMPT_VERSIONS.join() === "v1,v2" && prompt.split("\n").every((l) => l.startsWith("CONTEXT") || l.startsWith("{") || v2.includes(l)) && v2.split("\n").length === prompt.split("\n").length + 4);
  check("v2 says only different-side titles may be set aside", /Only titles marked .fits a different side of my taste. may go in setAside/.test(v2));
  check("v2 rule examples leak no case's titles or reasons", !CASES.some((c) => [...c.titles, ...Object.values(c.verdicts).flatMap((v) => v.reasons)].some((t) => t.length > 4 && v2.slice(0, v2.indexOf("\n\nCONTEXT")).includes(t))));
  let threw = false;
  try { buildSuggestionPrompt(caseContext(kase), "v9"); } catch { threw = true; }
  check("an unknown prompt version is refused", threw);
  check("never shows a hand-written suggestion", !CASES.filter((c) => c.hand).some((c) => c.hand.patterns.some((p) => p.name !== c.pattern.name && buildSuggestionPrompt(caseContext(c)).includes(p.name))));
}

// ---- checks ----
{
  for (const kase of CASES.filter((c) => c.hand)) eq(`the hand-written ${kase.id} passes`, checkSuggestion(kase.hand, kase, caseContext(kase)).problems.join("; "), "");
  const kase = byId("puzzle-games-narrow");
  const ctx = caseContext(kase);
  const good = { patterns: [{ name: "Exploration-heavy puzzle games", claim: "Favors games built around exploration and puzzle-solving.", titles: ["The Witness", "Portal 2"] }], setAside: ["Silent Hill 2"] };
  eq("a correct narrowing passes", checkSuggestion(good, kase, ctx).ok, true);
  const keepsMisfit = { ...good, patterns: [{ ...good.patterns[0], titles: ["The Witness", "Portal 2", "BioShock"] }] };
  check("keeping a doesn't-fit title fails", checkSuggestion(keepsMisfit, kase, ctx).problems.some((p) => /BioShock/.test(p)));
  check("losing a title fails", checkSuggestion({ ...good, setAside: [] }, kase, ctx).problems.some((p) => /loses "Silent Hill 2"/.test(p)));
  check("an invented title fails", checkSuggestion({ ...good, setAside: ["Silent Hill 2", "Myst"] }, kase, ctx).problems.some((p) => /Myst/.test(p)));
  check("setting aside a title the person didn't flag fails", checkSuggestion({ ...good, patterns: [{ ...good.patterns[0], titles: ["The Witness"] }], setAside: ["Silent Hill 2", "Portal 2"] }, kase, ctx).problems.some((p) => /didn't flag/.test(p)));
  const diffCited ={ patterns: [{ ...good.patterns[0], titles: ["The Witness", "Portal 2", "Silent Hill 2"] }], setAside: [] };
  check("citing a different-side title with the others fails", checkSuggestion(diffCited, kase, ctx).problems.some((p) => /different side/.test(p)));
  const notGrouped = byId("horror-games-not-grouped");
  eq("the not-grouped case no longer flags Control or Alan Wake II (Paige: they still fit)", Object.keys(notGrouped.verdicts).sort().join(), "BioShock Infinite,Portal 2");
  const paired = { patterns: [{ name: "Atmospheric survival horror", claim: "Survival horror games where mood carries the experience.", titles: notGrouped.titles.slice(0, 3) }, { name: "Story-driven games", claim: "Story-driven games with a strong sense of place.", titles: ["Portal 2", "BioShock Infinite"] }], setAside: [] };
  check("pairing different-side titles the person said don't go together fails", !checkSuggestion(paired, notGrouped, caseContext(notGrouped)).ok);
  const split = byId("comedy-sitcom-split");
  eq("pairing them when they do go together passes", checkSuggestion(split.hand, split, caseContext(split)).ok, true);
  const mythic = byId("mythic-obra-dinn");
  const wrongMedium = { patterns: [{ name: "Mythic fantasy books", claim: "Literary fantasy rooted in myth, in books.", titles: mythic.titles }], setAside: [] };
  check("a claim naming books while citing a game is flagged", checkSuggestion(wrongMedium, mythic, caseContext(mythic)).warnings.some((w) => /Obra Dinn/.test(w)));
  check("a name with a title in it fails", checkSuggestion({ patterns: [{ name: "Portal 2 style puzzles", claim: "Puzzle games.", titles: ["The Witness", "Portal 2"] }], setAside: ["Silent Hill 2"] }, kase, ctx).problems.some((p) => /names a title/.test(p)));
  check("narrowing books and games to books is flagged", checkSuggestion(mythic.hand, mythic, caseContext(mythic)).warnings.some((w) => /narrows book and game to book/.test(w)));
  const keepsBoth = { patterns: [{ name: "Mythic and fantastical worlds", claim: "Tends toward fantasy and mythic or uncanny settings.", titles: mythic.titles.slice(0, 3) }], setAside: ["Return of the Obra Dinn"] };
  check("dropping the medium mention isn't flagged as narrowing", !checkSuggestion(keepsBoth, mythic, caseContext(mythic)).warnings.some((w) => /narrows/.test(w)));
  const word = byId("horror-word-all");
  check("unchanged wording after tapped words is flagged", checkSuggestion({ patterns: [{ ...word.pattern, titles: word.titles }], setAside: [] }, word, caseContext(word)).warnings.length === 1);
}

// ---- caps ----
{
  const calls = plan();
  eq("30 calls, within the approved count", `${calls.length} ${calls.length <= APPROVED_CALLS}`, "30 true");
  eq("reps are interleaved across cases", calls.slice(0, 10).map((c) => c.rep).join(""), "1111111111");
  let n = 0;
  const call = async () => { n += 1; return { json: { patterns: [], setAside: [] }, usage: { input_tokens: 1000, output_tokens: 300 } }; };
  let seen = "";
  await runPlan(calls.slice(0, 1), { call: async (p) => { seen = p; return call(); }, maxUsd: 1, version: "v2" });
  check("runPlan sends the chosen prompt version", /Only titles marked/.test(seen));
  n = 0;
  const capped = await runPlan(calls, { call, maxUsd: 1, maxCalls: 4 });
  eq("the call cap stops the run", `${n} ${capped.stopped}`, "4 call cap 4 reached");
  n = 0;
  const cheap = await runPlan(calls, { call, maxUsd: 0.0001 });
  check("the spend cap stops before a call that could cross it", n === 0 && /spend cap/.test(cheap.stopped));
  const failing = await runPlan(calls.slice(0, 1), { call: async () => { throw new Error("boom"); }, maxUsd: 1 });
  check("a failed call is recorded, counted at its worst case, and not retried", failing.results[0].error === "boom" && failing.spend.calls === 1 && failing.spend.usd > 0);
}

finish();
