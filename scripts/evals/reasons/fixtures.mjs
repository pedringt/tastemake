// #323 reason-generation eval (Nov 15): can the model write "What's different about it?" options as good as
// the prototype's hand-written ones? Each case is a Taste Profile pattern, the titles it cites, and one title
// the person says "fits a different side of my taste". Titles and facts come from Paige's Example Profile
// (data/example-profile.json), so the model sees what production would have.
//
// Gold cases are the three round-3 prototype trials, with the reasons Paige actually picked (`gold`). The other
// cases have no gold: Paige judges them blind. No model call here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TMDB_GENRES } from "../../../src/catalog/synopsis.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(readFileSync(join(here, "../../../data/example-profile.json"), "utf8"));
const exampleState = example.state ?? example;
const items = Object.values(exampleState.feedbackByRecommendation ?? {}).map((entry) => entry.item).filter(Boolean);

const MEDIUM = { movie: "film", tv: "TV series", book: "book", game: "game" };

// Readable genres: TMDb ids become names; book subjects keep only plain words (no "nyt:…" or "form:…" tags).
export function readableGenres(item) {
  const out = [];
  for (const raw of item?.genres ?? []) {
    const value = /^\d+$/.test(String(raw)) ? TMDB_GENRES[Number(raw)] : String(raw);
    if (!value || /[:=()]/.test(value) || value.length > 30) continue;
    if (!out.some((g) => g.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out.slice(0, 6);
}

export function findItem(title) {
  const item = items.find((entry) => entry.title === title) ?? items.find((entry) => entry.title?.startsWith(title));
  if (!item) throw new Error(`fixture title not in the Example Profile: ${title}`);
  return item;
}

export function factsOf(title, { about = true } = {}) {
  const item = findItem(title);
  return {
    title: item.title,
    medium: MEDIUM[item.type] ?? item.type ?? "title",
    year: item.year ?? null,
    genres: readableGenres(item),
    ...(about ? { about: String(item.about ?? "").slice(0, 280) || null } : {})
  };
}

// The prototype's three cases, with Paige's round-3 picks as gold (labels as the prototype showed them).
const GOLD = [
  {
    id: "comedy-office",
    pattern: { name: "Quirky character-driven comedy", claim: "Awkward, deadpan, character-driven humor, especially on TV." },
    flagged: "The Office",
    others: ["Detroiters", "Nathan for You", "I Think You Should Leave", "The Rehearsal", "How To with John Wilson", "Tim and Eric"],
    gold: ["Traditional sitcom format", "Warmer, less cringe"]
  },
  {
    id: "mythic-obra-dinn",
    pattern: { name: "Mythic and fantastical worlds", claim: "Tends toward fantasy and mythic or uncanny settings, showing up in both books and games." },
    flagged: "Return of the Obra Dinn",
    others: ["Circe", "Piranesi", "The Song of Achilles"],
    gold: ["Grounded history, not myth"]
  },
  {
    id: "horror-leftovers",
    pattern: { name: "Slow-burn supernatural horror series", claim: "Responds well to slow-burn, mystery-driven, supernatural horror series with an ambiguous, eerie tone." },
    flagged: "The Leftovers",
    others: ["Midnight Mass", "The Haunting of Hill House", "Twin Peaks", "Yellowjackets"],
    gold: ["Grief drama, not horror"]
  }
];

// One case from each other Example Profile pattern: a cited title that plausibly belongs for another reason.
// No gold; these test whether the options are believable beyond the three cases the prototype was written for.
const BLIND = [
  ["games-re7", "Exploration-heavy games with puzzles", "Resident Evil 7: Biohazard"],
  ["horror-games-control", "Atmosphere-driven horror in games", "Control"],
  ["uncanny-screen-get-out", "Uncanny slow-burn horror on screen", "Get Out"],
  ["epic-dune", "Epic adventure on screen", "Dune: Part Two"],
  ["mystery-tv-widows-bay", "Uncanny mystery on television", "Widow's Bay"],
  ["comedy-john-wilson", "Quirky character-driven comedy", "How To with John Wilson"],
  ["games-portal", "Exploration-heavy games with puzzles", "Portal 2"]
];

function blindCase([id, patternTitle, flagged]) {
  const pattern = (exampleState.modelHypotheses ?? []).find((h) => h.title === patternTitle);
  if (!pattern) throw new Error(`fixture pattern not in the Example Profile: ${patternTitle}`);
  const byId = new Map(items.map((item) => [`ev:${item.id}`, item.title]));
  const others = (pattern.supports ?? []).map((ref) => byId.get(ref)).filter((title) => title && !title.startsWith(flagged));
  return { id, pattern: { name: pattern.title, claim: pattern.claim }, flagged, others, gold: null };
}

export const CASES = [...GOLD, ...BLIND.map(blindCase)];

// What the model is given for one case: the pattern, the flagged title's facts, and the other titles briefly.
export function caseContext(kase) {
  return {
    pattern: kase.pattern,
    flagged: factsOf(kase.flagged),
    others: kase.others.map((title) => factsOf(title, { about: false }))
  };
}
