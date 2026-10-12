#!/usr/bin/env node
// #120: recommendation latency work. Free, no network, no browser, no model call.
//   - candidate warm-up (src/ai/prefetch.js + the warm path in api/recommendations.mjs)
//   - click-to-first-pick timing (src/lib/timing.js)
//   - the "starting from" loading line (src/model/loading-basis.js)
import handler, { warmRecommendationCandidates } from "../../api/recommendations.mjs";
import { createCandidatePrefetcher, prefetchKey, shouldPrefetch } from "../../src/ai/prefetch.js";
import { RECS_EVENT, RECS_MEASURE, cancelRecommendationTiming, markRecommendationStart, measureRecommendationShown, roundMs } from "../../src/lib/timing.js";
import { basisSentence, recommendationBasis } from "../../src/model/loading-basis.js";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("latency tests");
const flush = () => new Promise((resolve) => setImmediate(resolve));

const item = (id, title, type = "movie", domains = ["movies"]) => ({ id, title, type, domains, provider: "tmdb", providerId: id.split("-").at(-1) });
const favs = [item("tmdb-movie-1", "Moon Garden"), item("tmdb-movie-2", "Glass City"), item("tmdb-movie-3", "Signal Room"), item("tmdb-movie-4", "Night Shift")];
const starterState = (ids = favs.map((f) => f.id), extra = {}) => ({
  onboarded: false,
  selectedFavorites: new Set(ids),
  libraryFavorites: new Set(),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: Object.fromEntries(favs.map((f) => [f.id, f])),
  recommendationFilter: "all",
  ...extra
});

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    runAll() { const due = [...timers.entries()]; timers.clear(); due.forEach(([, t]) => t.fn()); },
    get count() { return timers.size; }
  };
}

// ---- prefetch gating and key ----
check("needs four favorites", !shouldPrefetch(starterState(favs.slice(0, 3).map((f) => f.id))));
check("four favorites before onboarding prefetch", shouldPrefetch(starterState()));
check("onboarded users do not prefetch", !shouldPrefetch(starterState(undefined, { onboarded: true })));
check("an existing set stops prefetch", !shouldPrefetch(starterState(undefined, { recommendationSets: [["x"]] })));
eq("key ignores selection order", prefetchKey(starterState(favs.map((f) => f.id).reverse())), prefetchKey(starterState()));
check("key includes the filter", prefetchKey(starterState()) !== prefetchKey(starterState(undefined, { recommendationFilter: "movies" })));

// ---- prefetcher: debounced, deduplicated, warm-only body ----
{
  const timers = fakeTimers();
  const calls = [];
  let resolveFetch;
  const fetchImpl = (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Promise((resolve) => { resolveFetch = resolve; }); };
  let current = starterState(favs.slice(0, 3).map((f) => f.id));
  const prefetcher = createCandidatePrefetcher({ fetchImpl, setTimer: timers.setTimer, clearTimer: timers.clearTimer, getState: () => current });

  check("three favorites schedule nothing", prefetcher.schedule(current) === false && timers.count === 0);
  current = starterState();
  check("fourth favorite schedules a warm-up", prefetcher.schedule(current) === true && timers.count === 1);
  check("re-render with the same favorites does not reschedule", prefetcher.schedule(current) === false && timers.count === 1);
  timers.runAll();
  await flush();
  eq("one warm-up request sent", calls.length, 1);
  eq("warm-up goes to the recommendations endpoint", calls[0]?.url, "/api/recommendations");
  check("warm-up body is flagged warm", calls[0]?.body.warm === true);
  eq("warm-up carries the four favorites", calls[0]?.body.state?.selectedFavorites?.length, 4);
  check("same favorites after sending: no second warm-up", prefetcher.schedule(current) === false && timers.count === 0);

  // The real request claims the in-flight warm-up and waits for it.
  const claim = prefetcher.claim(current, { maxWaitMs: 60_000 });
  check("claim reports a matching warm-up", claim.warmed === true);
  let waited = false;
  claim.wait.then(() => { waited = true; });
  await flush();
  check("claim waits while the warm-up is still running", waited === false);
  resolveFetch({ ok: true });
  await flush(); await flush();
  check("claim resolves when the warm-up finishes", waited === true);
  const again = prefetcher.claim(current);
  check("a finished warm-up resolves at once", again.warmed === true);

  // Different favorites: no wait.
  const other = starterState([favs[0].id, favs[1].id, favs[2].id, "tmdb-movie-9"]);
  const miss = prefetcher.claim(other);
  check("a warm-up for other favorites is not claimed", miss.warmed === false);
}

// ---- debounce: swapping favorites quickly only warms the final set ----
{
  const timers = fakeTimers();
  const calls = [];
  let current = starterState();
  const prefetcher = createCandidatePrefetcher({
    fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, getState: () => current
  });
  prefetcher.schedule(current);
  current = starterState([favs[0].id, favs[1].id, favs[2].id, "tmdb-movie-9"]);
  prefetcher.schedule(current);
  eq("a changed set replaces the queued timer", timers.count, 1);
  timers.runAll();
  await flush();
  eq("only one warm-up for two quick changes", calls.length, 1);
  check("it warms the latest favorites", calls[0]?.state.selectedFavorites.includes("tmdb-movie-9"));
}

// ---- claim drops a queued (not yet sent) warm-up; a stale timer never sends ----
{
  const timers = fakeTimers();
  const calls = [];
  const current = starterState();
  const prefetcher = createCandidatePrefetcher({
    fetchImpl: async () => { calls.push(1); return { ok: true }; },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, getState: () => current
  });
  prefetcher.schedule(current);
  const claim = prefetcher.claim(current);
  check("claim before the timer fires: nothing to wait for", claim.warmed === false && timers.count === 0);
  timers.runAll();
  await flush();
  eq("the queued warm-up never fires", calls.length, 0);
}

// ---- a failing or capped warm-up never blocks the real request for long ----
{
  const timers = fakeTimers();
  const current = starterState();
  const prefetcher = createCandidatePrefetcher({
    fetchImpl: () => new Promise(() => {}), // never settles
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, getState: () => current
  });
  prefetcher.schedule(current);
  timers.runAll();
  await flush();
  const claim = prefetcher.claim(current, { maxWaitMs: 5 });
  let done = false;
  claim.wait.then(() => { done = true; });
  timers.runAll(); // the cap timer
  await flush(); await flush();
  check("a hung warm-up is abandoned at the cap", done === true);
}
{
  const timers = fakeTimers();
  const current = starterState();
  const prefetcher = createCandidatePrefetcher({
    fetchImpl: async () => { throw new Error("network down"); },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, getState: () => current
  });
  prefetcher.schedule(current);
  timers.runAll();
  await flush(); await flush();
  let done = false;
  prefetcher.claim(current).wait.then(() => { done = true; });
  await flush();
  check("a failed warm-up resolves (never rejects) for the real request", done === true);
}

// ---- server warm path: retrieval only, never the model ----
{
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes("/movie/41/recommendations")) {
      return { ok: true, json: async () => ({ results: [{ id: 42, title: "Related", overview: "A related film.", release_date: "2024-01-01", poster_path: null, genre_ids: [18] }] }) };
    }
    if (String(url).includes("api.anthropic.com")) throw new Error("model must not be called");
    return { ok: true, json: async () => ({ results: [] }) };
  };
  const liveEnv = {
    TASTEMAKE_TMDB_TOKEN: "tmdb-token",
    TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test-not-real", TASTEMAKE_AI_MODEL: "claude-sonnet-5-5",
    TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1"
  };
  const seed = { id: "tmdb-movie-41", provider: "tmdb", providerId: "41", title: "Seed", type: "movie", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] } };
  const result = await warmRecommendationCandidates({
    rawState: { selectedFavorites: [seed.id], feedbackByRecommendation: {}, recommendationSets: [], customItems: { [seed.id]: seed }, areas: { movies: true }, recommendationFilter: "movies" },
    env: liveEnv,
    fetchImpl
  });
  check("warm-up reports warmed", result.warmed === true);
  eq("warm-up counts the retrieved candidates", result.candidates, 1);
  check("warm-up never returns candidate content", !("picks" in result) && !JSON.stringify(result).includes("Related"));
  check("warm-up makes no paid call even with live AI fully enabled", result.meta.paidCallMade === false && !urls.some((u) => u.includes("anthropic")), urls.join(" "));
  check("warm-up did the provider retrieval", urls.some((u) => u.includes("/movie/41/recommendations")));
}

// ---- handler routes warm requests and keeps them out of the live-AI rate bucket ----
{
  const res = () => { const r = { code: null, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const emptyState = { selectedFavorites: [], feedbackByRecommendation: {}, recommendationSets: [], customItems: {} };
  const headers = { "x-forwarded-for": "203.0.113.120" };
  let last = null;
  for (let i = 0; i < 7; i += 1) {
    last = res();
    await handler({ method: "POST", headers, body: { warm: true, state: emptyState } }, last);
  }
  eq("a 7th warm-up within a minute hits the warm bucket's own limit", last.code, 429);
  const real = res();
  await handler({ method: "POST", headers, body: { state: emptyState } }, real);
  eq("warm-ups never use up the live-AI allowance", real.code, 200);
  check("the real request still returns picks (here: none, nothing to anchor on)", Array.isArray(real.body?.picks));
  const one = res();
  await handler({ method: "POST", headers: { "x-forwarded-for": "203.0.113.121" }, body: { warm: true, state: emptyState } }, one);
  check("warm response shape", one.code === 200 && one.body?.warmed === true && one.body?.meta?.paidCallMade === false && !("picks" in (one.body ?? {})), JSON.stringify(one.body));
  check("warm response is not cached", one.headers["cache-control"] === "no-store");
  const bad = res();
  await handler({ method: "POST", headers: { "x-forwarded-for": "203.0.113.122" }, body: "{not json" }, bad);
  eq("unparseable body is still a 400", bad.code, 400);
}

// ---- timing ----
{
  const marks = new Map();
  const measures = [];
  const cleared = [];
  let clock = 1000;
  const perf = {
    mark: (name) => { marks.set(name, clock); },
    measure: (name, start, end) => {
      if (!marks.has(start)) throw new Error("missing start mark");
      const entry = { name, duration: marks.get(end) - marks.get(start) };
      measures.push(entry);
      return entry;
    },
    clearMarks: (name) => { cleared.push(name); marks.delete(name); }
  };
  const events = [];
  const va = (...args) => events.push(args);

  check("start mark recorded", markRecommendationStart("ai-1", { perf }) === true);
  clock += 6789;
  const ms = measureRecommendationShown("ai-1", { source: "model", initial: true, warmed: true }, { perf, va });
  eq("measures click to first pick", ms, 6789);
  eq("measure has the documented name", measures[0]?.name, RECS_MEASURE);
  eq("one analytics event", events.length, 1);
  eq("event name", events[0]?.[1]?.name, RECS_EVENT);
  eq("event duration is rounded to 100ms", events[0]?.[1]?.data?.ms, 6800);
  eq("event carries only four low-cardinality fields", Object.keys(events[0]?.[1]?.data ?? {}).sort().join(","), "ms,set,source,warmed");
  check("marks are cleared after measuring", cleared.includes("tastemake:recommendations:start:ai-1") && cleared.includes("tastemake:recommendations:shown:ai-1"));

  eq("no start mark: nothing measured", measureRecommendationShown("ai-missing", {}, { perf, va }), null);
  eq("no start mark: no event", events.length, 1);
  markRecommendationStart("ai-2", { perf });
  cancelRecommendationTiming("ai-2", { perf });
  eq("a cancelled request is never measured", measureRecommendationShown("ai-2", {}, { perf, va }), null);
  markRecommendationStart("ai-3", { perf });
  check("works without analytics loaded", measureRecommendationShown("ai-3", {}, { perf, va: undefined }) === 0);
  check("no performance API: start is a no-op", markRecommendationStart("ai-4", { perf: null }) === false);
  eq("no performance API: measure is null", measureRecommendationShown("ai-4", {}, { perf: null, va }), null);
  markRecommendationStart("ai-5", { perf });
  check("a throwing analytics shim never breaks the app", measureRecommendationShown("ai-5", {}, { perf, va: () => { throw new Error("x"); } }) === 0);
  eq("roundMs", roundMs(1249), 1200);
}

// ---- loading basis ----
{
  const basis = recommendationBasis(starterState());
  eq("starter favorites are the basis before onboarding", basis.favorites.join("|"), "Moon Garden|Glass City|Signal Room|Night Shift");
  eq("first-set sentence", basisSentence(basis), "Starting from your favorites: Moon Garden, Glass City, Signal Room and Night Shift.");

  const later = {
    selectedFavorites: new Set(),
    libraryFavorites: new Set(["tmdb-movie-1", "tmdb-movie-2"]),
    customItems: {},
    feedbackByRecommendation: {
      "tmdb-movie-1": { item: favs[0], rating: "more", detail: "loved-before" },
      "tmdb-movie-2": { item: favs[1], rating: "more", detail: "loved-before" },
      "tmdb-movie-7": { item: item("tmdb-movie-7", "Tried One"), rating: "more", detail: "liked-before" },
      "tmdb-movie-8": { item: item("tmdb-movie-8", "Saved One"), rating: "not-tried", detail: "bookmark" }
    },
    recommendationFilter: "read"
  };
  const laterBasis = recommendationBasis(later);
  eq("after onboarding, Library favorites are the basis", laterBasis.favorites.join("|"), "Moon Garden|Glass City");
  eq("only tried, non-favorite reactions are counted", laterBasis.reactions, 1);
  eq("later-set sentence with a filter", basisSentence(laterBasis), "Starting from your favorites: Moon Garden and Glass City, plus 1 other thing you have tried. Looking for Books only.");
  eq("long favorite lists are shortened", basisSentence({ favorites: ["A", "B", "C", "D", "E", "F"] }), "Starting from your favorites: A, B, C, D and 2 others.");
  eq("nothing true to say: empty", basisSentence({}), "");
  eq("reactions without favorites", basisSentence({ favorites: [], reactions: 3 }), "Starting from 3 things you have tried.");
}

finish();
