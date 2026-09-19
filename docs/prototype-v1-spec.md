# Tastemake Prototype v1 Spec

## Goal
Validate whether Tastemake can make useful cross-media recommendations and improve them from low-friction feedback.

The primary loop is:

**Favorites -> Recommendations -> React -> Better recommendations**

The Taste Profile is inspectable, but it is secondary to recommendation quality.

## Product principles
- Ask for the smallest useful amount of information.
- Make one tap enough to give feedback.
- Keep richer context optional.
- Keep explicit user signals separate from inferred taste patterns.
- Keep interest in an unfamiliar item separate from evidence that the user actually enjoys it.
- Explain why a recommendation fits when the user wants that context.
- Do not force users to study model updates before getting better recommendations.
- Keep recommendation order stable while the user reacts to a set.

## Section 1: Favorites
Purpose: create enough initial signal without asking for an exhaustive history.

Requirements:
- Show a compact cross-media starter set.
- Allow multi-select.
- Preselect a plausible starter set for demo purposes.
- Require at least four selections before recommendations are available.
- Let the user go directly from Favorites to Recommendations.
- Keep Taste Profile available as an optional inspection path.

## Section 2: Taste Profile
Purpose: let curious users inspect the patterns Tastemake is using without making this a required workflow step.

Requirements:
- Show concise inferred taste patterns.
- Keep explicit favorites separate from inferred patterns.
- Avoid fake precision.
- Show stronger / less certain / still learning states when feedback provides useful taste evidence.
- Do not treat "Haven't tried" or simple interest as taste evidence.

## Section 3: Recommendations
Purpose: deliver the core product value and collect lightweight feedback.

Requirements:
- Show four ranked recommendations plus one Surprise Me item.
- Explain what each item is in plain language.
- Keep "Why this recommendation?" available but secondary.
- Let the user react directly on each card.
- Use three primary feedback actions:
  - More like this
  - Less like this
  - Haven't tried
- Save the first tap immediately.
- Show an obvious rated state on the card.
- Keep the recommendation order stable while rating.
- Never navigate away or scroll to the top just because the user rated an item.

## Optional feedback detail
Purpose: capture stronger signal without requiring a survey.

Requirements:
- After the primary reaction, offer optional one-tap context chips.
- Examples for More like this: Loved it before, Want to try, Surprising fit, Exactly my taste.
- Examples for Less like this: Tried it and disliked it, Not interested, Wrong vibe, Too obvious.
- For Haven't tried, optionally capture interest: Interested, Maybe, Not interested.
- Treat optional context according to what it actually means. Interest is not the same as enjoyment.

## Recommendation refresh
Purpose: show that feedback improves the next set without forcing a separate learning screen.

Requirements:
- Show progress such as "3 of 5 rated."
- When the set is complete, offer a direct recommendation refresh.
- Re-rank the next set from the feedback signals.
- Do not require a "What Changed" / "Learned" screen.
- Keep the Taste Profile available for users who want to inspect model changes.

## Prototype constraints
- No auth.
- No external integrations.
- No live LLM call.
- No production persistence.
- No catalog search.
- Static mock data derived from Experiments 001-003.
- Deterministic mock scoring for follow-up recommendations.
- Responsive enough for mobile and desktop.

## Success criteria
A first-time reviewer can answer:
1. Do these recommendations feel plausibly tailored to me?
2. Can I react to them quickly without losing my place?
3. Is it obvious which recommendations I already rated?
4. Does the next set feel meaningfully better informed by my feedback?
5. If I want to know why Tastemake made a recommendation, can I inspect that without being forced to?
