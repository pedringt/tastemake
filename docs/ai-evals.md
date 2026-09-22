# Live-AI evals (#32)

Quality is judged by evals, not by vibes, every time a model, prompt or context changes.

## Run it

```
node scripts/evals/run.mjs                              # deterministic baseline: free, no model
node scripts/evals/run.mjs --producer live --dry-run    # exact prompts + cost estimate, makes no call
node scripts/evals/run.mjs --producer live --yes        # PAID: one call per fixture
node scripts/qa/api-tests.mjs                           # the live endpoint, with a fake model: free
```

The live producer uses the **same prompt builder and transport as the production endpoint**
(`api/recommendations.mjs`), so the eval measures what production would actually send. A live run needs
`ANTHROPIC_API_KEY` and `TASTEMAKE_AI_MODEL` in the environment **and** `--yes`; without both it refuses and
explains why. Hypothesis inference is not a live job yet (v1 is picks only), so the profile side of a live
report still comes from the baseline.

Dry run as of Sept 22, 2026: 10 calls, about 23,400 input tokens, output capped at 12,000, worst case about
**$0.25** at $3/M in and $15/M out (real output is usually far below the cap; the two synthetic scale
fixtures are over half the input). Override the prices with `TASTEMAKE_AI_PRICE_IN` / `TASTEMAKE_AI_PRICE_OUT`.

It writes `scripts/evals/reports/<producer>-latest.md` (for product review) and `.json` (for comparing runs). Exit code 1 means a **rule** failed or the validator let a deliberately bad answer through.

## What runs
1. **Fixtures** (`scripts/evals/fixtures.mjs`), fixed and deterministic: cold start with 4 favorites, the default 6, about 10 things (the first milestone size), intent-heavy, a single miss (with a before/after), recurring misses, support across two areas, "the user said this isn't me", and synthetic scale at ~50 and ~100 pieces of evidence.
2. **Every answer goes through the product's validator** (`src/ai/validate.js`, see `docs/ai-contract.md`).
3. **Automatic scorers** (`scripts/evals/scorers.mjs`):
   - *Rules* (a failure fails the run): every citation is real, experienced evidence; intent is never used as taste; no claim above what the fixture allows; cross-domain no further than the evidence; user-confirmed statements are respected; one miss does not rewrite the profile.
   - *Quality findings* (reported, never fail the run): share of proposals that were valid, calibration (how often the product had to lower a claimed level), repetition (phrase overlap between reasons), grounding coverage.
4. **Validator self-test:** deliberately bad answers (invented citations, intent as taste, identity claims, genre-only claims, cross-domain overreach, invented contexts, invented titles, circular reasons, picks with no citations) must all be rejected for the right reason.

Every run also covers the **deterministic baseline** on the same fixtures, so "better than today" is measurable.

## Baseline result (Sept 22, 2026)
All rule checks pass; the validator catches 37 of 37 bad answers. Honest findings about today's logic:
- With only starter favorites, the fixed starting patterns can cite the user's own favorites for **3 of 5** patterns; the other two rest on titles the user never gave.
- At cold start (4 favorites), **4 of 5** deterministic picks can't be tied to anything the user said, so they fail the grounding bar a model will be held to.

These are exactly what a model has to do better.

## Human-review rubric
Automatic checks can't judge specificity or usefulness. For each fixture a reviewer scores 1-3:

| Dimension | 1 | 3 |
|---|---|---|
| Specificity | Genre-level or generic adjectives | A distinction a friend who knows you would make ("mythic material lands when it's serious and strange") |
| Evidence grounding | Cited items don't really support it | Each cited item clearly shows the pattern |
| Calibration | Sounds certain on thin evidence | Confidence matches what's there; says "still learning" when it should |
| Usefulness | Nothing to act on or react to | Clearly testable by the next pick |
| Non-repetition | Same phrases across reasons | Each reason says something different |
| Domain and context accuracy | Assumes one global aesthetic | Keeps "here, not there" differences |
| Respect for user authority | Argues with what the user said | Treats corrections as settled |

**First live-AI milestone:** given 8-12 things the user knows well, the profile feels specific rather than generic, picks are plausible, reasons point to real evidence, and one miss teaches something rather than just lowering a score.

## A note on repeatability

The request sends no `temperature`: the current model rejects it outright (a 400 that failed every live call until Sept 22). Live runs are therefore not bit-identical. Compare fixtures on the rules and the scored dimensions, not on exact wording, and re-run before concluding that a wording change is real.

## Rules for changing the eval
- Never loosen a scorer to make a run pass. If a rule is wrong, change it deliberately and say why in the commit.
- Model, prompt or context changes need a before/after run on the same fixtures.
- Any paid run: dry-run first, state the call count and estimated cost, and get an explicit yes.
