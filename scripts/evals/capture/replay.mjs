#!/usr/bin/env node
// #341 step 4 (Design A): replay a recording (recorder.mjs) through production's unmodified
// retrieveCatalogCandidates and check that it rebuilds the recorded pool exactly: the same candidates, in
// the same order, with the same metadata. Local, offline: every provider response, catalog-store row and
// random draw comes from the recording; a request the recording doesn't have fails the replay.
//
//   node scripts/evals/capture/replay.mjs <recording.json> [more.json ...]
import { readFileSync } from "node:fs";
import { retrieveCatalogCandidates } from "../../../src/catalog/related.mjs";
import { PROVIDER_ENV, profileState } from "./recorder.mjs";
import { findSecrets, redactUrl } from "./redact.mjs";

const requestKey = (method, url, body) => `${method} ${url} ${body ?? ""}`;

export async function replayRetrieval(recording, { profile, retrieve = retrieveCatalogCandidates } = {}) {
  const responses = new Map();
  for (const r of recording.requests) {
    const key = requestKey(r.method, r.url, r.body);
    if (!responses.has(key)) responses.set(key, []);
    responses.get(key).push(r);
  }
  const rows = new Map();
  for (const q of recording.queries) {
    const key = `${q.text}\n${JSON.stringify(q.params)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(q);
  }
  const missing = [];
  const fetchImpl = async (url, init = {}) => {
    const key = requestKey((init.method ?? "GET").toUpperCase(), redactUrl(url), typeof init.body === "string" ? init.body : null);
    const next = responses.get(key)?.shift();
    if (!next) { missing.push(key.slice(0, 160)); throw new Error("not in recording"); }
    if (next.error) throw Object.assign(new Error(next.error), { name: next.error });
    return new Response(next.response, { status: next.status, headers: { "content-type": "application/json" } });
  };
  const query = recording.config.store ? async (text, params = []) => {
    const next = rows.get(`${text}\n${JSON.stringify(params)}`)?.shift();
    if (!next) { missing.push(`query ${text.slice(0, 80)}`); throw new Error("not in recording"); }
    if (next.error) throw new Error(next.error);
    return next.rows;
  } : undefined;
  // Placeholder values for the provider settings the recording had, so retrieval takes the same paths.
  const env = Object.fromEntries(recording.config.providerEnv.filter((name) => PROVIDER_ENV.includes(name)).map((name) => [name, "replay-placeholder"]));
  const draws = [...recording.random];
  const original = Math.random;
  let overrun = 0;
  Math.random = () => (draws.length ? draws.shift() : (overrun += 1, 0.5));
  let pool;
  try {
    pool = await retrieve(profileState(profile), { env, fetchImpl, ...(query ? { query } : {}) });
  } finally {
    Math.random = original;
  }
  const same = JSON.stringify(pool) === JSON.stringify(recording.pool);
  return {
    exact: same && !missing.length && !overrun && !draws.length,
    samePool: same,
    missing,
    unusedRandom: draws.length,
    extraRandom: overrun,
    unusedRequests: [...responses.values()].reduce((n, list) => n + list.length, 0),
    pool
  };
}

// A recording is usable as a frozen pool only if it's complete, replays exactly and holds no secrets.
export function checkRecording(recording, replay, env = {}) {
  const problems = [];
  if (recording.stopped) problems.push(`stopped: ${recording.stopped}`);
  if (recording.failures.length) problems.push(`${recording.failures.length} failed or incomplete response(s)`);
  if (!replay.exact) problems.push(`replay not exact (pool ${replay.samePool ? "same" : "different"}, ${replay.missing.length} missing, ${replay.unusedRandom} unused / ${replay.extraRandom} extra random draws)`);
  const secrets = findSecrets(JSON.stringify(recording), env);
  if (secrets.length) problems.push(`secret-like content: ${secrets.join(", ")}`);
  return { usable: problems.length === 0, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { PROFILES } = await import("./profiles.mjs");
  let failed = 0;
  for (const file of process.argv.slice(2)) {
    const recording = JSON.parse(readFileSync(file, "utf8"));
    const profile = PROFILES[recording.profileId];
    if (!profile) { console.log(`${file}: unknown profile ${recording.profileId}`); failed += 1; continue; }
    const replay = await replayRetrieval(recording, { profile });
    const verdict = checkRecording(recording, replay, process.env);
    if (!verdict.usable) failed += 1;
    console.log(`${file}: ${verdict.usable ? "usable (exact replay)" : `NOT usable: ${verdict.problems.join("; ")}`}`);
  }
  process.exit(failed ? 1 : 0);
}
