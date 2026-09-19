# Experiment 001 Scorecard

## Quantitative result

- Holdout items: 8
- Exact five-level matches: 4/8
- One-step intensity near misses: 3/8
- Polarity misses: 1/8
- Correct positive/negative direction: 7/8

## Qualitative criteria

| Criterion | Result | Notes |
| --- | --- | --- |
| Non-generic hypotheses | Pass | Several hypotheses distinguished mechanisms within broad genres rather than merely labeling genres. |
| Cross-media reasoning | Pass | The model connected discovery, moral messiness, tonal mixing, and other patterns across media. |
| Useful uncertainty | Pass | Phase 1 explicitly flagged productive ambiguity vs. frustrating opacity as unresolved. |
| Calibration | Mixed | Some confidence values were too high, especially the 86% wrong prediction for Outer Wilds. |
| Prediction beyond genre matching | Pass with caveat | Schitt's Creek and The Traitors were useful examples; LOTR, Circe, and Alan Wake 2 were easier nearest-neighbor cases. |
| Miss analysis | Pass | The postmortem narrowed hypotheses rather than rationalizing the error. |
| Model revision | Pass | H01, H06, and H07 were revised in ways supported by the new evidence. |

## Pilot decision

**Continue.**

This result is strong enough to justify a second targeted experiment and an eventual prototype loop:

favorites → hypotheses → recommendation/prediction → user reaction → hypothesis revision

It is not yet evidence that Tastemake outperforms established recommendation methods.
