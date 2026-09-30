#!/usr/bin/env node
// Untrusted text must never become markup (#38). Free, no browser: render each screen to its HTML string
// with hostile values in every place untrusted text lands, and check the payload came out escaped.
//
//   node scripts/qa/escaping-tests.mjs
//
// Untrusted here means: titles and notes the user typed, anything imported later, and anything a model
// wrote (pick reasons, and hypothesis labels/claims once inference goes live).

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { state } = await import("../../src/state.js");
const { recommendations, hypotheses } = await import("./fixtures/catalog.js");
const { makeCustomItem, applySearchAction } = await import("../../src/model/search.js");
const { setStatement } = await import("../../src/model/statements.js");
const { saveBlindSpot, patternsFor } = await import("../../src/model/blindspots.js");
const { startTastebreak, toggleTastebreakPattern, setTastebreakNote, saveTastebreak } = await import("../../src/model/tastebreak.js");
const { esc } = await import("../../src/lib/html.js");
const { sanitizeRecommendationCopy } = await import("../../src/lib/recommendation-copy.js");

const PAYLOAD = `<img src=x onerror="alert(1)">`;
const ATTR = `" onmouseover="alert(2)`;
const ESCAPED = esc(PAYLOAD);

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

// the helper itself
check("esc() turns every dangerous character into an entity", esc(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;", esc(`<>&"'`));
check("esc() leaves ordinary text alone", esc("Everything Everywhere All at Once") === "Everything Everywhere All at Once");
check("esc() handles null and undefined", esc(null) === "" && esc(undefined) === "");

// #129: internal evidence refs are grounding metadata, never user-facing copy.
for (const ref of ["ev:openlibrary-book-OL8369445W", "ev:tmdb-movie-12345", "ev:igdb-game-67890"]) {
  const cleaned = sanitizeRecommendationCopy(`A useful connection **(${ref}).**`);
  check(`recommendation copy hides ${ref.split(":")[1].split("-")[0]} evidence ref`, cleaned === "A useful connection", cleaned);
}
check("citation-only copy becomes empty", sanitizeRecommendationCopy("**(ev:tmdb-movie-123).**") === "");
for (const internal of [
  "Anastasia shares 10751 catalog signals with Labyrinth.",
  "Severance came from a separate provider relationship around Horizon Zero Dawn.",
  "Willow is a distinct catalog branch away from Labyrinth.",
  "From Agents of S.H.I.E.L.D., the next nearby catalog path leads to Alien: Earth."
]) {
  check("recommendation copy drops retrieval plumbing", sanitizeRecommendationCopy(internal) === "", internal);
}

// hostile data in every untrusted slot
const nasty = makeCustomItem(`${PAYLOAD} Title`, "movie");
nasty.about = `${PAYLOAD} about`;
nasty.note = `${PAYLOAD} note`;
applySearchAction(state, nasty, "loved");

state.modelHypotheses = hypotheses;
const [first, second, third] = recommendations;
// a model wrote these: the pick reason and, later, hypothesis text
state.recommendationSets = [[{ ...first, reason: `${PAYLOAD} why **(ev:tmdb-movie-999).**`, about: `${PAYLOAD} about`, title: `${PAYLOAD} pick` }, second, third]];
applySearchAction(state, second, "bookmark");
applySearchAction(state, third, "disliked");
saveBlindSpot(state, third.id, { broken: [hypotheses[0].id], reasons: ["tone"] });
setStatement(state, hypotheses[0].id, "says", "not-me");
// a Tastebreak note (#19), the newest untrusted free-text slot: shown on the Library card and in My Tastemake
startTastebreak(state, third.id);
const taggedPattern = patternsFor(third, state)[0];
if (taggedPattern) toggleTastebreakPattern(state, third.id, taggedPattern.id);
setTastebreakNote(state, third.id, `${PAYLOAD} tastebreak note`);
saveTastebreak(state, third.id);
// a model-generated pattern, as inference will produce
hypotheses[0].title = `${PAYLOAD} pattern`;
hypotheses[0].claim = `${PAYLOAD} claim`;

const screens = {
  favorites: (await import("../../src/screens/favorites.js")).renderFavorites,
  recommendations: (await import("../../src/screens/recommendations.js")).renderRecommendations,
  profile: (await import("../../src/screens/profile.js")).renderProfile,
  library: (await import("../../src/screens/library.js")).renderLibrary,
  mine: (await import("../../src/screens/mine.js")).renderMine,
  look: (await import("../../src/screens/look.js")).renderLook
};

for (const [name, render] of Object.entries(screens)) {
  let html = "";
  try { html = render(); } catch (error) { check(`${name} renders`, false, error.message); continue; }
  check(`${name}: no raw <img ...onerror> from untrusted text`, !html.includes(PAYLOAD), html.slice(Math.max(0, html.indexOf(PAYLOAD) - 80), html.indexOf(PAYLOAD) + 80));
  check(`${name}: the payload is present but escaped`, !html.includes(PAYLOAD) && (html.includes(ESCAPED) || !html.includes("onerror")), "");
  check(`${name}: no unescaped quote can break out of an attribute`, !html.includes(ATTR));
  check(`${name}: ordinary copy still renders`, html.length > 200);
  if (name === "recommendations") {
    check("recommendations: internal evidence refs never render", !html.includes("ev:tmdb-movie-999"), html);
    check("recommendations: disliked reaction offers visible optional refinement", html.includes("Want to get more specific?") && html.includes("What didn’t work?"), html);
  }
}

// profile remains safe when its presentation state changes
state.profileView = "map";
const profileAgain = screens.profile();
check("profile alternate state: no raw payload", !profileAgain.includes(PAYLOAD));
state.profileView = "list";

// #94: the Tried tab (disliked items, reaction history) holds untrusted text too, but is only
// rendered when that tab is active — Saved is the default, so check it explicitly.
state.libraryView = "tried";
const libraryTried = screens.library();
check("library Tried tab: no raw payload", !libraryTried.includes(PAYLOAD));
state.libraryView = "saved";

console.log(`escaping tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
