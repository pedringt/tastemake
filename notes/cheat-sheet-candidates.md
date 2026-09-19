# AI product cheat-sheet candidate notes

Living notes for concepts worth turning into simple learning/portfolio explanations later.

## Holdout set
A set of examples hidden from the model while it forms its initial theory. Use them afterward to test whether the theory predicts anything it has not already seen.

Tastemake example: form taste hypotheses from training reactions, lock them, then predict hidden titles.

## Hypothesis vs. tag
A tag says what something is: "fantasy," "horror," "comedy."

A useful hypothesis says what seems to cause a user's reaction and can be wrong:
"Discovery helps when there is enough structure and forward pull."

Hypotheses are more useful because they can make predictions and be revised.

## Calibration
Confidence should reflect how likely the system thinks it is to be right.

A wrong 86% prediction is more informative than a wrong 52% prediction because it shows the model was not just wrong, but overconfident.

## Correlation vs. causal preference
A feature may appear repeatedly in favorites without being the reason those items are favorites.

Tastemake example: many favorite games contain exploration/discovery, but *Myst*, *Dear Esther*, and *Outer Wilds* show that exploration itself may not be the primary positive driver.

## Postmortem discipline
When a prediction fails:
1. identify which hypothesis produced it;
2. treat the failure as evidence against that claim;
3. narrow or lower confidence where justified;
4. do not invent a new explanation solely to save the original theory.

## Adaptive calibration
Instead of asking a user to fill out a long questionnaire, start with high-signal favorites and have the system choose the next examples that best distinguish between competing taste explanations.

This is related to information gain: ask the question whose answer would reduce the most uncertainty.

## Explicit vs. inferred evidence
Explicit evidence: "I loved this" or "difficulty made me quit."

Inferred evidence: "You may prefer structured discovery."

Keep them distinct so the system can revise an inference without rewriting what the user actually said.

## Recommendation feedback as evaluation
A recommendation creates a prediction that can be tested.

Useful signals may include:
- actual reaction to the item;
- whether the user considered it a good recommendation;
- optional reason for a strong positive or negative reaction.

This makes personalization and evaluation part of the same loop.
