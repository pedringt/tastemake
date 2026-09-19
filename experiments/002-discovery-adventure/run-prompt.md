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


## Locked H01-H09 model

```json
{
  "experiment_id": "002-discovery-adventure-boundaries",
  "source_experiment": "001-blind-taste-model",
  "profile_id": "pilot-user-001",
  "status": "locked_before_predictions",
  "reaction_scale": ["strong_positive", "positive", "mixed", "negative", "strong_negative"],
  "hypotheses": [
    {
      "id": "H01",
      "name": "Discovery over opacity",
      "claim": "Mystery and discovery are conditional positive signals rather than strong predictors by themselves. They should require additional support from structure, gameplay, atmosphere, character, or another established preference before driving a strong prediction.",
      "confidence": 76,
      "prediction_rule": "Do not treat mystery or discovery as sufficient. Raise a prediction only when discovery is paired with another established positive signal and enough structure or traction."
    },
    {
      "id": "H02",
      "name": "Dark genre material needs a distinct identity",
      "claim": "Darkness, horror, violence, or bleakness are not positive signals by themselves. Distinctive atmosphere, premise, mythology, visual identity, or storytelling approach matters more.",
      "confidence": 79,
      "prediction_rule": "Treat distinctive execution as more predictive than darkness itself."
    },
    {
      "id": "H03",
      "name": "Moral messiness is a feature, not a barrier",
      "claim": "The user frequently enjoys stories centered on compromised, selfish, abrasive, dangerous, manipulative, or morally ambiguous people.",
      "confidence": 92,
      "prediction_rule": "Do not penalize morally messy central characters; in strongly character-driven work they may raise the prediction."
    },
    {
      "id": "H04",
      "name": "Comedy skews abrasive, absurd, or deconstructive",
      "claim": "Comedy preferences skew toward absurdity, parody, ego-driven characters, social ugliness, deliberate stupidity, and highly specific comic voices more than warm, wholesome, or earnest contemporary comedy.",
      "confidence": 94,
      "prediction_rule": "Abrasive, absurd, committed, or highly specific comedy should predict better than comfort-oriented warmth."
    },
    {
      "id": "H05",
      "name": "Mythic and fantastical material works better when it feels adult",
      "claim": "The user is highly receptive to myth, fantasy, folklore, and supernatural material, but adult tone and treatment are more predictive than subject matter alone.",
      "confidence": 90,
      "prediction_rule": "Mature, strange, psychologically serious, dark, or formally distinctive fantasy/myth gets a stronger prediction than mythology alone."
    },
    {
      "id": "H06",
      "name": "Agency moderates difficulty frustration",
      "claim": "Agency specifically moderates frustration from game difficulty; it should not be generalized into a broader preference for open-ended game structure. When difficulty creates a bottleneck, alternatives help. Outside that situation, freedom of movement tells us much less.",
      "confidence": 95,
      "prediction_rule": "Use agency as a positive modifier only when it helps escape difficulty or progression bottlenecks. Do not use openness itself as a general positive."
    },
    {
      "id": "H07",
      "name": "Sense of place and discovery are enhancers, not primary drivers",
      "claim": "A strong sense of place and discovery can enhance games the user already responds to, but exploration itself is not a reliable primary driver of enjoyment.",
      "confidence": 72,
      "prediction_rule": "Exploration should raise a prediction only when another appealing system, clear objective, or narrative structure is doing substantial work too."
    },
    {
      "id": "H08",
      "name": "Choreographed action is a specific positive signal",
      "claim": "The user has a distinct positive response to memorable physical choreography, particularly martial arts, rather than action being a generic preference.",
      "confidence": 99,
      "prediction_rule": "Highly regarded physical fight choreography should independently raise an action-movie prediction; generic quantity of action should not."
    },
    {
      "id": "H09",
      "name": "Tonal mixing and genre collision are often positives",
      "claim": "The user appears comfortable with works that deliberately mix serious material with humor, surrealism, horror, fantasy, pulp, or absurdity.",
      "confidence": 78,
      "prediction_rule": "Strangeness or tonal mixture should not lower a prediction when the combination feels deliberate, but this is a modifier rather than a requirement."
    }
  ],
  "open_questions": [
    "What distinguishes discovery as an enjoyable feature from discovery as a frustrating primary activity?",
    "Is straightforward adventure, charisma, momentum, or spectacle an under-modeled positive axis?"
  ]
}

```

## Experiment 002 holdout

```json
{
  "experiment_id": "002-discovery-adventure-boundaries",
  "profile_id": "pilot-user-001",
  "instructions": "Predict reactions using only the locked H01-H09 model. Do not revise the model before predicting. Some items may later be marked not experienced and excluded from scoring.",
  "items": [
    {
      "id": "d01_witness",
      "title": "The Witness",
      "medium": "game",
      "test_dimension": "discovery_as_main_appeal",
      "why_selected": "Puzzle/discovery-focused with sparse external narrative propulsion."
    },
    {
      "id": "d02_forgotten_city",
      "title": "The Forgotten City",
      "medium": "game",
      "test_dimension": "structured_discovery",
      "why_selected": "Mystery and discovery are embedded in explicit goals, dialogue, and narrative structure."
    },
    {
      "id": "d03_firewatch",
      "title": "Firewatch",
      "medium": "game",
      "test_dimension": "guided_narrative_exploration",
      "why_selected": "Exploration exists inside a strongly guided character and narrative experience."
    },
    {
      "id": "d04_999",
      "title": "999: Nine Hours, Nine Persons, Nine Doors",
      "medium": "game",
      "test_dimension": "structured_mystery_and_puzzles",
      "why_selected": "Mystery/puzzles with strong goals, stakes, and narrative propulsion rather than open wandering."
    },
    {
      "id": "a01_mummy",
      "title": "The Mummy (1999)",
      "medium": "movie",
      "test_dimension": "straightforward_adventure_charisma",
      "why_selected": "Pulpy adventure, humor, charismatic leads, supernatural spectacle, and momentum."
    },
    {
      "id": "a02_pirates",
      "title": "Pirates of the Caribbean: The Curse of the Black Pearl",
      "medium": "movie",
      "test_dimension": "adventure_charisma_worldbuilding",
      "why_selected": "Adventure, charisma, action, fantasy, humor, and a distinctive world without relying heavily on darkness or ambiguity."
    },
    {
      "id": "a03_national_treasure",
      "title": "National Treasure",
      "medium": "movie",
      "test_dimension": "adventure_plus_structured_discovery",
      "why_selected": "Straightforward adventure where clues and discovery are tightly attached to momentum and clear objectives."
    },
    {
      "id": "a04_fury_road",
      "title": "Mad Max: Fury Road",
      "medium": "movie",
      "test_dimension": "spectacle_momentum_low_mystery",
      "why_selected": "Tests whether action, visual identity, momentum, and spectacle can succeed without mystery or deep world explanation."
    }
  ]
}

```
