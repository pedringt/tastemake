#!/usr/bin/env node
// #278: the counter-example grader's parsing, item collection, capping and aggregation, with a fake model, plus the
// runner's dry run and call plan for --suite counter. Free, no network, no model call.
//
//   node scripts/qa/counter-grader-tests.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraderPrompt, counterItems, describeEvidence, gradeCounters, gradesMarkdown, parseGrade, summarizeGrades } from "../evals/counter-grader.mjs";
import { COUNTER_FIXTURES, counterCalibration, exampleProfileCounters } from "../evals/fixtures.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("counter grader tests");

// ---- parsing ----
eq("a well-formed pass parses", parseGrade({ contradicts: "slow pacing", sentence: "  It was  too slow. ", defensible: true }).grade?.sentence, "It was too slow.");
eq("a well-formed fail parses", parseGrade({ contradicts: "nothing", sentence: "Different genre.", defensible: false }).grade?.defensible, false);
eq("not an object is ungraded", parseGrade(null).ok, false);
eq("a string defensible is ungraded", parseGrade({ contradicts: "x", sentence: "y", defensible: "true" }).ok, false);
eq("an empty sentence is ungraded", parseGrade({ contradicts: "x", sentence: "   ", defensible: false }).ok, false);
eq("defensible but naming nothing is ungraded, not a pass", parseGrade({ contradicts: "Nothing.", sentence: "Fine.", defensible: true }).ok, false);
eq("a fail with no contradicts reads as nothing", parseGrade({ sentence: "No link.", defensible: false }).grade?.contradicts, "nothing");

// ---- prompt ----
const rec = (id, title, kind, reasons = [], extra = {}) => ({ ref: `ev:${id}`, itemId: id, title, type: "book", kind, facts: { creator: null, genres: ["Fantasy"] }, refinements: reasons, ...extra });
const line = describeEvidence(rec("a", "Stoner", "experienced-negative", [{ dimension: "Pacing", direction: "Too slow" }]));
check("evidence line carries the reaction and the reason with its direction", line.includes("tried it and disliked it") && line.includes("Pacing: Too slow"), line);
check("evidence with no reason says so", describeEvidence(rec("b", "Circe", "starter-favorite")).includes("marked it a favorite; no reason given"));
const prompt = buildGraderPrompt({ pattern: "Mythic worlds", claim: "Likes myth.", supports: [rec("c", "Circe", "starter-favorite")], counter: rec("d", "It Ends With Us", "experienced-negative") });
check("an on-pattern dislike with no reason is defensible", /fits the pattern is defensible even when no reason is given/.test(prompt));
check("a missing reason alone never fails an item", /missing reason is never by itself grounds for "not defensible"/.test(prompt));
check("an off-pattern item (different genre) still fails", /just belongs to a different genre or area than the pattern/.test(prompt));
check("the old rule that needed the reason to bear on the pattern is gone", !/dislike \(or their stated reason\) bears/.test(prompt));
check("prompt names the pattern, claim, support and counter after CONTEXT", /CONTEXT\nPattern: Mythic worlds\nClaim: Likes myth\.[\s\S]*Circe[\s\S]*Counter-example to grade:\n- It Ends With Us/.test(prompt));

// ---- item collection ----
const evidence = [rec("s1", "Circe", "starter-favorite"), rec("x1", "It Ends With Us", "experienced-negative"), rec("syn-3", "Synthetic Book 3", "experienced-negative")];
const items = counterItems({ source: "f", evidence, hypotheses: [
  { label: "Mythic", claim: "c", evidence: ["ev:s1"], counter: ["ev:x1", "ev:syn-3", "ev:gone"], known: { "ev:x1": "not-defensible" } }
] });
eq("one item per counter ref", items.length, 3);
eq("supports resolve to records", items[0].supports[0]?.title, "Circe");
eq("a known answer is carried", items[0].known, "not-defensible");
eq("a synthetic title is skipped", items[1].skip, "synthetic title");
eq("a missing record is skipped", items[2].skip, "counter evidence not found");
const stored = counterItems({ source: "stored", evidence, hypotheses: [{ title: "Mythic", claim: "c", evidence: "Circe", supports: ["ev:s1"], counters: ["ev:x1"] }] });
check("the stored-profile shape (title, supports, counters) works", stored[0].pattern === "Mythic" && stored[0].supports.length === 1 && stored[0].counter?.title === "It Ends With Us");

// ---- grading with a fake model ----
const mk = (n, extra = {}) => ({ source: "f", pattern: `P${n}`, claim: "", ref: `ev:${n}`, supports: [], counter: rec(String(n), `T${n}`, "experienced-negative"), skip: null, known: null, ...extra });
let seen = 0;
const fake = async (p) => {
  seen += 1;
  if (p.includes("T3")) throw new Error("Anthropic returned 500 (api_error)");
  if (p.includes("T4")) return { sentence: "x" };
  return { contradicts: p.includes("T1") ? "pacing" : "nothing", sentence: "One sentence.", defensible: p.includes("T1") };
};
const grades = await gradeCounters([mk(1), mk(2), mk(3), mk(4), mk(5, { skip: "synthetic title" }), mk(6), mk(7)], { callModel: fake, maxCalls: 5 });
eq("skipped items make no call; the cap stops the rest", seen, 5);
eq("statuses in order", grades.map((g) => g.status).join(","), "defensible,not-defensible,ungraded,ungraded,skipped,not-defensible,skipped");
check("the cap is named on the item it skipped", /grading cap of 5/.test(grades[6].detail));
check("a model error is kept as the reason", grades[2].detail.includes("500"));

seen = 0;
const budget = Object.assign(new Error("spend cap $0.4: …"), { budgetStop: true });
const stopped = await gradeCounters([mk(1), mk(2), mk(6)], { callModel: async (p) => { seen += 1; if (p.includes("T2")) throw budget; return { contradicts: "x", sentence: "s", defensible: true }; }, isBudgetStop: (e) => e.budgetStop });
eq("a budget stop ends grading", stopped.map((g) => g.status).join(","), "defensible,skipped,skipped");
check("later items say why they were skipped", stopped[2].detail.startsWith("spend cap"));

// ---- aggregation ----
const summary = summarizeGrades([
  { source: "a", status: "defensible", pattern: "P", title: "T" },
  { source: "a", status: "not-defensible", pattern: "P", title: "U" },
  { source: "b", status: "not-defensible", pattern: "P", title: "V" },
  { source: "b", status: "ungraded" },
  { source: "b", status: "skipped" },
  { source: "calibration", status: "not-defensible", known: "not-defensible" },
  { source: "calibration", status: "not-defensible", known: "defensible" },
  { source: "calibration", status: "ungraded", known: "defensible" }
]);
eq("share counts graded items only, calibration excluded", summary.share, 1 / 3);
eq("graded", summary.graded, 3);
eq("ungraded and skipped are counted apart", `${summary.ungraded}/${summary.skipped}`, "1/1");
eq("per-source share", summary.bySource.a.share, 0.5);
check("calibration is not a source in the share", !("calibration" in summary.bySource));
eq("calibration agreement", `${summary.calibration.agreed}/${summary.calibration.of}`, "1/3");
eq("an ungraded calibration item neither agrees nor disagrees", summary.calibration.items[2].agrees, null);
eq("failures listed", summary.failures.map((f) => f.title).join(","), "U,V");
eq("nothing graded gives no share", summarizeGrades([{ source: "a", status: "skipped" }]).share, null);
const md = gradesMarkdown(summary, [{ source: "a", status: "not-defensible", pattern: "A | B", title: "T", contradicts: "x", sentence: "s" }]);
check("the report states the share", md.includes("**Defensible:** 1 of 3 graded counter items (33%)"));
check("pipes in a pattern don't break the table", md.includes("A / B"));

// ---- fixtures ----
eq("the counter suite leaves out the synthetic scale fixtures", COUNTER_FIXTURES.filter((f) => f.id.startsWith("scale-")).length, 0);
eq("eleven Taste Profile calls", COUNTER_FIXTURES.reduce((n, f) => n + (f.before ? 2 : 1), 0), 11);
check("no picks in the counter suite", COUNTER_FIXTURES.every((f) => Array.isArray(f.candidates) && f.candidates.length === 0));
const cal = counterItems(counterCalibration());
check("calibration holds the #278 Mr. Mercedes case as not defensible", cal.some((i) => i.counter?.title === "Mr. Mercedes" && i.known === "not-defensible" && /Cerebral speculative/.test(i.pattern)));
check("calibration holds a known pass", cal.some((i) => i.known === "defensible"));
const ex = counterItems(exampleProfileCounters());
check("the stored Example Profile's It Ends With Us counter is known not defensible", ex.some((i) => i.counter?.title === "It Ends With Us" && i.known === "not-defensible"));
check("every stored Example Profile counter resolves", ex.length > 0 && ex.every((i) => !i.skip));

// ---- the runner: dry run and plan (no key, no call) ----
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "tastemake-counter-grader-"));
const env = { ...process.env, ANTHROPIC_API_KEY: "", CI: "" };
const run = (args) => spawnSync(process.execPath, [join(root, "scripts", "evals", "run.mjs"), ...args, "--out", tmp], { encoding: "utf8", env });
let r = run(["--suite", "counter", "--producer", "live", "--model", "claude-haiku-5-5", "--dry-run"]);
check("dry run plans 11 profile calls and up to 60 grading calls", /DRY RUN: 71 call\(s\) would be made \(11 taste-profile, 0 picks, up to 60 counter-example grading on claude-haiku-5-5\)/.test(r.stdout), r.stdout.split("\n")[0]);
r = run(["--suite", "counter", "--producer", "live", "--model", "claude-haiku-5-5", "--dry-run", "--max-grade-calls", "10"]);
check("--max-grade-calls lowers the plan", /DRY RUN: 21 call\(s\)/.test(r.stdout), r.stdout.split("\n")[0]);
r = run(["--suite", "counter", "--producer", "live", "--model", "claude-haiku-5-5", "--yes", "--max-usd", "1", "--max-calls", "70"]);
eq("a paid run whose plan is over --max-calls is refused before any call", r.status, 2);
check("the refusal names the planned count", r.stderr.includes("up to 71 call(s), more than --max-calls 70"), r.stderr);
rmSync(tmp, { recursive: true, force: true });

finish();
