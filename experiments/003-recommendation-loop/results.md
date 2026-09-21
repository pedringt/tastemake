# Experiment 003: Recommendation selection and feedback loop — Results

## Status

**Result:** Recommendation selection looks useful, but confidence and intensity calibration are too aggressive.

Experiment 003 tested whether the locked Tastemake taste model could choose what to recommend from a 32-item mixed-media candidate pool, rather than merely predict reactions to hand-picked titles.

The model committed:
- 5 ranked top recommendations;
- 1 Surprise Me recommendation;
- 4 alternates;
- reaction predictions and confidence values;
- recommendation rationales;
- failure risks.

Only experienced items are scored.

## Experienced selections

| Item | Role | Predicted | Actual | Prediction result | Good recommendation? |
| --- | --- | --- | --- | --- | --- |
| Everything Everywhere All at Once | Top #1 | strong_positive | positive | near miss | yes |
| Barry | Top #2 | strong_positive | positive | near miss | yes |
| What We Do in the Shadows | Top #3 | strong_positive | positive | near miss | yes |
| Disco Elysium | Top #4 | strong_positive | positive | near miss | yes |
| Severance | Alternate A1 | positive | mixed | near miss | no |
| The Nice Guys | Alternate A4 | positive | positive | exact | yes |

## Unscored because not experienced

- The Library at Mount Char
- Inscryption
- The Handmaiden
- The Spear Cuts Through Water

The Surprise Me slot therefore remains untested in this experiment.

## Quantitative summary

Among the 6 experienced committed items:

- **5/6** were positive reactions.
- **5/6** were judged good recommendations.
- **1/6** reaction predictions were exact on the five-level scale.
- **5/6** were one-step intensity misses.
- **0/6** were polarity misses.

Among the experienced Top 5 selections specifically:

- 4/4 produced positive reactions.
- 4/4 were judged good recommendations.
- All four were overpredicted by one intensity level: strong_positive → positive.

## Main finding: ranking/selection was stronger than calibration

The model successfully selected a set of items that the user generally liked and considered reasonable recommendations.

The failure was not primarily "wrong item selection." It was **overconfidence about intensity**.

Four high-ranked recommendations were all predicted strong-positive with confidence from 86-94, but the user rated each only positive.

That suggests the current recommendation logic can identify fit while still being too eager to label a fit as a likely favorite.

## Severance: useful recommendation-quality distinction

*Severance* was predicted positive, but the actual reaction was mixed and the user said it was **not** a good recommendation.

This is useful because it shows why Tastemake should separately collect:
- reaction to the item;
- recommendation quality.

A mixed reaction alone might look like a modest prediction miss. The separate recommendation-quality label says the system should also reconsider why this item was surfaced at all.

## What Experiment 003 did not prove

### Ranking order
The experienced Top 5 items all received the same actual reaction: positive.

That means the experiment supports the **selection set**, but does not validate the exact ordering of #1 through #4.

### Surprise Me
The Surprise Me recommendation, *Inscryption*, was not experienced, so controlled exploration remains untested.

### Novel-item recommendation performance
This was a retroactive eval. The experiment shows that the model can choose previously experienced good fits from a candidate pool. It does not yet prove that a user will try and enjoy a genuinely new recommendation.

## Product implication

The Tastemake MVP should not present high-confidence "you will love this" language too aggressively.

A safer first version would separate:
- **fit confidence**: how well the item matches the current taste model;
- **predicted reaction**: expected enjoyment intensity.

The model may be fairly good at identifying a good fit before it is good at identifying which fits will become favorites.

## Conclusion

Experiment 003 supports moving to a prototype.

The recommendation set performed well enough to justify testing the real product loop:

**favorites → taste model → recommendation → user feedback → model update**

The first prototype should include:
- recommendation rationale;
- actual reaction;
- good recommendation? feedback;
- explicit model-learning/revision after feedback;
- conservative confidence/intensity language.

A future live test should specifically evaluate Surprise Me and genuinely unseen recommendations.
