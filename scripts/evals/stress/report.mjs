#!/usr/bin/env node
// #28 stress eval: turn recorded runs (JSONL from run-stress.mjs) into a metrics report and a human-review
// sample. No model calls, no network.
//
//   node scripts/evals/stress/report.mjs <file-or-dir> [...] [--out report.md] [--sample-dir dir]
//
// The report is measurements only (definitions in metrics.mjs, repeated at the end of the report). It
// never passes or fails a run.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFINITIONS, MIN_EXPLANATIONS_PER_VARIANT, NEEDS_HUMAN_REVIEW, bridgeMetrics, metricsFor, perSetSummary, reliability } from "./metrics.mjs";
import { SIZES, ALL_SHAPES } from "./profiles.mjs";

export function readRecords(paths) {
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map((f) => join(p, String(f))).filter((f) => f.endsWith(".jsonl")) : [p]));
  const calls = new Map();
  const headers = [];
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }   // a cut-off last line from a killed job
      if (rec.type === "header") headers.push(rec);
      // A resumed run can record the same call twice (an error, then a success): keep the last one.
      else if (rec.type === "call") calls.set(rec.key, rec);
    }
  }
  return { headers, calls: [...calls.values()], files };
}

export function pickRecords(calls) {
  return calls.filter((c) => c.kind === "picks" && c.source === "model").flatMap((c) => c.picks.map((p) => ({
    ...p, callKey: c.key, model: c.model, profile: c.profile, profileKey: `${c.model}|${c.profile}`, shape: c.shape, size: c.size, round: c.round, profileFacts: c.profileFacts
  })));
}

export function patternsByProfile(calls) {
  return Object.fromEntries(calls.filter((c) => c.kind === "profile" && c.patterns?.length).map((c) => [`${c.model}|${c.profile}`, c.patterns]));
}

const sizeOrder = (a, b) => Object.keys(SIZES).indexOf(a) - Object.keys(SIZES).indexOf(b);
const fmt = (x) => (x == null ? "–" : typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : String(x));
const cell = (text) => String(text ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();

// The rows of the "quality vs size" table: [label, getter].
const ROWS = [
  ["picks measured", (m) => m.picks],
  ["distinct-2 (higher = less reuse)", (m) => m.wording.distinct2],
  ["distinct-3", (m) => m.wording.distinct3],
  ["shared 4-gram share", (m) => m.wording.sharedLong4],
  ["shared 5-gram share", (m) => m.wording.sharedLong5],
  ["repeated opening share", (m) => m.wording.repeatedOpening],
  ["theme top-3 share", (m) => m.themes.top3Share],
  ["theme top-5 share", (m) => m.themes.top5Share],
  ["pattern top-3 share (with profile)", (m) => m.patterns?.top3Share],
  ["pattern top-5 share (with profile)", (m) => m.patterns?.top5Share],
  ["picks citing no pattern (with profile)", (m) => m.patterns?.noPatternShare],
  ["cites exist", (m) => m.traceability.citesExist],
  ["cites were in prompt", (m) => m.traceability.citesInPrompt],
  ["names a cited title", (m) => m.traceability.namesEvidence],
  ["evidence domain match", (m) => m.traceability.domainMatch],
  ["evidence genre match", (m) => m.traceability.genreMatch],
  ["relevant (domain or genre)", (m) => m.traceability.relevant],
  ["generic phrasing share", (m) => m.generic.share],
  ["genre-collapsed share", (m) => m.genre.collapsedShare],
  ["mean genre-word ratio", (m) => m.genre.meanGenreRatio],
  ["cross-domain share", (m) => m.crossDomain.crossShare],
  ["unsupported cross-domain share (of all picks)", (m) => m.crossDomain.unsupportedShare],
  ["cites only another domain", (m) => m.crossDomain.onlyOtherDomainShare],
  ["recent-20% share of reaction cites", (m) => m.other.recentShareOfReactionCites],
  ["cites a dislike", (m) => m.other.citesDislikeShare],
  ["mean cites per pick", (m) => m.other.meanCitesPerPick],
  ["mean words per explanation", (m) => m.other.meanWords]
];

export function buildReport({ calls, headers }) {
  const picks = pickRecords(calls);
  const patterns = patternsByProfile(calls);
  const models = [...new Set(calls.map((c) => c.model))].sort();
  const sizes = [...new Set(calls.map((c) => c.size))].sort(sizeOrder);
  const shapes = ALL_SHAPES.filter((s) => calls.some((c) => c.shape === s));
  const lines = ["# Tastemake #28 stress eval: reasoning at scale", ""];
  const usd = calls.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  const dry = headers.some((h) => h.dryRun);
  lines.push(`${calls.length} recorded call(s), ${picks.length} kept pick explanation(s); models ${models.join(", ") || "none"}; sizes ${sizes.join(", ") || "none"}; profiles ${shapes.join(", ") || "none"}. Estimated cost $${usd.toFixed(4)}.${dry ? " **Includes dry-run records (no model output).**" : ""}`, "");
  lines.push("These are measurements, not pass/fail gates. Definitions are at the end. Size labels count experienced items: 10, 50 and 100 (= 120 experienced; production's wire keeps at most 96 tried reactions plus favorites, and the pick prompt shows at most 18 evidence rows at any size).", "");

  lines.push("## Reliability", "", "| Model | Size | Pick calls | Model picks | Fallback | Picks kept | Picks rejected | Top rejection reasons | Cost |", "|---|---|---|---|---|---|---|---|---|");
  for (const model of models) for (const size of sizes) {
    const group = calls.filter((c) => c.model === model && c.size === size);
    if (!group.length) continue;
    const r = reliability(group);
    const top = Object.entries(r.rejectionReasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join("; ");
    const fb = Object.entries(r.fallbackReasons).map(([k, v]) => `${k}: ${v}`).join("; ");
    lines.push(`| ${model} | ${size} | ${r.calls} | ${r.modelSource} | ${r.fallback}${fb ? ` (${cell(fb)})` : ""} | ${r.picksKept} | ${r.picksRejected} | ${cell(top) || "–"} | $${fmt(r.usd)} |`);
  }
  lines.push("");

  const metrics = {};
  for (const model of models) {
    lines.push(`## Quality vs size: ${model}`, "", `| Metric | ${sizes.join(" | ")} |`, `|---|${sizes.map(() => "---").join("|")}|`);
    const bySize = Object.fromEntries(sizes.map((size) => [size, metricsFor(picks.filter((p) => p.model === model && p.size === size), { patternsByProfile: patterns })]));
    metrics[model] = { bySize, byShape: {} };
    for (const [label, get] of ROWS) lines.push(`| ${label} | ${sizes.map((s) => fmt(bySize[s].picks ? get(bySize[s]) : null)).join(" | ")} |`);
    lines.push("");
    lines.push("By taste shape (shared 4-gram / theme top-3 / relevant / generic / unsupported cross-domain):", "", `| Shape | ${sizes.join(" | ")} |`, `|---|${sizes.map(() => "---").join("|")}|`);
    for (const shape of shapes) {
      const row = sizes.map((size) => {
        const m = metricsFor(picks.filter((p) => p.model === model && p.size === size && p.shape === shape), { patternsByProfile: patterns });
        metrics[model].byShape[`${shape}-${size}`] = m;
        return m.picks ? `${fmt(m.wording.sharedLong4)} / ${fmt(m.themes.top3Share)} / ${fmt(m.traceability.relevant)} / ${fmt(m.generic.share)} / ${fmt(m.crossDomain.unsupportedShare)} (n=${m.picks})` : "–";
      });
      lines.push(`| ${shape} | ${row.join(" | ")} |`);
    }
    lines.push("");
    for (const size of sizes) {
      const m = bySize[size];
      if (!m.picks) continue;
      lines.push(`**${model}, size ${size}:** most-repeated phrases: ${m.wording.topPhrases.slice(0, 8).map((p) => `"${p.phrase}" (${p.count})`).join(", ") || "none"}. Top theme terms: ${m.themes.top.map((t) => `${t.term} (${t.count})`).join(", ") || "none"}.${Object.keys(m.generic.byTemplate).length ? ` Generic templates: ${Object.entries(m.generic.byTemplate).map(([k, v]) => `${k} (${v})`).join(", ")}.` : ""}`, "");
    }
  }

  // #28 Stage 0: the unit a visitor sees is one set, so repetition is also reported per set.
  lines.push("## Per-set repetition (one call's picks = what one visitor sees)", "", `Thresholds (SET_GATE in metrics.mjs) are calibrated against reference-sets.json, sets Paige marked as fine to show. A change in an explanation-level rate needs about ${MIN_EXPLANATIONS_PER_VARIANT} explanations per variant before it can be told from noise.`, "",
    "| Model | Size | Sets | Explanations | Would trigger | Stock family at gate | Stock hits / set | Frame share | Same opening at gate | Shared phrase at gate | Vague hedge share |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const model of models) for (const size of sizes) {
    const ps = perSetSummary(picks.filter((p) => p.model === model && p.size === size));
    if (!ps.sets) continue;
    lines.push(`| ${model} | ${size} | ${ps.sets} | ${ps.explanations}${ps.enoughSample ? "" : " (indicative)"} | ${fmt(ps.wouldTriggerRate)} | ${fmt(ps.stockFamilySetShare)} | ${fmt(ps.meanStockWhysPerSet)} | ${fmt(ps.frameWhyShare)} | ${fmt(ps.openingSetShare)} | ${fmt(ps.sharedPhraseSetShare)} | ${fmt(ps.hedgeWhyShare)} |`);
  }
  for (const model of models) {
    const all = perSetSummary(picks.filter((p) => p.model === model));
    if (!all.sets) continue;
    lines.push("", `**${model}, all sizes:** ${all.sets} sets, ${all.explanations} explanations${all.enoughSample ? "" : ` (under ${MIN_EXPLANATIONS_PER_VARIANT}: indicative only)`}; would trigger ${fmt(all.wouldTriggerRate)}. Triggers: ${Object.entries(all.triggerCounts).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}.`);
  }
  lines.push("");

  // #252 part 2: only when some call was offered a marked bridge candidate (profiles screen / screenfew).
  const bridgeCalls = calls.filter((c) => (c.offered ?? []).some((o) => o.bridge));
  if (bridgeCalls.length) {
    const group = calls.filter((c) => c.kind === "picks" && ["screen", "screenfew"].includes(c.shape));
    lines.push("## Cross-media bridge (#252 part 2)", "", "Over pick calls on the screen / screenfew profiles. Compare the same table from main (before) and the bridge branch (after).", "",
      "| Model | Size | Calls | Offered a bridge | Bridge pick rate | 2+ bridge picks | As exploratory | Why names source | Why says test | Bridge rejections | Fallback | Fallback used bridge | ms median / p90 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const model of models) for (const size of sizes) {
      const b = bridgeMetrics(group.filter((c) => c.model === model && c.size === size));
      if (!b.calls) continue;
      lines.push(`| ${model} | ${size} | ${b.calls} | ${fmt(b.bridgeOfferedShare)} | ${fmt(b.bridgePickRate)} | ${b.setsWithTwoOrMoreBridgePicks} | ${fmt(b.bridgeAsExploratory)} | ${fmt(b.bridgeWhyNamesSource)} | ${fmt(b.bridgeWhySaysTest)} | ${b.bridgeRejected}${Object.keys(b.bridgeRejectionReasons).length ? ` (${cell(Object.entries(b.bridgeRejectionReasons).map(([k, v]) => `${k}: ${v}`).join("; "))})` : ""} | ${fmt(b.fallbackShare)} | ${b.fallbackUsingBridge} | ${fmt(b.msMedian)} / ${fmt(b.msP90)} |`);
    }
    lines.push("");
  }

  lines.push("## Needs human review (not scored here)", "", ...NEEDS_HUMAN_REVIEW.map((q) => `- ${q}`), "", "The review sample (`review-sample.md`, `review-sample.json`) lists picks per model and profile with the cited evidence and its reaction, so these can be judged by reading.", "");
  lines.push("## Metric definitions", "", "| Metric | Definition |", "|---|---|", ...DEFINITIONS.map(([k, v]) => `| ${k} | ${cell(v)} |`), "");
  return { markdown: lines.join("\n"), metrics };
}

// Deterministic sample for reading: per model and profile, up to `perProfile` picks spread across rounds,
// plus every split-shape pick that cites a disliked item (the "similar items, different reactions" case).
export function reviewSample(calls, { perProfile = 6 } = {}) {
  const picks = pickRecords(calls).sort((a, b) => a.model.localeCompare(b.model) || a.profile.localeCompare(b.profile) || a.round - b.round);
  const patterns = patternsByProfile(calls);
  const groups = new Map();
  for (const p of picks) { const k = `${p.model}|${p.profile}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const out = [];
  for (const [key, list] of groups) {
    const step = Math.max(1, Math.floor(list.length / perProfile));
    const chosen = list.filter((_, i) => i % step === 0).slice(0, perProfile);
    const contrast = list.filter((p) => p.shape === "split" && p.citedEvidence.some((e) => e.polarity < 0) && !chosen.includes(p));
    const [model, profile] = key.split("|");
    const view = (p) => ({ round: p.round, title: p.title, domains: p.domains, about: p.about, why: p.why, kind: p.kind,
      cited: p.citedEvidence.map((e) => ({ title: e.title, reaction: e.kind, domains: e.domains, refinements: e.refinements })) });
    out.push({ model, profile, shape: list[0].shape, size: list[0].size, patterns: (patterns[key] ?? []).map(({ label, claim, level, crossDomain }) => ({ label, claim, level, crossDomain })), picks: chosen.map(view), contrast: contrast.map(view) });
  }
  return out;
}

export function reviewMarkdown(sample) {
  const lines = ["# #28 review sample", "", "For a human (or a later graded pass): judge relevance, new distinctions, domain nuance, and whether similar items' different reactions are explained. Questions:", "", ...NEEDS_HUMAN_REVIEW.map((q) => `- ${q}`), ""];
  for (const g of sample) {
    lines.push(`## ${g.model}: ${g.profile}`, "");
    if (g.patterns.length) lines.push(`Taste profile: ${g.patterns.map((p) => `**${p.label}** (${p.level}${p.crossDomain !== "untested" ? `, cross-domain ${p.crossDomain}` : ""})`).join("; ")}`, "");
    const row = (p) => `- r${p.round} **${p.title}** (${p.domains.join("/")}${p.kind === "curveball" ? ", curveball" : ""}): ${p.why}  \n  cites: ${p.cited.map((c) => `${c.title} [${c.reaction}${c.refinements?.length ? `; ${c.refinements.join(", ")}` : ""}; ${c.domains.join("/")}]`).join("; ")}`;
    g.picks.forEach((p) => lines.push(row(p)));
    if (g.contrast.length) { lines.push("", "Contrast picks (cite a disliked item):"); g.contrast.forEach((p) => lines.push(row(p))); }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const take = (name) => { const i = argv.indexOf(name); if (i === -1) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const out = take("--out");
  const sampleDir = take("--sample-dir");
  if (!argv.length) { console.error("usage: node scripts/evals/stress/report.mjs <file-or-dir> [...] [--out report.md] [--sample-dir dir]"); process.exit(2); }
  const data = readRecords(argv);
  const { markdown, metrics } = buildReport(data);
  if (out) { writeFileSync(out, markdown + "\n"); writeFileSync(out.replace(/\.md$/, "") + ".metrics.json", JSON.stringify(metrics, null, 1) + "\n"); }
  else console.log(markdown);
  if (sampleDir) {
    mkdirSync(sampleDir, { recursive: true });
    const sample = reviewSample(data.calls);
    writeFileSync(join(sampleDir, "review-sample.json"), JSON.stringify(sample, null, 1) + "\n");
    writeFileSync(join(sampleDir, "review-sample.md"), reviewMarkdown(sample) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
