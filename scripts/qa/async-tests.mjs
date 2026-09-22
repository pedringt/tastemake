#!/usr/bin/env node
// Async live-AI request rules (#42). Free, no browser, no model: the request-state module only.
//
//   node scripts/qa/async-tests.mjs
//
// The rule being protected: a model answer must never be shown if the evidence it was computed from has
// changed, or if the user left the page, or if a newer request replaced it.

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { favorites, recommendations, hypotheses } = await import("../../src/data/catalog.js");
const { applySearchAction } = await import("../../src/model/search.js");
const { setStatement } = await import("../../src/model/statements.js");
const R = await import("../../src/ai/requests.js");

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const mk = () => ({
  screen: "recommendations", selectedFavorites: new Set(favorites.filter((f) => f.selected).map((f) => f.id)),
  feedbackByRecommendation: {}, recommendationSets: [recommendations], libraryFavorites: new Set(), customItems: {},
  blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(), patternStatements: [],
  areas: { watch: true, read: true, play: true }, curveball: true, aiRequest: null, aiStatus: "idle"
});

// fingerprint: sensitive to everything a pick request depends on
const base = mk();
const print = R.evidenceFingerprint(base);
eq("the same state gives the same fingerprint", R.evidenceFingerprint(mk()), print);
const reacted = mk(); applySearchAction(reacted, recommendations[0], "loved");
check("a reaction changes it", R.evidenceFingerprint(reacted) !== print);
const bookmarked = mk(); applySearchAction(bookmarked, recommendations[0], "bookmark");
check("even an intent-only reaction changes it (it steers the next set)", R.evidenceFingerprint(bookmarked) !== print);
const areaOff = mk(); areaOff.areas.play = false;
check("turning an area off changes it", R.evidenceFingerprint(areaOff) !== print);
const noCurveball = mk(); noCurveball.curveball = false;
check("the curveball setting changes it", R.evidenceFingerprint(noCurveball) !== print);
const said = mk(); setStatement(said, hypotheses[0].id, "says", "not-me");
check("a pattern correction changes it", R.evidenceFingerprint(said) !== print);
const looked = mk(); looked.look = "collage"; looked.profileView = "map"; looked.libraryFilter = "watch";
eq("presentation-only state does not change it", R.evidenceFingerprint(looked), print);

// a quiet request is usable
const state = mk();
const request = R.startRequest(state);
eq("starting a request sets loading", state.aiStatus, R.AI_LOADING);
eq("nothing changed: the answer is usable", R.staleReason(state, request), null);
check("...and isCurrent agrees", R.isCurrent(state, request));

// the user reacts while it is in flight
applySearchAction(state, recommendations[1], "liked");
eq("a reaction mid-flight makes the answer stale", R.staleReason(state, request), "your reactions changed while it was thinking");
check("...and it must not be treated as current", !R.isCurrent(state, request));

// navigation
const navState = mk();
const navRequest = R.startRequest(navState);
navState.screen = "library";
eq("leaving the page makes it stale", R.staleReason(navState, navRequest), "you moved to another page while it was thinking");

// a newer request supersedes the older one, and cancels it
const twoState = mk();
const first = R.startRequest(twoState);
const second = R.startRequest(twoState);
eq("the first request is cancelled", first.cancelled, "superseded by a newer request");
check("...and its controller was aborted", first.controller?.signal.aborted === true);
eq("...so its answer is refused", R.staleReason(twoState, first), "superseded by a newer request");
eq("the newer request is fine", R.staleReason(twoState, second), null);

// explicit cancel
const cancelState = mk();
const cancelled = R.startRequest(cancelState);
R.cancelRequest(cancelState, "you moved to another page while it was thinking");
eq("cancelling clears the in-flight request", cancelState.aiRequest, null);
eq("...and stops loading", cancelState.aiStatus, R.AI_IDLE);
check("...and the answer is refused", R.staleReason(cancelState, cancelled) !== null);

// finishing
const doneState = mk();
const doneRequest = R.startRequest(doneState);
R.finishRequest(doneState, doneRequest, { source: "model", message: "live" });
eq("finishing clears the in-flight request", doneState.aiRequest, null);
eq("...sets ready", doneState.aiStatus, R.AI_READY);
eq("...and records the source", doneState.aiSource, "model");

console.log(`async tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
