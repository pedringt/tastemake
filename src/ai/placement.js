import { visibleDomains } from "../data/domains.js";
import { compactRow } from "./profile-context.js";
import { confirmationFor } from "../model/statements.js";
import { MAX_PROFILE_HYPOTHESES, normalizeHypothesisResponse, validateHypotheses } from "./validate.js";
import { labelStems } from "./support-filing.js";

// #326 Design A (docs/proposals/326-refresh-options.md, section 4; Paige's decisions, Nov 14): on a refresh the
// model no longer rewrites the Taste Profile. It is shown the patterns as read-only context and only the items
// that are new since the last refresh, and answers one question per item: where does it go?
//   supports <pattern>   tried and liked, and the item shows what the pattern describes
//   counter <pattern>    tried and disliked, and the same kind of thing (#278), so it pulls against the pattern
//   unexplained          fits nothing yet (a liked one goes to the "not yet explained" pool)
//   not-taste            says nothing about any pattern
// It may also propose new patterns, citing only items it placed as unexplained now or pooled ones, at least two
// (decision 4). Everything here is checked; software applies the result (src/model/placement-apply.js).
// Used by api/hypotheses.mjs and the eval runner, so both send the same prompt and apply the same checks.

export const PLACES = ["supports", "counter", "unexplained", "not-taste"];
export const PLACEMENT_MAX_OUTPUT_TOKENS = 1000;
export const MIN_NEW_PATTERN_ITEMS = 2;
const EXAMPLE_TITLES = 3;

const KIND_WORD = {
  "starter-favorite": "favorite",
  "experienced-favorite": "starred",
  "experienced-strong-positive": "loved",
  "experienced-positive": "liked",
  "experienced-negative": "disliked"
};

const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const statementsOf = (ctx) => ctx.statements ?? [];
const notMe = (ctx, p) => statementsOf(ctx).some((s) => s.says === "not-me" && (s.hypothesisId === p.id || (s.label && text(s.label) === text(p.title ?? p.label))));
const excludedAll = (ctx, p) => {
  const excluded = statementsOf(ctx).find((s) => s.hypothesisId === p.id && (s.excludedDomains ?? []).length)?.excludedDomains ?? [];
  return (p.domains ?? []).length > 0 && p.domains.every((d) => excluded.includes(d));
};

// The patterns an item can be placed under: every stored pattern except ones the user said aren't them, and
// confirmed ones with every area excluded (a scope correction: they're kept exactly as stored, as today).
export function placementTargets(patterns = [], ctx = {}) {
  return (patterns ?? []).filter((p) => p?.id && p.claim && (p.title ?? p.label) && !notMe(ctx, p) && !excludedAll(ctx, p));
}

const row = (evidence, ref) => evidence.get(ref);
const rowFor = (evidence, ref, id) => {
  const r = row(evidence, ref);
  return { ...compactRow(r, id), k: KIND_WORD[r.kind] ?? r.kind, areas: r.domains ?? [] };
};

// Returns { prompt, request }. request maps the short ids back: patterns (p1 -> pattern), items (n1 -> ref),
// pool (q1 -> ref). Items or pool refs not in ctx.evidence (not sent, or not something tried) are left out and
// listed in notSent.
export function buildPlacementRequest(ctx, patterns, { items = [], pool = [] } = {}) {
  const evidence = new Map((ctx.evidence ?? []).filter((r) => r.class === "experienced").map((r) => [r.ref, r]));
  const targets = placementTargets(patterns, ctx);
  const request = { patterns: new Map(), items: new Map(), pool: new Map(), notSent: [] };
  const context = { patterns: [], new: [], pool: [] };
  targets.forEach((p, i) => {
    const id = `p${i + 1}`;
    request.patterns.set(id, p);
    const examples = (p.supports ?? []).map((ref) => row(evidence, ref)?.title).filter(Boolean).slice(0, EXAMPLE_TITLES);
    context.patterns.push({ id, name: p.title ?? p.label, claim: p.claim, areas: p.domains ?? [], ...(confirmationFor(statementsOf(ctx), p) ? { confirmed: 1 } : {}), examples });
  });
  for (const ref of [...new Set(items)]) {
    if (!evidence.has(ref)) { request.notSent.push(ref); continue; }
    const id = `n${request.items.size + 1}`;
    request.items.set(id, ref);
    context.new.push(rowFor(evidence, ref, id));
  }
  for (const ref of [...new Set(pool)]) {
    if (!evidence.has(ref) || items.includes(ref)) continue;
    const id = `q${request.pool.size + 1}`;
    request.pool.set(id, ref);
    context.pool.push(rowFor(evidence, ref, id));
  }
  const prompt = [
    "You are the taste-interpretation layer inside Tastemake. Software keeps the user's Taste Profile; your only job is to say where each NEW rating belongs.",
    "Return JSON only: {\"placements\":[{\"item\":\"n1\",\"place\":\"supports\",\"pattern\":\"p2\"}],\"newPatterns\":[]}.",
    "patterns are the user's current patterns: id, name, claim, areas and a few example titles. They are read-only context: never rename, reword, merge or re-judge them. confirmed:1 marks a pattern the user confirmed.",
    "Return exactly one placement for every item in new, and none for anything else. place is one of:",
    "- \"supports\" with a pattern: the user tried and liked or loved it (k loved, liked, starred or favorite), and the item itself shows what that pattern's name and claim describe. Sharing a medium or a genre word is not enough.",
    "- \"counter\" with a pattern: the user tried and disliked it (k disliked), and it is the same kind of thing the pattern describes, so the dislike genuinely pulls against it. A disliked item that is merely in the same medium is not a counter.",
    "- \"unexplained\": no pattern describes it yet. Prefer this to squeezing an item into a pattern that only partly fits.",
    "- \"not-taste\": it says nothing about any pattern (for example a dislike unrelated to every pattern).",
    "pattern is null for unexplained and not-taste. A supports or counter placement must share an area with its pattern.",
    "pool lists liked items earlier refreshes couldn't place. newPatterns is optional and usually empty. Propose one only when two or more items you placed as \"unexplained\" in this answer, or pool items, share a specific, testable preference that no pattern covers. Cite only those items, by id, in evidence. Each: {\"label\":\"...\",\"claim\":\"...\",\"evidence\":[\"n1\",\"q2\"],\"domains\":[\"movies\"],\"conditional\":false}. A claim is one or two sentences about what the user responds to: a pattern, not a genre and not an identity, and no general rule from under three items.",
    `domains may contain only these exact product ids: ${visibleDomains().map((d) => d.id).join(", ")}, and each must be an area of a cited item.`,
    "Item rows: id, t title, type when the area doesn't imply it, y year, by creator, g genres, r the user's reasons (dimension or dimension:direction), k how they rated it, areas. u:1 means the item's facts are unresolved: don't supply genres, themes or creators from memory.",
    "Return exactly one JSON object. The first character must be { and the last must be }, with nothing after the closing brace. No markdown or prose outside JSON.",
    `CONTEXT\n${JSON.stringify(context)}`
  ].join("\n\n");
  return { prompt, request };
}

const shares = (a = [], b = []) => a.some((x) => b.includes(x));

// Checks the model's answer against the request. Returns
//   placements  [{ ref, place, patternId }]   one valid placement per new item that had one
//   invalid     [ref]                         new items with no placement, several, or an invalid one
//   newPatterns [proposal]                    accepted (validator + redundancy), cites real ev: refs
//   rejectedPatterns [{ label, claim, evidence, reasons }]
// A run never half-applies one item: an item is either placed once, or left new.
export function checkPlacementAnswer(answer, request, ctx, { existing = [] } = {}) {
  const evidence = new Map((ctx.evidence ?? []).map((r) => [r.ref, r]));
  const list = Array.isArray(answer?.placements) ? answer.placements : [];
  const byItem = new Map();
  for (const entry of list) {
    const id = typeof entry?.item === "string" ? entry.item.trim() : null;
    if (!id || !request.items.has(id)) continue;
    byItem.set(id, [...(byItem.get(id) ?? []), entry]);
  }
  const placements = [];
  const invalid = [];
  for (const [id, ref] of request.items) {
    const entries = byItem.get(id) ?? [];
    const placed = entries.length === 1 ? validPlacement(entries[0], ref, request, evidence) : null;
    if (placed) placements.push(placed);
    else invalid.push(ref);
  }

  // New patterns: only from items placed unexplained now, or pooled, at least MIN_NEW_PATTERN_ITEMS of them.
  const unexplained = new Map([...request.items].filter(([, ref]) => placements.some((p) => p.ref === ref && p.place === "unexplained")));
  const allowed = new Map([...unexplained, ...request.pool]);
  const newPatterns = [];
  const rejectedPatterns = [];
  const used = new Set();
  const targets = [...request.patterns.values()];
  const unconfirmed = targets.filter((p) => !confirmationFor(statementsOf(ctx), p)).length;
  let room = Math.max(0, MAX_PROFILE_HYPOTHESES - unconfirmed);
  for (const raw of Array.isArray(answer?.newPatterns) ? answer.newPatterns : []) {
    if (!raw || typeof raw !== "object") continue;
    const cited = Array.isArray(raw.evidence) ? [...new Set(raw.evidence.map((id) => String(id).trim()))] : [];
    const refs = cited.map((id) => allowed.get(id));
    const reasons = [];
    if (refs.some((ref) => !ref)) reasons.push("cites an item that wasn't placed as unexplained or pooled");
    const positive = refs.filter((ref) => ref && evidence.get(ref)?.polarity > 0);
    if (positive.length < MIN_NEW_PATTERN_ITEMS) reasons.push(`needs at least ${MIN_NEW_PATTERN_ITEMS} unexplained or pooled items the user liked`);
    if (positive.some((ref) => used.has(ref))) reasons.push("cites items another new pattern in this answer already uses");
    const proposal = {
      id: "ai-new",
      label: typeof raw.label === "string" ? raw.label.trim() : "",
      claim: typeof raw.claim === "string" ? raw.claim.trim() : "",
      evidence: refs.filter(Boolean),
      counter: [],
      domains: Array.isArray(raw.domains) ? raw.domains.filter((d) => typeof d === "string") : [],
      crossDomain: "untested",
      level: "emerging",
      conditional: raw.conditional === true,
      context: null
    };
    if (!reasons.length) {
      const [normalized] = normalizeHypothesisResponse({ hypotheses: [proposal] }, ctx).hypotheses;
      const checked = validateHypotheses({ hypotheses: [normalized], insufficientEvidence: false }, ctx);
      if (!checked.accepted.length) reasons.push(...(checked.rejected[0]?.reasons ?? ["did not pass validation"]));
      else {
        const accepted = checked.accepted[0];
        reasons.push(...redundancy(accepted, [...existing, ...targets, ...newPatterns]));
        if (!reasons.length && room <= 0) reasons.push(`the profile already has ${MAX_PROFILE_HYPOTHESES} unconfirmed patterns`);
        if (!reasons.length) {
          room -= 1;
          accepted.evidence.forEach((ref) => used.add(ref));
          newPatterns.push({ label: accepted.label, claim: accepted.claim, evidence: accepted.evidence, domains: accepted.domains, conditional: accepted.conditional });
          continue;
        }
      }
    }
    rejectedPatterns.push({ label: proposal.label, claim: proposal.claim, evidence: proposal.evidence, reasons });
  }
  return { placements, invalid, newPatterns, rejectedPatterns };
}

function validPlacement(entry, ref, request, evidence) {
  const place = typeof entry.place === "string" ? entry.place.trim() : "";
  if (!PLACES.includes(place)) return null;
  const item = evidence.get(ref);
  if (place === "unexplained" || place === "not-taste") return { ref, place, patternId: null };
  const pattern = request.patterns.get(typeof entry.pattern === "string" ? entry.pattern.trim() : "");
  if (!pattern || !item || item.class !== "experienced") return null;
  if (place === "supports" && !(item.polarity > 0)) return null;
  if (place === "counter" && !(item.polarity < 0)) return null;
  if (!shares(item.domains, pattern.domains)) return null;
  return { ref, place, patternId: pattern.id };
}

// A new pattern adds nothing when most of what it cites already supports one existing pattern, or when its name
// says the same thing as an existing one's (every content word of the shorter name is in the other).
export function redundancy(proposal, existing = []) {
  const reasons = [];
  const cites = proposal.evidence ?? [];
  const overlapping = existing.find((p) => cites.filter((ref) => (p.supports ?? p.evidence ?? []).includes(ref)).length * 2 > cites.length);
  if (overlapping) reasons.push(`redundant: most of what it cites already supports "${overlapping.title ?? overlapping.label}"`);
  const stems = labelStems(proposal.label);
  const sameName = existing.find((p) => {
    const other = labelStems(p.title ?? p.label);
    if (text(p.title ?? p.label) === text(proposal.label)) return true;
    const [short, long] = stems.length <= other.length ? [stems, other] : [other, stems];
    return short.length > 0 && short.every((s) => long.includes(s));
  });
  if (sameName) reasons.push(`redundant: says the same as "${sameName.title ?? sameName.label}"`);
  return reasons;
}

// One placement call. `callModel(prompt)` returns { json, usage, model } (or throws); with no new item it is
// never called (decision: no model call when nothing is new).
export async function placeNewItems({ ctx, patterns, items, pool, callModel }) {
  const { prompt, request } = buildPlacementRequest(ctx, patterns, { items, pool });
  if (!request.items.size) return { source: "nothing-new", placement: null, notSent: request.notSent, prompt: null };
  const model = await callModel(prompt);
  if (!model) return { source: "no-answer", placement: null, notSent: request.notSent, prompt };
  const checked = checkPlacementAnswer(model.json, request, ctx, { existing: patterns });
  return { source: "model", placement: { ...checked, notSent: request.notSent }, model: model.model, usage: model.usage, prompt };
}
