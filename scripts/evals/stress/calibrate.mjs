#!/usr/bin/env node
// #28 Stage 0: calibrate the per-set repetition thresholds (SET_GATE in metrics.mjs) from a reference set
// of explanation sets a person judged good, instead of inventing them. Free: no model call.
//
//   node scripts/evals/stress/calibrate.mjs --draft <stress results dir> [--per-cell 2] [--model claude-haiku-5-5]
//       Writes scripts/evals/stress/reference-sets.json: a seeded RANDOM sample of real sets, stratified by
//       taste shape and size, each with "keep": null. Chosen at random, not by the checks, so the
//       thresholds are not derived from what the checks already allow.
//   (Paige marks each set "keep": true or false: would she be happy to show it as-is?)
//   node scripts/evals/stress/calibrate.mjs
//       Reads the kept sets and prints the 90th and 95th percentiles of each per-set measure, and the
//       SET_GATE values they suggest (trigger only above what good sets do).

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SET_GATE, setRepetition } from "./metrics.mjs";

const REFERENCE_FILE = new URL("./reference-sets.json", import.meta.url);

// Nearest-rank percentile (p in 0..100) of a list of numbers.
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// The per-set measures SET_GATE thresholds apply to.
export function setMeasures(set) {
  const r = setRepetition(set.picks);
  return { stockFamilyWhys: Math.max(0, ...Object.values(r.stock)), frameWhys: r.frame, openingWhys: r.opening, sharedPhraseWhys: r.sharedPhrase };
}

// Suggested gate: one above the 95th percentile of good sets, and never below 2 (one occurrence is not
// repetition).
export function suggestGate(sets) {
  const measures = sets.map(setMeasures);
  const out = {};
  for (const key of Object.keys(SET_GATE)) {
    const values = measures.map((m) => m[key]);
    out[key] = { p90: percentile(values, 90), p95: percentile(values, 95), suggested: Math.max(2, (percentile(values, 95) ?? 0) + 1), current: SET_GATE[key] };
  }
  return out;
}

// Small seeded PRNG so a draft is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function readCalls(dir) {
  const files = [];
  const walk = (d) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else if (name.endsWith(".jsonl")) files.push(p); } };
  walk(dir);
  // A run is one top-level folder under `dir` (e.g. one downloaded workflow run); keys repeat across runs.
  return files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((line) => ({ ...JSON.parse(line), run: f.slice(dir.length).split(/[\\/]/).filter(Boolean)[0] ?? "" })))
    .filter((c) => c.type === "call" && c.kind === "picks" && c.source === "model" && (c.picks ?? []).length >= 4);
}

export function draftReference(calls, { perCell = 2, model = "claude-haiku-5-5", seed = 28 } = {}) {
  const random = rng(seed);
  const cells = new Map();
  for (const call of calls.filter((c) => c.model === model)) {
    const key = `${call.shape}-${call.size}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(call);
  }
  const out = [];
  for (const [cell, list] of [...cells].sort()) {
    const pool = [...list];
    for (let i = 0; i < perCell && pool.length; i += 1) {
      const call = pool.splice(Math.floor(random() * pool.length), 1)[0];
      out.push({
        id: call.run ? `${call.run}:${call.key}` : call.key, cell, keep: null,
        picks: call.picks.map((p) => ({ title: p.title, why: p.why, citedEvidence: (p.citedEvidence ?? []).map((e) => ({ title: e.title })) }))
      });
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const draftAt = argv.indexOf("--draft");
  if (draftAt !== -1) {
    const dir = argv[draftAt + 1];
    const perCell = Number(argv[argv.indexOf("--per-cell") + 1]) || 2;
    const model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "claude-haiku-5-5";
    const sets = draftReference(readCalls(dir), { perCell, model });
    writeFileSync(REFERENCE_FILE, `${JSON.stringify({ note: "Draft reference sets for #28 calibration. Mark each set keep: true (happy to show as-is) or false. Sampled at random, stratified by shape and size.", sets }, null, 2)}\n`);
    console.log(`Wrote ${sets.length} draft sets to scripts/evals/stress/reference-sets.json. Mark each "keep", then run without --draft.`);
    return;
  }
  const { sets } = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
  const kept = sets.filter((s) => s.keep === true);
  const unmarked = sets.filter((s) => s.keep == null).length;
  if (!kept.length) {
    console.log(`No sets marked keep: true yet (${unmarked} unmarked). Review scripts/evals/stress/reference-sets.json first.`);
    return;
  }
  console.log(`${kept.length} kept, ${sets.length - kept.length - unmarked} dropped, ${unmarked} unmarked.`);
  for (const [key, v] of Object.entries(suggestGate(kept))) console.log(`${key}: p90 ${v.p90}, p95 ${v.p95} -> suggested ${v.suggested} (now ${v.current})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
