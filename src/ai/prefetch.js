// #120: warm the first set's catalog candidates while the user is still choosing favorites.
//
// Production timing (#120) shows two big costs in a recommendation request: provider retrieval
// (TMDb / Open Library / IGDB, up to ~16s on a bad Open Library day) and the model call. Retrieval
// results are cached server-side per anchor item, so if the server has already fetched them for the
// same favorites, the real request skips that wait. Once four favorites are chosen (and they stay
// put for a moment), this sends the same serialized state with `warm: true`; the server runs
// retrieval only (no model call, nothing returned to show). When the user then asks for
// recommendations, the real request waits for a still-running warm-up with the same favorites
// instead of starting the same provider calls a second time in parallel.
//
// Product rules this does not touch: nothing from the warm-up is shown or stored, the real request
// still does retrieval, eligibility, novelty, ranking and validation itself, and a failed or slow
// warm-up only means the real request does the work as before.

import { serializeAiState } from "./live-client.js";

export const PREFETCH_DELAY_MS = 600;
// Longest the real request will hold for a warm-up that is still running. Retrieval normally
// finishes well inside this; past it, the real request just goes ahead on its own.
export const PREFETCH_MAX_WAIT_MS = 8000;

// The first set's anchors are exactly the starter favorites (plus the filter), so that is the key.
export function prefetchKey(state) {
  return `${state.recommendationFilter ?? "all"}|${[...(state.selectedFavorites ?? [])].sort().join(",")}`;
}

export function shouldPrefetch(state) {
  return !state.onboarded
    && (state.recommendationSets?.length ?? 0) === 0
    && (state.selectedFavorites?.size ?? 0) >= 4;
}

export function createCandidatePrefetcher({
  fetchImpl = (...args) => globalThis.fetch(...args),
  delayMs = PREFETCH_DELAY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  getState = null
} = {}) {
  let timer = null;
  let pendingKey = null;
  let warm = null; // { key, promise, done }

  function send(state) {
    const key = prefetchKey(state);
    if (warm?.key === key) return warm.promise;
    const entry = { key, done: false, promise: null };
    entry.promise = Promise.resolve()
      .then(() => fetchImpl("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ warm: true, state: serializeAiState(state) })
      }))
      .then((response) => Boolean(response?.ok), () => false)
      .finally(() => { entry.done = true; });
    warm = entry;
    return entry.promise;
  }

  return {
    // Call on every render; cheap when nothing changed. Debounced so swapping a favorite does not
    // warm every intermediate set.
    schedule(state) {
      if (!shouldPrefetch(state)) {
        if (timer !== null) { clearTimer(timer); timer = null; pendingKey = null; }
        return false;
      }
      const key = prefetchKey(state);
      if (key === warm?.key || key === pendingKey) return false;
      if (timer !== null) clearTimer(timer);
      pendingKey = key;
      timer = setTimer(() => {
        timer = null;
        pendingKey = null;
        const current = getState ? getState() : state;
        if (shouldPrefetch(current) && prefetchKey(current) === key) send(current);
      }, delayMs);
      return true;
    },

    // For the real first request, called before it starts (while selectedFavorites still holds the
    // starter favorites). Returns { warmed, wait } where wait resolves when it is worth sending the
    // real request: at once if there is no matching warm-up, or when a matching one finishes (or
    // maxWaitMs passes). A queued-but-unsent warm-up is dropped: the real request supersedes it.
    claim(state, { maxWaitMs = PREFETCH_MAX_WAIT_MS } = {}) {
      if (timer !== null) { clearTimer(timer); timer = null; pendingKey = null; }
      const key = prefetchKey(state);
      if (!warm || warm.key !== key) return { warmed: false, wait: Promise.resolve() };
      if (warm.done) return { warmed: true, wait: Promise.resolve() };
      let cap = null;
      const wait = Promise.race([
        warm.promise,
        new Promise((resolve) => { cap = setTimer(resolve, maxWaitMs); })
      ]).finally(() => clearTimer(cap));
      return { warmed: true, wait };
    },

    get lastKey() { return warm?.key ?? null; }
  };
}
