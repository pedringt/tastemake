# Experiment 001: Blind taste-model eval — Results

## Status

**Result:** Promising. The pilot showed predictive signal beyond broad genre matching, but the taste model is not yet robust.

The experiment used a frozen training set to generate nine taste hypotheses (H01-H09), then predicted reactions to eight unlabeled holdout items before revealing the user's actual reactions.

## Holdout results

| Item | Predicted | Actual | Classification |
| --- | --- | --- | --- |
| The Lord of the Rings | strong_positive | strong_positive | exact |
| Circe | positive | strong_positive | near miss |
| Indiana Jones and the Last Crusade | positive | strong_positive | near miss |
| Piranesi | strong_positive | positive | near miss |
| Alan Wake 2 | strong_positive | strong_positive | exact |
| Outer Wilds | positive | negative | miss |
| Schitt's Creek | negative | negative | exact |
| The Traitors | positive | positive | exact |

**Summary:** 4 exact matches, 3 one-step intensity misses, 1 polarity miss. Seven of eight predictions got the positive/negative direction right.

## What worked

### Comedy specificity

The model did not reduce the user's comedy taste to "likes comedy." H04 distinguished abrasive, absurd, deconstructive comedy from warmer, earnest contemporary comedy and correctly predicted a negative reaction to *Schitt's Creek* despite many positive comedy examples in training.

### Cross-medium social dynamics

The model used H03 and H01 to predict a positive reaction to *The Traitors*, generalizing from interest in morally messy characters, hidden information, manipulation, and social dynamics rather than matching an existing competition-reality title.

### Mythic/fantastical material

H05 performed well directionally. *The Lord of the Rings* was correctly predicted as strong-positive, while *Circe* was underpredicted by one intensity step.

## Most informative miss: Outer Wilds

The model predicted *Outer Wilds* as positive with 86% confidence and was wrong.

That miss exposed three problems:

1. **Discovery was overweighted.** Mystery, exploration, and systemic discovery appeared often in favorites, but the model treated a correlated feature as a stronger causal preference than the evidence justified.
2. **Exploration was too broad a predictor.** *Myst*, *Dear Esther*, and now *Outer Wilds* show that exploration/discovery alone is not enough.
3. **Agency was overgeneralized.** The user's explicit *Elden Ring* feedback supported "freedom helps when difficulty creates a bottleneck," not "open-ended structure is generally preferred."

## Revisions after reveal

### H01 — Discovery over opacity

**Before:** Discovery-driven mysteries were treated as a strong positive when they provided enough traction.

**After:** Mystery and discovery are conditional positives. They should require support from other established preferences before driving a strong prediction.

**Confidence:** 88 → 76.

### H07 — Games benefit from a strong sense of place and discovery

**Before:** Exploration, place, and learning how a game world works were treated as a strong game preference.

**After:** Those qualities can enhance games the user already responds to, but exploration itself is not a reliable primary driver.

**Confidence:** 86 → 72.

### H06 — Difficulty is acceptable until it removes agency

**Before:** Freedom to change objectives or routes was treated broadly as favorable.

**After:** Agency specifically moderates frustration caused by difficulty bottlenecks. It should not be generalized into a preference for open-ended structure.

**Confidence:** 98 → 95 in the narrower claim.

## New questions exposed

### Discovery as a feature vs. discovery as the main appeal

The next model needs to distinguish works that contain discovery from works whose primary reward is discovery itself.

### Straightforward adventure / charisma / spectacle

*Indiana Jones and the Last Crusade* was an all-time favorite but was predicted only positive. Combined with the original *Star Wars* trilogy in training, this suggests the first hypothesis set may underrepresent a simpler adventure/fun axis. Evidence is not yet strong enough to create a new hypothesis.

## Conclusion

Experiment 001 demonstrated enough predictive signal to continue. The useful result is not just the 7/8 directional accuracy. The model generated specific hypotheses, used some of them to generalize beyond genre, and revised an overbroad abstraction after a confident miss.

The next experiment should deliberately test the two unresolved distinctions above rather than simply adding more random holdout items.
