# Tastemake handoff

Updated September 25, 2026 after PR #99.

This file is the repo-level handoff for Claude Code or another coding agent. For the live issue tracker summary, also read **GitHub issue #16**. If older comments/docs conflict with current `main` + #16 + newer issue-specific acceptance criteria, trust the newer sources.

## Current state

- Repo: `pedringt/tastemake`
- Production: `https://tastemake.vercel.app`
- Current `main`: `ecc08d88e04d8a1357ead2b8fab41a086486391a`
- Last merged work: PR #99
- Exact PR #99 head passed required GitHub CI, workflow run #167.
- Vercel reported the current main deployment successful.
- No open PRs at this handoff.
- User now has Vercel Pro. The old Hobby deployment-rate-limit problem is no longer expected.
- User has a low Vercel spend-control limit configured. Do not confuse that with an Anthropic-provider spend cap.

## Product north star

Tastemake helps people understand patterns in what they are drawn to, then uses those patterns to discover and test more things they may like.

Primary loop:

> Favorites → Recommendations → react / save / dismiss → More recommendations → refine

Taste Profile is optional inspectability, not a required step in the discovery loop.

## Product mental model

- Recommendations = discovery
- Library = your stuff
- Saved = future / intent
- Tried = experienced history
- Favorites = especially representative experienced + loved items
- Taste Profile = what Tastemake currently infers

Do not reintroduce Try Next or a user-facing seed catalog.

## Authority model

These are settled unless a concrete failure forces reconsideration:

- AI interprets. Software owns evidence, state, and authority.
- Only experienced items count as taste evidence.
- Saved / intent does not become experience.
- Search, browse, filtering, and opening things are not taste evidence.
- User-confirmed correction outranks model inference.
- Cross-domain links begin as hypotheses, not facts.
- Model output must cite real evidence.
- The model does not mutate product state directly.
- Candidate eligibility, repeat suppression, novelty rules, state mutation, and fallback are deterministic.
- Live model output is validated before presentation.
- Do not loosen validation just to make a run pass.

Useful contract docs:
- `docs/ai-contract.md`
- `docs/ai-evals.md`
- `docs/ai-readiness.md`
- `docs/evidence-contract.md`

## Real catalog architecture

Providers:
- TMDb: movies + TV
- Open Library: books
- IGDB: games

Normal user-facing search/recommendation/profile paths must not fall back to seeded product content. Deterministic/synthetic fixtures are fine in isolated QA/eval code.

Provider records normalize into Tastemake item state with stable IDs, metadata, year, artwork, provenance, and domain/type information.

Manual add remains available.

## Recommendations: current behavior

Current pipeline:

> user evidence → provider candidates → deterministic eligibility/novelty rules → AI rank/explain when enabled → validation → cards

Current UI/product behavior:
- 6 recommendations per batch.
- Clean 3 × 2 desktop grid with responsive collapse.
- Equal-height/aligned card sections after PR #99.
- Provider artwork uses fixed geometry.
- Cards show type + release/publication year when available.
- Rationale is primary copy; synopsis is secondary and clamped.
- Surprise/curveball remains visually distinct without changing card height.
- More recommendations is below the card grid.
- Category controls are generation modes:
  - All = mixed set
  - Watch = fresh watch set
  - Read = fresh book set
  - Play = fresh game set
- All-mode retrieval tries to represent multiple domains/evidence sources when available.
- Direct sequels / obvious continuations / same-batch continuations are suppressed deterministically.
- Series-experience feedback can mark series coverage so obvious installments are not treated as fresh discovery.
- Catalog fallback uses the same real-candidate pipeline if live AI is unavailable/rejected.

Recently completed/closed:
- #91 loading feedback
- #92 sequel/franchise novelty guard
- #93 continuous More recommendations loop
- #94 Saved/Tried Library model
- #95 recommendation card redesign

## Library: current behavior

Library has two primary views:
- Saved
- Tried

Saved is the default.

Saved means future intent and does not count as experienced taste evidence.

Saved/Tried cards are compact by default so the collection can grow. Clicking/expanding exposes more detail and actions.

Favorites may remain more visually prominent because they are stronger representative evidence.

## Taste Profile: current state

Live hypothesis architecture exists:
- `api/hypotheses.mjs`
- `src/ai/hypothesis-profile.js`
- validator logic in `src/ai/validate.js`
- revision recording in `src/model/history.js`

Accepted live hypotheses:
- must cite valid experienced evidence;
- are normalized into current model-hypothesis state;
- can produce append-only meaningful revision records;
- do not replace user-confirmed authority.

Important unresolved item: **#86**.

During the last manual production review, the Taste Profile was still blank. PR #99 fixed a client bug where a failed/unavailable request could be remembered as already checked, and added an explicit **Retry profile AI** action.

Next agent should:
1. reproduce against current production;
2. use Retry if needed;
3. inspect Vercel runtime logs for `[tastemake-profile]` and `[tastemake-profile-ai]`;
4. distinguish configuration failure vs model/API failure vs validator rejection;
5. fix the actual cause without weakening the evidence validator.

## Test-state persistence

PR #99 added localStorage persistence specifically to make iterative testing less painful.

Persisted across refresh:
- Favorites
- recommendation reactions
- recommendation history
- Saved/Tried/Library state
- model hypotheses/history
- selected Look
- setup/preferences
- relevant filters/settings

Not persisted:
- in-flight requests
- loading flags
- temporary AI errors/messages
- open popovers/dialogs
- AbortControllers or request fingerprints

**Start over** clears persisted taste/test state while preserving the Look.

If debugging a truly fresh first-run flow, use Start over rather than assuming browser refresh resets the product.

## Search performance

PR #99 added:
- debounce reduced from 260 ms to 160 ms;
- small browser cache for repeated exact query/domain combinations;
- Vercel Runtime Cache for server catalog search;
- IGDB/Twitch access-token reuse.

Do not solve search latency by removing a domain from All search.

## Recommendation performance

PR #99 added:
- Vercel Runtime Cache for related provider lookups;
- IGDB token reuse;
- phased evidence retrieval: start from 4 diverse evidence sources and only fan out to up to 6 when the candidate pool is insufficient;
- Fluid Compute enabled;
- route-specific function durations.

This should reduce repeated provider work without changing authority boundaries.

Do not optimize further by shrinking validation or bypassing provider grounding. Measure first.

## Vercel Pro / observability

PR #99 added structured timing/outcome logs:
- `[tastemake-catalog]`
- `[tastemake-recommendations]`
- `[tastemake-profile]`
- errors also use existing AI/profile error prefixes

Vercel Runtime Cache and Fluid Compute are now configured in code.

Open issue **#100** owns the remaining Pro follow-up:
- enable Web Analytics;
- enable Speed Insights;
- confirm production data arrives;
- establish latency baselines for search/recommendations/Profile;
- confirm Runtime Cache reuse in production;
- only then decide whether further optimization is warranted.

During the prior ChatGPT session, direct Vercel connector reads for Tastemake still returned internal connector errors even after access was changed. GitHub's Vercel commit status remained usable and showed successful deployments.

## Expected production AI gates

Live recommendations require:
- `TASTEMAKE_AI_ENABLED=1`
- `ANTHROPIC_API_KEY` present
- `TASTEMAKE_AI_MODEL` present
- `TASTEMAKE_AI_RATE_LIMIT_CONFIRMED=1`
- `TASTEMAKE_AI_SPEND_CAP_CONFIRMED=1`
- `TASTEMAKE_AI_PRODUCTION_APPROVED=1`

Taste Profile also requires:
- `TASTEMAKE_AI_HYPOTHESES_ENABLED=1`

The user said all required Vercel variables were added and redeployed. Verify runtime behavior/logs rather than assuming that means the model path is healthy.

Never request, print, commit, or expose raw secret values.

## Open issues that matter next

### #86 — Live Taste Profile hypotheses
Highest-priority unresolved verification item.

### #83 — Real external catalog search
Implementation is done. Needs representative live smoke:
- movie
- TV
- book
- game
- manual add
- degraded-provider sanity check

### #84 — Real provider artwork
Plumbing is done. Needs representative live visual smoke for artwork + missing-art fallback at desktop/mobile.

### #85 — Grounded live recommendations
Architecture/tests are in place. Needs controlled live confirmation that Anthropic returns an accepted provider-grounded set and that the result is captured in eval evidence.

### #100 — Vercel Analytics / Speed Insights + latency baseline
Use the Pro observability tooling before adding speculative performance work.

### #28 — Reasoning specificity/repetition stress test
Later scale test at roughly 10 / 50 / 100+ evidence records.

### #29 — Library scaling / IA
Future validation at larger histories. Do not reopen Saved/Tried merely because this remains open.

### #15 — Experiment 004
Parked until Paige actually consumes/tests the locked recommendations.

### #48 / #69
Post-portfolio / optional.

### #6 / #7 / #9 / #10 / #11 / #17
Parked future directions unless Paige explicitly reopens them.

## QA policy

Default release gate:
1. required CI is green;
2. focused automated tests cover changed behavior;
3. short live smoke of the affected flow at one representative desktop width;
4. one representative mobile width;
5. one alternate Look only when the change is visual/theme-sensitive.

Do not use the exhaustive every-Look × every-width sweep as the routine blocker.

Commands:

```bash
npm install
npm test
npm run test:full
node scripts/evals/run.mjs
node scripts/evals/run.mjs --producer endpoint --dry-run
node scripts/evals/run.mjs --producer endpoint --yes
scripts/qa/headless.sh model|flow|layout|a11y 1440
```

`npm run test:full` is optional unless a broad CSS/system change or concrete regression justifies it.

## Paid-model rule

Before intentionally running a paid Anthropic verification/eval:
1. state expected call count;
2. estimate cost;
3. get Paige's explicit approval.

Do not infer approval from ordinary production UI testing.

## Workflow / control rules

- Feedback is read-only until Paige says the feedback round is done.
- Implement only the agreed scope.
- Never merge/push a new change to `main` or production unless Paige explicitly names that destination in that instruction.
- Preserve unrelated local work.
- Avoid opportunistic refactors during focused fixes.
- Do not broadly kill Chrome/browser processes if local QA hangs.

## Recommended Claude Code start sequence

1. `cd ~/code/tastemake`
2. `git status`
3. `git fetch`
4. sync to current `main` at `ecc08d88e04d8a1357ead2b8fab41a086486391a`
5. read this file, issue #16, and the AI/evidence contract docs
6. smoke current production before rewriting anything
7. investigate **#86 Profile live behavior first**
8. perform the short live-provider verification for **#83/#84**
9. work **#100** to enable Analytics / Speed Insights and collect latency evidence
10. only optimize further when measurements justify it
11. before any paid eval, stop and ask Paige with call count + estimated cost

## Historical note

Older portions of this file described stale branches, old 5-card behavior, deterministic-only hypotheses, and pre-Pro Vercel constraints. Those directions are superseded by the current state above. Use git history if historical detail is needed rather than reviving old implementation assumptions.
