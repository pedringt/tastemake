#!/usr/bin/env node
// #348 follow-up: when loading leaves saved data out, the original is kept aside before the next save
// overwrites it, a notice says so, and My Tastemake offers it until discarded. Clean data triggers none
// of it. Free, no network.
//
//   node scripts/qa/set-aside-tests.mjs

const data = new Map();
globalThis.localStorage = {
  getItem(key) { return data.get(key) ?? null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); }
};

const KEY = "tastemake:test-state:v1";
const ASIDE = "tastemake:set-aside:v1";
const { loadPersistedState, persistState, loadSetAsideData, readSetAsideCopy, discardSetAsideCopy } = await import("../../src/persistence.js");
const { setAsideNoticeHtml, setAsideBlock } = await import("../../src/components/set-aside.js");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("set aside tests");

const item = { id: "tmdb-movie-1", title: "Kept", type: "movie", domains: ["movies"], provider: "tmdb", providerId: "1" };
const good = { onboarded: true, displayName: "Tester", feedbackByRecommendation: { [item.id]: { item, rating: "more", detail: "loved-before" } } };
const save = (state) => data.set(KEY, JSON.stringify({ version: 1, state }));

// ---- 1. Clean data: nothing set aside, no notice -------------------------------------------------------
{
  data.clear();
  save(good);
  loadPersistedState();
  eq("clean data sets nothing aside", data.has(ASIDE), false);
  eq("...and asks for no notice", loadSetAsideData(), false);
  eq("...and My Tastemake shows no set-aside block", setAsideBlock(readSetAsideCopy()), "");
}

// ---- 2. A dropped entry: the original survives the next save -------------------------------------------
{
  data.clear();
  save({ ...good, feedbackByRecommendation: { ...good.feedbackByRecommendation, bad: { rating: "less" } } });
  const original = data.get(KEY);
  const loaded = loadPersistedState();
  eq("loading still leaves the bad entry out", Object.keys(loaded.feedbackByRecommendation).join(","), item.id);
  eq("the load asks for a notice", loadSetAsideData(), true);
  persistState({ ...loaded, selectedFavorites: new Set(), libraryFavorites: new Set(), blindSpotDismissed: new Set(), setupAreas: new Set(["all"]) });
  check("the next save overwrites the main key", data.get(KEY) !== original);
  const copy = readSetAsideCopy();
  eq("...but the original is kept aside, byte for byte", copy?.raw, original);
  check("...with what was left out", copy?.dropped?.includes("feedbackByRecommendation.bad"));

  // A later load of the cleaned data asks for no notice and keeps the copy.
  loadPersistedState();
  eq("the cleaned data loads with no new notice", loadSetAsideData(), false);
  eq("...and the copy is still there", readSetAsideCopy()?.raw, original);
}

// ---- 3. An existing copy is never replaced --------------------------------------------------------------
{
  const first = readSetAsideCopy().raw;
  save({ ...good, recommendationSets: "later damage" });
  loadPersistedState();
  eq("a second problem keeps the first copy", readSetAsideCopy().raw, first);
}

// ---- 4. Wholly unreadable saves are set aside too -------------------------------------------------------
{
  data.clear();
  data.set(KEY, "{not json");
  eq("unreadable JSON still loads as empty", Object.keys(loadPersistedState()).length, 0);
  eq("...and its text is kept aside", readSetAsideCopy()?.raw, "{not json");
  data.clear();
  data.set(KEY, JSON.stringify({ version: 99, state: good }));
  loadPersistedState();
  check("a save from an unknown version is kept aside", readSetAsideCopy()?.raw.includes('"version":99'));
  data.clear();
  loadPersistedState();
  eq("no saved data at all sets nothing aside", data.has(ASIDE), false);
}

// ---- 5. Notice and My Tastemake ---------------------------------------------------------------------------
{
  check("the notice shows when asked", setAsideNoticeHtml({ setAsideNotice: true, screen: "library" }).includes("data-open-mine"));
  eq("...not on My Tastemake itself", setAsideNoticeHtml({ setAsideNotice: true, screen: "mine" }), "");
  eq("...and not once it's answered", setAsideNoticeHtml({ setAsideNotice: false, screen: "library" }), "");
  const block = setAsideBlock({ raw: "x", dropped: ["a", "b"], setAsideAt: "2026-11-11T00:00:00Z" });
  check("My Tastemake offers Download it", block.includes('data-set-aside="download"'));
  check("...and a two-step Discard it", block.includes('data-set-aside="arm"') && setAsideBlock({ raw: "x" }, { armed: true }).includes('data-set-aside="confirm"'));
  check("...and says how much was left out", block.includes("(2 parts)"));

  data.set(ASIDE, JSON.stringify({ raw: "x" }));
  discardSetAsideCopy();
  eq("Discard removes the copy", readSetAsideCopy(), null);
}

finish();
