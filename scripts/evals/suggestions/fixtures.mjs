// #323 phase 1 suggestion eval (Nov 16): can the model write the suggested correction (renamed, narrowed or split
// pattern) from a person's Partly answers? Each case is a pattern, its titles, and what the person said: tapped
// words (and which titles they're about, Decision 5), and per-title verdicts ("doesnt-fit", or "different" with
// reasons). Facts come from Paige's Example Profile, via the reason eval's helpers. No model call here.
//
// Six cases replay the prototype (rounds 1–3), so `hand` holds the prototype's hand-written suggestion for the same
// answers; Paige rates those blind alongside the model's. Four are made up from other Example Profile patterns and
// have no hand-written version.

import { factsOf, findItem } from "../reasons/fixtures.mjs";

const full = (title) => (title === "The Office" ? "The Office" : findItem(title).title);

const COMEDY = {
  name: "Quirky character-driven comedy",
  claim: "Awkward, deadpan, character-driven humor, especially on TV.",
  titles: ["The Office", "Detroiters", "Nathan for You", "I Think You Should Leave", "The Rehearsal", "How To with John Wilson", "Tim and Eric"]
};
const MYTHIC = {
  name: "Mythic and fantastical worlds",
  claim: "Tends toward fantasy and mythic or uncanny settings, showing up in both books and games.",
  titles: ["Circe", "Piranesi", "The Song of Achilles", "Return of the Obra Dinn"]
};
const HORROR = {
  name: "Slow-burn supernatural horror series",
  claim: "Responds well to slow-burn, mystery-driven, supernatural horror series with an ambiguous, eerie tone.",
  titles: ["Midnight Mass", "The Haunting of Hill House", "Twin Peaks", "Yellowjackets", "The Leftovers"]
};
const without = (list, ...out) => list.filter((t) => !out.includes(t));

const RAW = [
  // Round 3, comedy trial 2 (Paige's answer). Prototype: the cringe-forward rewrite, The Office set aside.
  { id: "comedy-office", base: COMEDY,
    verdicts: { "The Office": { verdict: "different", reasons: ["Traditional sitcom format", "Warmer, less cringe"] } },
    hand: { patterns: [{ name: "Cringe-forward, deadpan comedy", claim: "Awkward, deadpan humor that leans into cringe more than warmth, mostly outside traditional sitcoms.", titles: without(COMEDY.titles, "The Office") }], setAside: ["The Office"] } },
  // Round 3, mythic trial (Paige's answer). Prototype: books-only literary fantasy, Obra Dinn set aside.
  { id: "mythic-obra-dinn", base: MYTHIC,
    verdicts: { "Return of the Obra Dinn": { verdict: "different", reasons: ["Grounded history, not myth"] } },
    hand: { patterns: [{ name: "Mythic and literary fantasy", claim: "Literary fantasy rooted in myth and strange, otherworldly settings, in books.", titles: without(MYTHIC.titles, "Return of the Obra Dinn") }], setAside: ["Return of the Obra Dinn"] } },
  // Round 3, horror trial (Paige's answer). Prototype: wording unchanged, The Leftovers set aside.
  { id: "horror-leftovers", base: HORROR,
    verdicts: { "The Leftovers": { verdict: "different", reasons: ["Grief drama, not horror"] } },
    hand: { patterns: [{ name: HORROR.name, claim: HORROR.claim, titles: without(HORROR.titles, "The Leftovers") }], setAside: ["The Leftovers"] } },
  // Made-up answer on the prototype's split path: two sitcoms flagged together. Prototype: a two-way split.
  { id: "comedy-sitcom-split", base: COMEDY, grouped: true,
    verdicts: { "The Office": { verdict: "different", reasons: ["Traditional sitcom format"] }, "Detroiters": { verdict: "different", reasons: ["Traditional sitcom format", "Warmer, more goofy"] } },
    hand: { patterns: [
      { name: "Awkward comedy in sketch and docu-style formats", claim: "Awkward, deadpan comedy drawn from real or heightened social discomfort, in sketch shows and docu-reality series.", titles: without(COMEDY.titles, "The Office", "Detroiters") },
      { name: "Character-driven sitcoms", claim: "Awkward sitcoms built on recurring characters and the way they play off each other.", titles: ["The Office", "Detroiters"] }
    ], setAside: [] } },
  // Made-up: the whole pattern is off on one word (round 1–2 path). Prototype: "horror" becomes "mystery".
  { id: "horror-word-all", base: HORROR, words: ["horror"], wordsAbout: "all",
    hand: { patterns: [{ name: "Slow-burn supernatural mystery series", claim: "Responds well to slow-burn, mystery-driven series with supernatural elements and an ambiguous, eerie tone.", titles: HORROR.titles }], setAside: [] } },
  // Made-up: a tapped word that's about one title only (Decision 5). Prototype's books-only path.
  { id: "mythic-word-games", base: MYTHIC, words: ["showing up in both books and games"], wordsAbout: ["Return of the Obra Dinn"],
    verdicts: { "Return of the Obra Dinn": { verdict: "different", reasons: [] , note: "It's a mystery puzzle game" } },
    hand: { patterns: [{ name: "Mythic and literary fantasy", claim: "Literary fantasy rooted in myth and strange, otherworldly settings, in books.", titles: without(MYTHIC.titles, "Return of the Obra Dinn") }], setAside: ["Return of the Obra Dinn"] } },

  // No hand-written version: Paige rates these on their own.
  // Two titles that don't fit (#318's complaint) plus one on a different side: narrow to the puzzle games.
  { id: "puzzle-games-narrow", base: { name: "Exploration-heavy games with puzzles", claim: "Favors games that combine atmospheric exploration with puzzle-solving over pure action.",
      titles: ["Resident Evil 7", "BioShock", "Silent Hill 2", "The Witness", "Portal 2"] },
    verdicts: { "Resident Evil 7": { verdict: "doesnt-fit" }, "BioShock": { verdict: "doesnt-fit" }, "Silent Hill 2": { verdict: "different", reasons: ["Survival horror, not a puzzle game"] } } },
  // A tapped word about some titles: the Mad Max films aren't fantasy.
  { id: "epic-word-some", base: { name: "Epic adventure on screen", claim: "Enjoys large-scale adventure and fantasy films, where the scope of the quest carries the story.",
      titles: ["Mad Max: Fury Road", "The Lord of the Rings", "Dune: Part Two", "Furiosa"] },
    words: ["fantasy"], wordsAbout: ["Mad Max: Fury Road", "Furiosa"],
    verdicts: { "Mad Max: Fury Road": { verdict: "different", reasons: ["Post-apocalyptic action, not fantasy"] }, "Furiosa": { verdict: "different", reasons: ["Post-apocalyptic action, not fantasy"] } }, grouped: true },
  // One title on a different side in a three-title pattern.
  { id: "mystery-tv-lost", base: { name: "Uncanny mystery on television", claim: "Responds to TV with mysterious, supernatural hooks and ensemble casts.",
      titles: ["Lost", "Widow's Bay", "Twin Peaks"] },
    verdicts: { "Lost": { verdict: "different", reasons: ["Survival adventure, not uncanny"], note: "I liked the castaway part more than the mystery" } } },
  // Two titles on different sides that don't go together: both set aside, not paired.
  { id: "horror-games-not-grouped", base: { name: "Atmosphere-driven horror in games", claim: "Responds strongly to games where mood and setting carry the experience, including survival horror and psychological horror.",
      titles: ["Resident Evil 7", "Silent Hill 2", "Alan Wake II", "Control"] },
    verdicts: { "Control": { verdict: "different", reasons: ["Weird action game, not horror"] }, "Alan Wake II": { verdict: "different", reasons: ["Story-driven thriller, not survival horror"] } }, grouped: false }
];

function normalize(raw) {
  const map = (t) => full(t);
  const verdicts = Object.fromEntries(Object.entries(raw.verdicts ?? {}).map(([t, v]) => [map(t), { reasons: [], ...v }]));
  return {
    id: raw.id,
    pattern: { name: raw.base.name, claim: raw.base.claim },
    titles: raw.base.titles.map(map),
    words: raw.words ?? [],
    wordsAbout: Array.isArray(raw.wordsAbout) ? raw.wordsAbout.map(map) : (raw.wordsAbout ?? null),
    verdicts,
    grouped: raw.grouped ?? null,
    hand: raw.hand ? { patterns: raw.hand.patterns.map((p) => ({ ...p, titles: p.titles.map(map) })), setAside: raw.hand.setAside.map(map) } : null
  };
}

export const CASES = RAW.map(normalize);

// What the model is given: the pattern, every title's facts (synopsis only for titles the person flagged or a
// tapped word is about), and the person's answers. `hand` never goes in.
export function caseContext(kase) {
  const flagged = new Set([...Object.keys(kase.verdicts), ...(Array.isArray(kase.wordsAbout) ? kase.wordsAbout : [])]);
  const answers = {};
  if (kase.words.length) answers.wrongWords = { words: kase.words, about: kase.wordsAbout === "all" ? "all of the titles" : kase.wordsAbout };
  const titleAnswers = Object.entries(kase.verdicts).map(([title, v]) => ({
    title,
    verdict: v.verdict === "doesnt-fit" ? "doesn't fit this description" : "fits a different side of my taste",
    ...(v.reasons?.length ? { reasons: v.reasons } : {}),
    ...(v.note ? { ownWords: v.note } : {})
  }));
  if (titleAnswers.length) answers.titles = titleAnswers;
  const different = Object.values(kase.verdicts).filter((v) => v.verdict === "different").length;
  if (different >= 2 && kase.grouped !== null) answers.differentTitlesGoTogether = kase.grouped;
  return {
    pattern: kase.pattern,
    titles: kase.titles.map((t) => factsOf(t, { about: flagged.has(t) })),
    answers
  };
}
