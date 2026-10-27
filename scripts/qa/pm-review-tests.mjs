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
  check("the model is told to name a cited item in each reason", prompt.includes("naming at least one cited item by its title"));
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

finish();
