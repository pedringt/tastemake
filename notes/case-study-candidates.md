# Case study candidate notes

Living notes for material that may later support a Tastemake portfolio case study. These are evidence candidates, not polished case-study copy.

## Product thesis

Tastemake explores whether an LLM can maintain an inspectable, revisable model of subjective taste across media instead of relying only on genre labels or black-box similarity.

Core loop:

favorites → taste hypotheses → prediction/recommendation → user reaction → hypothesis revision

## Strong case-study moments so far

### Experiment 001: blind holdout
- 8 holdout items.
- 4 exact five-level predictions.
- 3 one-step intensity near misses.
- 1 polarity miss.
- 7/8 correct positive/negative direction.
- Useful non-genre examples included correctly predicting a negative reaction to *Schitt's Creek* and a positive reaction to *The Traitors*.

### The useful failure: Outer Wilds
The model predicted *Outer Wilds* positive with 86% confidence and was wrong.

The postmortem identified that:
- discovery/exploration had been overweighted;
- a recurring characteristic of favorites had been mistaken for a primary preference;
- the *Elden Ring* agency signal had been overgeneralized beyond difficulty bottlenecks.

This is a strong example of why an inspectable hypothesis model may be more useful than a recommendation system that silently adjusts similarity weights.

### Product decision: minimal onboarding
Instead of requiring large imports first, onboarding can start with a few absolute favorites in each category, then use adaptive like/dislike/not-seen calibration cards to learn more.

Optional Spotify, Letterboxd, Goodreads, etc. imports can later reduce setup burden rather than being required.

### Product decision: feedback is part of the model
Recommendation feedback should serve both product evaluation and personalization.

Potential distinction:
- Did you like the item?
- Was this a good recommendation for you?

A failed recommendation is useful evidence if the system can identify which taste hypothesis led to the mistake and revise it.

## Attribution to preserve later
- Product concept, experiment framing, choice to use inspectable hypotheses, onboarding/feedback decisions, and evaluation judgment are human product decisions.
- AI is used to generate/refine hypotheses, make blind predictions, structure experiment artifacts, and assist with implementation.
- Holdout reactions come from the user and should remain separate from model-generated interpretation.

## Experiment 002 case-study opportunity

Test whether the system can move from a broad failed abstraction to a more precise boundary:
- discovery as a feature vs discovery as the main appeal;
- straightforward adventure/charisma/spectacle as a potentially missing taste axis.


## Experiment 002: targeted boundary test

Experiment 002 intentionally tested a failure exposed by Experiment 001 instead of optimizing for a higher general hit rate.

Results:
- 6/8 exact predictions;
- 2 one-step intensity near misses;
- 0 polarity misses;
- 8/8 correct positive/mixed direction.

The strongest finding was the discovery boundary:
- *The Witness* = mixed;
- *The Forgotten City* = positive;
- *Firewatch* = positive;
- *999* = strong positive.

This supported the revised idea that **discovery works better when it serves clear goals, narrative, stakes, character, or another strong system, rather than when discovery itself must generate most of the user's momentum**.

The adventure test is also useful product evidence because the team resisted adding a new hypothesis prematurely. *The Mummy* and *National Treasure* matched the existing model, *Pirates* was slightly overpredicted, and *Fury Road* was already explained by existing hypotheses. The correct decision was to leave "straightforward adventure" unresolved instead of overfitting to *Last Crusade*.

### Case-study principle
A strong eval is not just a benchmark. Use one experiment's failure to design the next experiment so it can distinguish between competing explanations.
