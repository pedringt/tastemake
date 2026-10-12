import { typeById } from "../data/domains.js";

// The Taste Profile prompt's CONTEXT block, compacted the way #130 compacted the recommendations prompt.
// The profile call used to send every experienced evidence record whole: a long `ev:<provider id>` ref
// (repeated again in every earlier pattern that cites it), the 27-character kind name plus polarity and
// weight on every row, null facts and empty refinements, and refinement labels next to their ids. On a
// long-running profile that was ~77% of the prompt.
//
// What the model still gets, for every experienced row (evidence-contract.md):
//   - which kind of experience it was (starter favorite vs tried, #231; loved / liked / disliked; starred
//     favorite), as the group the row sits in;
//   - its domains (cross-domain rules), title, type when the domains do not imply it, resolved-or-not facts
//     (year, creator, genres) and the user's refinements;
//   - every earlier pattern with the evidence and counter-evidence it rests on (#228/#229), cited by the
//     same short ids;
//   - user statements (not-me / partial / unsure, weight, context, excluded domains).
// Software keeps the full records: the validator and normalizer still run against ctx.evidence, and
// expandProfileRefs maps the model's short ids back to the real `ev:` refs before either sees them.

// Rows are grouped under these kinds, in this order. Only experienced evidence is ever sent.
export const PROFILE_KIND_ORDER = ["starter-favorite", "experienced-favorite", "experienced-strong-positive", "experienced-positive", "experienced-negative"];
export const MAX_PROMPT_TITLE = 80;
export const MAX_PROMPT_GENRES = 8;

const shortTitle = (title) => {
  const text = String(title ?? "").trim();
  return text.length > MAX_PROMPT_TITLE ? `${text.slice(0, MAX_PROMPT_TITLE - 1)}…` : text;
};

function compactGenres(genres = []) {
  const seen = new Set();
  return genres.filter((genre) => {
    const key = String(genre ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PROMPT_GENRES);
}

// One row: short id, title, then only what is known. Keys are short and explained in the prompt:
// t title, type (only when the domain group does not imply it), y year, by creator, g genres,
// r refinements, u:1 when the item's facts are unresolved (the model must not fill them in).
export function compactRow(row, id) {
  const out = { id, t: shortTitle(row.title) };
  const domains = row.domains ?? [];
  const typeDomain = typeById(row.type)?.domain;
  if (row.type && !(domains.length === 1 && domains[0] === typeDomain)) out.type = row.type;
  const facts = row.facts ?? {};
  if (facts.resolved !== true) out.u = 1;
  if (facts.year) out.y = facts.year;
  if (facts.creator) out.by = facts.creator;
  const genres = compactGenres(facts.genres);
  if (genres.length) out.g = genres;
  const refinements = (row.refinements ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.id)).filter(Boolean);
  if (refinements.length) out.r = [...new Set(refinements)];
  return out;
}

function compactStatement(statement) {
  const out = {};
  for (const key of ["hypothesisId", "label", "says", "weight", "context"]) {
    if (statement?.[key] != null && statement[key] !== "") out[key] = statement[key];
  }
  if (statement?.excludedDomains?.length) out.excludedDomains = statement.excludedDomains;
  return out;
}

// Returns { context, refs } where refs maps each short id ("e1") to the full evidence ref ("ev:...").
export function compactProfileContext(ctx = {}, existing = []) {
  const refs = new Map();
  const shortFor = new Map();
  const groups = {};
  const experienced = (ctx.evidence ?? []).filter((row) => row?.class === "experienced" && row.ref);
  for (const kind of [...PROFILE_KIND_ORDER, ...new Set(experienced.map((row) => row.kind))]) {
    for (const row of experienced) {
      if (row.kind !== kind || shortFor.has(row.ref)) continue;
      const id = `e${refs.size + 1}`;
      refs.set(id, row.ref);
      shortFor.set(row.ref, id);
      // Grouped by kind, then by domain ("read+movies" for an item in two), so neither repeats per row.
      const domainKey = (row.domains ?? []).join("+") || "none";
      ((groups[kind] ??= {})[domainKey] ??= []).push(compactRow(row, id));
    }
  }
  const cite = (list) => [...new Set((list ?? []).map((ref) => shortFor.get(ref)).filter(Boolean))];
  const context = {
    evidence: groups,
    statements: (ctx.statements ?? []).map(compactStatement),
    contexts: ctx.contexts ?? [],
    existing: (existing ?? []).map(({ id, title, label, claim, domains, strength, level, supports, evidence, counters, counter }) => ({
      id,
      label: title ?? label,
      claim,
      domains: domains ?? [],
      level: strength ?? level,
      evidence: cite(supports ?? (Array.isArray(evidence) ? evidence : [])),
      counter: cite(counters ?? counter)
    }))
  };
  return { context, refs };
}

// The model cites short ids; software owns the mapping back to real evidence refs. A full `ev:` ref is
// passed through unchanged, and an id the prompt never issued is left as-is, so the normalizer drops it and
// the validator still sees exactly what the model claimed.
export function expandProfileRefs(response, refs) {
  if (!response || !Array.isArray(response.hypotheses) || !(refs instanceof Map)) return response;
  const expand = (list) => (Array.isArray(list) ? list.map((ref) => (typeof ref === "string" && refs.has(ref.trim()) ? refs.get(ref.trim()) : ref)) : list);
  return {
    ...response,
    hypotheses: response.hypotheses.map((h) => (h && typeof h === "object" ? { ...h, evidence: expand(h.evidence), counter: expand(h.counter) } : h))
  };
}
