// #120: client-side recommendation timing, from the click to the first pick on screen.
//
// Uses the User Timing API, so every run shows up in DevTools' Performance panel and in
// performance.getEntriesByName(RECS_MEASURE) during QA. When Vercel Web Analytics is loaded (#100),
// one custom event per shown set also goes to it, with only the rounded duration and three
// low-cardinality labels: never titles, ids, favorites or anything the user typed. On localhost, or
// before Web Analytics is enabled, window.va is absent or only queues, and nothing is sent.

export const RECS_MEASURE = "tastemake:recommendations:click-to-first-pick";
export const RECS_EVENT = "Recommendations shown";

const startMark = (id) => `tastemake:recommendations:start:${id}`;
const shownMark = (id) => `tastemake:recommendations:shown:${id}`;

function perfOrNull(perf) {
  return perf && typeof perf.mark === "function" && typeof perf.measure === "function" ? perf : null;
}

export function markRecommendationStart(requestId, { perf = globalThis.performance } = {}) {
  const p = perfOrNull(perf);
  if (!p) return false;
  try { p.mark(startMark(requestId)); return true; } catch { return false; }
}

// Rounded to 100ms: precise enough for a p50/p95 that lives in seconds, coarse enough that an
// event can never act as a fingerprint.
export const roundMs = (ms) => Math.max(0, Math.round(Number(ms || 0) / 100) * 100);

// Returns the measured duration in ms, or null when the start mark is missing (for example the
// request started before a reload) or the platform lacks the API.
export function measureRecommendationShown(requestId, { source = "unknown", initial = false, warmed = false } = {}, {
  perf = globalThis.performance,
  va = globalThis.window?.va
} = {}) {
  const p = perfOrNull(perf);
  if (!p) return null;
  let duration = null;
  try {
    p.mark(shownMark(requestId));
    const entry = p.measure(RECS_MEASURE, startMark(requestId), shownMark(requestId));
    duration = entry?.duration ?? p.getEntriesByName?.(RECS_MEASURE)?.at?.(-1)?.duration ?? null;
  } catch {
    return null;
  } finally {
    try { p.clearMarks?.(startMark(requestId)); p.clearMarks?.(shownMark(requestId)); } catch { /* ignore */ }
  }
  if (duration == null) return null;
  if (typeof va === "function") {
    try {
      va("event", {
        name: RECS_EVENT,
        data: { ms: roundMs(duration), set: initial ? "first" : "more", source: String(source), warmed: Boolean(warmed) }
      });
    } catch { /* analytics must never break the app */ }
  }
  return duration;
}

export function cancelRecommendationTiming(requestId, { perf = globalThis.performance } = {}) {
  try { perf?.clearMarks?.(startMark(requestId)); } catch { /* ignore */ }
}
