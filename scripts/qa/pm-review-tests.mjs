#!/usr/bin/env node
// Oct 27 PM review: grounded reasons on cards, a "More about why" that adds something, one name for
// Surprise Me, plain wording on My Tastemake, and Browse after setup. Free: no network, no model.
//
//   node scripts/qa/pm-review-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { readFileSync } from "node:fs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("pm review tests");
const { state, resetState } = await import("../../src/state.js");
const { groundingFor, reasonNamesSource, renderRecommendations } = await import("../../src/screens/recommendations.js");
const { renderMine } = await import("../../src/screens/mine.js");
const { renderBrowse } = await import("../../src/screens/browse.js");
const { buildPickPrompt } = await import("../../api/recommendations.mjs");

const godOfWar = { id: "igdb-game-19560", provider: "igdb", providerId: "19560", title: "God of War", type: "game", domains: ["play"] };
const hades = { id: "igdb-game-113112", provider: "igdb", providerId: "113112", title: "Hades", type: "game", domains: ["play"] };
const pick = (extra) => ({ id: "igdb-game-1020", provider: "igdb", providerId: "1020", title: "Red Dead Redemption 2", type: "game", domains: ["play"], year: "2018", ...extra });

function rated() {
  resetState();
  state.onboarded = true;
  state.feedbackByRecommendation[godOfWar.id] = { item: godOfWar, rating: "more", detail: "liked-before", refinements: [] };
  state.feedbackByRecommendation[hades.id] = { item: hades, rating: "more", detail: "loved-before", refinements: [] };
  state.libraryFavorites.add(hades.id);
}

// ---- grounding ------------------------------------------------------------------------------------
{
  rated();
  const item = pick({ reason: "A sprawling, character-led outlaw saga with story momentum.", relatedTo: "God of War", relatedToId: godOfWar.id, ai: { cites: [`ev:${hades.id}`] } });
  const sources = groundingFor(item);
  eq("a pick is grounded in what it cites and what it was found from", sources.map((s) => `${s.title}:${s.label}`).sort().join(","), "God of War:Liked,Hades:Favorite");

  state.recommendationSets = [[item]];
  let html = renderRecommendations();
  check("a reason that names nothing gets a 'Based on' line", html.includes('class="editorial-grounding">Based on') && html.includes("God of War (liked)") && html.includes("Hades (favorite)"));
  check("More about why says what it was found from", html.includes("<strong>Found from:</strong> God of War (liked)"));
  check("...and no longer repeats the card's reason word for word", !html.includes("<strong>Why this might work:</strong>"));

  state.recommendationSets = [[{ ...item, reason: "Its mythic journey echoes Hades' character-driven storytelling." }]];
  html = renderRecommendations();
  check("a reason that already names a rated item gets no extra line", !html.includes('class="editorial-grounding"'));

  check("a short form of a title counts as naming it", reasonNamesSource("shares Everything's playful energy", [{ title: "Everything Everywhere All at Once" }]));
  check("a word that only appears inside a title doesn't", !reasonNamesSource("a grim war story", [{ title: "God of War" }]));

  const prompt = buildPickPrompt({ evidence: [], candidates: [], curveball: false, statements: [], contexts: [] }, 6);
  check("the model is told to name a cited item in each reason", prompt.includes("naming at least one cited item by the shortest form of its title"));
}

// ---- Surprise Me: one name ------------------------------------------------------------------------------
{
  rated();
  const surprise = pick({ surprise: true, reason: "Skyrim's open world.", relatedTo: "God of War", relatedToId: godOfWar.id, ai: { kind: "curveball", cites: [] } });
  state.recommendationSets = [[surprise]];
  const html = renderRecommendations();
  check("the sticker says Surprise Me", html.includes("SURPRISE<br />ME") && !html.includes("WEIRD"));
  check("the popover calls it Surprise Me too", html.includes('<span class="why-kicker">Surprise Me</span>'));
  check("and says it tests the edges when it came from a Liked item", html.includes("liked but didn"));
  const mine = renderMine();
  check("the setting uses the same name", mine.includes("Include a Surprise Me pick") && !/curveball/i.test(mine.replace(/<[^>]+>/g, "")));
}

// ---- My Tastemake: plain words -----------------------------------------------------------------------------
{
  rated();
  const mine = renderMine();
  check("the counts are in plain words", mine.includes("shaping your taste") && !mine.includes("taste evidence</span>") && !mine.includes("intent signals"));
  const cards = readFileSync(new URL("../../src/screens/recommendations.js", import.meta.url), "utf8");
  check("'Don't recommend' says where to undo it", cards.includes("Undo it anytime in My Tastemake (the person icon at the top)."));
}

// ---- Browse after setup -----------------------------------------------------------------------------------
{
  rated();
  const film = { id: "tmdb-movie-157336", provider: "tmdb", providerId: "157336", title: "Interstellar", type: "movie", domains: ["movies"], genres: ["878"] };
  state.browseItems = [film];
  for (let i = 0; i < 4; i++) state.feedbackByRecommendation[`tmdb-movie-9${i}`] = { item: { ...film, id: `tmdb-movie-9${i}` }, rating: "more", detail: "loved-before", refinements: [] };
  check("after setup, Browse doesn't show the setup-only 'enough to start' banner", !renderBrowse().includes("You've given Tastemake enough to start."));
  resetState();
  state.browseItems = [film];
  ["a", "b", "c", "d"].forEach((id) => state.selectedFavorites.add(id));
  check("...which still shows during setup", renderBrowse().includes("You've given Tastemake enough to start."));

  const app = readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");
  const handler = app.slice(app.indexOf('closest("[data-rec-favorite]")'));
  check("starring in Browse counts toward 'rated this visit', before the re-render",
    handler.indexOf("browseRatedThisVisit.push") > 0 && handler.indexOf("browseRatedThisVisit.push") < handler.indexOf("renderPreservingCardPosition"));
}

// ---- Oct 27 smoke test follow-ups ----------------------------------------------------------------------------
{
  const { isOffTopicBook } = await import("../../src/catalog/search-ranking.mjs");
  const { isBookCompanion } = await import("../../src/catalog/book-companions.mjs");
  const { searchCatalog } = await import("../../src/catalog/providers.mjs");
  // Open Library's real answer for "Project Hail Mary" on Oct 27 (titles and authors only).
  const docs = [
    { key: "/works/OL21745884W", title: "Project Hail Mary", author_name: ["Andy Weir"] },
    { key: "/works/OL36735881W", title: "The Martian / Artemis / Project Hail Mary", author_name: ["Andy Weir"] },
    { key: "/works/OL25960717W", title: "SUMMARY and REVIEW : PROJECT HAIL MARY", author_name: ["Unique Summary"] },
    { key: "/works/OL1W", title: "Summary of Andy Weir's Project Hail Mary", author_name: ["Irb Media"] },
    { key: "/works/OL7166017M", title: "Blake Estate oral history project" },
    { key: "/works/OL259509W", title: "La dame aux camélias [novel]", author_name: ["Alexandre Dumas fils"] },
    { key: "/works/OL2W", title: "Frankenstein", author_name: ["Mary Shelley"] }
  ];
  const fetchImpl = async (url) => {
    if (String(url).includes("openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs }) };
    throw new Error(`unexpected ${url}`);
  };
  const titles = (await searchCatalog("Project Hail Mary", { domain: "read", env: {}, fetchImpl })).items.map((i) => i.title);
  check("book search keeps the real book and its collection", titles.includes("Project Hail Mary") && titles.includes("The Martian / Artemis / Project Hail Mary"), titles.join(" | "));
  check("...and drops 'Summary and Review' and other summaries", !titles.some((t) => /summary/i.test(t)), titles.join(" | "));
  check("...and books that match neither title nor author", !titles.some((t) => /Blake Estate|camélias|Frankenstein/.test(t)), titles.join(" | "));

  check("a search for an author still finds their books", !isOffTopicBook("The Martian", ["Andy Weir"], "andy weir"));
  check("a search for a series still finds its books", !isOffTopicBook("The Way of Kings", ["Brandon Sanderson"], "stormlight archive", ["The Stormlight Archive"]));
  check("a shared first name isn't an author match", isOffTopicBook("Frankenstein", ["Mary Shelley"], "Project Hail Mary"));
  check("asking for a summary still finds one", !isBookCompanion({ title: "SUMMARY and REVIEW : PROJECT HAIL MARY" }, "project hail mary summary"));

  const prompt = buildPickPrompt({ evidence: [], candidates: [], curveball: false, statements: [], contexts: [] }, 6);
  check("reasons stay at 14 words with the title counted, using a short form of long titles", prompt.includes("14 words or fewer counting the title") && prompt.includes("'Everything' for Everything Everywhere All at Once"));

  rated();
  const mine = renderMine();
  check("My Tastemake's setup note is in plain words", mine.includes("They don’t change your Taste Profile.") && !/taste evidence/.test(mine.replace(/<[^>]+>/g, "")));
}

// ---- Oct 27 smoke test after #301: series searches -----------------------------------------------------------
{
  const { searchCatalog } = await import("../../src/catalog/providers.mjs");
  // Open Library's real answer for "stormlight archive" on Oct 27: no series_name on any row.
  const sanderson = ["Brandon Sanderson"];
  const docs = ["Edgedancer", "Words of Radiance", "The Way of Kings", "Oathbringer", "Dawnshard", "Rhythm of War", "The Stormlight Archive", "Wind and Truth"]
    .map((title, i) => ({ key: `/works/OL${i + 100}W`, title, author_name: sanderson }))
    .concat({ key: "/works/OL999W", title: "Blake Estate oral history project" });
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ docs }) });
  const titles = (await searchCatalog("stormlight archive", { domain: "read", env: {}, fetchImpl })).items.map((i) => i.title);
  check("a series search keeps the series' books by the same author as the matching result", ["The Way of Kings", "Words of Radiance", "Oathbringer"].every((t) => titles.includes(t)), titles.join(" | "));
  check("...and still drops an unrelated book with no shared author", !titles.includes("Blake Estate oral history project"), titles.join(" | "));

  // A study guide's author never vouches for anything: companions are dropped first.
  const guideDocs = [
    { key: "/works/OL1W", title: "Project Hail Mary", author_name: ["Andy Weir"] },
    { key: "/works/OL2W", title: "Summary of Project Hail Mary", author_name: ["Irb Media"] },
    { key: "/works/OL3W", title: "Irb Media Cookbook", author_name: ["Irb Media"] }
  ];
  const guideTitles = (await searchCatalog("Project Hail Mary", { domain: "read", env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ docs: guideDocs }) }) })).items.map((i) => i.title);
  check("a summary publisher's other books don't ride along", !guideTitles.includes("Irb Media Cookbook"), guideTitles.join(" | "));

  const prompt = buildPickPrompt({ evidence: [], candidates: [], curveball: false, statements: [], contexts: [] }, 6);
  check("the model is told not to open a reason with the pick's own title", prompt.includes("don't start the why with the pick's own title"));
}

finish();
