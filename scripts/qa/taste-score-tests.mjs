#!/usr/bin/env node
// Oct 27: whole-profile recommendations. Every rating votes on which candidates are offered, Liked
// counts, reasons count, dislikes count against; prompt evidence is chosen per candidate; Liked items
// start searches; Surprise Me comes from a Liked item. Free: no network, no model.
//
//   node scripts/qa/taste-score-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("taste score tests");
const { chooseCandidates, closestRatings, featureRarity, isEdgeCandidate, tasteScore } = await import("../../src/ai/taste-score.js");
const { buildPickPrompt, offeredCandidates, selectPromptEvidence } = await import("../../api/recommendations.mjs");
const { weightedOrder, withEdgeAnchor } = await import("../../src/catalog/related.mjs");

let n = 0;
const rec = (kind, item, extra = {}) => {
  const weights = { "experienced-favorite": 3, "experienced-strong-positive": 2, "experienced-positive": 1.25, "experienced-negative": -2 };
  return {
    ref: `ev:${item.id}`, itemId: item.id, title: item.title, type: item.type, domains: item.domains,
    kind, class: "experienced", polarity: Math.sign(weights[kind]), weight: weights[kind],
    facts: { genres: item.genres ?? [], creator: item.by ?? null }, refinements: [], ...extra
  };
};
const movie = (title, genres, extra = {}) => ({ id: `tmdb-movie-${++n}`, provider: "tmdb", providerId: String(n), type: "movie", domains: ["movies"], title, genres, ...extra });
const tv = (title, genres, extra = {}) => ({ id: `tmdb-tv-${++n}`, provider: "tmdb", providerId: String(n), type: "tv", domains: ["tv"], title, genres, ...extra });
const game = (title, genres, extra = {}) => ({ id: `igdb-game-${++n}`, provider: "igdb", providerId: String(n), type: "game", domains: ["play"], title, genres, ...extra });

// ---- scoring ------------------------------------------------------------------------------------------
{
  const liked = movie("Liked Space Film", ["878", "12"]);
  const records = [rec("experienced-positive", liked)];
  const near = movie("Near The Liked One", ["878", "12"]);
  const far = movie("Unrelated Romcom", ["10749", "35"]);
  check("Liked counts: a match to something only Liked scores above zero", tasteScore(near, records) > 0);
  check("...and above an unrelated candidate", tasteScore(near, records) > tasteScore(far, records));

  const loved = movie("Loved Space Film", ["878", "12"]);
  eq("Loved counts more than Liked for the same match",
    tasteScore(near, [rec("experienced-strong-positive", loved)]) > tasteScore(near, records), true);

  const disliked = movie("Disliked Horror", ["27", "53"]);
  const scary = movie("Another Horror", ["27", "53"]);
  check("a close match to a dislike scores below zero", tasteScore(scary, [...records, rec("experienced-negative", disliked)]) < 0);

  const withReason = [rec("experienced-positive", liked, { refinements: [{ id: "pacing", label: "Pacing" }] })];
  check("a rating with reasons counts for more", tasteScore(near, withReason) > tasteScore(near, records));

  const creator = movie("Same Director", ["99"], { by: "Denis Villeneuve" });
  const lovedByCreator = movie("Arrival", ["878", "18"], { by: "Denis Villeneuve" });
  check("the same creator is a match on its own", tasteScore(creator, [rec("experienced-strong-positive", lovedByCreator)]) > 0);
}

// ---- rarity: a common label says less than a rare one ---------------------------------------------------
{
  const comedies = Array.from({ length: 8 }, (_, i) => tv(`Comedy ${i}`, ["35"]));
  const mystery = tv("Mystery Show", ["9648"]);
  const records = [...comedies.map((item) => rec("experienced-strong-positive", item)), rec("experienced-strong-positive", mystery)];
  const rarity = featureRarity(records);
  check("a label on most ratings is rarer-weighted lower than one on a single rating", rarity.get("g:35") < rarity.get("g:9648"), `${rarity.get("g:35")} vs ${rarity.get("g:9648")}`);
  // Against one rated show that has both labels, sharing its rare label is the closer match.
  const both = tv("Comedy Mystery", ["35", "9648"]);
  const one = [rec("experienced-strong-positive", both)];
  const viaCommon = closestRatings(tv("Sitcom", ["35", "10751"]), one, { rarity })[0]?.similarity ?? 0;
  const viaRare = closestRatings(tv("Mystery", ["9648", "10751"]), one, { rarity })[0]?.similarity ?? 0;
  check("so sharing the rare label makes a closer match than sharing the common one", viaRare > viaCommon, `${viaRare} vs ${viaCommon}`);
}

// ---- choosing the six -------------------------------------------------------------------------------
{
  const lovedHorrorGame = game("Resident Evil 2", ["Shooter", "Adventure"], { by: "Capcom" });
  const lovedComedy = tv("Nathan for You", ["35", "99"]);
  const likedSciFi = movie("Liked Sci-Fi", ["878", "53"]);
  const dislikedDrama = movie("Disliked Drama", ["18", "10749"]);
  const records = [
    rec("experienced-strong-positive", lovedHorrorGame), rec("experienced-strong-positive", lovedComedy),
    rec("experienced-positive", likedSciFi), rec("experienced-negative", dislikedDrama)
  ];
  const pool = [
    movie("Romance Drama", ["18", "10749"]),                        // like the dislike
    movie("Sci-Fi Thriller", ["878", "53"], { relatedToId: likedSciFi.id }),
    tv("Docu Comedy", ["35", "99"], { relatedToId: lovedComedy.id }),
    game("The Last of Us", ["Shooter", "Adventure"], { relatedToId: lovedHorrorGame.id }),
    game("The Last of Us Part II", ["Shooter", "Adventure"], { relatedToId: lovedHorrorGame.id }),
    game("Dead Rising", ["Shooter", "Adventure"]),
    movie("Space Thriller", ["878", "53"]),
    tv("Another Docu Comedy", ["35", "99"])
  ];
  const chosen = chooseCandidates(pool, records, { count: 6, mode: "all", curveball: false });
  const titles = chosen.map((i) => i.title);
  eq("six are offered", chosen.length, 6);
  check("the one most like a dislike is not offered while better fits remain", !titles.includes("Romance Drama"), titles.join(" | "));
  check("one title per franchise", !(titles.includes("The Last of Us") && titles.includes("The Last of Us Part II")), titles.join(" | "));
  check("All stays mixed across types", new Set(chosen.map((i) => i.type)).size >= 3, titles.join(" | "));
  check("each carries its score", chosen.every((i) => typeof i.tasteScore === "number"));

  const one = chooseCandidates(pool, records, { count: 3, mode: "movies" });
  check("a single-type filter takes the best in order", one[0].title !== "Romance Drama" && one.length === 3);

  // Surprise Me from the edges: the best candidate found from a Liked item takes the last place.
  check("a candidate found from a Liked item is an edge candidate", isEdgeCandidate(pool[1], records) && !isEdgeCandidate(pool[2], records));
  const withSurprise = chooseCandidates(pool, records, { count: 6, mode: "all", curveball: true });
  const last = withSurprise.at(-1);
  check("with Surprise Me on, the last place is the edge candidate, marked", last.title === "Sci-Fi Thriller" && last.edge === true, JSON.stringify(withSurprise.map((i) => [i.title, i.edge])));
  check("only one is marked", withSurprise.filter((i) => i.edge).length === 1);
  check("Surprise Me off: nothing marked", chooseCandidates(pool, records, { curveball: false }).every((i) => !i.edge));

  // Retrieval's order still counts: a first-found result isn't buried by a blunt genre match.
  const flat = [rec("experienced-strong-positive", tv("Loved Comedy", ["35"]))];
  const fused = chooseCandidates([tv("First Found", ["18"]), tv("Genre Match A", ["35"]), tv("Genre Match B", ["35"]), tv("Genre Match C", ["35"])], flat, { count: 2, mode: "tv" });
  check("the first-found result still makes the top two", fused.some((i) => i.title === "First Found"), fused.map((i) => i.title).join(" | "));
}

// ---- prompt evidence, per candidate -------------------------------------------------------------------
{
  const loved = Array.from({ length: 20 }, (_, i) => movie(`Loved Generic ${i}`, ["28"]));
  const likedMatch = movie("Liked Exact Match", ["9648", "878"]);
  const anchor = movie("The Anchor", ["53"]);
  const dislikeNear = movie("Disliked Mystery", ["9648"]);
  const dislikeFar = movie("Disliked Western", ["37"]);
  const evidence = [
    ...loved.map((item) => rec("experienced-strong-positive", item)),
    rec("experienced-positive", likedMatch), rec("experienced-strong-positive", anchor),
    rec("experienced-negative", dislikeFar), rec("experienced-negative", dislikeNear)
  ];
  const candidate = movie("Mystery Sci-Fi Candidate", ["9648", "878"], { relatedToId: anchor.id });
  const rows = selectPromptEvidence({ evidence, candidates: [candidate], evidenceRotation: 0 });
  const refs = rows.map((r) => r.ref);
  check("the item a candidate was found from is shown", refs.includes(`ev:${anchor.id}`));
  check("its closest rating is shown even when only Liked, among 20 Loved", refs.includes(`ev:${likedMatch.id}`));
  check("the dislike shown is the one most like the candidates", refs.includes(`ev:${dislikeNear.id}`) && !refs.includes(`ev:${dislikeFar.id}`), refs.join(","));
  eq("still capped at 18 rows", rows.length, 18);

  const later = selectPromptEvidence({ evidence, candidates: [candidate], evidenceRotation: 4 });
  check("the filler rotates between rounds", later.map((r) => r.ref).join() !== refs.join());

  const prompt = buildPickPrompt({ evidence, candidates: [{ ...candidate, edge: true }], curveball: true, statements: [], contexts: [] }, 1);
  check("the prompt marks the edge candidate and says what it means", prompt.includes('"edge":true') && prompt.includes("edge:true was found from something the user liked but did not love"));
  check("offeredCandidates is what production offers", typeof offeredCandidates === "function" && offeredCandidates({ candidates: [candidate], evidence, recommendationFilter: "all", curveball: false }).length === 1);
}

// ---- anchors: Liked items start searches too ------------------------------------------------------------
{
  const items = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `loved-${i}`, domains: ["movies"], anchorStrength: 3 })),
    { id: "liked-0", domains: ["movies"], anchorStrength: 1 }
  ];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let likedEarly = 0;
  for (let i = 0; i < 400; i++) if (weightedOrder(items, (x) => x.anchorStrength, random).slice(0, 2).some((x) => x.id === "liked-0")) likedEarly += 1;
  check("a Liked item gets drawn into the first places some of the time", likedEarly > 20 && likedEarly < 200, `${likedEarly} of 400`);

  const selected = items.slice(0, 5);
  const withEdge = withEdgeAnchor(selected, items);
  check("with no Liked anchor drawn, one is moved into the first wave", withEdge.slice(0, 4).some((x) => x.id === "liked-0"), withEdge.map((x) => x.id).join(","));
  eq("nothing is dropped", withEdge.length, selected.length + 1);
  const already = [items[6], ...items.slice(0, 4)];
  eq("left alone when the first wave already has one", withEdgeAnchor(already, items), already);
}

finish();
