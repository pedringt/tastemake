#!/usr/bin/env node
// #323 phase 3: the paid reasons check (scripts/evals/partly-reasons-check.mjs), tested for free. The dry run (a
// child process with no key), the argument refusals, and the caps in its fetch wrapper with a mocked fetch: the
// call cap, the model, and the spend cap. Then a whole run against a canned endpoint: pass, fail and the report.
// Nothing reaches the network.
//
//   node scripts/qa/partly-reasons-check-tests.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSuite } from "./lib/assert.mjs";

const SCRIPT = fileURLToPath(new URL("../evals/partly-reasons-check.mjs", import.meta.url));
const { APPROVED_CALLS, CAP_USD, MODEL, PASS_AT, buildPlan, makeCappedFetch, refusalFor, runCheck } = await import(SCRIPT);

const { check, eq, finish } = createSuite("partly reasons check tests");

// ---- 1. The dry run: free, no key, no calls --------------------------------------------------------------------
{
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const out = execFileSync(process.execPath, [SCRIPT, "--dry-run"], { env, encoding: "utf8" });
  check("prints the plan: 10 calls on Haiku 5.5 with both caps", out.includes(`Plan: 10 calls (1 per case) on ${MODEL}`) && out.includes(`caps ${APPROVED_CALLS} calls and $${CAP_USD}`));
  eq("one line per case", (out.match(/^- /gm) ?? []).length, 10);
  check("every request matches its state", !out.includes("REFUSED"));
  check("says no calls were made", out.trim().endsWith("DRY RUN: no calls made."));
}

// ---- 2. Refused before anything happens -------------------------------------------------------------------------
{
  check("neither flag: refused", /--dry-run \(free\) or --yes/.test(refusalFor([], {})));
  check("both flags: refused", /not both/.test(refusalFor(["--dry-run", "--yes"], {})));
  check("--yes without --out: refused", /--out/.test(refusalFor(["--yes"], { ANTHROPIC_API_KEY: "x" })));
  check("--yes without a key: refused", /ANTHROPIC_API_KEY/.test(refusalFor(["--yes", "--out", "/tmp/x"], {})));
  eq("--dry-run needs nothing", refusalFor(["--dry-run"], {}), null);
  eq("the plan is 10 calls", buildPlan().length, APPROVED_CALLS);
  eq("pass needs 9 of 10", PASS_AT, 9);
}

// ---- 3. The caps in the fetch wrapper (mocked fetch) ------------------------------------------------------------
{
  let sent = 0;
  const realFetch = async () => { sent += 1; return { ok: true, json: async () => ({}) }; };
  const request = (model = MODEL) => ({ body: JSON.stringify({ model, max_tokens: 400, system: [{ text: "x".repeat(1500) }] }) });
  const refusedWith = async (fetchImpl, init) => { try { await fetchImpl("https://api.anthropic.com/v1/messages", init); return null; } catch (e) { return e.message; } };

  const calls = makeCappedFetch({ realFetch });
  for (let i = 0; i < APPROVED_CALLS; i += 1) await calls.fetchImpl("u", request());
  const eleventh = await refusedWith(calls.fetchImpl, request());
  check("the 11th call is refused and never sent", /call cap 10/.test(eleventh ?? "") && sent === APPROVED_CALLS && calls.spend.calls === APPROVED_CALLS);

  sent = 0;
  const other = makeCappedFetch({ realFetch });
  const wrongModel = await refusedWith(other.fetchImpl, request("claude-sonnet-5-5"));
  check("another model is refused and never sent", /approved claude-haiku-5-5/.test(wrongModel ?? "") && sent === 0 && other.spend.calls === 0);

  const tight = makeCappedFetch({ realFetch, capUsd: 0.00001 });
  const overCap = await refusedWith(tight.fetchImpl, request());
  check("a call whose worst case could cross the cap is refused and never sent", /could cross/.test(overCap ?? "") && sent === 0 && tight.spend.usd === 0);
  const nearly = makeCappedFetch({ realFetch, spend: { calls: 3, usd: CAP_USD - 0.00001 } });
  check("…including when earlier calls used most of it", /could cross/.test((await refusedWith(nearly.fetchImpl, request())) ?? "") && sent === 0);
}

// ---- 4. A whole run against a canned endpoint ------------------------------------------------------------------
{
  const ENV = { ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: MODEL, TASTEMAKE_AI_ENABLED: "1", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", TASTEMAKE_PARTLY_REASONS: "1" };
  const GOOD = { reasons: [{ label: "Quiet character study, not spectacle", basis: "a" }, { label: "Slow patient pacing, not thrills", basis: "b" }, { label: "Grounded realism, not fantasy", basis: "c" }] };
  const canned = (badEvery = 0) => {
    let n = 0;
    return async () => {
      n += 1;
      const answer = badEvery && n % badEvery === 0 ? { reasons: GOOD.reasons.slice(0, 2) } : GOOD;
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 900, output_tokens: 50 }, model: MODEL }) };
    };
  };
  const quiet = async (fn) => { const saved = [console.info, console.error]; console.info = () => {}; console.error = () => {}; try { return await fn(); } finally { [console.info, console.error] = saved; } };

  const good = makeCappedFetch({ realFetch: canned() });
  const report = await quiet(() => runCheck(buildPlan(), { ...good, env: ENV }));
  check("all 10 sets from the model: PASS", report.pass && report.passed === 10 && report.calls === 10);
  check("each set carries its reasons, checks, usage and cost", report.sets.every((s) => s.reasons.length === 3 && s.checksPassed && s.usage?.input_tokens === 900 && s.usd > 0));
  check("the total is the real usage, under the cap", report.usd > 0 && report.usd < CAP_USD && Math.abs(report.usd - report.sets.reduce((a, s) => a + s.usd, 0)) < 1e-12);

  const twoBad = makeCappedFetch({ realFetch: canned(5) });
  const failing = await quiet(() => runCheck(buildPlan(), { ...twoBad, env: ENV }));
  check("two sets failing the checks: 8 of 10, FAIL", !failing.pass && failing.passed === 8 && failing.sets.filter((s) => s.source === "fallback").every((s) => s.problems.some((p) => /expected 3/.test(p))));

  const capped = makeCappedFetch({ realFetch: canned(), maxCalls: 3 });
  const stopped = await quiet(() => runCheck(buildPlan(), { ...capped, env: ENV }));
  check("a cap that stops calls leaves the rest unavailable, with no call made", stopped.calls === 3 && stopped.sets.slice(3).every((s) => s.source === "unavailable" && !s.callMade) && !stopped.pass);
}

finish();
