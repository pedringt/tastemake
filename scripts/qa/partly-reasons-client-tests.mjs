#!/usr/bin/env node
// #323 phase 3: "What's different about it?" in the browser. Choosing, clearing and keeping a reason
// (src/model/partly-elements.js chooseReason); the request (src/ai/partly-reasons-request.js): one call per flagged
// title, cached for the visit, none in the Example Profile, a stale answer ignored; the Taste Profile rows: the
// loading line, up to three reason buttons with aria-pressed, the fallback and the copy saying it changes nothing
// yet; and the picks prompt still without `elements`. Free: the endpoint is a canned fake, no network.
//
//   node scripts/qa/partly-reasons-client-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { PARTLY_DIFFERENT_SIDE, chooseReason, markBelongs, markDifferentSide, markDoesntFit, setDifferentSideNote, titleAnswer } = await import("../../src/model/partly-elements.js");
const { buildReasonsRequest, forgetAllReasons, loadReasons, reasonOptions, reasonsEntry } = await import("../../src/ai/partly-reasons-request.js");
const { setStatement } = await import("../../src/model/statements.js");
const { serializeAiState } = await import("../../src/ai/live-client.js");
const { buildContext } = await import("../../src/ai/context.js");
const { checkStateShape } = await import("../../src/model/state-shape.js");
const { state } = await import("../../src/state.js");
const profileScreen = await import("../../src/screens/profile.js");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("partly reasons client tests");

const item = (id, title, type, genres, extra = {}) => ({ id, title, type, domains: [type === "game" ? "play" : "movies"], genres, provider: "tmdb", providerId: id.split("-").pop(), year: "2017", ...extra });
const ref = (it) => `ev:${it.id}`;
const MYTH = [item("tmdb-movie-1", "Princess Mononoke", "movie", [14]), item("tmdb-movie-2", "Spirited Away", "movie", [14]), item("tmdb-movie-3", "Pan's Labyrinth", "movie", [14])];
const RE7 = item("igdb-game-7", "Resident Evil 7", "game", ["Horror"], { about: "A survival horror game set in a derelict plantation house in Louisiana." });
const P_MYTH = { id: "ai-mythic-worlds", title: "Mythic and fantastical worlds", claim: "Drawn to stories set in mythic, fantastical worlds with their own rules and spirits.", supports: [...MYTH, RE7].map(ref), counters: [], domains: ["movies"], strength: "strong", status: "strong", crossDomain: "untested", evidence: "", aiGenerated: true };
const LABELS = ["Survival horror, not a mythic world", "Tense resource scarcity, not wonder", "Interactive play, not a film"];
function profile() {
  const s = { ...emptyState([]), recommendationSets: [], hypothesisHistory: [], profileGeneration: 0 };
  [...MYTH, RE7].forEach((it) => react(s, it, "loved"));
  s.modelHypotheses = [{ ...P_MYTH, supports: [...P_MYTH.supports] }];
  s.patternStatements = [{ hypothesisId: P_MYTH.id, label: P_MYTH.title, says: "partial", weight: null, context: null, authority: "user-confirmed" }];
  return s;
}
const answerOf = (s) => titleAnswer(s, P_MYTH.id, ref(RE7));

// A fake /api/hypotheses: answers with `payload`, or waits for release() when held.
function fakeEndpoint(payload = { source: "model", reasons: LABELS, meta: {} }, { hold = false, ok = true, fail = false } = {}) {
  const calls = [];
  let release;
  const gate = hold ? new Promise((r) => { release = r; }) : Promise.resolve();
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    await gate;
    if (fail) throw new Error("offline");
    return { ok, status: ok ? 200 : 500, json: async () => JSON.parse(JSON.stringify(payload)) };
  };
  return { fetchImpl, calls, release: () => release?.() };
}

// ---- 1. Saving, clearing and keeping a reason ------------------------------------------------------------------
{
  eq("the different-side flag is on", PARTLY_DIFFERENT_SIDE, true);
  const s = profile();
  eq("no reason without a different-side answer", chooseReason(s, P_MYTH.id, ref(RE7), LABELS[0]), null);
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  const saved = chooseReason(s, P_MYTH.id, ref(RE7), LABELS[0]);
  eq("tapping a reason saves it as the one reason", JSON.stringify(answerOf(s).reasons), JSON.stringify([LABELS[0]]));
  eq("…the live-region sentence says so, and that it changes nothing yet", saved, "Mythic and fantastical worlds: saved “Survival horror, not a mythic world” as what’s different about “Resident Evil 7”. It’s kept for a later step and changes nothing yet.");
  check("…without claiming it affects picks or the pattern", !/picks will|pattern will|updat/i.test(saved));
  chooseReason(s, P_MYTH.id, ref(RE7), LABELS[1]);
  eq("tapping another replaces it (one choice)", JSON.stringify(answerOf(s).reasons), JSON.stringify([LABELS[1]]));
  setDifferentSideNote(s, P_MYTH.id, ref(RE7), "the house is the point");
  const cleared = chooseReason(s, P_MYTH.id, ref(RE7), LABELS[1]);
  check("tapping it again clears it", answerOf(s).reasons.length === 0 && /cleared your reason/.test(cleared));
  eq("…and keeps the own-words note", answerOf(s).note, "the house is the point");
  chooseReason(s, P_MYTH.id, ref(RE7), LABELS[2]);
  eq("the note stays when a reason is chosen", answerOf(s).note, "the house is the point");
  const before = JSON.stringify(s.modelHypotheses);
  check("the pattern is untouched", JSON.stringify(s.modelHypotheses) === before && s.modelHypotheses[0].supports.includes(ref(RE7)));
  check("Belongs clears the answer and its reason", Boolean(markBelongs(s, P_MYTH.id, ref(RE7))) && answerOf(s) === null);
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  chooseReason(s, P_MYTH.id, ref(RE7), LABELS[0]);
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  check("toggling “Fits a different side” off clears it too", answerOf(s) === null);
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  eq("…and toggling it back on starts with no reason (undo is a fresh answer)", JSON.stringify(answerOf(s).reasons), "[]");
  chooseReason(s, P_MYTH.id, ref(RE7), LABELS[0]);
  setStatement(s, P_MYTH.id, "says", "accurate");
  check("leaving Partly drops the answer and its reason", answerOf(s) === null);
  const t = profile();
  markDoesntFit(t, P_MYTH.id, ref(RE7));
  eq("no reason on a doesn't-fit answer", chooseReason(t, P_MYTH.id, ref(RE7), LABELS[0]), null);
  const u = profile();
  markDifferentSide(u, P_MYTH.id, ref(RE7));
  chooseReason(u, P_MYTH.id, ref(RE7), LABELS[0]);
  eq("a saved reason passes the state shape check", checkStateShape({ patternStatements: u.patternStatements, modelHypotheses: u.modelHypotheses }).dropped.join(","), "");
  check("…and still never reaches the picks prompt or the wire", buildContext(u).statements.every((st) => !("elements" in st)) && serializeAiState(u).patternStatements.every((st) => !("elements" in st)));
}

// ---- 2. The request: one call, cached, stale answers ignored, none in the Example Profile ------------------------
{
  forgetAllReasons();
  const s = profile();
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  const body = buildReasonsRequest(s, P_MYTH.id, ref(RE7));
  check("the request names the pattern and title, with the title's synopsis", body.reasons.hypothesisId === P_MYTH.id && body.reasons.ref === ref(RE7) && /plantation house/.test(body.reasons.about));
  check("…sends only this pattern, and no element-level answers", body.state.modelHypotheses.length === 1 && body.state.patternStatements.every((st) => !("elements" in st)));
  check("…and carries every title the pattern cites", P_MYTH.supports.every((r) => body.state.feedbackByRecommendation[r.replace("ev:", "")]));

  const endpoint = fakeEndpoint();
  const updates = [], said = [];
  const outcome = await loadReasons(s, P_MYTH.id, ref(RE7), { title: "Resident Evil 7", fetchImpl: endpoint.fetchImpl, onUpdate: () => updates.push(reasonsEntry(s, P_MYTH.id, ref(RE7))?.status), announce: (m) => said.push(m) });
  eq("one call on marking", endpoint.calls.length, 1);
  eq("…to the reasons mode of /api/hypotheses", `${endpoint.calls[0].url} ${Boolean(endpoint.calls[0].body.reasons)}`, "/api/hypotheses true");
  eq("loading, then ready", updates.join(","), "loading,ready");
  check("ready with the three reasons", outcome === "ready" && reasonsEntry(s, P_MYTH.id, ref(RE7)).reasons.join("|") === LABELS.join("|"));
  eq("the live region says they're ready", said.at(-1), "Suggested reasons for “Resident Evil 7” are ready. Pick the one that fits, or say it in your own words.");
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  markDifferentSide(s, P_MYTH.id, ref(RE7));
  const again = await loadReasons(s, P_MYTH.id, ref(RE7), { fetchImpl: endpoint.fetchImpl });
  check("marking it again in this visit makes no second call", again === "cached" && endpoint.calls.length === 1);
  check("the cache isn't saved state", !JSON.stringify(s).includes(LABELS[1]));

  // Stale: the person chose Belongs while the request was out.
  forgetAllReasons();
  const t = profile();
  markDifferentSide(t, P_MYTH.id, ref(RE7));
  const held = fakeEndpoint(undefined, { hold: true });
  const saidT = [];
  const pending = loadReasons(t, P_MYTH.id, ref(RE7), { fetchImpl: held.fetchImpl, announce: (m) => saidT.push(m) });
  markBelongs(t, P_MYTH.id, ref(RE7));
  held.release();
  eq("an answer that arrives after Belongs is ignored", await pending, "stale");
  check("…nothing cached, nothing announced", reasonsEntry(t, P_MYTH.id, ref(RE7)) === null && saidT.length === 0);
  check("…and the answer stays cleared", answerOf(t) === null);

  // Stale: toggled off and on while loading. The newer request wins; the older answer is ignored.
  forgetAllReasons();
  const u = profile();
  markDifferentSide(u, P_MYTH.id, ref(RE7));
  const first = fakeEndpoint({ source: "model", reasons: ["Old one, not this", "Old two, not that", "Old three, not those"], meta: {} }, { hold: true });
  const older = loadReasons(u, P_MYTH.id, ref(RE7), { fetchImpl: first.fetchImpl });
  markDifferentSide(u, P_MYTH.id, ref(RE7));
  markDifferentSide(u, P_MYTH.id, ref(RE7));
  const newer = await loadReasons(u, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint().fetchImpl });
  first.release();
  check("toggled off and on while loading: the newer answer is kept, the older ignored", newer === "ready" && (await older) === "stale" && reasonsEntry(u, P_MYTH.id, ref(RE7)).reasons[0] === LABELS[0]);

  // Stale: the profile was replaced (Start over, a restored backup).
  forgetAllReasons();
  const v = profile();
  markDifferentSide(v, P_MYTH.id, ref(RE7));
  const heldV = fakeEndpoint(undefined, { hold: true });
  const pendingV = loadReasons(v, P_MYTH.id, ref(RE7), { fetchImpl: heldV.fetchImpl });
  v.profileGeneration = 1;
  heldV.release();
  eq("an answer for a replaced profile is ignored", await pendingV, "stale");

  // The Example Profile: no call, "Something else" only.
  forgetAllReasons();
  const ex = { ...profile(), viewingExample: true };
  markDifferentSide(ex, P_MYTH.id, ref(RE7));
  const exEndpoint = fakeEndpoint();
  const exUpdates = [];
  eq("no call while viewing the Example Profile", await loadReasons(ex, P_MYTH.id, ref(RE7), { fetchImpl: exEndpoint.fetchImpl, onUpdate: () => exUpdates.push(1) }), "example");
  check("…no request and no loading state", exEndpoint.calls.length === 0 && exUpdates.length === 0 && reasonsEntry(ex, P_MYTH.id, ref(RE7)) === null);

  // Failures and the switch.
  forgetAllReasons();
  const w = profile();
  markDifferentSide(w, P_MYTH.id, ref(RE7));
  const saidW = [];
  eq("server switch off: \"off\", nothing to apologize for", await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint({ source: "unavailable", reasons: [], meta: { reasonsOff: true, paidCallMade: false } }).fetchImpl, announce: (m) => saidW.push(m) }), "off");
  check("…no failure message", saidW.length === 0);
  check("…and not asked again this visit", (await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint().fetchImpl })) === "cached");
  forgetAllReasons();
  const saidF = [];
  eq("a fallback answer (failed checks) is a failure", await loadReasons(w, P_MYTH.id, ref(RE7), { title: "Resident Evil 7", fetchImpl: fakeEndpoint({ source: "fallback", reasons: [], meta: { paidCallMade: true } }).fetchImpl, announce: (m) => saidF.push(m) }), "failed");
  eq("…announced plainly", saidF.at(-1), "Tastemake couldn’t suggest reasons for “Resident Evil 7”. You can still say it in your own words.");
  forgetAllReasons();
  eq("a network failure is a failure", await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint(undefined, { fail: true }).fetchImpl }), "failed");
  eq("an error status is a failure", await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint(undefined, { ok: false }).fetchImpl }), "failed");
  const retry = fakeEndpoint();
  check("after a failure, marking it again asks again", (await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: retry.fetchImpl })) === "ready" && retry.calls.length === 1);
  forgetAllReasons();
  const many = fakeEndpoint({ source: "model", reasons: [...LABELS, "Fourth, not shown"], meta: {} });
  await loadReasons(w, P_MYTH.id, ref(RE7), { fetchImpl: many.fetchImpl });
  eq("never more than three reasons", reasonsEntry(w, P_MYTH.id, ref(RE7)).reasons.length, 3);
  const nf = profile();
  eq("no call for a title that isn't marked", await loadReasons(nf, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint().fetchImpl }), "not-flagged");
  eq("a saved reason that isn't loaded still shows, so it can be cleared", reasonOptions({ reasons: ["Mine, not theirs"] }, null).join(), "Mine, not theirs");
}

// ---- 3. The Taste Profile rows ---------------------------------------------------------------------------------
{
  const { renderProfile, openPattern, resetDisclosure, setPartlyFraming, DIFFERENT_SIDE_TEXT, REASONS_INTRO_TEXT, REASONS_LOADING_TEXT, REASONS_FAILED_TEXT } = profileScreen;
  const show = (s) => {
    Object.assign(state, s, { screen: "model", profileView: "full", onboarded: true });
    resetDisclosure();
    openPattern(P_MYTH.id);
    setPartlyFraming(P_MYTH.id, "titles");
    return renderProfile();
  };
  forgetAllReasons();
  const s = profile();
  let html = show(s);
  check("each cited title offers “Fits a different side of my taste”", html.includes(`data-partly-action="different" data-partly-ref="${ref(RE7)}"`) && html.includes("Fits a different side of my taste"));

  markDifferentSide(state, P_MYTH.id, ref(RE7));
  const held = fakeEndpoint(undefined, { hold: true });
  const pending = loadReasons(state, P_MYTH.id, ref(RE7), { fetchImpl: held.fetchImpl });
  html = renderProfile();
  check("while loading: the loading line and “Something else”", html.includes(REASONS_LOADING_TEXT) && html.includes("Something else? Say it in your own words") && !html.includes('data-partly-action="reason"'));
  held.release();
  await pending;
  html = renderProfile();
  const reasonButtons = html.match(/<button[^>]*data-partly-action="reason"[^>]*>[^<]*<\/button>/g) ?? [];
  eq("then three reason buttons", reasonButtons.length, 3);
  check("…real buttons with aria-pressed, none chosen yet", reasonButtons.every((b) => b.startsWith('<button type="button"') && b.includes('aria-pressed="false"')));
  check("…in a labelled group", html.includes('role="group" aria-label="What’s different about “Resident Evil 7”?"'));
  check("…above the “Something else” box, which stays", html.indexOf('data-partly-action="reason"') < html.indexOf("Something else? Say it in your own words"));
  check("the copy says it's saved for later and changes nothing yet", html.includes(REASONS_INTRO_TEXT) && /saved for a later step and changes nothing yet/.test(REASONS_INTRO_TEXT));
  check("…and never claims it affects picks or the pattern", !/will (change|update|affect)|improve/i.test(REASONS_INTRO_TEXT + DIFFERENT_SIDE_TEXT));
  check("no loading line once loaded", !html.includes(REASONS_LOADING_TEXT));

  chooseReason(state, P_MYTH.id, ref(RE7), LABELS[1]);
  html = renderProfile();
  const pressed = (html.match(/<button[^>]*data-partly-action="reason"[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/) ?? [])[1];
  eq("the chosen reason is pressed", pressed, LABELS[1]);
  check("…carrying the index the click handler reads", html.includes(`data-partly-action="reason" data-partly-ref="${ref(RE7)}" data-partly-value="1" aria-pressed="true"`));

  // Fallback: no reasons, a plain line, "Something else" still there.
  forgetAllReasons();
  const f = profile();
  markDifferentSide(f, P_MYTH.id, ref(RE7));
  html = show(f);
  await loadReasons(state, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint({ source: "unavailable", reasons: [], meta: {} }).fetchImpl });
  html = renderProfile();
  check("fallback: says so plainly, no reason buttons, “Something else” stays", html.includes(REASONS_FAILED_TEXT) && !html.includes('data-partly-action="reason"') && html.includes("Something else? Say it in your own words"));

  // Switch off and the Example Profile: "Something else" only, no extra line.
  forgetAllReasons();
  const o = profile();
  markDifferentSide(o, P_MYTH.id, ref(RE7));
  show(o);
  await loadReasons(state, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint({ source: "unavailable", reasons: [], meta: { reasonsOff: true } }).fetchImpl });
  html = renderProfile();
  check("server switch off: only “Something else”", !html.includes('data-partly-action="reason"') && !html.includes(REASONS_FAILED_TEXT) && !html.includes(REASONS_LOADING_TEXT) && html.includes("Something else? Say it in your own words"));
  forgetAllReasons();
  const ex = { ...profile(), viewingExample: true };
  markDifferentSide(ex, P_MYTH.id, ref(RE7));
  html = show(ex);
  await loadReasons(state, P_MYTH.id, ref(RE7), { fetchImpl: fakeEndpoint().fetchImpl });
  html = renderProfile();
  check("Example Profile: only “Something else”", !html.includes('data-partly-action="reason"') && !html.includes(REASONS_LOADING_TEXT) && html.includes("Something else? Say it in your own words"));
  state.viewingExample = false;
  resetDisclosure();
}

// ---- 4. The click handler is wired: reason buttons save through chooseReason, marking loads reasons ---------------
{
  const source = (await import("node:fs")).readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");
  check("app.js saves a tapped reason with chooseReason and announces it", /action === "reason"[\s\S]{0,400}chooseReason\(state, id, ref, label\)[\s\S]{0,200}announce\(message\)/.test(source));
  check("app.js loads reasons only after a title is marked different", /action === "different" && titleAnswer\(state, id, ref\)\?\.verdict === "different"[\s\S]{0,200}requestPartlyReasons/.test(source));
}

finish();
