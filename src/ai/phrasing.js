// Wording measures shared by the #28 stress eval (scripts/evals/stress/metrics.mjs) and the runtime why-line
// check (src/ai/why-lines.js), so "generic" and "repeats another pick" mean the same thing in both places.
// Moved here unchanged from metrics.mjs on Nov 14; metrics.mjs re-exports them. Pure functions, no network.

import { CIRCULAR_PATTERNS } from "./contract.js";

// ---- text normalisation ------------------------------------------------------------------------

// Small English stopword list; content words are what is left.
export const STOPWORDS = new Set(("a an the and or but if then so as of to in on at by for with from into onto about over under " +
  "this that these those it its it's is are was were be been being has have had do does did not no nor " +
  "you your you're you've yours i me my we our they them their he she his her who whom which what when where why how " +
  "than too very just more most less much many some any all each both either neither one two own same other such " +
  "can could will would should may might must shall also even still yet only again ever never here there " +
  "because since while though although whether through like well " +
  "s t ll ve re d m").split(/\s+/));

// Reaction and recommendation verbs say nothing about WHICH taste idea is used, so they are left out of
// theme terms (they still count for wording metrics).
export const REACTION_WORDS = new Set("love loved loves liked likes enjoy enjoyed enjoys disliked dislike tried try pick picks fit fits worth".split(" "));

const TITLE = "<title>";

function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Titles are masked before any wording metric, so "Because you loved X" and "Because you loved Y" count
// as the same template rather than as different sentences. Masked titles: the pick's own title and the
// titles of the evidence it cites.
export function maskTitles(text, titles = []) {
  let out = ` ${String(text ?? "")} `;
  const sorted = [...new Set(titles.filter((t) => t && t.trim().length >= 2))].sort((a, b) => b.length - a.length);
  for (const title of sorted) out = out.replace(new RegExp(`(^|[^\\w])${escapeRegex(title)}(?=[^\\w]|$)`, "gi"), `$1 ${TITLE} `);
  return out.trim();
}

export function tokens(text) {
  return String(text ?? "").toLowerCase()
    .replace(/<title>/g, " ttitlet ")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean)
    .map((t) => (t === "ttitlet" ? TITLE : t));
}

export const isContent = (t) => t !== TITLE && !STOPWORDS.has(t) && t.length >= 3 && !/^\d+$/.test(t);

export function ngrams(list, n) {
  const out = [];
  for (let i = 0; i + n <= list.length; i += 1) out.push(list.slice(i, i + n).join(" "));
  return out;
}

// ---- circular / generic phrasing ---------------------------------------------------------------

// A short, transparent list. Each hit counts once per explanation. The product's own CIRCULAR_PATTERNS
// (src/ai/contract.js) make kept picks impossible for those exact forms, so they are listed for
// completeness; the extra templates are softer generic phrases the validator does not block.
export const GENERIC_TEMPLATES = [
  ...CIRCULAR_PATTERNS.map((re, i) => ({ id: `product-circular-${i + 1}`, re })),
  { id: "you'll love/like/enjoy", re: /\byou(?:'ll| will) (?:love|like|enjoy|appreciate|adore)\b/i },
  { id: "right up your alley", re: /\bright up your alley\b/i },
  { id: "perfect for you / perfect fit", re: /\bperfect (?:for you|fit|match|pick)\b/i },
  { id: "great fit / good fit", re: /\b(?:great|good|natural|strong) (?:fit|match)\b/i },
  { id: "your kind of", re: /\byour kind of\b/i },
  { id: "you seem to like", re: /\byou seem to (?:like|love|enjoy|prefer)\b/i },
  { id: "since you liked/loved", re: /\b(?:since|because|as) you (?:liked|loved|enjoyed)\b/i },
  { id: "if you liked/loved", re: /\bif you (?:liked|loved|enjoyed)\b/i },
  { id: "fans of", re: /\bfans? of\b/i },
  { id: "similar to what you", re: /\bsimilar to (?:what|things|stuff) you\b/i },
  { id: "based on your (anything)", re: /\bbased on your\b/i },
  // Oct 20 (#28 comment): seen on a real books profile.
  { id: "third person (a ... reader)", re: /\b(?:a|the) (?:[\w'’-]+ ){0,4}reader(?: who)?\b/i },
  { id: "echoes / scope / sweeping", re: /\becho(?:es|ing)?\b|\bscope\b|\bsweeping\b/i }
];

// ---- genre-label vocabulary --------------------------------------------------------------------

// Genre and medium vocabulary. An explanation "collapses into genre labels" when at least half of its
// content words (titles masked and excluded) are genre or medium words. Reported as the share of
// collapsed explanations and the mean genre-word ratio.
export const GENRE_WORDS = new Set(("sci-fi scifi science fiction fantasy horror thriller thrillers mystery mysteries comedy comedies comedic " +
  "drama dramas dramatic romance romantic adventure adventures action animated animation documentary documentaries " +
  "crime historical history literary epic rpg rpgs role-playing puzzle puzzles strategy indie platformer shooter " +
  "simulation cozy narrative genre genres film films movie movies show shows series tv book books novel novels " +
  "game games fiction nonfiction memoir sitcom anime").split(/\s+/));

// ---- per-set repetition (Stage 0 of the #28 research report, Oct 20) ---------------------------

// Stock-word FAMILIES, so a swapped synonym still counts ("echo" -> "mirror" is the same habit). Matched
// on title-masked text. Kept small on purpose (#28 report: large ban/flag lists stop meaning anything).
export const STOCK_FAMILIES = [
  { id: "callback verb", re: /\b(?:echo(?:es|ed|ing)?|mirror(?:s|ed|ing)?|recall(?:s|ed|ing)?|resonat(?:e|es|ed|ing)|evok(?:e|es|ed|ing)|evocative|reminiscent)\b/i },
  { id: "scale word", re: /\b(?:sweeping|scope|sprawling)\b/i }
];

// "...you loved in <title>": the frame that replaced "you enjoyed in" once that was banned (1 -> 7 of 49).
export const FRAME = /\byou(?:'ve)? (?:loved|enjoyed|liked|praised|responded to|connected with|rewarded|appreciated|admired) in <title>/i;

// Thresholds for "a visitor would notice this set". Calibrated Oct 20 from reference-sets.json: 11 sets
// Paige would show as-is, one above their 95th percentile (scripts/evals/stress/calibrate.mjs). Her kept
// sets used a stock family in up to 2 explanations, so 2 alone is not a problem; they never repeated an
// opening. A set "would trigger" when any one is reached.
export const SET_GATE = {
  stockFamilyWhys: 3,   // the same stock family in 3+ explanations of one set
  frameWhys: 3,         // the "you loved in <title>" frame in 3+ explanations
  openingWhys: 2,       // 2+ explanations starting with the same two words
  sharedPhraseWhys: 3   // 3+ explanations sharing one 3-word phrase (with a content word)
};
