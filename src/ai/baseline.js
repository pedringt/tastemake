// Deterministic no-model baseline used by evals. Production no longer has a hand-written
// recommendation or Taste Profile seed. The baseline therefore stays deliberately conservative:
// no invented hypotheses, and catalog candidates only.

export function inferHypotheses() {
  return { hypotheses: [], insufficientEvidence: true };
}

export function explainPicks(state, ctx) {
  const positive = (ctx.evidence ?? []).filter((row) => row.class === "experienced" && row.polarity > 0);
  const byTitle = new Map(positive.map((row) => [row.title, row]));
  const firstEvidence = positive[0]?.ref ?? null;
  const reasons = [
    (item) => item.relatedTo ? `Because you liked ${item.relatedTo}, Tastemake thinks ${item.title} is worth trying next.` : `${item.title} is a related pick worth testing against things you've liked.`,
    (item) => item.relatedTo ? `${item.title} is an adjacent pick to ${item.relatedTo}, which you liked.` : `${item.title} is a nearby fit based on things you've liked.`,
    (item) => item.relatedTo ? `Your positive reaction to ${item.relatedTo} helped surface ${item.title} as another possibility.` : `Tastemake is testing ${item.title} against your positive taste evidence.`,
    (item) => `${item.title} is a more exploratory pick that still connects back to things you've liked.`,
    (item) => item.relatedTo ? `If what worked for you in ${item.relatedTo} carries over, ${item.title} may be worth a try.` : `${item.title} is a cautious test outside your strongest patterns.`
  ];
  return {
    picks: (ctx.candidates ?? []).slice(0, 5).map((item, index) => {
      const cited = byTitle.get(item.relatedTo)?.ref ?? firstEvidence;
      return {
        itemId: item.id,
        why: reasons[index % reasons.length](item),
        cites: cited ? [cited] : [],
        tests: null,
        kind: state.curveball !== false && index === 4 ? "curveball" : "pick"
      };
    })
  };
}
