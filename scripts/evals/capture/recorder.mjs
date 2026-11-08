// #341 step 4 (Design A): record one run of production's unmodified retrieveCatalogCandidates, so the same
// pool can be replayed locally, exactly, as often as needed (replay.mjs). Approved for local build Nov 7;
// capturing needs Paige's separate approval of the preview, the request cap and the capture window.
//
// What it records: every provider response (URLs and bodies redacted, redact.mjs), every catalog-store
// read, every Math.random() draw (anchor order is a weighted random draw), the live pool and the trace.
// Safeguards, all enforced in code:
// - a hard cap on external traffic: every attempt counts (retries, follow-ups, the IGDB token, store
//   reads); at the cap the next attempt is blocked before it's sent and the run is marked stopped.
// - a host allowlist: any other host stops the run.
// - store reads only: anything but a SELECT (or a read-only WITH) stops the run, and the database URL is
//   removed from the env retrieval sees, so its direct write-behind (canonicalizeWriteBehind) is a no-op.
// Retrieval catches lookup errors itself, so a stop can't end the call early; instead every later
// attempt is refused too, and the recording is marked stopped and incomplete, never used as a pool.
import { createHash } from "node:crypto";
import { retrieveCatalogCandidates } from "../../../src/catalog/related.mjs";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { redactBody, redactUrl } from "./redact.mjs";

export const ALLOWED_HOSTS = ["api.themoviedb.org", "openlibrary.org", "api.igdb.com", "id.twitch.tv", "www.googleapis.com"];
// Provider settings retrieval reads. Replay gives the same names placeholder values; values are never kept.
export const PROVIDER_ENV = ["TASTEMAKE_TMDB_TOKEN", "IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET", "TASTEMAKE_GOOGLE_BOOKS_API_KEY"];
const WRITE_SQL = /\b(insert|update|delete|merge|upsert|truncate|alter|drop|create|grant)\b/i;

export class CaptureStop extends Error {}

export function createRecorder({ maxRequests, realFetch = fetch, realQuery = null, allowedHosts = ALLOWED_HOSTS }) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error("maxRequests must be a positive whole number; there is no default");
  const log = { attempts: 0, requests: [], queries: [], failures: [], stopped: null };
  const stop = (reason) => {
    log.stopped ??= reason;
    throw new CaptureStop(log.stopped);
  };
  const charge = (what) => {
    if (log.stopped) stop(log.stopped);
    if (log.attempts >= maxRequests) stop(`request cap ${maxRequests} reached (blocked attempt ${log.attempts + 1}: ${what})`);
    log.attempts += 1;
  };

  const fetchImpl = async (url, init = {}) => {
    const host = new URL(String(url)).hostname;
    if (!allowedHosts.includes(host)) stop(`unexpected host ${host}`);
    charge(host);
    const entry = { method: (init.method ?? "GET").toUpperCase(), url: redactUrl(url), body: typeof init.body === "string" ? init.body : null };
    try {
      const response = await realFetch(url, init);
      const text = await response.text();
      log.requests.push({ ...entry, status: response.status, response: redactBody(url, text) });
      if (!response.ok) log.failures.push({ url: entry.url, status: response.status, kind: response.status === 429 ? "rate-limited" : "http-error" });
      return new Response(text, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
    } catch (error) {
      if (error instanceof CaptureStop) throw error;
      log.requests.push({ ...entry, error: error?.name ?? "Error" });
      log.failures.push({ url: entry.url, kind: error?.name === "AbortError" ? "timeout" : "network" });
      throw error;
    }
  };

  const query = realQuery ? async (text, params = []) => {
    if (!/^\s*(select|with)\b/i.test(text) || WRITE_SQL.test(text)) stop("a catalog-store query that isn't a read");
    charge("catalog store");
    try {
      const rows = await realQuery(text, params);
      log.queries.push({ text, params, rows });
      return rows;
    } catch (error) {
      if (error instanceof CaptureStop) throw error;
      log.queries.push({ text, params, error: error?.name ?? "Error" });
      log.failures.push({ query: text.slice(0, 60), kind: "store-error" });
      throw error;
    }
  } : null;

  return { fetchImpl, query, log };
}

export const profileHash = (feedbackByRecommendation) => createHash("sha256").update(JSON.stringify(feedbackByRecommendation)).digest("hex");

// The state retrieval sees for a bundled profile. Rounds are independent draws: the random anchor order
// is what varies between them, which is production's own variation.
export function profileState(profile) {
  return hydrateState({ feedbackByRecommendation: profile.feedbackByRecommendation, recommendationFilter: "all", curveball: true, areas: {}, recommendationSets: [], seenItemIds: [] });
}

export async function captureRetrieval({ profile, round, maxRequests, env = process.env, realFetch = fetch, realQuery = null, commit = null, retrieve = retrieveCatalogCandidates }) {
  const recorder = createRecorder({ maxRequests, realFetch, realQuery });
  const retrievalEnv = { ...env };
  delete retrievalEnv.TASTEMAKE_DATABASE_URL;   // retrieval's direct store writes become no-ops; reads go through recorder.query
  const draws = [];
  const original = Math.random;
  Math.random = () => { const value = original(); draws.push(value); return value; };
  const trace = {};
  let pool = [];
  try {
    pool = await retrieve(profileState(profile), { env: retrievalEnv, fetchImpl: recorder.fetchImpl, ...(recorder.query ? { query: recorder.query } : {}), trace });
  } finally {
    Math.random = original;
  }
  const { log } = recorder;
  return {
    version: 1,
    profileId: profile.id,
    profileHash: profileHash(profile.feedbackByRecommendation),
    round,
    commit,
    capturedAt: new Date().toISOString(),
    config: { mode: "all", curveball: true, limit: 30, providerEnv: PROVIDER_ENV.filter((name) => Boolean(env[name])), store: Boolean(realQuery) },
    maxRequests,
    attempts: log.attempts,
    stopped: log.stopped,
    failures: log.failures,
    complete: !log.stopped && log.failures.length === 0,
    random: draws,
    requests: log.requests,
    queries: log.queries,
    pool,
    trace: trace.retrieval ?? null
  };
}
