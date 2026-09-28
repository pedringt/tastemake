#!/usr/bin/env node
// #120: TMDb/Open Library/IGDB provider fetches had no timeout at all before this. Real production
// logs showed a single Open Library call taking 10.7s, pushing candidateRetrieval (previously
// "never the bottleneck" at under 2s) to 10-14s. Free, no network, no real timers -- uses a short
// override timeout so this runs fast.
//
//   node scripts/qa/fetch-timeout-tests.mjs

import { fetchWithTimeout } from "../../src/lib/fetch-timeout.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// ---- a fast response resolves normally, timer never fires -------------------------------------

{
  const fastFetch = async (url, opts) => ({ ok: true, url, signal: opts.signal });
  const response = await fetchWithTimeout(fastFetch, "https://example.test/ok", {}, 50);
  check("a fast response resolves normally", response.ok === true);
  check("the fetch was called with an AbortSignal", response.signal instanceof AbortSignal);
}

// ---- a fetch that never resolves is aborted at the timeout, not left hanging ------------------

{
  let sawAbort = false;
  const hangingFetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener("abort", () => { sawAbort = true; reject(new DOMException("aborted", "AbortError")); });
  });
  const startedAt = Date.now();
  let threw = null;
  try {
    await fetchWithTimeout(hangingFetch, "https://example.test/hangs", {}, 30);
  } catch (error) {
    threw = error;
  }
  const elapsed = Date.now() - startedAt;
  check("a hanging fetch is aborted rather than left pending forever", sawAbort === true);
  check("the caller sees an AbortError, not a silent hang", threw?.name === "AbortError");
  check("it aborts close to the configured timeout, not the caller's own long wait", elapsed < 500, `elapsed ${elapsed}ms`);
}

// ---- existing headers/method/body pass through untouched --------------------------------------

{
  let seenOpts = null;
  const captureFetch = async (url, opts) => { seenOpts = opts; return { ok: true }; };
  await fetchWithTimeout(captureFetch, "https://example.test/opts", { method: "POST", headers: { "x-test": "1" }, body: "payload" }, 50);
  check("method passes through", seenOpts.method === "POST");
  check("headers pass through", seenOpts.headers["x-test"] === "1");
  check("body passes through", seenOpts.body === "payload");
}

console.log(`fetch timeout tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
