# Tastemake Prototype v1 Spec

## Goal
Validate the core product loop with a reviewer-friendly interactive prototype:

**Favorites -> Taste Model -> Recommendations -> Feedback -> What Tastemake Learned**

## Product principles
- Ask for the smallest useful amount of information.
- Keep explicit user evidence separate from inferred taste hypotheses.
- Explain why a recommendation fits without pretending the system knows more than it does.
- Separate taste-model fit from predicted enjoyment intensity.
- Treat recommendation feedback as both personalization data and product-evaluation data.
- Make model revisions inspectable.

## State 1: Seed favorites
Purpose: create enough initial signal without asking for an exhaustive history.

Requirements:
- Show a compact cross-media starter set.
- Allow multi-select.
- Preselect a plausible starter set for demo purposes.
- Require at least four selections before continuing.
- Explain that the prototype uses a small sample, not a complete history.

## State 2: Taste Model
Purpose: make the inferred model visible and correctable in principle.

Requirements:
- Show five concise taste hypotheses.
- Show strength as Strong or Conditional rather than fake precision.
- Show supporting evidence examples.
- Label hypotheses as inferred.
- Show a separate explicit-evidence summary.

## State 3: Recommendations
Purpose: demonstrate selection and rationale.

Requirements:
- Show four ranked best-fit recommendations plus one Surprise Me item.
- Show Taste-model fit separately from predicted reaction.
- Use conservative predicted-reaction copy such as "Likely to like".
- Explain the hypotheses behind each recommendation.
- Allow the user to start feedback from any card.

## State 4: Feedback
Purpose: collect two distinct signals.

Requirements:
- Reaction: Loved / Liked / Meh / Disliked / Haven't tried.
- Recommendation quality: Good recommendation / Maybe / Not a good recommendation.
- Optional reason.
- Keep item reaction and recommendation-quality labels separate.

## State 5: What Tastemake Learned
Purpose: make personalization changes inspectable.

Requirements:
- Repeat the user's explicit feedback without reinterpretation.
- Show which hypothesis was affected.
- Show a deterministic before/after interpretation for the prototype.
- Explain what changes in future recommendations.
- Offer return to recommendations and rate-another actions.

## Prototype constraints
- No auth.
- No external integrations.
- No live LLM call.
- No production persistence.
- No catalog search.
- Static mock data derived from Experiments 001-003.
- Responsive enough for mobile and desktop.

## Success criteria
A first-time reviewer can finish the loop and answer:
1. What does Tastemake think I like?
2. Why did it recommend this?
3. How do I tell it whether the recommendation worked?
4. What changed because of my feedback?
