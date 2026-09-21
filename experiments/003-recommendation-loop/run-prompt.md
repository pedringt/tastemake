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


## Locked taste model

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

## Candidate pool

```json
{
  "experiment_id": "003-recommendation-loop",
  "pool_version": "1.0",
  "note": "Exposure status and actual reactions are intentionally hidden. Metadata is neutral catalog information, not preference evidence.",
  "candidates": [
    {
      "id": "b01_addie_larue",
      "title": "The Invisible Life of Addie LaRue",
      "medium": "book",
      "traits": [
        "adult fantasy",
        "immortality bargain",
        "romance",
        "long-spanning story",
        "lyrical style"
      ]
    },
    {
      "id": "b02_diavola",
      "title": "Diavola",
      "medium": "book",
      "traits": [
        "contemporary horror",
        "dysfunctional family",
        "haunted villa",
        "dark humor",
        "family tension"
      ]
    },
    {
      "id": "b03_library_mount_char",
      "title": "The Library at Mount Char",
      "medium": "book",
      "traits": [
        "dark fantasy",
        "secret knowledge",
        "surrealism",
        "violence",
        "unconventional mythology"
      ]
    },
    {
      "id": "b04_spear_cuts_water",
      "title": "The Spear Cuts Through Water",
      "medium": "book",
      "traits": [
        "epic fantasy",
        "mythic storytelling",
        "experimental structure",
        "quest",
        "romance"
      ]
    },
    {
      "id": "b05_vita_nostra",
      "title": "Vita Nostra",
      "medium": "book",
      "traits": [
        "dark academic fantasy",
        "transformation",
        "metaphysical ideas",
        "strangeness",
        "demanding ambiguity"
      ]
    },
    {
      "id": "b06_legends_lattes",
      "title": "Legends & Lattes",
      "medium": "book",
      "traits": [
        "cozy fantasy",
        "low stakes",
        "found family",
        "romance",
        "warm humor"
      ]
    },
    {
      "id": "b07_midnight_library",
      "title": "The Midnight Library",
      "medium": "book",
      "traits": [
        "contemporary speculative fiction",
        "alternate lives",
        "regret",
        "emotional reflection",
        "accessible structure"
      ]
    },
    {
      "id": "b08_and_i_darken",
      "title": "And I Darken",
      "medium": "book",
      "traits": [
        "historical fiction",
        "political ambition",
        "morally ruthless protagonist",
        "court intrigue",
        "YA framing"
      ]
    },
    {
      "id": "m01_witch",
      "title": "The Witch",
      "medium": "movie",
      "traits": [
        "folk horror",
        "historical setting",
        "family conflict",
        "religious dread",
        "slow-burn atmosphere"
      ]
    },
    {
      "id": "m02_lighthouse",
      "title": "The Lighthouse",
      "medium": "movie",
      "traits": [
        "psychological drama",
        "black comedy",
        "surrealism",
        "claustrophobia",
        "ambiguity"
      ]
    },
    {
      "id": "m03_annihilation",
      "title": "Annihilation",
      "medium": "movie",
      "traits": [
        "science-fiction horror",
        "expedition",
        "transformation",
        "mystery",
        "visual surrealism"
      ]
    },
    {
      "id": "m04_handmaiden",
      "title": "The Handmaiden",
      "medium": "movie",
      "traits": [
        "period thriller",
        "deception",
        "twists",
        "morally complex characters",
        "stylized filmmaking"
      ]
    },
    {
      "id": "m05_dnd",
      "title": "Dungeons & Dragons: Honor Among Thieves",
      "medium": "movie",
      "traits": [
        "fantasy adventure",
        "ensemble",
        "comedy",
        "action",
        "warm character dynamics"
      ]
    },
    {
      "id": "m06_nice_guys",
      "title": "The Nice Guys",
      "medium": "movie",
      "traits": [
        "buddy comedy",
        "crime mystery",
        "abrasive humor",
        "1970s setting",
        "character chemistry"
      ]
    },
    {
      "id": "m07_prestige",
      "title": "The Prestige",
      "medium": "movie",
      "traits": [
        "period thriller",
        "rivalry",
        "obsession",
        "mystery",
        "nonlinear reveals"
      ]
    },
    {
      "id": "m08_eeaao",
      "title": "Everything Everywhere All at Once",
      "medium": "movie",
      "traits": [
        "science-fiction",
        "action",
        "absurd comedy",
        "family drama",
        "martial arts",
        "tonal mixing"
      ]
    },
    {
      "id": "t01_severance",
      "title": "Severance",
      "medium": "tv",
      "traits": [
        "science-fiction",
        "workplace mystery",
        "identity",
        "slow reveal",
        "dark humor",
        "distinctive visual design"
      ]
    },
    {
      "id": "t02_barry",
      "title": "Barry",
      "medium": "tv",
      "traits": [
        "dark comedy",
        "crime",
        "morally compromised lead",
        "violence",
        "absurdity"
      ]
    },
    {
      "id": "t03_fargo",
      "title": "Fargo",
      "medium": "tv",
      "traits": [
        "crime anthology",
        "dark comedy",
        "moral messiness",
        "violence",
        "stylized dialogue"
      ]
    },
    {
      "id": "t04_yellowjackets",
      "title": "Yellowjackets",
      "medium": "tv",
      "traits": [
        "survival drama",
        "mystery",
        "horror",
        "dual timelines",
        "messy ensemble"
      ]
    },
    {
      "id": "t05_leftovers",
      "title": "The Leftovers",
      "medium": "tv",
      "traits": [
        "grief drama",
        "mystery",
        "ambiguity",
        "spiritual themes",
        "character focus"
      ]
    },
    {
      "id": "t06_wwdits",
      "title": "What We Do in the Shadows",
      "medium": "tv",
      "traits": [
        "supernatural sitcom",
        "absurd comedy",
        "selfish characters",
        "mockumentary",
        "ensemble"
      ]
    },
    {
      "id": "t07_dark",
      "title": "Dark",
      "medium": "tv",
      "traits": [
        "science-fiction mystery",
        "time travel",
        "dense plotting",
        "family drama",
        "somber tone"
      ]
    },
    {
      "id": "t08_good_place",
      "title": "The Good Place",
      "medium": "tv",
      "traits": [
        "philosophical sitcom",
        "warmth",
        "moral growth",
        "high-concept fantasy",
        "ensemble comedy"
      ]
    },
    {
      "id": "g01_signalis",
      "title": "Signalis",
      "medium": "game",
      "traits": [
        "survival horror",
        "science fiction",
        "puzzles",
        "atmosphere",
        "fragmented narrative"
      ]
    },
    {
      "id": "g02_soma",
      "title": "SOMA",
      "medium": "game",
      "traits": [
        "science-fiction horror",
        "exploration",
        "philosophical narrative",
        "limited combat",
        "underwater setting"
      ]
    },
    {
      "id": "g03_disco_elysium",
      "title": "Disco Elysium",
      "medium": "game",
      "traits": [
        "narrative RPG",
        "morally messy protagonist",
        "dense dialogue",
        "choices",
        "dark humor"
      ]
    },
    {
      "id": "g04_pentiment",
      "title": "Pentiment",
      "medium": "game",
      "traits": [
        "historical narrative",
        "mystery",
        "investigation",
        "dialogue",
        "choices",
        "slow pace"
      ]
    },
    {
      "id": "g05_inscryption",
      "title": "Inscryption",
      "medium": "game",
      "traits": [
        "card game",
        "puzzles",
        "horror",
        "meta structure",
        "genre shifts",
        "mystery"
      ]
    },
    {
      "id": "g06_golden_idol",
      "title": "The Case of the Golden Idol",
      "medium": "game",
      "traits": [
        "deduction puzzles",
        "murder mysteries",
        "explicit inference",
        "minimal action",
        "structured cases"
      ]
    },
    {
      "id": "g07_immortality",
      "title": "Immortality",
      "medium": "game",
      "traits": [
        "interactive film",
        "mystery",
        "nonlinear discovery",
        "experimental structure",
        "performance-focused"
      ]
    },
    {
      "id": "g08_pathologic_2",
      "title": "Pathologic 2",
      "medium": "game",
      "traits": [
        "survival narrative",
        "punishing systems",
        "bleak world",
        "moral choices",
        "high difficulty"
      ]
    }
  ]
}
```
