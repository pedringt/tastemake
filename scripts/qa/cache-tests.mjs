#!/usr/bin/env node
import { cachedValue } from "../../src/server/cache.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// Regression for #120: a provider timeout/error after a successful cache miss must not be
// interpreted as a cache failure and retried through the in-memory fallback.
{
  let calls = 0;
  const cache = { get: async () => null, set: async () => {} };
  let threw = false;
  try {
    await cachedValue("producer-failure", async () => {
      calls += 1;
      throw new Error("provider timed out");
    }, { cacheImpl: cache });
  } catch { threw = true; }
  check("producer failure is surfaced", threw);
  check("producer is called exactly once when it fails after a cache miss", calls === 1, `calls=${calls}`);
}

// A cache-set failure after a successful provider call must reuse the already-produced value,
// not call the provider again just to populate the memory fallback.
{
  let calls = 0;
  const cache = {
    get: async () => null,
    set: async () => { throw new Error("cache set failed"); }
  };
  const value = await cachedValue("set-failure", async () => {
    calls += 1;
    return { ok: true };
  }, { cacheImpl: cache });
  check("successful producer value survives cache-set failure", value?.ok === true);
  check("cache-set failure does not repeat the provider call", calls === 1, `calls=${calls}`);
}

console.log(`cache tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
