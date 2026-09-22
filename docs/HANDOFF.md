# Handoff: Tastemake live AI producer

## Fixes and tests added on `live-producer-preview` (Sept 22, after the rollout)

- **The deterministic fallback is the product's own picks again.** `api/recommendations.mjs` used to run the baseline through `validatePicks`, whose grounding rules exist to judge *model* output; a legitimate pick whose pattern cannot cite anything the user has tried was dropped. A cold-start request returned 4 picks where the app shows 5. Fixed: the fallback is `nextRecommendations(state)` as-is, and the model's output is still fully validated.
- **The live-AI status banner no longer borrows the end-of-demo style.** It used `is-finished`, so two "finished" banners could stack and the end-of-demo message was no longer the first match. It now has `is-fallback` / `is-live`. Flow QA is back to 222/222 in all four looks.
- **`scripts/qa/api-tests.mjs` (new, free, no network):** 49 checks over the endpoint with a fake model. Covers every gate reason, production needing its own approval, the fallback being unfiltered, valid model answers, and refusals (invented ids, missing or invented citations, intent cited as taste, circular reasons, identity claims, duplicates, too few picks, non-JSON, a pattern the user rejected), transport timeout / error / non-200, that the prompt carries no secrets, and the handler's 405 / 400 / 413 / 429 / no-store behavior.
- **`--producer live` is wired**, with `--dry-run` (prints the prompts and a cost estimate, makes no call) and a `--yes` requirement before any spend.

## First live AI run (Sept 22, 2026)

Live AI is enabled in production (Paige set `TASTEMAKE_AI_PRODUCTION_APPROVED=1`). Model: `claude-sonnet-5`. Three bugs had to be fixed first, each found in the Vercel logs:

1. **`temperature` is rejected by this model** (400 invalid_request_error). It is no longer sent, so runs are not bit-identical.
2. **The 12-second timeout tripped on every real call.** Now 25s, with the function allowed 30s.
3. **Extended thinking spent the whole output budget** and returned no text (`stop_reason=max_tokens`, `blocks=thinking`). Thinking is now disabled for this short JSON job; set `TASTEMAKE_AI_THINKING=enabled` (with a much larger cap) to try it again.

`paidCallMade` now only counts calls that got past the API's checks; a refused call is not billed.

**Eval through the deployed endpoint** (`node scripts/evals/run.mjs --producer endpoint --yes`, so the key stays in Vercel): 10 of 10 fixtures came back from the model, every rule check passed, no quality findings, and the endpoint never had to fall back. 10 calls, 40,046 input and 5,961 output tokens, about **$0.21**. Report: `scripts/evals/reports/endpoint-latest.md`.

Notable: with only four favorites the model still cited real evidence; in the "not me" fixture no pick tested the excluded pattern; phrase overlap between reasons stayed at 8% or below, including at 50 and 100 pieces of evidence.

**Open, small:** four reasons say "This is a curveball" while `kind` is `pick`. The prompt should either ask for `kind: "curveball"` or stop inviting that phrasing.

## Escaping untrusted text (#38), done

Screens render with template strings and `innerHTML`, and live AI made that urgent: the model's own prose (`item.reason`) was going in raw, as were titles the user types. One helper, `src/lib/html.js` (`esc`), is now used everywhere; the three local copies of an escaper were replaced with it. `scripts/qa/escaping-tests.mjs` (32 checks, free, no browser) renders every screen with `<img src=x onerror=...>` in each untrusted slot (typed titles, notes, model pick reasons, model hypothesis label/claim, blind-spot summaries) and fails if any of it survives as markup. It caught two paths the first pass missed: the recommendation artwork title and the blind-spot summary shown on the Profile, Library and Map.

## Async live-AI request state (#42), done

`src/ai/requests.js` is the small explicit model: one request at a time, with an id, an AbortController and a **fingerprint of the evidence it was computed from** (favorites, every reaction, pattern statements, areas, the curveball setting, what has already been shown; presentation state like the look or a filter is deliberately excluded). When an answer arrives, the fingerprint is taken again:

- **evidence changed** (the user reacted, corrected a pattern, changed a setting): the answer is dropped and the deterministic picks are used, with the reason shown;
- **the user left the page**: the request is cancelled and nothing is shown;
- **a newer request started**: the older one is aborted and its answer refused.

`navigate()` cancels an in-flight request for another screen. This is separate from validation: #31 decides whether an answer is allowed, #42 decides whether it is still about the user's current state. `scripts/qa/async-tests.mjs` (23 checks, free) covers the fingerprint's sensitivity, each stale reason, cancellation and completion.

## Purpose

This handoff is for Claude Code to resume Tastemake without reopening the prior ChatGPT thread. Continue from the newly promoted live-AI foundation, verify the production deployment state, and complete the first controlled Anthropic-backed recommendation test without reopening settled architecture decisions.

## Current objective

Resume from main at commit 25ae748f65717a5092b34eff672616c0a064bada and verify the live recommendation producer on Vercel. The live path must remain fail-closed in production until the explicit production approval variable is intentionally enabled.

## Repository state

Repository: pedringt/tastemake

Expected local clone: ~/code/tastemake

Current refs at handoff:
- main -> 25ae748f65717a5092b34eff672616c0a064bada
- live-producer-preview -> same commit before this documentation-only handoff update
- pre-ai-foundations -> d868fdaeeabbdbf5ae0f4ec2885a8769460d23f3

Main was fast-forwarded from the preview branch. It includes the full pre-AI foundation package plus the first live recommendation producer.

Before changing anything locally, inspect git status, current branch, and recent commits. Preserve unrelated local work.

## Product goal

Tastemake is a taste-understanding and recommendation prototype. It should understand recurring patterns in what a user is drawn to across domains without collapsing them into one global identity, genre label, or aesthetic.

The first live-AI milestone is deliberately narrow: use live AI to choose and explain the next recommendation set from a product-controlled candidate pool. Pattern generation can come later.

The deterministic system remains both the baseline and the fallback.

## Settled authority model

- AI interprets; software/product owns evidence and state.
- Interest is not experience.
- Only things the user actually tried or experienced count as taste evidence.
- User-confirmed interpretation outranks inference.
- Cross-domain links start as hypotheses, not facts.
- Model output must be structured, traceable, and cite real evidence refs.
- The model never mutates product state directly.
- Candidate eligibility is product-controlled. The model chooses only from eligible IDs.
- Deterministic logic remains the baseline and safe fallback.
- One experienced dislike does not weaken a pattern. Two recurring misses can.
- Repeated intent never becomes taste evidence.
- A user statement like not-me excludes a pattern from live recommendation testing and inference.

## Evidence rules

Experienced taste:
- Loved it before -> strong positive
- Liked it before -> positive
- Tried it and disliked it -> negative
- Starter favorite -> experienced, but never validates a pattern by itself

Intent only:
- More
- Less
- Not interested
- Bookmark

Lookup only:
- Search
- Browse
- Open

User pattern statements are separate authority, not taste evidence:
- accurate -> user-confirmed
- not-me -> excluded from inference/recommendation testing
- matters a lot -> stronger ranking weight
- matters a little -> weaker ranking weight

## AI contract and validation

Key files:
- src/ai/context.js
- src/ai/contract.js
- src/ai/validate.js
- src/ai/baseline.js
- docs/ai-contract.md
- docs/ai-evals.md
- docs/ai-readiness.md
- docs/evidence-contract.md

Pick proposal fields:
- itemId
- why
- cites
- tests
- kind: pick | curveball

Validator rejects:
- invented, ineligible, or already-seen candidates
- missing or invalid citations
- intent used as taste
- circular reasoning
- identity/aesthetic claims
- more than one curveball, or any curveball when disabled
- tests values not attached to that candidate
- tests values for patterns the user explicitly marked not-me

Accepted model output is stamped by the product rather than trusted directly.

## Live producer now on main

New or changed live-AI pieces include:

api/recommendations.mjs
- Vercel function
- calls Anthropic Messages API with native fetch
- rebuilds product context server-side
- validates model output server-side
- falls back to deterministic picks on provider failure or invalid output
- request body limit
- timeout
- best-effort per-instance rate limiting
- no-store responses

src/ai/live-client.js
- serializes relevant client state
- POSTs to /api/recommendations

src/app.js
- Keep discovering now calls the live endpoint
- UI falls back locally if the endpoint itself fails

src/state.js
- transient AI UI status only
- AI UI state is not taste evidence

src/screens/recommendations.js
- loading state
- live-AI status
- safe-fallback status
- privacy note explaining that typed taste evidence and eligible picks are sent to Anthropic

index.html
- label changed to Prototype - AI-ready

vercel.json
- configures api/*.mjs function runtime

## Production safety gate

Production paid calls require:

TASTEMAKE_AI_PRODUCTION_APPROVED=1

Without that variable, VERCEL_ENV=production keeps Anthropic calls disabled even if the API key and other AI flags are present.

This gate was added because the user had already created the other variables in Vercel Production and pushing main should not automatically create public paid traffic.

## Vercel environment variables already created

The user has already created these in Vercel Production:

- ANTHROPIC_API_KEY = secret value
- TASTEMAKE_AI_ENABLED=1
- TASTEMAKE_AI_MODEL=claude-sonnet-5
- TASTEMAKE_AI_RATE_LIMIT_CONFIRMED=1
- TASTEMAKE_AI_SPEND_CAP_CONFIRMED=1

Do not ask for or expose the Anthropic API key.

Important: the last two are release-confirmation flags, not durable infrastructure by themselves. Do not claim that the app has a globally reliable distributed rate limiter or a true app-specific daily spend cap simply because those flags exist.

The Vercel project was not visible through ChatGPT's connected Vercel account, so deployment state and environment configuration could not be independently verified from that tool.

## Verification already completed before promotion

Local/reconstructed checks completed before the final promotion:
- deterministic baseline hard rules passed
- validator adversarial coverage was strengthened from 37 to 53 bad answers; all 53 were rejected
- mocked live-producer tests covered valid output, invalid output, provider failure, timeout, disabled config, dry-run, fenced JSON parsing, and prompt leakage
- no real Anthropic call was successfully made from the ChatGPT environment
- no API key was pasted into chat or committed

The planned first live eval is 10 model calls with a rough maximum around $0.17. Those calls were not completed because the ChatGPT execution environment did not have the API key.

## Recommended next steps

1. cd ~/code/tastemake
2. inspect git status and current branch
3. git fetch
4. confirm local main matches or intentionally advances beyond 25ae748f65717a5092b34eff672616c0a064bada
5. read this file plus docs/ai-readiness.md, docs/ai-contract.md, docs/ai-evals.md, and docs/evidence-contract.md
6. confirm the Vercel production deployment for the current main commit is Ready
7. smoke-test the existing product while production live AI remains gated off
8. verify /api/recommendations returns deterministic fallback while TASTEMAKE_AI_PRODUCTION_APPROVED is absent
9. report findings before enabling the production gate
10. only after Paige explicitly approves public live-AI enablement, consider adding TASTEMAKE_AI_PRODUCTION_APPROVED=1
11. then run the previously approved controlled 10-call eval, staying within the roughly $0.17 cap unless new approval is obtained

## Do not re-litigate

These are settled unless a concrete failure provides new evidence:
- first live AI job = picks/explanations
- candidate pool remains curated/product-controlled
- user authority outranks model inference
- intent does not become taste evidence
- deterministic fallback is required
- model may not directly mutate state
- no need for Render for this milestone; Vercel function is the intended backend

## Risks and watchouts

- The in-function rate limiter is not a globally reliable distributed limiter.
- TASTEMAKE_AI_SPEND_CAP_CONFIRMED=1 is a release gate, not an actual spend cap.
- Do not silently turn on production paid traffic.
- Do not push further changes to main without Paige explicitly authorizing that new production change.
- Preserve local user changes.
- Avoid unrelated refactors while verifying the live producer.

## Authority and credentials

Do not include or request raw credentials, tokens, cookies, API keys, session values, private keys, or .env contents.

GitHub:
- read access for inspection
- write only for explicitly authorized changes
- no destructive actions
- production/main promotion requires current explicit approval

Vercel:
- read access for deployment/runtime verification
- environment mutation only with explicit approval
- production live-AI enablement requires explicit approval

Anthropic:
- use the existing server-side key only
- do not request the raw key
- the 10-call eval up to roughly $0.17 was previously approved
- public production enablement is a separate approval gate

## Source context

Prepared from the ChatGPT implementation session and verified GitHub state on September 22, 2026. No secret values are included.
