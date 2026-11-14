// #278: does each counter-example actually contradict its pattern? An eval scorer, not a production gate.
//
// The validator checks a counter-example's structure (it exists, was tried, was disliked). It can't check
// meaning: "You said Mr. Mercedes: pacing" is a valid citation against "Cerebral speculative worlds with mystery
// at the core", but it isn't clear a crime show's pacing says anything about that pattern. Here a grader model
// states, in one sentence, which part of the pattern each counter item contradicts, and the item fails if that
// relationship isn't defensible from the evidence it was given.
//
// Everything in this file is free and pure except gradeCounters, which calls whatever `callModel` it's handed
// (run.mjs passes the paid, capped Anthropic call; scripts/qa/counter-grader-tests.mjs passes a fake).

export const GRADER_MAX_OUTPUT_TOKENS = 300;

export const GRADER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    contradicts: { type: "string" },
    sentence: { type: "string" },
    defensible: { type: "boolean" }
  },
  required: ["contradicts", "sentence", "defensible"],
  additionalProperties: false
};

const REACTION = {
  "starter-favorite": "marked it a favorite", "experienced-favorite": "marked it a favorite", "experienced-strong-positive": "loved it",
  "experienced-positive": "liked it", "experienced-negative": "tried it and disliked it"
};

// One evidence record (src/model/evidence.js) as a line the grader reads: title, type, genres, reaction, reasons.
export function describeEvidence(record) {
  if (!record) return "(missing evidence)";
  const by = record.facts?.creator ? ` by ${record.facts.creator}` : "";
  const genres = (record.facts?.genres ?? []).slice(0, 6).join("; ");
  const reasons = (record.refinements ?? []).map((r) => r.direction ? `${r.dimension}: ${r.direction}` : r.dimension);
  return `${record.title}${by} (${record.type ?? "item"}${genres ? `; genres: ${genres}` : ""}). The person ${REACTION[record.kind] ?? record.kind}${reasons.length ? `; their reasons: ${reasons.join(", ")}` : "; no reason given"}.`;
}

// Nov 13 (#278 rerun): the first run failed on-pattern dislikes only because no reason was given (Ariadne under
// "Mythic retellings"), and gave The Witch and Severance opposite verdicts across profiles. A dislike of an item
// that fits the pattern is exactly what a counter-example should be, so a missing reason no longer fails it.
export function buildGraderPrompt({ pattern, claim, supports, counter }) {
  return [
    "You grade one counter-example on a taste pattern from a recommender's Taste Profile. A counter-example is something the person tried and disliked that the pattern lists as evidence against itself.",
    "",
    "State in one sentence which specific part of the pattern this item contradicts, and how. Then decide whether that relationship is defensible from the evidence given.",
    "Defensible: the item clearly has a quality the pattern says the person enjoys, so disliking it is a real reason to doubt or narrow the pattern. A dislike of an item that fits the pattern is defensible even when no reason is given; a missing reason is never by itself grounds for \"not defensible\". A stated reason only matters when it points away from the pattern (see below).",
    "Not defensible: the item just belongs to a different genre or area than the pattern; the stated reason is about something the pattern makes no claim about; or the link needs facts the evidence doesn't give. You may use common knowledge of what a title is, but the link to the pattern must come from that and the person's reaction and reasons.",
    "If nothing in the pattern is contradicted, set contradicts to \"nothing\" and defensible to false.",
    "",
    "Answer as JSON: {\"contradicts\": \"<the part of the pattern, in a few words>\", \"sentence\": \"<one sentence>\", \"defensible\": true or false}.",
    "",
    "CONTEXT",
    `Pattern: ${pattern}`,
    `Claim: ${claim || "(none given)"}`,
    "Supporting evidence:",
    ...(supports.length ? supports.map((r) => `- ${describeEvidence(r)}`) : ["- (none)"]),
    "Counter-example to grade:",
    `- ${describeEvidence(counter)}`
  ].join("\n");
}

// A grade the report can trust, or why not. Malformed answers are "ungraded", never counted as a pass or a fail.
export function parseGrade(json) {
  if (!json || typeof json !== "object") return { ok: false, error: "answer is not a JSON object" };
  if (typeof json.defensible !== "boolean") return { ok: false, error: "defensible is not true or false" };
  const sentence = typeof json.sentence === "string" ? json.sentence.trim().replace(/\s+/g, " ") : "";
  if (!sentence) return { ok: false, error: "no sentence" };
  const contradicts = typeof json.contradicts === "string" ? json.contradicts.trim() : "";
  // A pass needs the grader to name what is contradicted; "defensible" with nothing named is not a pass.
  if (json.defensible && (!contradicts || /^nothing\.?$/i.test(contradicts))) return { ok: false, error: "defensible, but names nothing it contradicts" };
  return { ok: true, grade: { contradicts: contradicts || "nothing", sentence, defensible: json.defensible } };
}

// Every counter item on every accepted pattern, resolved to its evidence records. Items whose title carries no
// meaning (the synthetic scale fixtures) can't be judged and are listed as skipped instead.
export function counterItems({ source, hypotheses, evidence }) {
  const byRef = new Map(evidence.map((r) => [r.ref, r]));
  return hypotheses.flatMap((h) => (h.counter ?? h.counters ?? []).map((ref) => ({
    source, known: h.known?.[ref] ?? null, pattern: h.label ?? h.title, claim: h.claim ?? "", ref,
    supports: (Array.isArray(h.evidence) ? h.evidence : h.supports ?? []).map((r) => byRef.get(r)).filter(Boolean),
    counter: byRef.get(ref) ?? null
  }))).map((item) => ({ ...item, skip: !item.counter ? "counter evidence not found" : /^syn-/.test(item.counter.itemId ?? "") ? "synthetic title" : null }));
}

// Grades items in order until maxCalls grading calls have been made. callModel(prompt) resolves to the model's
// JSON answer, or throws; a throw from the budget guard (budgetError) stops grading, any other throw is one
// ungraded item.
export async function gradeCounters(items, { callModel, maxCalls = Infinity, isBudgetStop = () => false }) {
  const out = [];
  let calls = 0;
  let stopped = null;
  for (const item of items) {
    const base = { source: item.source, pattern: item.pattern, claim: item.claim, ref: item.ref, title: item.counter?.title ?? item.ref, known: item.known ?? null };
    if (item.skip) { out.push({ ...base, status: "skipped", detail: item.skip }); continue; }
    if (stopped || calls >= maxCalls) { out.push({ ...base, status: "skipped", detail: stopped ?? `grading cap of ${maxCalls} call(s) reached` }); continue; }
    const prompt = buildGraderPrompt(item);
    calls += 1;
    try {
      const parsed = parseGrade(await callModel(prompt));
      out.push(parsed.ok ? { ...base, status: parsed.grade.defensible ? "defensible" : "not-defensible", ...parsed.grade } : { ...base, status: "ungraded", detail: parsed.error });
    } catch (error) {
      const message = String(error?.message ?? error);
      if (isBudgetStop(error)) { calls -= 1; stopped = message; out.push({ ...base, status: "skipped", detail: message }); continue; }
      out.push({ ...base, status: "ungraded", detail: message });
    }
  }
  return out;
}

// The share of graded counter items that are defensible, by source, plus examples. Calibration items (known set)
// are reported on their own and never counted in the share.
export function summarizeGrades(grades, { examples = 4 } = {}) {
  const measured = grades.filter((g) => !g.known);
  const count = (list, status) => list.filter((g) => g.status === status).length;
  const tally = (list) => {
    const defensible = count(list, "defensible");
    const notDefensible = count(list, "not-defensible");
    const graded = defensible + notDefensible;
    return { items: list.length, graded, defensible, notDefensible, ungraded: count(list, "ungraded"), skipped: count(list, "skipped"), share: graded ? defensible / graded : null };
  };
  const sources = [...new Set(measured.map((g) => g.source))];
  const calibration = grades.filter((g) => g.known).map((g) => ({ ...g, agrees: g.status === "defensible" || g.status === "not-defensible" ? (g.status === "defensible") === (g.known === "defensible") : null }));
  return {
    ...tally(measured),
    bySource: Object.fromEntries(sources.map((s) => [s, tally(measured.filter((g) => g.source === s))])),
    passes: measured.filter((g) => g.status === "defensible").slice(0, examples),
    failures: measured.filter((g) => g.status === "not-defensible"),
    calibration: { items: calibration, agreed: calibration.filter((c) => c.agrees === true).length, of: calibration.length }
  };
}

const pct = (share) => (share === null ? "n/a" : `${Math.round(share * 100)}%`);
const cell = (text) => String(text ?? "").replace(/\|/g, "/").replace(/\n/g, " ");

export function gradesMarkdown(summary, grades) {
  const lines = [
    "## Counter-example grader (#278)",
    "",
    `**Defensible:** ${summary.defensible} of ${summary.graded} graded counter items (${pct(summary.share)}); ${summary.ungraded} ungraded, ${summary.skipped} skipped. Eval only, not a production gate.`,
    "",
    `Calibration (known cases, not counted above): the grader agreed on ${summary.calibration.agreed} of ${summary.calibration.of}.`,
    ""
  ];
  if (Object.keys(summary.bySource).length) {
    lines.push("| Source | Graded | Defensible | Not defensible | Ungraded | Skipped |", "|---|---|---|---|---|---|");
    Object.entries(summary.bySource).forEach(([s, t]) => lines.push(`| ${cell(s)} | ${t.graded} | ${t.defensible} (${pct(t.share)}) | ${t.notDefensible} | ${t.ungraded} | ${t.skipped} |`));
    lines.push("");
  }
  lines.push("| Source | Pattern | Counter item | Result | Contradicts | Grader's sentence |", "|---|---|---|---|---|---|");
  grades.forEach((g) => lines.push(`| ${cell(g.known ? `calibration (expected ${g.known})` : g.source)} | ${cell(g.pattern)} | ${cell(g.title)} | ${g.status === "defensible" ? "defensible" : g.status === "not-defensible" ? "**not defensible**" : g.status} | ${cell(g.contradicts ?? "")} | ${cell(g.sentence ?? g.detail ?? "")} |`));
  return lines.join("\n") + "\n";
}
