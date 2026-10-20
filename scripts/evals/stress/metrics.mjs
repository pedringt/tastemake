// #28 stress eval: deterministic metrics over recorded recommendation explanations. Pure functions, no
// network, no model. These are MEASUREMENTS, not pass/fail gates: nothing here decides whether a run is
// good enough. Where #28 needs judgment ("genuinely relevant", "new distinctions", "why two similar
// items got different reactions") the report lists it as needing human review and exports a sample.
//
// Input: pick records written by run-stress.mjs, one per accepted pick:
//   { model, profile, shape, size, round, itemId, title, domains, genres, why, cites,
//     citedEvidence: [{ ref, title, kind, domains, genres, recency }], profileFacts: { triedDomains, ... } }
// "why" is the sentence a visitor reads (production's sanitized reason).
//
// Every metric's definition is written next to its code and repeated in the report (DEFINITIONS below).

import { CIRCULAR_PATTERNS } from "../../../src/ai/contract.js";
import { TMDB_GENRES } from "../../../src/catalog/synopsis.mjs";

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

export function maskedTokens(pick) {
  return tokens(maskTitles(pick.why, [pick.title, ...(pick.citedEvidence ?? []).map((e) => e.title)]));
}

const share = (n, d) => (d ? n / d : null);
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---- 1. repeated wording --------------------------------------------------------------------------

// distinct-n: unique n-grams / all n-grams over every explanation in the group (masked tokens).
// 1.0 = no n-gram ever repeats; lower = more reuse. Reported for n = 2 and 3.
export function distinctN(picks, n) {
  const all = picks.flatMap((p) => ngrams(maskedTokens(p), n));
  return round3(share(new Set(all).size, all.length));
}

// Long n-gram sharing: share of explanations that contain at least one n-gram (n = 4 and 5, masked
// tokens) that also appears in a DIFFERENT explanation in the group. An n-gram made only of stopwords and
// title placeholders does not count (e.g. "of <title> and the").
export function longNgramShare(picks, n) {
  const owners = new Map();
  const perPick = picks.map((p, index) => {
    const grams = new Set(ngrams(maskedTokens(p), n).filter((g) => g.split(" ").some(isContent)));
    for (const g of grams) { if (!owners.has(g)) owners.set(g, new Set()); owners.get(g).add(index); }
    return grams;
  });
  const shared = perPick.filter((grams) => [...grams].some((g) => owners.get(g).size > 1)).length;
  return round3(share(shared, picks.length));
}

// Most-repeated phrases: 3- to 5-grams (masked, at least one content word) ranked by how many distinct
// explanations contain them; only phrases in 2+ explanations are listed. Sub-phrases of a listed longer
// phrase with the same count are dropped so the list is not padded with fragments.
export function topPhrases(picks, limit = 10) {
  const counts = new Map();
  for (const p of picks) {
    const t = maskedTokens(p);
    const grams = new Set([3, 4, 5].flatMap((n) => ngrams(t, n)).filter((g) => g.split(" ").some(isContent)));
    for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]));
  const out = [];
  for (const [phrase, count] of ranked) {
    if (out.some((o) => o.count === count && o.phrase.includes(phrase))) continue;
    out.push({ phrase, count, share: round3(count / picks.length) });
    if (out.length >= limit) break;
  }
  return out;
}

// Repeated openings: share of explanations whose first three masked tokens equal another explanation's
// first three (the pick prompt explicitly asks the model not to repeat an opening phrase).
export function repeatedOpeningShare(picks) {
  const openings = picks.map((p) => maskedTokens(p).slice(0, 3).join(" "));
  const counts = openings.reduce((m, o) => m.set(o, (m.get(o) ?? 0) + 1), new Map());
  return round3(share(openings.filter((o) => o && counts.get(o) > 1).length, picks.length));
}

// ---- 2. pattern overuse ---------------------------------------------------------------------------

// Lexical proxy (always available): "theme terms" are content words and adjacent content-word pairs
// (after removing stopwords and titles). Terms are ranked by how many explanations use them; the metric
// is the share of explanations that use at least one of the top 3 / top 5 terms. A high share means a few
// ideas carry most explanations. It is a proxy: it cannot tell two different ideas that share a word.
export function themeTerms(pick) {
  const content = maskedTokens(pick).filter((t) => isContent(t) && !REACTION_WORDS.has(t));
  return new Set([...content, ...ngrams(content, 2)]);
}

export function themeConcentration(picks, ks = [3, 5]) {
  const counts = new Map();
  const perPick = picks.map((p) => { const t = themeTerms(p); for (const term of t) counts.set(term, (counts.get(term) ?? 0) + 1); return t; });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = { top: ranked.slice(0, Math.max(...ks)).map(([term, count]) => ({ term, count, share: round3(count / picks.length) })) };
  for (const k of ks) {
    const top = new Set(ranked.slice(0, k).map(([t]) => t));
    out[`top${k}Share`] = round3(share(perPick.filter((t) => [...t].some((x) => top.has(x))).length, picks.length));
  }
  return out;
}

// Pattern-based (only when the run also produced a taste profile for that profile): a pick "uses"
// a pattern when one of its cited evidence refs is among that pattern's supporting evidence. Patterns
// are ranked by how many picks use them; the metric is the share of picks that use one of the top 3 /
// top 5 patterns, plus how many of the available patterns were used at all.
export function patternConcentration(picks, patternsByProfile, ks = [3, 5]) {
  const usable = picks.filter((p) => patternsByProfile[p.profileKey ?? p.profile]?.length);
  if (!usable.length) return null;
  const perPick = usable.map((p) => {
    const patterns = patternsByProfile[p.profileKey ?? p.profile];
    const cites = new Set(p.cites ?? []);
    return { key: p.profileKey ?? p.profile, used: patterns.filter((h) => (h.evidence ?? []).some((ref) => cites.has(ref))).map((h) => h.label) };
  });
  const counts = new Map();
  for (const x of perPick) for (const label of x.used) counts.set(`${x.key}::${label}`, (counts.get(`${x.key}::${label}`) ?? 0) + 1);
  const out = { picks: usable.length, noPatternShare: round3(share(perPick.filter((x) => !x.used.length).length, usable.length)) };
  // Rank within each profile (patterns are per profile), then pool the per-profile shares.
  for (const k of ks) {
    let hit = 0;
    for (const key of new Set(perPick.map((x) => x.key))) {
      const ranked = [...counts.entries()].filter(([name]) => name.startsWith(`${key}::`)).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name]) => name.slice(key.length + 2));
      hit += perPick.filter((x) => x.key === key && x.used.some((l) => ranked.includes(l))).length;
    }
    out[`top${k}Share`] = round3(hit / usable.length);
  }
  const available = Object.entries(patternsByProfile).filter(([key]) => perPick.some((x) => x.key === key)).reduce((sum, [, list]) => sum + list.length, 0);
  out.patternsAvailable = available;
  out.patternsUsed = counts.size;
  return out;
}

// ---- 3. traceability ------------------------------------------------------------------------------

// Genre keys: a small, transparent vocabulary that provider genre strings are mapped onto, so a TMDb id
// ("878"), an Open Library subject ("Fiction, fantasy, epic") and an IGDB genre ("Role-playing (RPG)")
// can be compared. A genre string can map to several keys; strings matching no key are ignored.
export const GENRE_KEYS = {
  "sci-fi": /\bsci-?fi\b|science.?fiction/i, fantasy: /fantas/i, horror: /horror|ghost|vampire|zombie/i,
  mystery: /myster|detective|whodunit/i, thriller: /thriller|suspense/i, crime: /\bcrime|gangster|heist/i,
  comedy: /comed|humou?r|satire|sitcom/i, drama: /\bdrama/i, romance: /romanc|love stor/i,
  adventure: /adventure/i, action: /\baction\b/i, animation: /animat/i, documentary: /documentar|biograph|memoir/i,
  historical: /histor|\bwar\b/i, family: /family|kids|children|juvenile/i, literary: /literary|literature/i,
  rpg: /role-?playing|\brpg\b/i, puzzle: /puzzle/i, strategy: /strateg|tactic/i, indie: /\bindie\b/i,
  platform: /platform/i, shooter: /shooter/i, simulation: /simulat/i
};

export function genreKeys(genres = []) {
  const keys = new Set();
  for (const raw of genres) {
    const value = /^\d+$/.test(String(raw)) ? (TMDB_GENRES[Number(raw)] ?? "") : String(raw ?? "");
    for (const [key, re] of Object.entries(GENRE_KEYS)) if (re.test(value)) keys.add(key);
  }
  return keys;
}

// Per pick:
//   citesExist     every cited ref is a real evidence record of this profile (the validator enforces this
//                  for kept picks, so it is reported over kept AND rejected proposals)
//   citesInPrompt  every cited ref was in the evidence list the prompt actually showed the model
//   namesEvidence  the explanation names at least one cited evidence title (the visitor can trace it)
//   domainMatch    a cited POSITIVE evidence item shares a domain with the pick
//   genreMatch     a cited POSITIVE evidence item shares a genre key with the pick
//   relevant       domainMatch or genreMatch (a deterministic floor for "relevant"; whether the evidence is
//                  GENUINELY relevant needs human review)
export function traceability(picks) {
  const rows = picks.map((p) => {
    const positives = (p.citedEvidence ?? []).filter((e) => e.polarity > 0);
    const pickGenres = genreKeys(p.genres);
    const domainMatch = positives.some((e) => (e.domains ?? []).some((d) => (p.domains ?? []).includes(d)));
    const genreMatch = positives.some((e) => [...genreKeys(e.genres)].some((g) => pickGenres.has(g)));
    const whyLower = String(p.why ?? "").toLowerCase();
    return {
      citesExist: (p.citedEvidence ?? []).length === (p.cites ?? []).length && (p.cites ?? []).length > 0,
      citesInPrompt: (p.citedEvidence ?? []).every((e) => e.inPrompt),
      namesEvidence: (p.citedEvidence ?? []).some((e) => e.title && whyLower.includes(e.title.toLowerCase())),
      domainMatch, genreMatch, relevant: domainMatch || genreMatch
    };
  });
  const rate = (key) => round3(share(rows.filter((r) => r[key]).length, rows.length));
  return { picks: rows.length, citesExist: rate("citesExist"), citesInPrompt: rate("citesInPrompt"), namesEvidence: rate("namesEvidence"), domainMatch: rate("domainMatch"), genreMatch: rate("genreMatch"), relevant: rate("relevant") };
}

// ---- 4. circular / generic phrasing ---------------------------------------------------------------

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

export function genericPhrasing(picks) {
  const counts = Object.fromEntries(GENERIC_TEMPLATES.map((t) => [t.id, 0]));
  let any = 0;
  for (const p of picks) {
    let hit = false;
    for (const t of GENERIC_TEMPLATES) if (t.re.test(p.why ?? "")) { counts[t.id] += 1; hit = true; }
    if (hit) any += 1;
  }
  return { share: round3(share(any, picks.length)), byTemplate: Object.fromEntries(Object.entries(counts).filter(([, c]) => c > 0)) };
}

// ---- 5. genre-label collapse ----------------------------------------------------------------------

// Genre and medium vocabulary. An explanation "collapses into genre labels" when at least half of its
// content words (titles masked and excluded) are genre or medium words. Reported as the share of
// collapsed explanations and the mean genre-word ratio.
export const GENRE_WORDS = new Set(("sci-fi scifi science fiction fantasy horror thriller thrillers mystery mysteries comedy comedies comedic " +
  "drama dramas dramatic romance romantic adventure adventures action animated animation documentary documentaries " +
  "crime historical history literary epic rpg rpgs role-playing puzzle puzzles strategy indie platformer shooter " +
  "simulation cozy narrative genre genres film films movie movies show shows series tv book books novel novels " +
  "game games fiction nonfiction memoir sitcom anime").split(/\s+/));
export const COLLAPSE_THRESHOLD = 0.5;

export function genreCollapse(picks) {
  const ratios = picks.map((p) => {
    const content = maskedTokens(p).filter(isContent);
    return content.length ? content.filter((t) => GENRE_WORDS.has(t)).length / content.length : 0;
  });
  return {
    collapsedShare: round3(share(ratios.filter((r) => r >= COLLAPSE_THRESHOLD).length, ratios.length)),
    meanGenreRatio: round3(ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null)
  };
}

// ---- 6. cross-domain caution ----------------------------------------------------------------------

// A pick is CROSS-DOMAIN when at least one cited evidence item shares no domain with the pick (the
// explanation leans on, say, a book to explain a film). Such a pick is SUPPORTED only when the profile
// has TRIED evidence (Loved / Liked / disliked reactions; starter favorites do not count, per the
// evidence contract) in the pick's domain AND in every cited domain. Reported: share of picks that are
// cross-domain, and the share of those that are unsupported. "onlyOtherDomain" = cross-domain picks
// with no same-domain citation at all.
export function crossDomain(picks) {
  let cross = 0, unsupported = 0, onlyOther = 0;
  for (const p of picks) {
    const pickDomains = p.domains ?? [];
    const cited = p.citedEvidence ?? [];
    const otherDomain = cited.filter((e) => !(e.domains ?? []).some((d) => pickDomains.includes(d)));
    if (!otherDomain.length) continue;
    cross += 1;
    if (otherDomain.length === cited.length) onlyOther += 1;
    const tried = new Set(p.profileFacts?.triedDomains ?? []);
    const needed = new Set([...pickDomains, ...otherDomain.flatMap((e) => e.domains ?? [])]);
    if ([...needed].some((d) => !tried.has(d))) unsupported += 1;
  }
  return { crossShare: round3(share(cross, picks.length)), unsupportedShareOfCross: round3(share(unsupported, cross)), unsupportedShare: round3(share(unsupported, picks.length)), onlyOtherDomainShare: round3(share(onlyOther, picks.length)) };
}

// ---- 7. other measurable signals from #28's failure list --------------------------------------------

// Overfitting to recent reactions: of the cited REACTION refs, the share that are among the most recent
// 20% of the profile's tried reactions (recency is the order reactions were added). With no preference
// for recency this sits near 0.2; the prompt-evidence selection itself is what the model was shown.
// Dislike centering: share of picks that cite a disliked item at all.
export function recencyAndDislikes(picks) {
  const reactionCites = picks.flatMap((p) => (p.citedEvidence ?? []).filter((e) => e.recency != null));
  return {
    recentShareOfReactionCites: round3(share(reactionCites.filter((e) => e.recency >= 0.8).length, reactionCites.length)),
    citesDislikeShare: round3(share(picks.filter((p) => (p.citedEvidence ?? []).some((e) => e.polarity < 0)).length, picks.length)),
    meanCitesPerPick: round3(picks.length ? picks.reduce((a, p) => a + (p.cites ?? []).length, 0) / picks.length : null),
    meanWords: round3(picks.length ? picks.reduce((a, p) => a + tokens(p.why).length, 0) / picks.length : null)
  };
}

// ---- 8. per-set repetition (Stage 0 of the #28 research report, Oct 20) ---------------------------
// Everything above pools explanations across many calls. A visitor sees one SET (one call's 5-6 picks),
// and a future runtime gate would act on one set, so these checks run per set and are then summarised.
// Prompt bans did not move these (Oct 20 paid eval: "echo" 10 of 49 before and after), so the point here
// is to measure them per set, with enough explanations to tell a real change from noise.

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

// Vague hedges: what most separated the sets Paige dropped from the ones she kept (Oct 20: 38% of dropped
// explanations vs 20% of kept). Reported, not part of the gate: a hedge is a specificity problem, and the
// fix is in what the prompt asks for, not a runtime repair.
export const HEDGE = /\b(?:could appeal|may appeal|might appeal|could suit|may suit|might suit|could fit|may fit|if you (?:like|enjoy)|your favou?rites?|your love of|you may enjoy|may click)\b/i;

// The smallest sample at which a 20% -> 10% change in an explanation-level rate is detectable (two-sided
// alpha 0.05, power 0.8: about 190 per variant, rounded up). Below it, report numbers as indicative only.
export const MIN_EXPLANATIONS_PER_VARIANT = 200;

const maskedText = (p) => maskedTokens(p).join(" ");

// One set's checks. `picks` are the kept picks of a single call.
export function setRepetition(picks) {
  const texts = picks.map(maskedText);
  const stock = Object.fromEntries(STOCK_FAMILIES.map((f) => [f.id, texts.filter((t) => f.re.test(t)).length]));
  const frame = texts.filter((t) => FRAME.test(t)).length;

  const openings = picks.map((p) => maskedTokens(p).slice(0, 2).join(" ")).filter((o) => o.split(" ").length === 2);
  const openingCounts = openings.reduce((m, o) => m.set(o, (m.get(o) ?? 0) + 1), new Map());
  const opening = Math.max(0, ...openingCounts.values());

  const phraseOwners = new Map();
  picks.forEach((p, index) => {
    for (const g of new Set(ngrams(maskedTokens(p), 3).filter((g) => g.split(" ").some(isContent)))) {
      if (!phraseOwners.has(g)) phraseOwners.set(g, new Set());
      phraseOwners.get(g).add(index);
    }
  });
  let sharedPhrase = 0;
  let sharedPhraseText = null;
  for (const [g, owners] of phraseOwners) if (owners.size > sharedPhrase) { sharedPhrase = owners.size; sharedPhraseText = g; }
  if (sharedPhrase < 2) { sharedPhrase = 0; sharedPhraseText = null; }

  const triggers = [];
  for (const [family, count] of Object.entries(stock)) if (count >= SET_GATE.stockFamilyWhys) triggers.push(`${family} x${count}`);
  if (frame >= SET_GATE.frameWhys) triggers.push(`"you ... in <title>" frame x${frame}`);
  if (opening >= SET_GATE.openingWhys) triggers.push(`same opening x${opening}`);
  if (sharedPhrase >= SET_GATE.sharedPhraseWhys) triggers.push(`"${sharedPhraseText}" x${sharedPhrase}`);
  return { size: picks.length, stock, frame, opening, sharedPhrase, sharedPhraseText, triggers, wouldTrigger: triggers.length > 0 };
}

// Summary over sets. `picks` carry `callKey` (pickRecords adds it); one call = one set.
export function perSetSummary(picks) {
  const byCall = new Map();
  for (const p of picks) {
    const key = p.callKey ?? `${p.model}|${p.profile}|r${p.round}`;
    if (!byCall.has(key)) byCall.set(key, []);
    byCall.get(key).push(p);
  }
  const sets = [...byCall.values()].map(setRepetition);
  const shareOf = (test) => round3(share(sets.filter(test).length, sets.length));
  const triggerCounts = {};
  for (const set of sets) for (const t of set.triggers) {
    const kind = t.startsWith('"you') ? "frame" : t.startsWith("same opening") ? "opening" : t.startsWith('"') ? "shared phrase" : t.replace(/ x\d+$/, "");
    triggerCounts[kind] = (triggerCounts[kind] ?? 0) + 1;
  }
  return {
    sets: sets.length,
    explanations: picks.length,
    enoughSample: picks.length >= MIN_EXPLANATIONS_PER_VARIANT,
    wouldTriggerRate: shareOf((s) => s.wouldTrigger),
    stockFamilySetShare: shareOf((s) => Object.values(s.stock).some((c) => c >= SET_GATE.stockFamilyWhys)),
    meanStockWhysPerSet: round3(sets.length ? sets.reduce((a, s) => a + Object.values(s.stock).reduce((x, y) => x + y, 0), 0) / sets.length : null),
    frameSetShare: shareOf((s) => s.frame >= SET_GATE.frameWhys),
    frameWhyShare: round3(share(sets.reduce((a, s) => a + s.frame, 0), picks.length)),
    hedgeWhyShare: round3(share(picks.filter((p) => HEDGE.test(p.why ?? "")).length, picks.length)),
    openingSetShare: shareOf((s) => s.opening >= SET_GATE.openingWhys),
    sharedPhraseSetShare: shareOf((s) => s.sharedPhrase >= SET_GATE.sharedPhraseWhys),
    triggerCounts
  };
}

// ---- grouping -------------------------------------------------------------------------------------

export function metricsFor(picks, { patternsByProfile = {} } = {}) {
  return {
    picks: picks.length,
    wording: {
      distinct2: distinctN(picks, 2), distinct3: distinctN(picks, 3),
      sharedLong4: longNgramShare(picks, 4), sharedLong5: longNgramShare(picks, 5),
      repeatedOpening: repeatedOpeningShare(picks), topPhrases: topPhrases(picks)
    },
    themes: themeConcentration(picks),
    patterns: patternConcentration(picks, patternsByProfile),
    traceability: traceability(picks),
    generic: genericPhrasing(picks),
    genre: genreCollapse(picks),
    crossDomain: crossDomain(picks),
    other: recencyAndDislikes(picks),
    perSet: perSetSummary(picks)
  };
}

// Call-level reliability (not a wording metric, but needed to read the others): how many calls returned
// model picks, fell back, or failed, and why picks were rejected.
export function reliability(calls) {
  const pickCalls = calls.filter((c) => c.kind === "picks");
  const reasons = {};
  for (const c of pickCalls) for (const r of c.rejected ?? []) for (const reason of r.reasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const kept = pickCalls.reduce((a, c) => a + (c.picks?.length ?? 0), 0);
  const rejected = pickCalls.reduce((a, c) => a + (c.rejected?.length ?? 0), 0);
  return {
    calls: pickCalls.length,
    modelSource: pickCalls.filter((c) => c.source === "model").length,
    fallback: pickCalls.filter((c) => c.source !== "model").length,
    fallbackReasons: pickCalls.filter((c) => c.source !== "model").reduce((m, c) => ({ ...m, [c.reason ?? "unknown"]: (m[c.reason ?? "unknown"] ?? 0) + 1 }), {}),
    picksKept: kept, picksRejected: rejected, rejectionReasons: reasons,
    usd: round3(calls.reduce((a, c) => a + (c.costUsd ?? 0), 0))
  };
}

export const DEFINITIONS = [
  ["Title masking", "Before any wording metric, the pick's title and the titles of the evidence it cites are replaced by <title>, so 'Because you loved X' and 'Because you loved Y' count as one template."],
  ["distinct-2 / distinct-3", "Unique word 2-grams (3-grams) divided by all 2-grams (3-grams) across every explanation in the group. 1.0 = nothing repeats; lower = more reuse."],
  ["shared 4-gram / 5-gram", "Share of explanations containing a 4-word (5-word) phrase, with at least one content word, that also appears in a different explanation in the group."],
  ["repeated opening", "Share of explanations whose first three words match another explanation's first three."],
  ["top phrases", "3- to 5-word phrases (with a content word) ranked by how many explanations contain them; listed only when in 2+ explanations."],
  ["theme top-3 / top-5", "Lexical proxy for pattern overuse: content words (minus reaction verbs such as loved/liked/enjoyed) and adjacent content-word pairs, ranked by how many explanations use them; share of explanations using at least one of the top 3 (top 5). Cannot tell two different ideas sharing a word apart."],
  ["pattern top-3 / top-5", "Only with --with-profile: a pick uses a taste-profile pattern when one of its cited refs supports that pattern. Share of picks using one of the profile's top 3 (top 5) most-used patterns; 'no pattern' = share citing no pattern's evidence."],
  ["cites exist", "Share of picks whose every cited ref is a real evidence record of the profile (kept picks always pass, since the validator enforces it; rejected proposals are in the reliability table)."],
  ["cites in prompt", "Share of picks whose every cited ref was in the 18-row evidence list the prompt actually showed the model."],
  ["names evidence", "Share of explanations that name at least one cited evidence title."],
  ["domain / genre match, relevant", "A cited positive evidence item shares a domain (genre key) with the pick; 'relevant' = either. A deterministic floor only: whether evidence is GENUINELY relevant needs human review."],
  ["generic phrasing", "Share of explanations matching any template in GENERIC_TEMPLATES (the product's circular patterns plus soft generic phrases such as 'you'll love', 'right up your alley', 'fans of')."],
  ["genre collapse", "An explanation collapses when at least half its content words (titles excluded) are genre or medium words (GENRE_WORDS). Share collapsed, plus the mean genre-word ratio."],
  ["cross-domain", "A pick citing evidence from a domain the pick is not in. Unsupported = the profile lacks TRIED evidence (Loved/Liked/disliked, not starter favorites) in the pick's domain or the cited domain."],
  ["recent share", "Of cited reaction refs, the share among the most recent 20% of the profile's tried reactions (about 0.2 if recency plays no part)."],
  ["cites a dislike", "Share of picks citing any disliked item (allowed only as contrast)."],
  ["per-set: would trigger", "Share of SETS (one call's kept picks, what one visitor sees) that reach any SET_GATE threshold: a stock-word family in 3+ explanations, the 'you … in <title>' frame in 3+, the same two-word opening in 2+, or one 3-word phrase (with a content word) in 3+. Calibrated Oct 20 against reference-sets.json."],
  ["per-set: stock family", "Share of sets where one STOCK_FAMILIES family (callback verbs: echo/mirror/recall/resonate/evoke/reminiscent; scale words: sweeping/scope/sprawling) appears in 2+ explanations. Families, so a swapped synonym still counts. Mean = family hits per set."],
  ["per-set: frame", "'you loved / enjoyed / responded to … in <title>' (title-masked): share of explanations using it, and share of sets where 3+ do."],
  ["vague hedge", "Share of explanations with a hedge such as 'could appeal', 'may suit', 'if you like' or 'your favorites'. Reported, not gated: it separated the reference sets Paige dropped (38%) from those she kept (20%)."],
  ["sample size", `Explanation-level rates need about ${MIN_EXPLANATIONS_PER_VARIANT} explanations per variant to detect a 20% -> 10% change; below that the report marks numbers as indicative.`]
];

export const NEEDS_HUMAN_REVIEW = [
  "Is each cited item GENUINELY relevant to the pick (beyond sharing a domain or genre)?",
  "Does the reasoning find NEW, more specific distinctions as evidence grows (compare 10 vs 50 vs 100+ for the same shape)?",
  "In the split shape, does it explain why two superficially similar items got different reactions?",
  "Does it keep domain and context nuance (here, not there) rather than one global aesthetic?",
  "Is the confidence calibrated? Picks carry no confidence field in production (every live pick shows 'Promising fit' / 'Worth testing'); only taste-profile patterns have levels, which the product caps.",
  "Do explanations that sound personalized actually follow from the cited evidence?"
];
