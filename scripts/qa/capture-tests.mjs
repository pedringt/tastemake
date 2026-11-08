#!/usr/bin/env node
// #341 step 4: the capture recorder, replay harness and capture route (scripts/evals/capture/,
// api/eval-capture.mjs). The request cap blocks the attempt past the cap, retries included; unexpected
// hosts and non-read store queries stop a run; retrieval never sees the database URL; credentials never
// reach a recording or a response; a recording of production's real retrieval replays exactly, and a
// tampered one doesn't; the route refuses outside a preview, unknown or unapproved profiles, and a missing
// cap. Free: stubbed providers and store, no network.
//
//   node scripts/qa/capture-tests.mjs

import { createSuite } from "./lib/assert.mjs";
import { CaptureStop, captureRetrieval, createRecorder } from "../evals/capture/recorder.mjs";
import { checkRecording, replayRetrieval } from "../evals/capture/replay.mjs";
import { findSecrets, redactBody, redactUrl } from "../evals/capture/redact.mjs";
import { PROFILES, usableProfile } from "../evals/capture/profiles.mjs";
import { createHandler } from "../../api/eval-capture.mjs";

const { check, eq, finish } = createSuite("capture tests");
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

// ---- 1. the hard cap: the attempt past the cap is blocked before it's sent, even a retry --------------------
{
  let sent = 0;
  const recorder = createRecorder({ maxRequests: 120, realFetch: async () => { sent += 1; return ok({}); } });
  for (let i = 0; i < 120; i += 1) await recorder.fetchImpl("https://api.themoviedb.org/3/movie/1/recommendations");
  let blocked = null;
  try { await recorder.fetchImpl("https://api.themoviedb.org/3/movie/1/recommendations"); } catch (error) { blocked = error; }
  check("cap 120: the 121st attempt (a retry of the same URL) is blocked", blocked instanceof CaptureStop);
  eq("cap 120: exactly 120 requests were sent", sent, 120);
  check("cap 120: the run is marked stopped with the reason", /request cap 120 reached \(blocked attempt 121/.test(recorder.log.stopped ?? ""), recorder.log.stopped);
  let after = null;
  try { await recorder.fetchImpl("https://openlibrary.org/search.json?q=x"); } catch (error) { after = error; }
  check("after a stop, every later attempt is refused too", after instanceof CaptureStop && sent === 120);
  let noCap = null;
  try { createRecorder({ realFetch: async () => ok({}) }); } catch (error) { noCap = error; }
  check("there is no default cap", /no default/.test(noCap?.message ?? ""));
}

// ---- 2. unexpected hosts and store writes stop the run; reads count toward the cap ---------------------------
{
  let sent = 0;
  const recorder = createRecorder({ maxRequests: 5, realFetch: async () => { sent += 1; return ok({}); }, realQuery: async () => [{ n: 1 }] });
  let stopped = null;
  try { await recorder.fetchImpl("https://example.com/anything"); } catch (error) { stopped = error; }
  check("an unexpected host stops the run without sending", stopped instanceof CaptureStop && sent === 0 && /unexpected host example.com/.test(recorder.log.stopped));
  const reads = createRecorder({ maxRequests: 2, realQuery: async () => [{ n: 1 }] });
  eq("a SELECT is allowed and recorded", (await reads.query("select 1 as n", []))[0].n, 1);
  let write = null;
  try { await reads.query("insert into canonical_items values ($1)", [1]); } catch (error) { write = error; }
  check("an INSERT is refused and stops the run", write instanceof CaptureStop && /isn't a read/.test(reads.log.stopped));
  const cte = createRecorder({ maxRequests: 5, realQuery: async () => [] });
  let cteWrite = null;
  try { await cte.query("with x as (select 1) update canonical_items set a = 1", []); } catch (error) { cteWrite = error; }
  check("a WITH that writes is refused too", cteWrite instanceof CaptureStop);
  const capped = createRecorder({ maxRequests: 1, realFetch: async () => ok({}), realQuery: async () => [] });
  await capped.query("select 1", []);
  let overCap = null;
  try { await capped.fetchImpl("https://openlibrary.org/search.json?q=x"); } catch (error) { overCap = error; }
  check("store reads count toward the same cap", overCap instanceof CaptureStop);
}

// ---- 3. retrieval never sees the database URL (its direct write-behind becomes a no-op) -----------------------
{
  let seenEnv = null;
  const recording = await captureRetrieval({
    profile: PROFILES["example-profile"], round: 1, maxRequests: 10,
    env: { TASTEMAKE_DATABASE_URL: "postgres://user:pw@host/db", TASTEMAKE_TMDB_TOKEN: "tmdb-secret-value-123" },
    realQuery: async () => [],
    retrieve: async (state, options) => { seenEnv = options.env; return []; }
  });
  check("retrieval's env has no database URL", seenEnv && !("TASTEMAKE_DATABASE_URL" in seenEnv));
  check("provider settings are recorded by name only", recording.config.providerEnv.includes("TASTEMAKE_TMDB_TOKEN") && !JSON.stringify(recording).includes("tmdb-secret-value-123"));
}

// ---- 4. redaction ------------------------------------------------------------------------------------------
{
  const url = redactUrl("https://id.twitch.tv/oauth2/token?client_id=abc12345&client_secret=s3cr3tvalue&grant_type=client_credentials");
  check("the Twitch token URL keeps no client id or secret", !url.includes("abc12345") && !url.includes("s3cr3tvalue") && url.includes("grant_type=client_credentials"));
  check("a Google Books key is removed", !redactUrl("https://www.googleapis.com/books/v1/volumes?q=x&key=AIzaSECRET99").includes("AIzaSECRET99"));
  const body = JSON.parse(redactBody("https://id.twitch.tv/oauth2/token", JSON.stringify({ access_token: "real-token-value", expires_in: 100 })));
  eq("the token response keeps its shape but not the token", body.access_token, "REDACTED");
  const env = { IGDB_CLIENT_SECRET: "planted-secret-0000", TASTEMAKE_DATABASE_URL: "postgres://u:p@h/d" };
  check("a planted env secret is found", findSecrets("{\"x\":\"planted-secret-0000\"}", env).includes("env:IGDB_CLIENT_SECRET"));
  check("a database URL pattern is found", findSecrets("postgres://someone:pw@db.example/x", {}).length > 0);
  check("clean text has no findings", findSecrets(JSON.stringify({ title: "Circe", url: redactUrl("https://openlibrary.org/search.json?q=myth") }), env).length === 0);
}

// ---- 5. a recording of production's real retrieval replays exactly; a tampered one doesn't ---------------------
// Two TMDb anchors and one IGDB anchor; stubbed providers answer deterministically by URL.
const fixture = (() => {
  const movie = (id, title, genres) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), title, type: "movie", domains: ["movies"], genres, providerMeta: { genreIds: genres.map(Number), collectionId: null } });
  const game = { id: "igdb-game-7", provider: "igdb", providerId: "7", title: "Anchor Game", type: "game", domains: ["play"], genres: ["31"], providerMeta: { genreIds: [31] } };
  const fb = (item, detail) => ({ item, rating: "more", detail, refinements: ["atmosphere"] });
  return {
    id: "fixture", approved: true, resolved: true,
    feedbackByRecommendation: {
      "tmdb-movie-100": fb(movie(100, "Anchor One", ["18", "9648"]), "loved-before"),
      "tmdb-movie-200": fb(movie(200, "Anchor Two", ["878"]), "liked-before"),
      "igdb-game-7": fb(game, "loved-before")
    }
  };
})();
// Distinct, unrelated titles: numbered ones ("Film 1", "Film 2") read as one franchise to the novelty guard.
const WORDS = ["Harbor", "Lantern", "Meridian", "Thistle", "Orchard", "Basalt", "Cinder", "Willow", "Quarry", "Juniper", "Falcon", "Marrow", "Saffron", "Tundra", "Vesper", "Gossamer", "Pebble", "Rampart", "Solstice", "Tamarind", "Umber", "Verdigris", "Wren", "Zephyr"];
const providerStub = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.themoviedb.org") {
    const anchor = Number(u.pathname.split("/")[3]);
    return ok({ results: Array.from({ length: 8 }, (_, i) => ({ id: anchor * 10 + i, title: `${WORDS[(anchor / 100 * 8 + i) % WORDS.length]} ${["Road", "Hours", "Season", "Letters"][i % 4]}`, genre_ids: [18], release_date: "2015-01-01", overview: "A film.", popularity: 10 - i })) });
  }
  if (u.hostname === "id.twitch.tv") return ok({ access_token: "stub-token", expires_in: 3600 });
  if (u.hostname === "api.igdb.com") return ok(Array.from({ length: 6 }, (_, i) => ({ id: 900 + i, name: `${WORDS[(i * 5 + 3) % WORDS.length]} Expedition`, summary: "A game.", first_release_date: 1500000000, genres: [{ id: 31, name: "Adventure" }] })));
  return ok({ docs: [] });
};
{
  const env = { TASTEMAKE_TMDB_TOKEN: "stub-tmdb", IGDB_CLIENT_ID: "stub-client-id", IGDB_CLIENT_SECRET: "stub-client-secret" };
  const recording = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: providerStub, realQuery: async () => [] });
  check("the recording run built a real pool", recording.pool.length >= 6, `pool ${recording.pool.length}`);
  check("it's complete: not stopped, no failures", recording.complete, JSON.stringify({ stopped: recording.stopped, failures: recording.failures }));
  check("it recorded the random draws", recording.random.length > 0);
  check("it recorded provider requests and store reads", recording.requests.length > 0 && recording.queries.length > 0);
  check("the recorded Twitch request has no client secret", recording.requests.filter((r) => r.url.includes("id.twitch.tv")).every((r) => !r.url.includes("stub-client-secret")));
  check("no credential in the recording", findSecrets(JSON.stringify(recording), env).length === 0);
  const replay = await replayRetrieval(recording, { profile: fixture });
  check("replay through the unmodified retrieval is exact", replay.exact, JSON.stringify({ samePool: replay.samePool, missing: replay.missing, unusedRandom: replay.unusedRandom, extraRandom: replay.extraRandom }));
  check("and the recording is usable", checkRecording(recording, replay, env).usable);
  const tampered = structuredClone(recording);
  const tmdb = tampered.requests.find((r) => r.url.includes("themoviedb"));
  tmdb.response = tmdb.response.replace("A film.", "Changed.").replace(/"popularity":\d+/, "\"popularity\":0").replace(/"id":(\d+)/, (m, id) => `"id":${Number(id) + 5000}`);
  const replayTampered = await replayRetrieval(tampered, { profile: fixture });
  check("a changed provider response is detected", !replayTampered.exact && !replayTampered.samePool);
  // Replay must consume exactly the recorded draws: one missing or one extra makes it inexact.
  const short = structuredClone(recording);
  short.random = short.random.slice(0, -1);
  const shortReplay = await replayRetrieval(short, { profile: fixture });
  check("a missing random draw is detected", !shortReplay.exact && shortReplay.extraRandom === 1);
  const long = structuredClone(recording);
  long.random = [...long.random, 0.5];
  const longReplay = await replayRetrieval(long, { profile: fixture });
  check("an extra random draw is detected", !longReplay.exact && longReplay.unusedRandom === 1);
  const stopped = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 2, env, realFetch: providerStub, realQuery: async () => [] });
  check("a capped run is marked stopped and incomplete", Boolean(stopped.stopped) && !stopped.complete);
  check("and is never usable as a pool", !checkRecording(stopped, await replayRetrieval(stopped, { profile: fixture }), env).usable);
}

// ---- 5b. timing races replay the way they ran live (Nov 8 diagnostic) ---------------------------------------
// A stand-in for retrieval's real patterns: a 400 ms wait (the Wikidata year check), a store read raced against
// a 100 ms timer (the anchor-metadata lookup), a provider abort timeout (fetchWithTimeout), a request left
// running in the background, and an ordinary fast lookup.
{
  const { fetchWithTimeout } = await import("../../src/lib/fetch-timeout.mjs");
  const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const raceRetrieve = async (state, { fetchImpl, query }) => {
    const year = await Promise.race([fetchImpl("https://query.wikidata.org/sparql?q=year").then((r) => r.json()).then((j) => j.year), wait(400, "waited")]);
    const meta = await Promise.race([query("select meta", []).then((rows) => rows.length), wait(100, "timed-out")]);
    let aborted = "no";
    try { await fetchWithTimeout(fetchImpl, "https://openlibrary.org/search.json?q=slow", {}, 150); } catch (error) { aborted = error.name; }
    fetchImpl("https://query.wikidata.org/sparql?q=background").catch(() => {});
    const fast = await (await fetchImpl("https://api.themoviedb.org/3/movie/1/recommendations")).json();
    return [{ id: "race", year, meta, aborted, fast: fast.n }];
  };
  const delays = { year: 600, slow: 400, background: 300, recommendations: 10 };
  const slowStub = (url, init = {}) => new Promise((resolve, reject) => {
    const u = String(url);
    const key = Object.keys(delays).find((k) => u.includes(k));
    const timer = setTimeout(() => resolve(ok(key === "year" ? { year: 1999 } : { n: 7 })), delays[key]);
    init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
  });
  const recording = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 10, env: {}, realFetch: slowStub, realQuery: () => wait(200, [{ a: 1 }]), retrieve: raceRetrieve });
  const live = recording.pool[0];
  check("live: the 400 ms wait won over a 600 ms lookup", live.year === "waited", JSON.stringify(live));
  check("live: the 100 ms timer won over a 200 ms store read", live.meta === "timed-out");
  check("live: the 150 ms provider timeout aborted a 400 ms lookup", live.aborted === "AbortError");
  check("the background request is recorded as in flight", recording.requests.some((r) => r.url.includes("background") && r.inFlight));
  check("finished requests carry their duration", recording.requests.filter((r) => !r.inFlight).every((r) => Number.isInteger(r.ms)));
  const replay = await replayRetrieval(recording, { profile: fixture, retrieve: raceRetrieve });
  check("replay with recorded timing reproduces every race exactly", replay.exact, JSON.stringify({ pool: replay.pool, missing: replay.missing }));
  const instant = await replayRetrieval(recording, { profile: fixture, retrieve: raceRetrieve, timing: false });
  check("instant replay (the old behaviour) would get the races wrong", !instant.samePool, JSON.stringify(instant.pool));
}

// ---- 5c. the usability rule: natural timeouts can qualify; recorder stops and other failures can't (Nov 8) -----
{
  const env = { TASTEMAKE_TMDB_TOKEN: "stub-tmdb", IGDB_CLIENT_ID: "stub-client-id", IGDB_CLIENT_SECRET: "stub-client-secret" };
  const abort = () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const timingOut = (urls) => async (url, init) => (urls.some((u) => String(url).includes(u)) ? abort() : providerStub(url, init));
  const one = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: timingOut(["/movie/200/"]), realQuery: async () => [] });
  const oneVerdict = checkRecording(one, await replayRetrieval(one, { profile: fixture }), env);
  check("a production timeout, faithfully replayed, is usable", oneVerdict.usable && oneVerdict.replayExact, JSON.stringify(oneVerdict.problems));
  eq("and the timed-out lookup is listed as unavailable", oneVerdict.unavailable.length, 1);
  check("its pool still came from the other anchors", one.pool.length > 0);
  const two = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: timingOut(["/movie/100/", "/movie/200/"]), realQuery: async () => [] });
  const twoVerdict = checkRecording(two, await replayRetrieval(two, { profile: fixture }), env);
  check("over 25% of lookups failing is unrepresentative, even with an exact replay", !twoVerdict.usable && twoVerdict.replayExact && !twoVerdict.representative, JSON.stringify(twoVerdict));
  const limited = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: async (url, init) => (String(url).includes("/movie/200/") ? new Response("{}", { status: 429 }) : providerStub(url, init)), realQuery: async () => [] });
  const limitedVerdict = checkRecording(limited, await replayRetrieval(limited, { profile: fixture }), env);
  check("a rate-limited response disqualifies", !limitedVerdict.usable && limitedVerdict.problems.some((p) => /rate-limited/.test(p)));
  // Revised Nov 8 after Stage 2: a provider 5xx is handled by production like a timeout.
  const status = (code, urls) => async (url, init) => (urls.some((u) => String(url).includes(u)) ? new Response("{}", { status: code }) : providerStub(url, init));
  const bad = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: status(502, ["/movie/200/"]), realQuery: async () => [] });
  const badVerdict = checkRecording(bad, await replayRetrieval(bad, { profile: fixture }), env);
  check("a provider 502, faithfully replayed, is usable", badVerdict.usable && badVerdict.replayExact, JSON.stringify(badVerdict.problems));
  check("and the pool is marked degraded, with the 502 listed as unavailable", badVerdict.degraded && badVerdict.unavailable.some((u) => u.status === 502));
  const clean = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: providerStub, realQuery: async () => [] });
  const cleanVerdict = checkRecording(clean, await replayRetrieval(clean, { profile: fixture }), env);
  check("a clean recording is usable and not marked degraded", cleanVerdict.usable && !cleanVerdict.degraded);
  const many5xx = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: status(503, ["/movie/100/", "/movie/200/"]), realQuery: async () => [] });
  const manyVerdict = checkRecording(many5xx, await replayRetrieval(many5xx, { profile: fixture }), env);
  check("too many provider 5xx responses are unrepresentative", !manyVerdict.usable && !manyVerdict.representative);
  const missingPage = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: status(404, ["/movie/200/"]), realQuery: async () => [] });
  check("a 404 (not a provider outage) disqualifies", !checkRecording(missingPage, await replayRetrieval(missingPage, { profile: fixture }), env).usable);
  const dropped = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 40, env, realFetch: async (url, init) => (String(url).includes("/movie/200/") ? Promise.reject(new TypeError("fetch failed")) : providerStub(url, init)), realQuery: async () => [] });
  const droppedVerdict = checkRecording(dropped, await replayRetrieval(dropped, { profile: fixture }), env);
  check("a network error isn't usable automatically: it needs human review", !droppedVerdict.usable && droppedVerdict.needsReview);
  const capped = await captureRetrieval({ profile: fixture, round: 1, maxRequests: 2, env, realFetch: providerStub, realQuery: async () => [] });
  const cappedVerdict = checkRecording(capped, await replayRetrieval(capped, { profile: fixture }), env);
  check("a recording stopped by the request cap is never usable, whatever its replay", !cappedVerdict.usable && cappedVerdict.stopped && cappedVerdict.problems.some((p) => /stopped by the recorder: request cap/.test(p)));
}

// ---- 5d. the capture runner: the approved 80-request cap, and a fresh ledger per run ---------------------------
{
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const runner = new URL("../evals/capture/run-capture.mjs", import.meta.url).pathname;
  const tmp = mkdtempSync(join(tmpdir(), "tastemake-run-capture-"));
  writeFileSync(join(tmp, "ledger.json"), JSON.stringify({ calls: [{ profileId: "example-profile", round: 1, charged: 150 }] }));
  const stub = join(tmp, "stub.mjs");
  writeFileSync(stub, `globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); return new Response(JSON.stringify({ complete: true, attempts: Math.min(b.maxRequests, 61), maxRequests: b.maxRequests, pool: [1], failures: [], stopped: null }), { status: 200 }); };`);
  const run = (extra) => spawnSync(process.execPath, ["--import", stub, runner, "--url", "https://x-preview.vercel.app", "--out", tmp, ...extra], { encoding: "utf8", env: { ...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: "test-secret-value" } });
  const stage2 = ["--run", "stage2", "--only", "example-profile:1", "--max-calls", "1", "--max-total-requests", "80"];
  const accepted = run([...stage2, "--max-requests", "80"]);
  eq("--max-requests 80 is accepted", accepted.status, 0);
  check("the call is given the full 80 (budget allows it)", /1 of 1 approved calls and 61 of 80 approved external requests used/.test(accepted.stdout), accepted.stdout + accepted.stderr);
  eq("--max-requests 81 is refused", run([...stage2.map((v) => (v === "stage2" ? "stage2b" : v)), "--max-requests", "81"]).status, 2);
  eq("--run is required", run(["--only", "example-profile:1", "--max-calls", "1", "--max-total-requests", "80", "--max-requests", "80"]).status, 2);
  const fresh = JSON.parse(readFileSync(join(tmp, "stage2", "ledger.json"), "utf8"));
  check("the run's ledger is its own, starting from zero", fresh.calls.length === 1 && fresh.calls[0].charged === 61);
  check("the first run's ledger is untouched", JSON.parse(readFileSync(join(tmp, "ledger.json"), "utf8")).calls[0].charged === 150);
  check("the recording lands in the run's folder", existsSync(join(tmp, "stage2", "example-profile-round1.json")));
  check("the secret is never printed", !accepted.stdout.includes("test-secret-value") && !accepted.stderr.includes("test-secret-value"));
  rmSync(tmp, { recursive: true, force: true });
}

// ---- 6. the capture route's guards ------------------------------------------------------------------------
{
  const call = async (handler, body, method = "POST") => {
    const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
    await handler({ method, body }, res);
    return res;
  };
  const fakeCapture = async ({ profile, maxRequests }) => ({ profileId: profile.id, maxRequests, pool: [] });
  const preview = createHandler({ env: { VERCEL_ENV: "preview" }, capture: fakeCapture });
  eq("production: not found", (await call(createHandler({ env: { VERCEL_ENV: "production" }, capture: fakeCapture }), { profileId: "example-profile", round: 1, maxRequests: 10 })).code, 404);
  eq("no VERCEL_ENV (local or unknown): not found", (await call(createHandler({ env: {}, capture: fakeCapture }), { profileId: "example-profile", round: 1, maxRequests: 10 })).code, 404);
  eq("GET: refused", (await call(preview, {}, "GET")).code, 405);
  eq("an unknown profile: refused", (await call(preview, { profileId: "someone-else", round: 1, maxRequests: 10 })).code, 400);
  eq("an approved, resolved persona: captured", (await call(preview, { profileId: "rosa", round: 1, maxRequests: 10 })).code, 200);
  eq("a prototype key as profile id: refused", (await call(preview, { profileId: "__proto__", round: 1, maxRequests: 10 })).code, 400);
  eq("no maxRequests: refused", (await call(preview, { profileId: "example-profile", round: 1 })).code, 400);
  eq("maxRequests over the ceiling: refused", (await call(preview, { profileId: "example-profile", round: 1, maxRequests: 500 })).code, 400);
  const good = await call(preview, { profileId: "example-profile", round: 1, maxRequests: 10, feedbackByRecommendation: { injected: {} } });
  eq("a valid request on a preview: captured", good.code, 200);
  check("state sent in the request is ignored (the bundled profile is used)", JSON.parse(good.body).profileId === "example-profile");
  const leaky = createHandler({ env: { VERCEL_ENV: "preview", TASTEMAKE_TMDB_TOKEN: "leaky-token-value-99" }, capture: async () => ({ note: "leaky-token-value-99" }) });
  const leaked = await call(leaky, { profileId: "example-profile", round: 1, maxRequests: 10 });
  check("a recording containing a credential isn't returned", leaked.code === 500 && !JSON.stringify(leaked.body).includes("leaky-token-value-99"));
  let release;
  const slow = createHandler({ env: { VERCEL_ENV: "preview" }, capture: () => new Promise((resolve) => { release = () => resolve({ pool: [] }); }) });
  const first = call(slow, { profileId: "example-profile", round: 1, maxRequests: 10 });
  eq("a second capture while one runs: refused", (await call(slow, { profileId: "example-profile", round: 2, maxRequests: 10 })).code, 409);
  release();
  eq("the first capture still completes", (await first).code, 200);
  check("all five profiles are usable: the Example Profile and the four approved, resolved personas", ["example-profile", "rosa", "theo", "mara", "dev"].every((id) => usableProfile(id)));
}

// ---- 7. the personas exercise retrieval across media (stubbed providers, so only anchor choice is tested) ------
{
  const { retrieveCatalogCandidates } = await import("../../src/catalog/related.mjs");
  const { profileState } = await import("../evals/capture/recorder.mjs");
  const empty = async () => ok({ results: [], docs: [], works: [] });
  for (const id of ["rosa", "theo", "mara", "dev"]) {
    const profile = PROFILES[id];
    eq(`${id}: 10 rated titles`, Object.keys(profile.feedbackByRecommendation).length, 10);
    check(`${id}: every title has a provider id`, Object.values(profile.feedbackByRecommendation).every((f) => f.item.provider && f.item.providerId));
    const trace = {};
    await retrieveCatalogCandidates(profileState(profile), { env: {}, fetchImpl: empty, trace });
    const media = new Set((trace.retrieval?.anchors ?? []).map((a) => a.medium));
    check(`${id}: retrieval anchors reach all four media`, ["movies", "tv", "read", "play"].every((m) => media.has(m)), [...media].join(","));
  }
}

finish();
