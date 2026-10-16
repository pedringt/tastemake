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
(`api/recommendations.mjs` for the prompt, `src/server/anthropic.mjs` for the transport), so the eval measures what production would actually send. A live run needs
`ANTHROPIC_API_KEY` in the environment **and** `--yes`; without both it refuses and explains why. The model
comes from `--model`, else `TASTEMAKE_RECOMMENDATIONS_MODEL` (picks) and `TASTEMAKE_AI_MODEL` (taste profile),
else `claude-sonnet-5-5`. Since #225 a live run includes the live taste-profile step (`--profile baseline` skips it).

Dry run as of Oct 12, 2026: 21 calls per model (11 taste-profile, 10 picks), about 34,400 input tokens, output
capped at 47,200. Worst case about **$0.03** on `claude-haiku-5-5` and **$0.54** on `claude-sonnet-5-5`, priced
with the per-model rates in `src/server/ai-metrics.mjs` (real output is usually far below the cap). Override the
prices with `TASTEMAKE_AI_PRICE_IN` / `TASTEMAKE_AI_PRICE_OUT`.

It writes `scripts/evals/reports/<producer>-latest.md` (for product review) and `.json` (for comparing runs). Exit code 1 means a **rule** failed or the validator let a deliberately bad answer through.

## Compare models on GitHub (paid, Oct 10)

The **ai-eval** workflow (Actions → ai-eval → Run workflow) runs the live eval for each model you list and writes a side-by-side page to the run summary: per fixture, each model's taste-profile patterns and its picks with the explanation a visitor would read, plus a table of picks kept/rejected, rule failures, quality findings and cost. It needs the repository secret `ANTHROPIC_API_KEY`, and it refuses to start when the planned calls (about 21 per model per repeat) exceed `max_calls`.

- The live producer goes through production's own code: the recommendation call (`TASTEMAKE_RECOMMENDATIONS_MODEL` settings: effort low, and the model's no-up-front-thinking mode) and the taste-profile call (`api/hypotheses.mjs` prompt, normalization and validation).
- `--model` sets both steps; `--profile-model` sets the taste profile alone; `--profile baseline` keeps the deterministic profile; `--tag` names the report files.
- Locally: `node scripts/evals/run.mjs --producer live --model claude-haiku-5-5 --tag haiku --yes`, then `node scripts/evals/compare.mjs scripts/evals/reports/live-*-latest.json`.

## Stress test at scale (#28, paid, manual)

`scripts/evals/stress/` measures whether explanations stay specific, varied and traceable as evidence grows. It never calls a model in `npm test`; its unit suite (`scripts/qa/stress-eval-tests.mjs`) uses a fake model.

- **Profiles** (`profiles.json`, built by `profiles.mjs` from `catalog-snapshot.json`, which holds real items captured from production's free `/api/browse`): four taste shapes (narrow one-genre film fan, broad cross-domain, many dislikes, similar items with opposite reactions) at 10, 50 and 100+ (120) experienced items, plus a little intent. Seeded and committed; a test checks they rebuild exactly. Each has a fixed 36-item candidate pool.
- **Live mode** (`run-stress.mjs`): each call is production's `produceRecommendations()` itself (wire serialization, the 6-candidate offer, prompt, transport, normalization, validation, sanitizer). Only candidate retrieval (held fixed) and fetch (Anthropic only, budget-capped, raw text kept) are injected. A repeat is a recommendation round: earlier windows count as shown, so each round offers new candidates, and they cycle after 6. `--with-profile` adds one taste-profile call per profile. Results are appended to JSONL after every call; re-running resumes.
- **Metrics** (`metrics.mjs`, `report.mjs`): repeated wording (distinct-n, shared 4/5-grams, repeated openings, top phrases), pattern overuse (lexical theme concentration; with a profile, cite-based top-3/5 pattern share), traceability, generic phrasing (a short listed set of templates), genre-label collapse, cross-domain caution, recency and dislike use, all per size. Definitions are in the code and at the end of every report. They are measurements, not gates. What needs judgment is listed in the report and exported as `review-sample.md`.
- **Run:** `node scripts/evals/stress/run-stress.mjs --dry-run [--models ..] [--repeats N] [--with-profile]` (free: real prompt sizes, call count, cost floor and ceiling), then the **stress-eval** workflow (one job per model and size, budget-checked against `max_calls`). Locally: add `--yes` with `ANTHROPIC_API_KEY` set, then `node scripts/evals/stress/report.mjs scripts/evals/stress/results --sample-dir <dir>`.
- **Dry run, Oct 16** (4 shapes, 3 sizes, with profile): 12 pick calls per model per repeat plus 12 profile calls per model. 6 repeats = 84 calls per model, about $0.02 to $0.07 on Haiku 5.5 and $0.34 to $1.45 on Sonnet 5.5 (input only to output at the cap). 30 repeats = 372 calls per model, $0.07 to $0.27 and $1.46 to $5.44.
- Facts that shape the results: production's wire keeps at most 96 tried reactions (plus favorites), and the pick prompt shows at most 18 evidence rows at any size, so the pick prompt hardly grows from 50 to 100+. Picks carry no confidence of their own.

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
