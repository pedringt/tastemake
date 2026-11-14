// Why-line check (Nov 14, queued after #261 and #334; behaviour decided by Paige on Nov 13). Runs on live AI
// picks AFTER validatePicks has accepted them. A pick is never dropped here: when its one-sentence "why" fails,
// software swaps in a plain line that names the cited item ("Because you liked Circe."), in the style of the
// catalog fallback's reasons (src/catalog/fallback-reasons.mjs). Pure functions, no network, no model.
//
// A line fails when:
//   generic         circular (CIRCULAR_PATTERNS), or fewer than MIN_SPECIFIC_WORDS words are left once titles,
//                   stopwords, reaction verbs, genre words and stock filler are taken out ("You'll love this if
//                   you loved Circe", "Another literary fantasy like Circe").
//   repeat          it would push the set over the stress eval's "would trigger a repetition check" gate
//                   (SET_GATE in src/ai/phrasing.js): the same two-word opening as an earlier line, a 3-word
//                   phrase already in 2 earlier lines, a stock-word family already in 2, or the
//                   "you loved in <title>" frame already in 2. The first lines are kept; later ones replaced.
//   no-cited-title  it names none of the items it cites by a recognisable form of the title: the full title,
//                   the part before a subtitle, a leading part of it ("Mistborn", "Everything"), or one of its
//                   distinctive words written with a capital ("Prada", "Malkovich", "Evangelion").

import { CIRCULAR_PATTERNS } from "./contract.js";
import { FRAME, GENRE_WORDS, REACTION_WORDS, SET_GATE, STOCK_FAMILIES, STOPWORDS, isContent, maskTitles, ngrams, tokens } from "./phrasing.js";
import { sanitizeRecommendationCopy } from "../lib/recommendation-copy.js";

export const WHY_FAILURES = ["generic", "repeat", "no-cited-title"];
export const MIN_SPECIFIC_WORDS = 2;

// Words that say nothing about WHAT links the pick to the cited item, on top of stopwords, reaction verbs and
// genre words. Kept short on purpose (#28 report: long flag lists stop meaning anything).
const FILLER_WORDS = new Set("taste tastes fit fits fitting match matches perfect great good alley kind similar fan fans based seem seems appreciate adore another tagged style vibe vibes choice".split(" "));

// ---- title forms ----------------------------------------------------------------------------------

const ARTICLE = /^(?:the|a|an)\s+/i;
const SERIES_PART = /^(?:book|volume|vol\.?|part|season|episode|chapter)\b/i;
const straight = (text) => String(text ?? "").replace(/[‘’]/g, "'");
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Mistborn: The Final Empire" -> ["Mistborn", "The Final Empire"]; "Shōgun (2024)" -> ["Shōgun"];
// "The Adventures of Sherlock Holmes [12 stories]" -> ["The Adventures of Sherlock Holmes", "12 stories"].
function segments(title) {
  return straight(title).trim()
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")
    .split(/\s*(?::|\s[-–—]\s|[([])\s*/)
    .map((part) => part.replace(/[)\]]\s*$/, "").trim())
    .filter(Boolean);
}

// The shortest form this module writes into a plain line: the title before any subtitle ("Terminator 2" for
// "Terminator 2: Judgment Day"). A longer main title is kept whole: cutting "Harry Potter and the
// Philosopher's Stone" to its first words can't be done safely without knowing the title.
export function shortTitle(title) {
  const [main] = segments(title);
  return main && main.length >= 2 ? main : String(title ?? "").trim();
}

// Forms of a title a reader would recognise. A one-word form must appear capitalised ("Arrival", not
// "arrival"), so a common word in a title doesn't count by accident. Archived Nov 13 stress sets named
// cited items by a later word ("Prada's power-world satire", "Roger Ackroyd's contained village") often
// enough that those count too: any word of 4+ letters that isn't a stopword.
export function titleForms(title) {
  const full = straight(title).trim();
  if (!full) return [];
  const forms = new Set([full]);
  segments(full).forEach((part, index) => {
    const bare = part.replace(ARTICLE, "");
    if (index === 0) {
      forms.add(part);
      const words = bare.split(/\s+/);
      for (let n = 1; n <= words.length; n += 1) {
        const lead = words.slice(0, n).join(" ");
        if (lead.length >= 4 || n === words.length) forms.add(lead);
      }
    } else if (bare.length >= 4 && !SERIES_PART.test(bare)) {
      forms.add(bare);
    }
    if (index === 0) for (const word of bare.split(/\s+/)) if (word.length >= 4 && !STOPWORDS.has(word.toLowerCase())) forms.add(word);
  });
  return [...forms].filter((form) => form.length >= 2);
}

export function namesTitle(why, title) {
  const text = straight(why);
  return titleForms(title).some((form) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(form)}(?![\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(re)) {
      if (form.includes(" ") || /[\p{Lu}\p{N}]/u.test(match[0][0])) return true;
    }
    return false;
  });
}

// Titles masked before the wording checks: the pick's own and each cited item's, full and short.
function maskList(item, cited) {
  return [item?.title, ...cited.map((record) => record.title)].filter(Boolean).flatMap((title) => [title, shortTitle(title)]);
}

// ---- the three checks ------------------------------------------------------------------------------

export function specificWords(why, titles = []) {
  return tokens(maskTitles(why, titles)).filter((t) => isContent(t) && !REACTION_WORDS.has(t) && !GENRE_WORDS.has(t) && !FILLER_WORDS.has(t));
}

export function isGeneric(why, titles = []) {
  return CIRCULAR_PATTERNS.some((re) => re.test(why)) || specificWords(why, titles).length < MIN_SPECIFIC_WORDS;
}

// The per-set features the stress eval's setRepetition counts, for one line (title-masked tokens).
function wording(masked) {
  const text = masked.join(" ");
  return {
    opening: masked.length >= 2 ? masked.slice(0, 2).join(" ") : null,
    phrases: new Set(ngrams(masked, 3).filter((g) => g.split(" ").some(isContent))),
    stock: STOCK_FAMILIES.filter((family) => family.re.test(text)).map((family) => family.id),
    frame: FRAME.test(text)
  };
}

function emptySet() {
  return { openings: new Map(), phrases: new Map(), stock: new Map(), frame: 0 };
}

const count = (map, key) => map.get(key) ?? 0;

// Would adding this line make the set reach a SET_GATE threshold?
function repeatsSet(line, set) {
  return (line.opening != null && count(set.openings, line.opening) + 1 >= SET_GATE.openingWhys)
    || [...line.phrases].some((g) => count(set.phrases, g) + 1 >= SET_GATE.sharedPhraseWhys)
    || line.stock.some((id) => count(set.stock, id) + 1 >= SET_GATE.stockFamilyWhys)
    || (line.frame && set.frame + 1 >= SET_GATE.frameWhys);
}

function addToSet(line, set) {
  if (line.opening != null) set.openings.set(line.opening, count(set.openings, line.opening) + 1);
  for (const g of line.phrases) set.phrases.set(g, count(set.phrases, g) + 1);
  for (const id of line.stock) set.stock.set(id, count(set.stock, id) + 1);
  if (line.frame) set.frame += 1;
}

// ---- the plain line --------------------------------------------------------------------------------

// Each opens with different words, so replaced lines don't repeat each other.
const PLAIN_LINES = [
  (title) => `Because you liked ${title}.`,
  (title) => `Picked with ${title} in mind.`,
  (title) => `Found through ${title}, which you liked.`,
  (title) => `Here because you liked ${title}.`,
  (title) => `Linked to ${title}, one you liked.`,
  (title) => `Suggested from ${title}, which you liked.`
];
// #252 part 2: a cross-medium test must still say it's a test (validatePicks requires it).
const BRIDGE_KIND = { book: "book", movie: "film", tv: "show", game: "game" };
const bridgeLine = (title, item) => `A ${BRIDGE_KIND[item?.type] ?? "cross-media"} test, found from ${title}.`;

// The cited item the plain line names: for a bridge pick, the item it was found from; otherwise a positive
// cited item the model's line already named, or the first positive cited item.
function plainSource(item, cited, why) {
  const positives = cited.filter((record) => record.polarity > 0 && record.title);
  if (item?.bridge && item.relatedToId) {
    const from = positives.find((record) => record.ref === `ev:${item.relatedToId}`);
    if (from) return from;
  }
  return positives.find((record) => why && namesTitle(why, record.title)) ?? positives[0] ?? null;
}

function plainLine(item, source, set, titles) {
  const title = shortTitle(source.title);
  const options = item?.bridge ? [bridgeLine(title, item)] : PLAIN_LINES.map((line) => line(title));
  const lines = options.map((why) => ({ why, line: wording(tokens(maskTitles(why, titles))) }));
  return lines.find(({ line }) => !repeatsSet(line, set)) ?? lines[0];
}

// `picks`: accepted picks ({ why, cites, item, ... }), in the order the model returned them.
// `evidence`: the evidence records the picks cite (ctx.evidence).
// Returns the same picks in the same order, failed lines replaced and marked with `whyReplaced: [reasons]`,
// plus counts for logging. Never returns pick text in the counts.
export function checkWhyLines(picks = [], evidence = []) {
  const byRef = new Map(evidence.map((record) => [record.ref, record]));
  const set = emptySet();
  const reasons = Object.fromEntries(WHY_FAILURES.map((reason) => [reason, 0]));
  let replaced = 0;
  const out = picks.map((pick) => {
    const cited = (pick.cites ?? []).map((ref) => byRef.get(ref)).filter(Boolean);
    const titles = maskList(pick.item, cited);
    const why = sanitizeRecommendationCopy(pick.why);
    const line = wording(tokens(maskTitles(why, titles)));
    const failed = [];
    if (!cited.some((record) => record.title && namesTitle(why, record.title))) failed.push("no-cited-title");
    if (why && isGeneric(why, titles)) failed.push("generic");
    if (!failed.length && repeatsSet(line, set)) failed.push("repeat");
    const source = failed.length ? plainSource(pick.item, cited, why) : null;
    if (!source) {
      addToSet(line, set);
      return pick;
    }
    const plain = plainLine(pick.item, source, set, titles);
    addToSet(plain.line, set);
    replaced += 1;
    for (const reason of failed) reasons[reason] += 1;
    return { ...pick, why: plain.why, whyReplaced: failed };
  });
  return { picks: out, checked: picks.length, replaced, reasons };
}
