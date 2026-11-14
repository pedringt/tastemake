#!/usr/bin/env node
// #334 before/after: what production's shortlist offers on the correction-eval fixtures with and without the
// "Not me" down-rank (src/ai/corrections.js, chooseCandidates' `conflicts`). Free: no network, no model.
// Deterministic.
//
//   node scripts/evals/corrections/shortlist-334.mjs            # summary table
//   node scripts/evals/corrections/shortlist-334.mjs --examples # plus a few before/after sets
//
// "Before" is the same request with the correction ignored (ctx.correctionConflict = null), which is what
// production did until #334. Conflicting titles are counted with the same matcher in both columns.
// Per case, every scenario with at least one "Not me" (single, conflict, double, Surprise) over every round.

import { offeredCandidates } from "../../../api/recommendations.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { ROUNDS, loadCases, wireRecords } from "./fixtures.mjs";
import { primaryDomain, withAnchors } from "./rank.mjs";
import { scenariosFor } from "./run.mjs";

const NOT_ME = new Set(["not-me", "conflict", "double", "not-me+accurate", "surprise"]);

// The fixture state as the browser would send it, with the case's patterns stored and these answers given.
export function requestContext(kase, round, statements, pool) {
  const state = kase.state(round);
  state.modelHypotheses = kase.patterns.map((p) => ({ id: p.id, title: p.label, domains: p.domains, supports: p.supports }));
  state.patternStatements = statements;
  return buildContext(hydrateState(JSON.parse(JSON.stringify(serializeAiState(state)))), pool);
}

export function compare(kase, round, statements, pool) {
  const ctx = requestContext(kase, round, statements, pool);
  const conflicts = ctx.correctionConflict;
  const before = offeredCandidates({ ...ctx, correctionConflict: null }, 6);
  const outcome = {};
  const after = offeredCandidates(ctx, 6, null, outcome);
  const summary = (set) => ({
    titles: set.map((c) => `${c.title}${conflicts?.(c) ? " [not me]" : ""}${c.edge ? " (Surprise)" : ""}`),
    conflicting: conflicts ? set.filter(conflicts).length : 0,
    media: new Set(set.map(primaryDomain)).size,
    surpriseConflicts: Boolean(conflicts && set.some((c) => c.edge && conflicts(c)))
  });
  return { before: summary(before), after: summary(after), surpriseDropped: Boolean(outcome.surpriseDropped), active: Boolean(conflicts) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const examples = process.argv.includes("--examples");
  const rows = [];
  const shown = [];
  for (const kase of loadCases()) {
    const pool = withAnchors(kase.pool, wireRecords(kase.state(0)));
    const total = { sets: 0, active: 0, before: 0, after: 0, mediaLost: 0, surpriseBefore: 0, dropped: 0 };
    for (const scenario of scenariosFor(kase).filter((s) => NOT_ME.has(s.cls))) {
      for (let round = 0; round < ROUNDS; round += 1) {
        const r = compare(kase, round, scenario.statements, pool);
        total.sets += 1;
        if (!r.active) continue;
        total.active += 1;
        total.before += r.before.conflicting;
        total.after += r.after.conflicting;
        if (r.after.media < r.before.media) total.mediaLost += 1;
        if (r.before.surpriseConflicts) total.surpriseBefore += 1;
        if (r.surpriseDropped) total.dropped += 1;
        if (examples && round === 0 && r.before.conflicting > r.after.conflicting && !shown.some((s) => s.case === kase.id)) {
          shown.push({ case: kase.id, scenario: scenario.id, ...r });
        }
      }
    }
    rows.push({ case: kase.id, ...total });
  }
  const sum = (key) => rows.reduce((n, row) => n + row[key], 0);
  console.log("| Case | Sets | Sets a \"Not me\" reaches | \"Not me\" titles offered, before → after | Sets that lost a medium | Conflicting Surprise before | Surprise dropped after |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.case} | ${r.sets} | ${r.active} | ${r.before} → ${r.after} | ${r.mediaLost} | ${r.surpriseBefore} | ${r.dropped} |`);
  console.log(`| **All** | ${sum("sets")} | ${sum("active")} | ${sum("before")} → ${sum("after")} | ${sum("mediaLost")} | ${sum("surpriseBefore")} | ${sum("dropped")} |`);
  if (examples) {
    for (const s of shown) {
      console.log(`\n### ${s.case}: ${s.scenario} (round 0)`);
      console.log(`Before: ${s.before.titles.join("; ")}`);
      console.log(`After:  ${s.after.titles.join("; ")}${s.surpriseDropped ? " (no Surprise this set)" : ""}`);
    }
  }
}
