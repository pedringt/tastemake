// Deterministic no-model baseline used by evals. Production no longer has a hand-written
// recommendation or Taste Profile seed. The baseline therefore stays deliberately conservative:
// no invented hypotheses, and catalog candidates only.

export function inferHypotheses() {
  return { hypotheses: [], insufficientEvidence: true };
}

export function explainPicks(state, ctx) {
  const experienced = (ctx.evidence ?? []).filter((row) => row.class === "experienced" && row.polarity > 0);
  const firstEvidence = experienced[0]?.ref ?? null;
  const reasons = [
    (item) => `Catalog neighbors of ${item.relatedTo || "your experienced favorites"} include ${item.title}.`,
    (item) => `${item.title} surfaced through provider relationships around ${item.relatedTo || "your experienced favorites"}.`,
    (item) => `From ${item.relatedTo || "your experienced favorites"}, Tastemake followed nearby metadata to ${item.title}.`,
    (item) => `${item.title} sits in a related catalog cluster connected to ${item.relatedTo || "your experienced favorites"}.`,
    (item) => `A separate catalog branch from ${item.relatedTo || "your experienced favorites"} leads to ${item.title}.`
  ];
  return {
    picks: (ctx.candidates ?? []).slice(0, 5).map((item, index) => ({
      itemId: item.id,
      why: reasons[index % reasons.length](item),
      cites: firstEvidence ? [firstEvidence] : [],
      tests: null,
      kind: state.curveball !== false && index === 4 ? "curveball" : "pick"
    }))
  };
}
