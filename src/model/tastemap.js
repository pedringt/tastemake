import { starterItems } from "./starters.js";
import { exonerated, hypothesisMatches, isBookmarked, untriedReactionLean, modelUpdateFor } from "./taste.js";
import { blindSpotsFor } from "./blindspots.js";
import { visibleDomains } from "../data/domains.js";
import { isExperiencedNegative, isExperiencedPositive, isStrongPositive } from "./evidence.js";

// Taste-map utilities now operate only on hypotheses supplied by state/model output. There is no
// built-in pattern catalog.

const patterns = (state) => state?.modelHypotheses ?? [];

export const patternsOfItem = (item, stateOrPatterns = []) => {
  const list = Array.isArray(stateOrPatterns) ? stateOrPatterns : patterns(stateOrPatterns);
  const testId = item?.ai?.tests ?? null;
  if (testId) return list.filter((pattern) => hypothesisMatches([pattern.id], testId) || hypothesisMatches([testId], pattern.id));
  return list.filter((pattern) => hypothesisMatches(item?.hypotheses ?? [], pattern.id));
};

export function patternLinks(state) {
  const list = patterns(state);
  const items = (state?.recommendationSets ?? []).flat();
  const links = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      const shared = items.filter((item) => {
        const ids = [item?.ai?.tests, ...(item?.hypotheses ?? [])].filter(Boolean);
        return ids.some((id) => hypothesisMatches([id], a.id)) && ids.some((id) => hypothesisMatches([id], b.id));
      });
      if (shared.length) links.push({ a:a.id, b:b.id, items:shared, level:shared.length >= 3 ? "strong" : shared.length === 2 ? "some" : "weak" });
    }
  }
  return links;
}

export function nodeLayout(count) {
  if (!count) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
    return { x:+(50 + 34 * Math.cos(angle)).toFixed(1), y:+(50 + 36 * Math.sin(angle)).toFixed(1) };
  });
}

export function patternEvidence(state, pattern) {
  const rows = { supports:[], against:[], heldUp:[], steers:[] };
  const refs = new Set(pattern?.supports ?? []);
  const counters = new Set(pattern?.counters ?? []);
  for (const feedback of Object.values(state.feedbackByRecommendation ?? {})) {
    const ref = `ev:${feedback.item.id}`;
    const attached = refs.has(ref) || counters.has(ref)
      || hypothesisMatches(feedback.item.hypotheses ?? [], pattern.id)
      || hypothesisMatches([feedback.item?.ai?.tests].filter(Boolean), pattern.id);
    if (!attached) continue;
    const row = { item:feedback.item, feedback };
    if (isExperiencedPositive(feedback)) rows.supports.push({ ...row, label:isStrongPositive(feedback) ? "Loved it" : "Liked it" });
    else if (isExperiencedNegative(feedback)) {
      if (exonerated(state, feedback, pattern.id)) rows.heldUp.push({ ...row, label:"Didn't like it, but this pattern held up" });
      else rows.against.push({ ...row, label:"Didn't like it" });
    } else rows.steers.push({ ...row, label:isBookmarked(feedback) ? "Bookmarked" : feedback.rating === "more" ? "More like this" : feedback.rating === "less" ? "Less like this" : "Reacted" });
  }
  return rows;
}

export function patternConfidence(state, pattern) {
  const evidence=patternEvidence(state,pattern);
  const supports=evidence.supports.length, against=evidence.against.length;
  const areas=new Set(evidence.supports.flatMap((row)=>row.item.domains ?? [])).size;
  const update=modelUpdateFor(state,pattern);
  let level=pattern?.strength ?? "Emerging", status=String(pattern?.status ?? "emerging").toLowerCase(), look="tentative", basis="model", provenance=pattern?.provenance ?? "Live AI interpretation, validated against experienced evidence.";
  if(update.status==="revision"){level="Less certain";status="revision";look="shaky";basis="doubted";}
  else if(level==="Strong"){look="firm";}
  return {level,status,look,basis,provenance,supports,against,heldUp:evidence.heldUp.length,areas};
}

export function confidenceOf(state,pattern){
  const update=modelUpdateFor(state,pattern), c=patternConfidence(state,pattern);
  return {...update,...c,label:c.level,note:c.provenance,change:update.note};
}

export const evidenceCount=(rows)=>rows.supports.length+rows.against.length+rows.heldUp.length+rows.steers.length;

export function domainCoverage(state){
  const seen=Object.fromEntries(visibleDomains().map((d)=>[d.id,new Set()]));
  const add=(item)=>(item.domains ?? []).forEach((d)=>seen[d]?.add(item.id));
  starterItems(state).forEach(add);
  for(const feedback of Object.values(state.feedbackByRecommendation ?? {})){
    if(isExperiencedPositive(feedback)||isExperiencedNegative(feedback)) add(feedback.item);
  }
  return Object.fromEntries(Object.entries(seen).map(([domain,ids])=>[domain,ids.size]));
}

const listTitles=(rows)=>rows.map((row)=>`“${row.item.title}”`).join(", ");

export function tensions(state){
  const out=[];
  for(const pattern of patterns(state)){
    const evidence=patternEvidence(state,pattern);
    if(evidence.supports.length&&evidence.against.length) out.push({patternId:pattern.id,kind:"mixed",text:`${pattern.title}: ${listTitles(evidence.supports)} supported it, but ${listTitles(evidence.against)} counted against it.`});
    const spots=blindSpotsFor(state,pattern.id);
    if(spots.length) out.push({patternId:pattern.id,kind:"blind-spot",text:`${pattern.title}: Tastemake expected you to like ${spots.map((s)=>`“${s.item.title}”`).join(", ")} because of this, and it didn't hold up.`});
    if(pattern.status==="conditional") out.push({patternId:pattern.id,kind:"conditional",text:`${pattern.title}: Tastemake treats this one as conditional.`});
  }
  return out;
}

export function thinAreas(state){
  const list=patterns(state);
  const quiet=list.filter((pattern)=>evidenceCount(patternEvidence(state,pattern))===0);
  const coverage=domainCoverage(state);
  const thin=Object.entries(coverage).filter(([,count])=>count<=2).map(([domain,count])=>({domain,count}));
  return {quietPatterns:quiet,thinDomains:thin,coverage};
}

export const lean=(state,pattern)=>untriedReactionLean(state,pattern);
