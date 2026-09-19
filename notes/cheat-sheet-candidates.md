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


## Targeted follow-up evals
After a failure exposes an uncertain boundary, the next test should deliberately separate competing explanations.

Tastemake example:
- Experiment 001 missed *Outer Wilds* and exposed uncertainty around exploration/discovery.
- Experiment 002 selected titles where discovery was either the main activity or supported by stronger narrative/goal structures.
- The result clarified the boundary instead of simply measuring another random accuracy percentage.

## Avoiding hypothesis proliferation
Do not create a new preference rule every time one item surprises the model.

Tastemake example:
*Indiana Jones and the Last Crusade* was underpredicted, raising the possibility of a missing "straightforward adventure" preference. Experiment 002 tested that idea across multiple titles. The results did not justify a new hypothesis, so the model kept it as an open question.

This prevents overfitting and keeps the taste model interpretable.

## Feature vs. driver
A feature can improve something without being the main reason the user likes it.

Tastemake example:
Exploration/discovery appears to be an **enhancer** when paired with goals, narrative, stakes, or strong systems. It is not yet supported as a reliable primary driver of enjoyment.


## Classification vs. ranking
A model can be good at predicting "you would like this" for an item it is shown and still be bad at deciding **which item to recommend** from many possibilities.

Classification asks:
> How will the user react to this item?

Ranking asks:
> Which of these candidates is most worth showing the user first?

Recommendation products need both.

## Recommendation quality vs. item reaction
"Did I like it?" and "Was this a good recommendation?" are different labels.

A user can dislike an item but still think it was a thoughtful recommendation. A user can also like something that was an obvious, low-value recommendation.

Tracking both helps distinguish:
- a bad taste prediction;
- a reasonable recommendation that happened to miss;
- weak ranking or novelty.

## Precommitted alternates
When an eval depends on hidden facts such as whether the user has already experienced an item, choose backup items **before** revealing those facts.

This prevents post-hoc reranking and keeps the evaluation honest.

## Surprise Me as an exploration strategy
A recommendation system should not only exploit the safest known preferences.

A controlled "Surprise Me" slot can explore a less obvious hypothesis with bounded risk. If it works, the model learns a new region of taste. If it fails, the reaction should still reduce uncertainty.


## Fit confidence vs. predicted enjoyment
A recommendation model may know that an item matches a user's taste patterns without knowing whether that item will become a favorite.

Tastemake Experiment 003 selected several good recommendations but consistently predicted `strong_positive` when the actual reaction was only `positive`.

Product lesson:
- **fit confidence** = how well the item matches the model;
- **predicted enjoyment** = how strongly the user is expected to like it.

Do not collapse those into one score.

## Set quality vs. rank quality
A recommender can choose a good group of items without proving that #1 is better than #4.

If several selected items all get the same actual reaction, the experiment validates the **selection set** but not the exact ranking order.

## Retroactive vs. live recommendation eval
A retroactive eval asks whether the recommender would have selected items the user has already experienced.

That is useful for cheap early validation, but it does not prove the system can recommend something genuinely new.

A later live eval should test:
- unseen items;
- whether the user chooses to try them;
- actual reaction afterward;
- whether Surprise Me expands the model successfully.
