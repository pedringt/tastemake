// Deterministic no-model baseline used by evals. Production no longer has a hand-written
// recommendation or Taste Profile seed. The baseline therefore stays deliberately conservative:
// no invented hypotheses, and catalog candidates only.

export function inferHypotheses() {
  return { hypotheses: [], insufficientEvidence: true };
}

export function explainPicks(state, ctx) {
  const experienced = (ctx.evidence ?? []).filter((row) => row.class === "experienced" && row.polarity > 0);
  const firstEvidence = experienced[0]?.ref ?? null;
  return {
    picks: (ctx.candidates ?? []).slice(0, 5).map((item, index) => ({
      itemId: item.id,
      why: item.relatedTo
        ? `Related in the catalog to ${item.relatedTo}.`
        : "A real catalog candidate related to your experienced favorites.",
      cites: firstEvidence ? [firstEvidence] : [],
      tests: null,
      kind: state.curveball !== false && index === 4 ? "curveball" : "pick"
    }))
  };
}
