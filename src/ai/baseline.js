import { favorites, hypotheses } from "../data/catalog.js";
import { hypothesisMatches, nextRecommendations } from "../model/taste.js";
import { hypothesisRecord } from "../model/interpretations.js";
import { patternConfidence } from "../model/tastemap.js";

// The deterministic "producer": today's logic, answering in the live-AI contract's shapes. It is the
// baseline every model run is scored against (#32), and the fallback when a model fails (#31).
// It does not use a model and costs nothing.

const LEVEL = { Emerging: "emerging", Supported: "supported", Strong: "strong", "Still learning": "emerging", "Less certain": "emerging" };

// Starter favorites named in a pattern's hand-written evidence line ("LOTR, Circe, ...").
const initials = (title) => title.replace(/^the /i, "").split(/\s+/).map((w) => w[0]).join("").toUpperCase();
function startersNamedIn(pattern, state) {
  const text = pattern.evidence ?? "";
  const tokens = text.split(/,\s*|\s+vs\.\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
  // a token names a favorite when it is the title, its initials ("LOTR"), or how the title starts ("Buffy", "Alan Wake")
  return favorites.filter((f) => state.selectedFavorites.has(f.id) && tokens.some((tok) =>
    tok === f.title.toLowerCase() || tok === initials(f.title).toLowerCase() || f.title.toLowerCase().startsWith(tok)));
}

export function inferHypotheses(state) {
  const proposals = [];
  for (const pattern of hypotheses) {
    const rec = hypothesisRecord(state, pattern);
    const starterRefs = startersNamedIn(pattern, state).map((f) => `ev:${f.id}`);
    const evidence = [...new Set([...starterRefs, ...rec.evidence])];
    if (!evidence.length) continue;   // nothing of this user's backs it: say nothing rather than invent
    proposals.push({
      id: pattern.id,
      label: pattern.title,
      claim: pattern.claim,
      evidence,
      counter: rec.counter,
      domains: rec.scope.supported,
      crossDomain: rec.crossDomain,
      level: LEVEL[patternConfidence(state, pattern).level] ?? "emerging",
      conditional: pattern.status === "conditional",
      context: null
    });
  }
  return { hypotheses: proposals, insufficientEvidence: proposals.length === 0 };
}

// Picks: the deterministic ranking, with reasons that cite the user's own experienced evidence that shares a pattern.
export function explainPicks(state, ctx) {
  const experiencedRefsFor = (item) => {
    const refs = [];
    for (const record of ctx.evidence) {
      if (record.class !== "experienced" || record.polarity <= 0) continue;
      const fb = state.feedbackByRecommendation[record.itemId];
      if (fb && item.hypotheses.some((id) => hypothesisMatches(fb.item.hypotheses, id))) refs.push(record.ref);
    }
    for (const id of item.hypotheses) {
      const pattern = hypotheses.find((p) => hypothesisMatches([p.id], id) || hypothesisMatches([id], p.id));
      if (pattern) startersNamedIn(pattern, state).forEach((f) => refs.push(`ev:${f.id}`));
    }
    return [...new Set(refs)];
  };
  const picks = nextRecommendations(state).map((item) => ({
    itemId: item.id,
    why: item.reason ?? "",
    cites: experiencedRefsFor(item),
    tests: item.hypotheses[0] ?? null,
    kind: item.surprise ? "curveball" : "pick"
  }));
  return { picks };
}
