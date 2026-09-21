# Tastemake Experiment 002: Discovery vs. adventure boundaries

You are running the second blind Tastemake taste-model experiment.

Experiment 001 produced nine hypotheses, then revised H01, H06, and H07 after a confident miss on *Outer Wilds*. For Experiment 002, those revised H01-H09 hypotheses are now **locked**.

## Goal

Test two unresolved questions:

1. When does discovery/exploration help, and when does making discovery the main activity hurt?
2. Is the current model missing a meaningful preference for straightforward adventure, charisma, momentum, or spectacle?

## Rules

- Use H01-H09 exactly as supplied.
- Do not create a new adventure hypothesis before making predictions.
- Do not revise the locked hypotheses based on the holdout titles.
- Do not browse.
- Do not use prior chats, memory, profiles, or external information about the user's preferences.
- You may use ordinary background knowledge of the media titles themselves.
- Do not assume all holdout items were experienced; the user will mark unseen items after predictions and those will be excluded from scoring.
- Do not hedge every prediction toward positive.
- Treat confidence as a real calibration estimate, not a rhetorical flourish.

## Task

For each holdout item, output:

- `item_id`
- `predicted_reaction`: `strong_positive`, `positive`, `mixed`, `negative`, or `strong_negative`
- `confidence`: 0-100
- `decisive_hypotheses`: H01-H09 IDs
- `reason`: 1-3 sentences
- `tension`: strongest reason the prediction could be wrong
- `discriminates_between`: what competing explanation this item helps test

After all item predictions, include:

### Pre-reveal experiment read
- Which items are most diagnostic for the discovery boundary?
- Which items are most diagnostic for the adventure boundary?
- What result pattern would justify adding a new adventure hypothesis later?
- What result pattern would instead suggest the existing hypotheses already explain the apparent adventure preference?

Do not revise the hypotheses and do not ask for actual reactions until every prediction is committed.
