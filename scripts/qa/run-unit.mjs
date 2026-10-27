#!/usr/bin/env node
// `npm run test:unit` (#221): runs every no-browser unit suite, even after one fails, then prints a
// per-suite summary with the total check count and exits 1 if any suite failed. Free, no network,
// no browser, no model call.
//
//   node scripts/qa/run-unit.mjs          # quiet: hides the app's own [tastemake-*] debug log lines
//   DEBUG=1 node scripts/qa/run-unit.mjs  # shows them
//
// Suites built on scripts/qa/lib/assert.mjs print "<label>: N passed, M failed", which is where the
// counts come from. The two node:assert suites (ai-metrics, refinement) stop at their first failure,
// so they report pass/fail only.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const SUITES = [
  "api-tests.mjs",
  "ai-metrics-tests.mjs",
  "catalog-ai-tests.mjs",
  "escaping-tests.mjs",
  "async-tests.mjs",
  "validate-tests.mjs",
  "profile-rules-tests.mjs",
  "profile-prompt-tests.mjs",
  "novelty-tests.mjs",
  "loop-tests.mjs",
  "library-tests.mjs",
  "library-search-tests.mjs",
  "persistence-tests.mjs",
  "export-tests.mjs",
  "example-profile-tests.mjs",
  "refinement-tests.mjs",
  "statements-tests.mjs",
  "new-releases-tests.mjs",
  "exclusions-tests.mjs",
  "browse-tests.mjs",
  "similar-tests.mjs",
  "taste-score-tests.mjs",
  "pm-review-tests.mjs",
  "metadata-tests.mjs",
  "canonical-store-tests.mjs",
  "canonical-related-tests.mjs",
  "fetch-timeout-tests.mjs",
  "cache-tests.mjs",
  "candidate-quality-tests.mjs",
  "synopsis-tests.mjs",
  "search-meta-tests.mjs",
  "search-ranking-tests.mjs",
  "insights-tests.mjs",
  "latency-tests.mjs",
  "stress-eval-tests.mjs"
];

// A new *-tests.mjs file that is not listed above would otherwise never run.
const unlisted = readdirSync(HERE).filter((f) => f.endsWith("-tests.mjs") && !SUITES.includes(f));
if (unlisted.length) {
  console.error(`run-unit: add these suites to SUITES in scripts/qa/run-unit.mjs: ${unlisted.join(", ")}`);
  process.exit(1);
}

const SHOW_DEBUG = Boolean(process.env.DEBUG);
const SUMMARY = /^(.+): (\d+) passed, (\d+) failed$/;

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`${HERE}${file}`], { stdio: ["ignore", "pipe", "pipe"] });
    let counts = null;
    const forward = (stream, out) => {
      const lines = createInterface({ input: stream });
      lines.on("line", (line) => {
        const match = line.match(SUMMARY);
        if (match) counts = { passed: Number(match[2]), failed: Number(match[3]) };
        if (!SHOW_DEBUG && line.startsWith("[tastemake-")) return;
        out.write(`${line}\n`);
      });
      return new Promise((done) => lines.on("close", done));
    };
    const streams = Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)]);
    child.on("close", async (code, signal) => {
      await streams;
      resolve({ file, code: code ?? 1, signal, counts });
    });
  });
}

const results = [];
for (const file of SUITES) results.push(await runSuite(file));

const failedSuites = results.filter((r) => r.code !== 0);
const checks = results.reduce((sum, r) => sum + (r.counts?.passed ?? 0) + (r.counts?.failed ?? 0), 0);
const failedChecks = results.reduce((sum, r) => sum + (r.counts?.failed ?? 0), 0);

console.log("\nunit suites:");
for (const r of results) {
  const detail = r.counts ? `${r.counts.passed} passed, ${r.counts.failed} failed` : (r.code === 0 ? "passed" : `exited ${r.signal ?? r.code}`);
  console.log(`  ${r.code === 0 ? "ok  " : "FAIL"} ${r.file}: ${detail}`);
}
console.log(`unit total: ${results.length - failedSuites.length}/${results.length} suites passed; ${checks - failedChecks}/${checks} counted checks passed`);
process.exit(failedSuites.length ? 1 : 0);
