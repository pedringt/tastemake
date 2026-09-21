# Experiment 003 Scorecard

## Selection quality

- Experienced committed items: 6
- Positive reactions: 5/6
- Good recommendations: 5/6
- Experienced Top 5: 4
- Positive Top 5 reactions: 4/4
- Good Top 5 recommendations: 4/4

## Reaction prediction

- Exact five-level matches: 1/6
- One-step intensity near misses: 5/6
- Polarity misses: 0/6

## Calibration

**Needs improvement.**

The top four experienced recommendations were predicted `strong_positive` at 86-94 confidence, but all four actual reactions were only `positive`.

This is a consistent pattern rather than a single miss.

## Ranking

**Inconclusive.**

The four experienced Top 5 items all landed at the same actual reaction level, so the model did not demonstrate that its exact rank order was meaningful.

## Recommendation quality

**Promising.**

Five of six experienced committed items were judged good recommendations.

The one failure, *Severance*, was both:
- weaker than predicted (mixed vs. positive);
- explicitly judged not to be a good recommendation.

That gives the system an actionable negative example.

## Surprise Me

**Not scored.**

The committed Surprise Me item, *Inscryption*, was not experienced.

## Decision

**Proceed to prototype.**

Do not run another broad manual static experiment before prototyping unless a specific unresolved product risk emerges.

Prototype priorities:
1. taste-model display;
2. recommendation rationale;
3. reaction feedback;
4. separate recommendation-quality feedback;
5. visible "what Tastemake learned" update;
6. conservative confidence/intensity presentation.

Future eval priority:
- genuinely unseen recommendations;
- Surprise Me success/failure;
- calibration between `positive` and `strong_positive`.
