#!/usr/bin/env node
// #341 step 2: the eval runner's safeguards. An ordinary run leaves the committed baseline byte for byte
// unchanged; replacing it needs --update-baseline <path> and is refused in CI; paid runs need --max-usd and
// print their plan first; --auth ant is refused in CI and its token never reaches output or reports; the
// model's raw answer is kept only with --raw. Runs scripts/evals/run.mjs as a subprocess with a fake `ant`
// and a stubbed fetch, so nothing real is called. Free, no network, no model call.
//
//   node scripts/qa/eval-runner-tests.mjs

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("eval runner tests");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runner = join(root, "scripts", "evals", "run.mjs");
const reports = join(root, "scripts", "evals", "reports");
const tmp = mkdtempSync(join(tmpdir(), "tastemake-eval-runner-"));
const FAKE_TOKEN = "sk-ant-oat01-FAKE-TEST-TOKEN-0000";

// A fake `ant` that hands out FAKE_TOKEN and leaves a marker when it's asked.
const bin = join(tmp, "bin");
const antMarker = join(tmp, "ant-was-called");
spawnSync("mkdir", ["-p", bin]);
writeFileSync(join(bin, "ant"), `#!/bin/sh\ntouch "${antMarker}"\necho "${FAKE_TOKEN}"\n`);
chmodSync(join(bin, "ant"), 0o755);

// A stubbed fetch for the Anthropic API: records the authorization header it saw, answers like a model would.
const seen = join(tmp, "auth-seen");
const stub = join(tmp, "stub-fetch.mjs");
writeFileSync(stub, `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("https://api.anthropic.com/")) throw new Error("unexpected network call: " + url);
  appendFileSync(${JSON.stringify(seen)}, String(init.headers?.authorization ?? "none") + "\\n");
  const text = JSON.stringify({ hypotheses: [{ id: "ai-stub", label: "Stub pattern", claim: "A stubbed claim.", evidence: [], counter: [], domains: ["play"], level: "emerging", crossDomain: "untested", conditional: false, context: null }], insufficientEvidence: false });
  return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 500 }, stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } });
};
`);

const env = (extra = {}) => {
  const e = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ANTHROPIC_API_KEY: "", ...extra };
  if (!("CI" in extra)) delete e.CI;
  return e;
};
const run = (args, extra = {}) => {
  const r = spawnSync(process.execPath, [runner, ...args], { cwd: root, env: env(extra), encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const sums = () => ["md", "json"].map((ext) => createHash("sha256").update(readFileSync(join(reports, `baseline-latest.${ext}`))).digest("hex")).join(",");
const reset = () => { for (const f of [antMarker, seen]) rmSync(f, { force: true }); };
const before = sums();

// ---- 1. an ordinary run compares, never writes, the committed baseline -------------------------------------
{
  const out = join(tmp, "out-default");
  const r = run(["--out", out]);
  eq("default run: passes", r.code, 0);
  check("default run: says it matches the committed baseline byte for byte", /matches the committed .*byte for byte/.test(r.out), r.out);
  check("default run: report goes to the chosen folder", existsSync(join(out, "baseline-latest.md")) && existsSync(join(out, "baseline-latest.json")));
  eq("default run: committed baseline unchanged", sums(), before);
}

// ---- 2. replacing a committed report is explicit and never happens in CI -----------------------------------
{
  const target = join(reports, "baseline-latest");
  let r = run(["--out", join(tmp, "o2"), "--update-baseline", target], { CI: "true" });
  eq("--update-baseline in CI: refused", r.code, 2);
  check("--update-baseline in CI: says why", /refused: .*CI/.test(r.out), r.out);
  r = run(["--out", join(tmp, "o3"), "--update-baseline"]);
  eq("--update-baseline without a destination: refused", r.code, 2);
  r = run(["--out", join(tmp, "o4"), "--update-baseline", join(tmp, "elsewhere")]);
  eq("--update-baseline outside scripts/evals/reports: refused", r.code, 2);
  check("--update-baseline outside: nothing written there", !existsSync(join(tmp, "elsewhere.md")));
  r = run(["--out", join(tmp, "o5"), "--update-baseline", join(reports, "runs", "x")]);
  eq("--update-baseline into runs/: refused", r.code, 2);
  r = run(["--out", join(tmp, "o5b"), "--update-baseline", join(reports, "..", "reports-escape")]);
  eq("--update-baseline with ../ traversal: refused", r.code, 2);
  check("traversal: nothing written next to reports/", !existsSync(join(reports, "..", "reports-escape.md")));
  r = run(["--out", join(tmp, "o5c"), "--update-baseline", join(reports, "runs", "..", "..", "fixtures-escape")]);
  eq("--update-baseline with runs/../../ traversal: refused", r.code, 2);
  // A symlinked folder inside reports/ and a symlinked report file must not lead outside it.
  const outside = join(tmp, "outside"); spawnSync("mkdir", ["-p", outside]);
  const linkDir = join(reports, "tmp-test-linkdir");
  const linkFile = join(reports, "tmp-test-link-latest.md");
  try {
    symlinkSync(outside, linkDir);
    r = run(["--out", join(tmp, "o5d"), "--update-baseline", join(linkDir, "x")]);
    eq("--update-baseline through a symlinked folder: refused", r.code, 2);
    check("symlinked folder: nothing written outside", readdirSync(outside).length === 0);
    writeFileSync(join(outside, "victim.md"), "untouched");
    symlinkSync(join(outside, "victim.md"), linkFile);
    r = run(["--out", join(tmp, "o5e"), "--update-baseline", join(reports, "tmp-test-link-latest")]);
    eq("--update-baseline through a symlinked report file: refused", r.code, 2);
    eq("symlinked file: its target is untouched", readFileSync(join(outside, "victim.md"), "utf8"), "untouched");
  } finally {
    rmSync(linkDir, { force: true });
    rmSync(linkFile, { force: true });
  }
  eq("after every refusal: committed baseline unchanged", sums(), before);
}

// ---- 3. paid runs need a cap; --auth ant never runs in CI ---------------------------------------------------
{
  reset();
  let r = run(["--producer", "live", "--yes", "--out", join(tmp, "o6")]);
  eq("live run without --max-usd: refused", r.code, 2);
  check("live run without --max-usd: says so", /--max-usd/.test(r.out), r.out);
  r = run(["--producer", "endpoint", "--yes", "--out", join(tmp, "o7")]);
  eq("endpoint run without --max-usd: refused", r.code, 2);
  r = run(["--producer", "live", "--yes", "--max-usd", "0", "--out", join(tmp, "o8")]);
  eq("--max-usd 0: refused", r.code, 2);
  r = run(["--producer", "live", "--auth", "ant", "--yes", "--max-usd", "1", "--suite", "support", "--out", join(tmp, "o9")], { CI: "true" });
  eq("--auth ant in CI: refused", r.code, 2);
  check("--auth ant in CI: the login is never read", !existsSync(antMarker));
  r = run(["--producer", "live", "--dry-run", "--out", join(tmp, "o10")]);
  check("a dry run needs no cap and makes no call", r.code !== 2 && !existsSync(seen), r.out);
}

// ---- 4. an approved-style local run: plan first, token used but never shown, raw only with --raw -------------
{
  reset();
  const out = join(tmp, "o11");
  const r = spawnSync(process.execPath, ["--import", stub, runner, "--producer", "live", "--auth", "ant", "--yes", "--max-usd", "1", "--suite", "support", "--out", out], { cwd: root, env: env(), encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  check("local live run: reads the ant login", existsSync(antMarker), text);
  const auth = existsSync(seen) ? readFileSync(seen, "utf8") : "";
  check("local live run: sends it as a Bearer token", auth.includes(`Bearer ${FAKE_TOKEN}`), auth);
  check("local live run: prints its plan before the first call", /Plan: up to \d+ paid call\(s\).*\$1/.test(text), text);
  check("local live run: plan comes before the spend summary", text.indexOf("Plan:") >= 0 && text.indexOf("Plan:") < text.indexOf("paid calls:"), text);
  const files = existsSync(out) ? readdirSync(out).map((f) => readFileSync(join(out, f), "utf8")).join("\n") : "";
  check("the token never appears in console output", !text.includes(FAKE_TOKEN) && !/authorization/i.test(text));
  check("the token never appears in reports", files.length > 0 && !files.includes(FAKE_TOKEN) && !/authorization|bearer/i.test(files));
  const json = JSON.parse(readFileSync(join(out, "support-live-latest.json"), "utf8"));
  check("without --raw: no raw model answers in the report", json.fixtures.every((f) => f.raw === null));
  const withRaw = join(tmp, "o12");
  spawnSync(process.execPath, ["--import", stub, runner, "--producer", "live", "--auth", "ant", "--yes", "--max-usd", "1", "--suite", "support", "--raw", "--out", withRaw], { cwd: root, env: env(), encoding: "utf8" });
  const rawJson = JSON.parse(readFileSync(join(withRaw, "support-live-latest.json"), "utf8"));
  check("with --raw: the model's own answer is kept", rawJson.fixtures.some((f) => Array.isArray(f.raw) && f.raw.length));
  eq("local live runs: committed baseline unchanged", sums(), before);
}

// ---- 5. the cap is checked against each call's worst case before it's made; spend counts prompt caching ----------
{
  reset();
  const out = join(tmp, "o13");
  const r = spawnSync(process.execPath, ["--import", stub, runner, "--producer", "live", "--auth", "ant", "--yes", "--max-usd", "0.0001", "--suite", "support", "--out", out], { cwd: root, env: env(), encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  check("a cap below one call's worst case: no call is made", !existsSync(seen), text);
  check("it says why the call wasn't made", /could cost up to \$[\d.]+ on top of \$0\.0000 spent, so it wasn't made/.test(text), text);
  const { usageCostUsd } = await import("../evals/pricing.mjs");
  const ok = join(tmp, "o14");
  reset();
  spawnSync(process.execPath, ["--import", stub, runner, "--producer", "live", "--auth", "ant", "--yes", "--max-usd", "1", "--suite", "support", "--out", ok], { cwd: root, env: env(), encoding: "utf8" });
  const spent = JSON.parse(readFileSync(join(ok, "support-live-latest.json"), "utf8")).spend;
  const perCall = usageCostUsd("claude-sonnet-5-5", { input_tokens: 1000, cache_creation_input_tokens: 2000, output_tokens: 500 });
  check("spend counts cache writes, not just input and output", spent.calls > 0 && Math.abs(spent.usd - perCall * spent.calls) < 1e-9 && spent.inputTokens === 3000 * spent.calls, JSON.stringify(spent));
  check("and stays under the cap", spent.usd <= 1);
}

rmSync(tmp, { recursive: true, force: true });
finish();
