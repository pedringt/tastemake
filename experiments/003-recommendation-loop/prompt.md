# Tastemake Experiment 003: Recommendation selection

You are testing whether a locked taste model can **select useful recommendations**, not merely predict reactions to titles chosen for it.

You will receive:
1. a locked H01-H09 taste model;
2. a candidate pool with neutral catalog metadata.

Some candidates may already have been experienced by the user, but exposure status and actual reactions are intentionally hidden. Treat every candidate as eligible. This is a retroactive recommendation eval: after you commit your choices, the user will reveal which selections they have experienced and how they reacted.

## Rules

- Use the locked H01-H09 model exactly as supplied.
- Do not revise or add hypotheses before making selections.
- Do not browse.
- Do not use prior chats, memory, user profiles, or outside information about this user's preferences.
- You may use ordinary background knowledge of the titles, but do not override the supplied catalog metadata with speculative details.
- Do not ask which items the user has already experienced.
- Do not optimize for medium diversity. If the strongest recommendations cluster in one medium, that is allowed.
- Avoid choosing an item merely because it is the closest surface-level genre match. The recommendation must be justified by the locked taste model.
- Do not predict every candidate. This experiment tests **selection and ranking**.
- All recommendations, alternates, predicted reactions, and confidence values must be committed before asking for feedback.

## Task A: Choose the five best-fit recommendations

Rank exactly five distinct items from #1 to #5.

For each provide:
- `item_id`
- `title`
- `medium`
- `predicted_reaction`: `strong_positive`, `positive`, `mixed`, `negative`, or `strong_negative`
- `confidence`: 0-100
- `decisive_hypotheses`: H01-H09 IDs
- `recommendation_reason`: why this is a good fit
- `why_it_ranks_here`: why it deserves this rank over nearby candidates
- `failure_risk`: strongest reason the recommendation could miss

## Task B: Choose one Surprise Me recommendation

Choose exactly one additional item that is **not** in the top five.

The Surprise Me choice should:
- be less obvious from surface genre/category similarity;
- still have a defensible path through deeper cross-media taste signals;
- ideally teach the model something useful whether it succeeds or fails.

Provide the same fields as above plus:
- `surprise_logic`: why this is a deeper or less obvious recommendation
- `learning_value`: what the user's reaction would teach the taste model

## Task C: Commit four alternates

Choose four additional distinct items as committed backup recommendations, ranked A1-A4.

These are fixed before exposure status is revealed so that the experiment can still be scored if several primary selections are unexperienced.

For each provide:
- `item_id`
- `title`
- `predicted_reaction`
- `confidence`
- `decisive_hypotheses`
- one-sentence reason

## Task D: Pre-reveal recommendation read

Before asking for feedback, state:

1. Which top recommendation is safest?
2. Which top recommendation is most likely to be overconfident?
3. What tradeoff did you make between obvious fit and useful novelty?
4. What would count as evidence that the **ranking logic** is poor even if individual reaction predictions are mostly correct?
5. What would count as evidence that the **taste model** is poor rather than the ranking logic?

End with:

**Recommendations are now committed.**

Do not ask for or infer actual reactions until all of the above is complete.
