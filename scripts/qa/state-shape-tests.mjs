#!/usr/bin/env node
// #348: saved or restored data with the wrong shape never blanks the app. Loading keeps what is usable,
// restoring refuses the file, and a screen that still throws shows a way out. Free, no network.
//
//   node scripts/qa/state-shape-tests.mjs

import { readFileSync } from "node:fs";

const data = new Map();
globalThis.localStorage = {
  getItem(key) { return data.get(key) ?? null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { checkStateShape } = await import("../../src/model/state-shape.js");
const { loadPersistedState } = await import("../../src/persistence.js");
const { parseBackupText } = await import("../../src/model/export.js");
const { state, restoreStateFromBackupText } = await import("../../src/state.js");
const { renderLibrary } = await import("../../src/screens/library.js");
const { renderProfile } = await import("../../src/screens/profile.js");
const { renderMine } = await import("../../src/screens/mine.js");
const { renderRecovery } = await import("../../src/components/recovery.js");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("state shape tests");

const item = (id, title = id) => ({ id, title, type: "movie", domains: ["movies"], provider: "tmdb", providerId: id.split("-").pop() });
const good = {
  onboarded: true,
  feedbackByRecommendation: { "tmdb-movie-1": { item: item("tmdb-movie-1", "Kept"), rating: "more", detail: "loved-before", refinements: [] } },
  recommendationSets: [[item("tmdb-movie-2")]],
  libraryFavorites: ["tmdb-movie-1"],
  areas: { movies: true, tv: true, read: true, play: true },
  displayName: "Tester"
};
const backupOf = (s) => JSON.stringify({ format: "tastemake-backup", version: 1, state: s });

// ---- 1. Good data passes untouched -----------------------------------------------------------------------
{
  eq("good data drops nothing", checkStateShape(good).dropped.length, 0);
  const example = JSON.parse(readFileSync(new URL("../../data/example-profile.json", import.meta.url), "utf8"));
  eq("the Example Profile backup drops nothing", checkStateShape(example.state).dropped.join(","), "");
  check("a good backup still restores", parseBackupText(backupOf(good)).feedbackByRecommendation["tmdb-movie-1"].item.title === "Kept");
}

// ---- 2. The QA case: whole fields with the wrong shape -------------------------------------------------
const broken = { ...good, feedbackByRecommendation: "oops", recommendationSets: { a: 1 }, areas: null, customItems: [1, 2], modelHypotheses: "x" };
{
  const { state: kept, dropped } = checkStateShape(broken);
  for (const field of ["feedbackByRecommendation", "recommendationSets", "areas", "customItems", "modelHypotheses"]) {
    check(`"${field}" with the wrong shape is dropped`, dropped.includes(field) && !(field in kept));
  }
  check("...and the usable fields stay", kept.displayName === "Tester" && kept.onboarded === true && kept.libraryFavorites[0] === "tmdb-movie-1");
}

// ---- 3. One bad entry: only that entry goes -----------------------------------------------------------
{
  const mixed = {
    ...good,
    feedbackByRecommendation: { ...good.feedbackByRecommendation, "tmdb-movie-9": { rating: "more", detail: "loved-before" } },
    recommendationSets: [[item("tmdb-movie-2"), { title: "no id" }], "not a set"],
    selectedFavorites: ["a", 7]
  };
  const { state: kept, dropped } = checkStateShape(mixed);
  check("a reaction without its item is dropped", dropped.includes("feedbackByRecommendation.tmdb-movie-9") && !kept.feedbackByRecommendation["tmdb-movie-9"]);
  check("...and the other reactions stay", Boolean(kept.feedbackByRecommendation["tmdb-movie-1"]));
  eq("a set keeps its usable picks", JSON.stringify(kept.recommendationSets.map((set) => set.map((i) => i.id))), '[["tmdb-movie-2"]]');
  eq("ids that aren't strings are dropped", JSON.stringify(kept.selectedFavorites), '["a"]');
}

// ---- 4. Loading data already broken in a browser recovers --------------------------------------------
{
  localStorage.setItem("tastemake:test-state:v1", JSON.stringify({ version: 1, state: broken }));
  const loaded = loadPersistedState();
  check("load leaves out the broken fields", !("feedbackByRecommendation" in loaded) && !("recommendationSets" in loaded));
  check("load keeps the rest", loaded.displayName === "Tester" && loaded.libraryFavorites instanceof Set && loaded.libraryFavorites.has("tmdb-movie-1"));
}

// ---- 5. Restoring a broken backup is refused, and current data is untouched ---------------------------
{
  restoreStateFromBackupText(backupOf(good));
  let message = "";
  try { restoreStateFromBackupText(backupOf(broken)); } catch (error) { message = error.message; }
  check("restore refuses a backup with unreadable data", /can't read/.test(message), message);
  check("...and the current data is unchanged", state.feedbackByRecommendation["tmdb-movie-1"]?.item.title === "Kept" && Array.isArray(state.recommendationSets));
  let entryMessage = "";
  try { restoreStateFromBackupText(backupOf({ ...good, feedbackByRecommendation: { x: { rating: "more" } } })); } catch (error) { entryMessage = error.message; }
  check("one reaction without its item is enough to refuse", /can't read/.test(entryMessage));
}

// ---- 6. Screens that used to crash render once the bad data is dropped --------------------------------
{
  restoreStateFromBackupText(backupOf(good));
  localStorage.setItem("tastemake:test-state:v1", JSON.stringify({ version: 1, state: { ...good, feedbackByRecommendation: { ...good.feedbackByRecommendation, bad: { rating: "less" } } } }));
  Object.assign(state, loadPersistedState());
  for (const [name, render] of [["Library", renderLibrary], ["Taste Profile", renderProfile], ["My Tastemake", renderMine]]) {
    let ok = true;
    try { render(); } catch { ok = false; }
    check(`${name} renders after a reaction without its item is dropped on load`, ok);
  }
}

// ---- 7. The recovery panel offers a way out ----------------------------------------------------------
{
  const html = renderRecovery({ resetArmed: false });
  check("recovery offers Download backup", html.includes('data-mine-export="backup"'));
  check("recovery offers Restore backup", html.includes("data-mine-restore-file"));
  check("recovery offers Start over (two steps)", html.includes('data-mine-reset="arm"') && renderRecovery({ resetArmed: true }).includes('data-mine-reset="confirm"'));
}

finish();
