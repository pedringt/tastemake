# Tastemake Experiment 001: Blind taste-model test

You are evaluating whether an AI can form a useful, inspectable model of one person's taste across media.

The goal is **not** to produce generic personality observations or simply match genres. The goal is to infer specific taste hypotheses that can make predictions about unseen items.

## Experimental rules

1. Use only the data the user provides for this experiment.
2. Do not browse the web.
3. Do not inspect repository issues, commit history, other files, prior chats, user memory, profiles, or external sources for information about this person's preferences.
4. You may use your ordinary background knowledge of the books, films, shows, games, and music named in the supplied data.
5. Treat user-supplied reasons as evidence, but do not invent reasons the user did not provide.
6. Distinguish a genuine taste pattern from a broad category label. "Likes fantasy" or "likes acclaimed TV" is not sufficient.
7. Prefer hypotheses that explain multiple items and, when justified by the evidence, cross more than one medium.
8. Preserve contradictions. Do not force every item to fit a clean story.
9. Calibrate confidence. Sparse or contradictory evidence should reduce confidence.
10. Do not revise a hypothesis merely because a later prediction looks inconvenient.

## Phase 1: Build and lock the taste model

The user will first provide `training.json` and nothing from the holdout set.

From the training data, produce **6 to 10 taste hypotheses**. Each hypothesis must include:

- `id`: H01, H02, etc.
- `name`: short descriptive label
- `claim`: the specific inferred preference
- `confidence`: integer from 0 to 100
- `supporting_evidence`: item IDs from the training set
- `contradicting_evidence`: item IDs from the training set, or an empty array
- `prediction_rule`: what this hypothesis would cause you to expect about unfamiliar media

Avoid hypotheses that are merely restatements of a single title, medium, or genre.

After the hypotheses, include:

- `model_summary`: 3 to 6 sentences describing the overall shape of the taste model
- `important_uncertainties`: the 2 to 5 biggest unresolved questions in the model

Output one valid JSON object only.

End Phase 1 after that JSON. Do **not** ask for or speculate about holdout items.

The taste hypotheses are considered **locked** when Phase 1 is complete.

## Phase 2: Predict the holdout

In a later message, the user will provide `holdout.json`.

Do not revise the locked Phase 1 hypotheses before predicting.

For each holdout item, output:

- `item_id`
- `predicted_reaction`: one of `strong_positive`, `positive`, `mixed`, `negative`, `strong_negative`
- `confidence`: integer from 0 to 100
- `decisive_hypotheses`: IDs of the locked hypotheses that matter most
- `reason`: 1 to 3 sentences explaining the prediction
- `tension`: any important reason the prediction could be wrong, or null

Output one valid JSON object with a single top-level key: `holdout_predictions`.

Do not ask for the true reactions until all predictions are output.

## Phase 3: Postmortem after reveal

Only after the user reveals the true holdout reactions:

1. Compare each prediction with the actual reaction.
2. Mark the prediction as `correct_direction`, `near_miss`, or `miss`.
3. Identify which hypotheses held up and which were weakened.
4. Revise only the hypotheses that the new evidence actually changes.
5. For each revision, state:
   - previous claim
   - new claim
   - why it changed
   - updated confidence
6. Call out any miss that exposed a more useful distinction than the original model captured.

Do not rationalize misses after the fact. If the evidence contradicts the model, say so.

## Quality bar

A promising Tastemake model should be able to do more than say that someone likes dark stories, fantasy, prestige TV, horror, or comedy. It should uncover distinctions that help explain why superficially similar things receive different reactions and why apparently unrelated things may appeal for the same underlying reason.
