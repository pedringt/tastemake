// Live-AI output contract (#31). AI interprets; the product owns evidence and state.
//
// A model only ever returns *proposals* in these shapes. Nothing it returns is written to state directly:
// every response goes through validate.js, which stamps authority/source itself, drops anything that
// breaks a rule, and falls back to the deterministic logic when too little survives. See docs/ai-contract.md.
//
// Two jobs for v1:
//   inferHypotheses  working taste hypotheses from typed evidence (evidenceRecords in src/model/evidence.js)
//   explainPicks     choose from eligible candidates (a curated pool, so every title is real) and say why

export const CONTRACT_VERSION = "2026-09-22";

export const LEVELS = ["emerging", "supported", "strong"];           // what a model may claim; never above what evidence allows
export const CROSS_DOMAIN = ["untested", "tentative", "supported"];  // cross-domain links start as hypotheses

// Hypothesis proposal, as the model must return it.
//   label        short plain-English name ("Comedy works better when it has teeth")
//   claim        one or two sentences; a pattern, not a genre and not an identity
//   evidence     refs ("ev:<itemId>") of experienced positive evidence it rests on (at least one)
//   counter      refs of experienced negative evidence that pulls against it (may be empty)
//   domains      domains the model says it holds in (each must be backed by cited evidence in that domain)
//   crossDomain  one of CROSS_DOMAIN
//   level        one of LEVELS (the model's own calibration; the product caps it)
//   conditional  true when it only holds sometimes ("when atmosphere is strong")
//   context      null, or a short context the user gave ("family movie night"); never invented
export const HYPOTHESIS_FIELDS = {
  label: "string", claim: "string", evidence: "refs", counter: "refs", domains: "strings",
  crossDomain: "enum:crossDomain", level: "enum:level", conditional: "boolean", context: "nullable-string"
};

// #28 Stage 1 (Oct 20): every model pick names the one concrete element that links it to the cited
// evidence, chosen before the sentence is written. Bans on stock phrases moved the model to the next stock
// word (stress eval: sets that would trigger a repetition check rose from 23% to 35% on Haiku after #247);
// a distinct anchor per pick changes what each sentence has to be about instead.
export const ANCHORS = ["setting", "character", "structure", "tone", "theme", "pacing", "voice"];
export const MAX_PICKS_PER_ANCHOR = 2;

// Pick proposal.
//   itemId   must be one of the eligible candidates the product sent
//   anchor   one of ANCHORS: the element the why is about (optional for non-model producers; at most
//            MAX_PICKS_PER_ANCHOR picks in one set may share it)
//   why      the personalized reason: what this pick tests about the user's taste
//   cites    refs of experienced evidence the reason relies on (at least one)
//   tests    id of the hypothesis it tests (from the product's or the model's accepted list), or null
//   kind     "pick" | "curveball"
export const PICK_FIELDS = { itemId: "string", why: "string", cites: "refs", tests: "nullable-string", kind: "enum:kind" };

// Responses:
//   { hypotheses: [...], insufficientEvidence: boolean }
//   { picks: [...] }
// `insufficientEvidence: true` with an empty list is a valid, honest answer.

// Words that turn a pattern into an identity label. Tastemake never says "your style is X".
export const IDENTITY_PATTERNS = [
  /\byour (?:style|aesthetic|taste|vibe) is\b/i,
  /\byou are (?:a|an|the) \w+(?: \w+)? (?:person|type|fan|lover)\b/i,
  /\byou only (?:like|enjoy|love)\b/i,
  /\byou (?:always|never) (?:like|enjoy|love|hate)\b/i
];

// Reasons that explain nothing.
export const CIRCULAR_PATTERNS = [
  /\b(?:matches|fits|suits) your taste\b/i,
  /\bbecause (?:you have|of your) (?:good|great) taste\b/i,
  /\byou(?:'ll| will) (?:like|love|enjoy) (?:it|this) because you (?:like|love|enjoy) (?:it|this|things like this)\b/i,
  /\bbased on your (?:taste|profile|preferences)\.?$/i
];

// A "pattern" that is just a genre ("likes fantasy", "enjoys comedy").
export const GENRE_ONLY = /^(?:you )?(?:likes?|loves?|enjoys?|prefers?)\s+(?:\w+\s?){1,2}\.?$/i;
