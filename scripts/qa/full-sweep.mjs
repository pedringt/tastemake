#!/usr/bin/env node
// The full manual sweep (#41): every look, every width, for flow/layout/a11y, plus the free suites.
// This is NOT the required CI gate (npm test) — it is slower and meant to be run by hand before a
// release or a risky change, the way this project's QA has been run throughout development.
//
//   npm run test:full
//   node scripts/qa/full-sweep.mjs                 # same thing
//   node scripts/qa/full-sweep.mjs --widths 1440,390   # override the width list
//
// Never runs a paid producer. For the live model eval, run `npm run test:eval:live` by hand.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const widthsArg = args.includes("--widths") ? args[args.indexOf("--widths") + 1] : "1600,1440,1300,1024,860,768,430,390,360,320";
const WIDTHS = widthsArg.split(",").map((w) => w.trim());
const LOOKS = ["editorial", "collage", "analog", "graphic"];

let failures = 0;
function run(label, cmd, args, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) { failures += 1; console.log(`  x FAILED: ${label}`); }
}

run("api tests (no browser)", "node", ["scripts/qa/api-tests.mjs"]);
run("escaping tests (no browser)", "node", ["scripts/qa/escaping-tests.mjs"]);
run("async tests (no browser)", "node", ["scripts/qa/async-tests.mjs"]);
run("model rules", "scripts/qa/headless.sh", ["model"]);
run("eval baseline (free)", "node", ["scripts/evals/run.mjs"]);

for (const look of LOOKS) {
  run(`flow — ${look} @ ${WIDTHS.join(",")}`, "scripts/qa/headless.sh", ["flow", ...WIDTHS], { LOOK: look });
  run(`layout — ${look} @ ${WIDTHS.join(",")}`, "scripts/qa/headless.sh", ["layout", ...WIDTHS], { LOOK: look });
  run(`a11y — ${look} @ 1440,390`, "scripts/qa/headless.sh", ["a11y", "1440", "390"], { LOOK: look });
}

console.log(`\nfull sweep: ${failures ? `${failures} suite(s) failed` : "all suites passed"}`);
process.exit(failures ? 1 : 0);
