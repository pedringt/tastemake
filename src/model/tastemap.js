import { favorites, hypotheses, followUpPool, recommendations } from "../data/catalog.js";
import { exonerated, hypothesisMatches, isBookmarked, untriedReactionLean, modelUpdateFor } from "./taste.js";
import { blindSpotsFor } from "./blindspots.js";

// Taste Map (#21): the Taste Profile as a picture. Design principle from the issue: avoid fake precision.
// So confidence and link strength are shown in coarse steps (never as numbers), every claim is backed by
// something you can point at, and thin or mixed evidence is called out instead of hidden.

const tagged = () => [...recommendations, ...followUpPool];

export const patternsOfItem = (item) => hypotheses.filter((pattern) => hypothesisMatches(item.hypotheses ?? [], pattern.id));

// Patterns are linked when picks Tastemake knows about lean on both. Three coarse levels.
export function patternLinks() {
  const links = [];
  for (let i = 0; i < hypotheses.length; i += 1) {
    for (let j = i + 1; j < hypotheses.length; j += 1) {
      const a = hypotheses[i];
      const b = hypotheses[j];
      const items = tagged().filter((item) => hypothesisMatches(item.hypotheses, a.id) && hypothesisMatches(item.hypotheses, b.id));
      if (items.length) links.push({ a: a.id, b: b.id, items, level: items.length >= 3 ? "strong" : items.length === 2 ? "some" : "weak" });
    }
  }
  return links;
}

// Five nodes around a centre, in percent of the map. (Fixed positions: the map is a diagram, not a chart.)
export function nodeLayout(count) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
    return { x: +(50 + 34 * Math.cos(angle)).toFixed(1), y: +(50 + 36 * Math.sin(angle)).toFixed(1) };
  });
}

// ---- Confidence (#26) ---------------------------------------------------------------------------------
// Two different things used to be blurred into one word ("Strong"):
//   inferred    a pattern that is plausible from the starting picture (a starting pattern), and
//   validated   a pattern that the user's own experienced reactions actually back up.
// In this prototype the patterns are a fixed, pre-written starting set (they do not change with your favorites),
// so every pattern begins as Emerging. What moves it is only what the user tried: Loved / Liked it (backs it) and
// Tried it and disliked it (counts against it, unless a blind spot says this pattern held up).
//
//   Emerging       nothing the user tried backs it yet (and nothing counts against it)
//   Supported      at least one thing they tried backs it, and more back it than count against it
//   Strong         three or more things they tried back it, and at least two more back it than count against it
//   Still learning something counted against it and it is not backed clearly (one miss never weakens a pattern)
//   Less certain   two or more misses that outweigh the support (the existing weakening rule)
// Untried reactions and bookmarks never count here; they are shown separately as a "lean".
export function patternConfidence(state, pattern) {
  const evidence = patternEvidence(state, pattern);
  const supports = evidence.supports.length;
  const against = evidence.against.length;
  const areas = new Set(evidence.supports.flatMap((row) => row.item.domains ?? [])).size;
  const update = modelUpdateFor(state, pattern);
  const backed = `${supports} ${supports === 1 ? "thing" : "things"} you've tried`;

  let level, status, look, basis, provenance;
  if (update.status === "revision") {
    level = "Less certain"; status = "revision"; look = "shaky"; basis = "doubted";
    provenance = `${against} things you tried didn't land${supports ? `, and ${supports} backed it` : ""}, so it carries less weight.`;
  } else if (supports >= 3 && supports - against >= 2) {
    level = "Strong"; status = "strong"; look = "firm"; basis = "confirmed";
    provenance = `Backed by ${backed}${areas > 1 ? `, across ${areas} areas` : ""}.${against ? ` ${against} didn't land, which doesn't outweigh that.` : ""}`;
  } else if (supports >= 1 && supports > against) {
    level = "Supported"; status = "supported"; look = "tentative"; basis = "confirmed";
    provenance = `Backed by ${backed}${areas > 1 ? `, across ${areas} areas` : ""}.${against ? ` ${against} didn't land.` : ""} More would make it Strong.`;
  } else if (against >= 1) {
    level = "Still learning"; status = "conditional"; look = "tentative"; basis = "mixed";
    provenance = supports
      ? `Backed by ${backed}, but ${against} didn't land. It takes more than one to weaken a pattern.`
      : "A pick you tried didn't land, and nothing you've tried backs it yet. It takes more than one to weaken a pattern.";
  } else {
    level = "Emerging"; status = "emerging"; look = "tentative"; basis = "starting";
    provenance = "A starting pattern. Nothing you've tried has tested it yet.";
  }
  return { level, status, look, basis, provenance, supports, against, heldUp: evidence.heldUp.length, areas };
}

// How firmly Tastemake holds a pattern: the computed level, plus one of three looks (solid / dashed / dotted).
export function confidenceOf(state, pattern) {
  const update = modelUpdateFor(state, pattern);
  const c = patternConfidence(state, pattern);
  return { ...update, ...c, label: c.level, note: c.provenance, change: update.note };
}

// What the user has told Tastemake that touches this pattern.
//   supports  = tried and Loved / Liked (counts as taste)
//   against   = tried and disliked (counts as taste, unless a blind spot says this pattern held up)
//   heldUp    = tried and disliked, but the user said THIS pattern held up, so it is not counted against
//   steers    = untried reactions and bookmarks: they shape what comes next, they are not taste
export function patternEvidence(state, pattern) {
  const rows = { supports: [], against: [], heldUp: [], steers: [] };
  for (const feedback of Object.values(state.feedbackByRecommendation)) {
    if (!hypothesisMatches(feedback.item.hypotheses, pattern.id)) continue;
    const row = { item: feedback.item, feedback };
    if (feedback.rating === "more" && (feedback.detail === "loved-before" || feedback.detail === "liked-before")) {
      rows.supports.push({ ...row, label: feedback.detail === "loved-before" ? "Loved it" : "Liked it" });
    } else if (feedback.rating === "less" && feedback.detail === "tried-disliked") {
      if (exonerated(state, feedback, pattern.id)) rows.heldUp.push({ ...row, label: "Didn't like it, but this pattern held up" });
      else rows.against.push({ ...row, label: "Didn't like it" });
    } else {
      rows.steers.push({ ...row, label: isBookmarked(feedback) ? "Bookmarked" : feedback.rating === "more" ? "More like this" : feedback.rating === "less" ? "Less like this" : "Reacted" });
    }
  }
  return rows;
}

export const evidenceCount = (rows) => rows.supports.length + rows.against.length + rows.heldUp.length + rows.steers.length;

// Experienced picks by area, so thin areas are visible (starter favorites count: you told us those).
export function domainCoverage(state) {
  const seen = { watch: new Set(), read: new Set(), play: new Set() };
  const add = (item) => (item.domains ?? []).forEach((domain) => seen[domain]?.add(item.id));
  favorites.filter((item) => state.selectedFavorites.has(item.id)).forEach(add);
  for (const feedback of Object.values(state.feedbackByRecommendation)) {
    if (feedback.rating === "more" && (feedback.detail === "loved-before" || feedback.detail === "liked-before")) add(feedback.item);
    if (feedback.rating === "less" && feedback.detail === "tried-disliked") add(feedback.item);
  }
  return Object.fromEntries(Object.entries(seen).map(([domain, ids]) => [domain, ids.size]));
}

const listTitles = (rows) => rows.map((row) => `“${row.item.title}”`).join(", ");

// Only tensions the data actually shows. Nothing is invented to make the map look richer.
export function tensions(state) {
  const out = [];
  for (const pattern of hypotheses) {
    const evidence = patternEvidence(state, pattern);
    if (evidence.supports.length && evidence.against.length) {
      out.push({ patternId: pattern.id, kind: "mixed", text: `${pattern.title}: ${listTitles(evidence.supports)} supported it, but ${listTitles(evidence.against)} counted against it.` });
    }
    const spots = blindSpotsFor(state, pattern.id);
    if (spots.length) {
      out.push({ patternId: pattern.id, kind: "blind-spot", text: `${pattern.title}: Tastemake expected you to like ${spots.map((spot) => `“${spot.item.title}”`).join(", ")} because of this, and it didn't hold up.` });
    }
    if (pattern.status === "conditional") {
      out.push({ patternId: pattern.id, kind: "conditional", text: `${pattern.title}: Tastemake treats this one as conditional. It holds in some picks and not others.` });
    }
  }
  return out;
}

// Where Tastemake has little to go on.
export function thinAreas(state) {
  const quiet = hypotheses.filter((pattern) => evidenceCount(patternEvidence(state, pattern)) === 0);
  const coverage = domainCoverage(state);
  const thin = Object.entries(coverage).filter(([, count]) => count <= 2).map(([domain, count]) => ({ domain, count }));
  return { quietPatterns: quiet, thinDomains: thin, coverage };
}

export const lean = (state, pattern) => untriedReactionLean(state, pattern);
