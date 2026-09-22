# Before live AI: readiness plan

Tastemake is deterministic and front-end only ("Prototype - no live AI"). This is what has to be true before a live model is added, in the order it should happen. Status is as of Sept 21, 2026.

Guiding idea: **add the model behind rules that already exist and are already tested, and measure it against the deterministic version.** The deterministic app is the baseline and the fallback, not throwaway code.

## Status at a glance

| # | Need | Status |
|---|---|---|
| 1 | Evidence rules written down and tested (#27) | **Done**: `docs/evidence-contract.md`, model checks in `scripts/qa/model-rules.js` |
| 2 | Confidence computed from evidence, inferred vs validated (#26) | **Done** (Sept 21): Emerging / Supported / Strong / Still learning / Less certain |
| 3 | Decide how user corrections of a pattern work | **Proposal below; needs Paige's decision** |
| 4 | Decide the first AI job and its output contract | Proposal below |
| 5 | Decide grounding (how real titles are guaranteed) | Options below |
| 6 | Eval plan and a synthetic-evidence generator (#28) | Plan below; generator not built |
| 7 | Backend, secrets, cost protection, fallback | Not started |
| 8 | Loading / error / offline-to-deterministic states | Not started (everything is synchronous today) |
| 9 | Privacy note: what is sent to a third party, what is logged | Not started |
| 10 | Information-architecture check (#29) | Not blocking; a heuristic review is enough for now |

## 3. Pattern corrections: a proposal

**Recommendation: yes, but as its own evidence class, not as taste.** A user saying "that's not really me" is not an experience of an item. Treating it as taste would break the rule that exactly three experienced reactions count. So:

- Add a class, **User statement about a pattern**, next to Experienced taste, Intent, Setting, Lookup and Correction (see `evidence-contract.md`).
- Four small controls on a pattern: **Accurate**, **Not really me**, **Matters a lot**, **Matters a little**. ("Only in certain areas" later; it needs per-area scoping.)
- Effects, all reversible and all shown in My Tastemake:
  - *Not really me*: the pattern is excluded from ranking and from what a model may use. It stays visible as "You said this isn't you", so provenance is kept.
  - *Matters a lot / a little*: a ranking weight (for example ×1.5 / ×0.5). No change to counts of tried things.
  - *Accurate*: a badge "You confirmed this". It does **not** raise the confidence level, because confidence is about what the user *tried*. A statement is not a trial.
- Explicit statements outrank inference (#8), and the original inference and its history stay inspectable.
- For a live model these are **hard constraints** in the prompt, not hints.

This keeps the taste rule clean, honors #8's "correction beats inference", and gives a model something it must obey.

## 4. First AI job and output contract

Start with **one** job. Recommendation: **choose the next set of picks and write a grounded "Why this one?" for each**. The other jobs (infer patterns from favorites, Tastebreak dialogue, Blind Spot follow-up questions) come after this one is measured.

Input: the typed evidence list (class, item, what the user said), the areas that are on, the curveball setting, and the items already shown or reacted to.

Output must be structured (a schema, not free text). Per pick:

- `title`, `medium`, `year` (or edition), `areas`
- `about`: one or two neutral, spoiler-free sentences
- `why`: the personalized reason
- `cites`: the ids of the specific evidence items the reason relies on (at least one, and only experienced items may support "you'll like this")
- `patterns`: which patterns it tests
- `kind`: `pick` or `curveball`

Rejected automatically: no citations, a cited item that isn't in the evidence, a title already reacted to, an area that's off, or circular reasoning ("you'll like it because it matches your taste").

## 5. Grounding real titles

Today all picks come from a hand-written pool of about 15 items, so every title is real. A model can invent titles. Options:

1. **Verify against a catalog API** (movies/TV, books, games) and drop anything that doesn't resolve. Most reliable; adds a dependency (and ties to #10 and #13).
2. **Let the model propose and label unverified titles honestly**, checking only on user action. Cheapest; weaker trust.
3. **Constrain to a curated, larger pool** the model only ranks and explains. Safest, least "AI"; a good first step.

Recommendation: start with option 3 (a larger curated pool the model ranks and explains), then move to option 1.

## 6. Evaluating before shipping

- **Scale test (#28).** Build a synthetic-evidence generator that produces users with 10, 50 and 100+ pieces of typed evidence. For each, score explanations on: cites relevant evidence, not repetitive (phrase reuse across a set), no circular reasoning, no overconfidence from weak evidence, cross-domain claims supported, and no drift into genre labels. The generator and rubric need no model and cost nothing.
- **Back-test instead of watching new things (#15).** The user rates things they *already* know that the model has not been told about. Measure how often the model's picks and predicted fit agree. This works without spending time on new media.
- **Baseline comparison.** Every eval runs the deterministic version on the same evidence, so "better than baseline" is measurable.
- **Rules as tests.** The evidence contract's rules become checks on model output (citations exist, nothing reacted-to is repeated, areas respected).
- Model, prompt and retrieval changes are product changes: a before/after measurement each time, and a written cost estimate before any paid run.

## 7. Backend, secrets and cost protection

- A key cannot live in a front-end page. A small server function holds the key and makes the calls.
- Start **stateless**: the browser sends the evidence with each request. No accounts and no stored user data yet. (This is where "no saving until a real backend" gets revisited.)
- The public site means anyone can trigger paid calls. Required before launch: per-visitor rate limits, a daily spend cap, and a single off switch that reverts to deterministic picks.
- Failure path: on timeout or error, fall back to the deterministic picks and say so plainly.
- Every paid call is counted and its cost estimated; dry-run first.

## 8. Loading and failure states

Nothing is asynchronous today. Needed: a clear "thinking" state that doesn't move the layout, keyboard focus and screen-reader announcements for arrival, a slow-response state, and a visible message when it fell back to deterministic picks.

## 9. Privacy

Taste data would go to a third party. Before any live call, write down: exactly what is sent (typed evidence, no names or contact details), what is logged and for how long, what visitors are told, and update the header label ("Prototype - no live AI"). No new categories of data should be sent without updating this note.

## Suggested order

1. Decide pattern corrections (section 3) and record it in `evidence-contract.md`.
2. Build the synthetic-evidence generator and rubric (section 6); run them against the deterministic version to get a baseline.
3. Choose the first job and grounding (sections 4 and 5); design loading/failure states (section 8).
4. Backend with rate limit, spend cap and off switch (section 7); privacy note (section 9).
5. First paid run: dry-run, state the call count and estimated cost, then measure against the baseline.
