# Handoff: Tastemake live AI producer

## Next chat: start here (updated Sept 23, 2026, end of session)

**North star:** Tastemake helps people understand the patterns in what they're drawn to across different parts of their life, without assuming they have one single aesthetic, then uses that understanding to find and test more things that might fit.

**State**
- `main` = `live-producer-preview` = `357d9e0` (PR #56, merged with Paige's explicit "merge to main" go-ahead). Everything from this session — Tastebreak v1, #29 clarity pass, #8/#48 split, #36's finish-line, #52/#53/#54 — is on `main`.
- **Vercel's rate limit cleared and it deployed `357d9e0`** (confirmed via `gh api .../commits/357d9e0/status` right after merging — Vercel reported "deploying"). Worth a fresh look at https://tastemake.vercel.app to confirm it's actually live before trusting it, since this wasn't watched through to "Ready."
- **Live AI is ON in production and stays on** (Paige: "I'm ok with the gate, no one is using this but me" — settled, don't re-ask). Live job: choose and explain the next recommendation set on "Keep discovering". Hypothesis inference is still deterministic. Model `claude-sonnet-5`, ~$0.014/call.
- **CI is real and required.** `npm test` runs on every push/PR via `.github/workflows/test.yml` (a clean, isolated container — see the local-Chrome note below). Root `package.json` has the scripts; see `docs/ai-evals.md` for the paid ones.

**A product-decision pass happened this session** (before any of the code below): went through every open issue (#6, #7, #9-11, #14-19, #25, #28-30, #33, #36-39), sorted into ready-now / needs-a-small-decision / needs-real-users-or-paid-calls / park, and gave Paige concrete options + a recommendation for each decision point. Paige called all six decisions herself (not defaults). The result, in case a future session needs the reasoning: #7/#17 stay parked (media-only for now); #6/#9/#10/#11 stay parked (no integrations without a real reason); #29 got split into a free definitions pass (done) + a real-user-testing remainder (still parked); #8 treated as complete, exclusions split into #48 (deliberately left unbuilt); #18/#19 (Tastebreak) got a deterministic v1 instead of staying parked or going straight to live AI.

**This session, on `live-producer-preview`, not yet promoted to main:**
1. **`67617c4`** — the curveball-language prompt nit: `buildPickPrompt` now says `kind` must be `"curveball"` whenever `why` calls a pick one. Not eval-verified against a live model (no paid call authorized).
2. **`dd3fbe9`** — **Tastebreak v1** (#19, folds in #18), deterministic only: on a tried Library item with a tagged pattern, "Break down why it landed/didn't" lets the user confirm/reject which patterns actually mattered plus a free-text note; confirmed patterns are recorded as user-confirmed revisions (#37). New: `src/model/tastebreak.js`, `src/components/tastebreak.js`, `src/actions/tastebreak.js`, `styles/tastebreak.css`. Also in this commit: the **#29 IA clarity pass** (a "What each part means" glossary in My Tastemake) and the **#8 cleanup** (commented #8 as effectively complete, split exclusions into #48, left unbuilt).
3. **`4377c49` + `b0fde97`** — **#36's context-qualifier finish-line**: a single user-confirmed "Only in some contexts" toggle per pattern, separate from domain exclusion; the live-AI validator caps a context-qualified pattern's claimed level to at most Supported, never Strong. New free test suite `scripts/qa/validate-tests.mjs` (8 checks), wired into `npm test`. `b0fde97` fixes a real regression the first diagnostic PR caught: a flow test hardcoded 2 controls per pattern card, now 3.
4. **#37 got a comment, not code** — checked that hypothesis inference still isn't live-wired (confirmed by grep, no call site anywhere), so per Paige's explicit instruction, no fake call site was invented. The exact finish-line trigger is written on the issue: when inference goes live, that work must also record `origin: "model"` revisions, link via `supersedes`, avoid duplicate revisions, and add tests proving user-confirmed vs. model-generated revisions stay distinguishable.
5. **`9779841`** — **#52 / #53 / #54**, three new issues from a review Paige ran herself (not from this session's product-decision pass): recommendation cards now split feedback into three layers (primary always visible, secondary after a reaction, tertiary — the discovery-quality note — collapsed by default behind "More feedback"); "Too predictable" recopied to "Good fit, but too obvious?" so it reads as a distinct question from Less, not a second negative reaction (#53); the technical AI/privacy paragraph moved from the primary "Keep discovering" banner into a native `<details>` ("How this set is made") (#54). Blind Spot's own panel was deliberately left outside the new toggle — it already has its own offer/quiet/draft/saved progression and wrapping it risked burying its proactive prompt. `scripts/qa/bookmark-flow.js` updated: two hardcoded copy assertions, a real toggle-click added before interacting with the now-collapsed quality chips (previously relied on `.click()` firing on a still-unhidden element, which happened to work but didn't test the real flow).
6. Every commit verified via the clean-CI diagnostic-PR pattern (local Chrome was stuck all session, same as before). One real regression caught and fixed (`b0fde97`, see #3 above) — the pattern is working as intended. PR #55's CI run took longer than usual (~5 min queued before running) but was not an actual hang — the `test` check itself still finished in 30s once it started.
7. **Merged to `main` via PR #56** (Paige's explicit "merge to main"). Issues themselves are still open — every one touched this session (#19/#18, #29, #8, #48, #36, #52, #53, #54) has a fresh "your call whether this clears it" comment; a merge doesn't auto-close them.

**Local Chrome can get stuck — know this before you burn an hour on it.** Local headless Chrome on this machine hung again this session (same updater/crash-handler churn as before), most likely from other concurrent Claude Code sessions sharing this Mac. If `scripts/qa/headless.sh` or `npm test` hangs/times out locally with no clear error, **do not spend more than one retry chasing it**. Instead: push the branch, open a **throwaway PR** to `main` (title it "diagnostic" or similar) so the `pull_request` trigger runs the suite in GitHub's clean container, read that result with `gh pr checks <n>`, then **close the PR without merging** (`gh pr close <n> --comment "..."`) — do not merge or fast-forward `main` without Paige's separate, explicit go-ahead each time. Never `pkill` browsers or other processes broadly on this machine — ask first; another session may depend on them.

**What's next, roughly in order:**
1. Verify https://tastemake.vercel.app actually reflects `357d9e0` — load it and check for the Tastebreak "Break down why it landed" button on a Library card, the "Only in some contexts" toggle on Taste Profile, or the collapsed "More feedback" on a rated recommendation card. The deploy was triggered and reported "deploying" right after the merge, but wasn't watched through to "Ready."
2. Get Paige's read on this session's issue comments (#33/#30/#37-closeable-status/#36/#39 from earlier, #19/#18/#29/#8/#48/#36-finish-line from the middle batch, #52/#53/#54 from the last one) and close whichever ones she's happy with — a merge doesn't do that automatically.
3. **#28** — the free infrastructure already exists (scale-50/100 fixtures, a repetition scorer). The real next step is a paid `--producer endpoint` eval run (~$0.20/10 calls); needs Paige's yes on cost first.
4. **#15** (Experiment 004) — waiting on Paige to actually watch/read/play the 5 locked candidates and report reactions. Nothing to build.
5. **#48** (hard-boundary exclusions) — deliberately left unbuilt; pick up only if Paige wants it.
6. Parked per this session's decisions, revisit only if Paige changes her mind: #6, #7, #9, #10, #11, #17.

**Standing rules:** AI interprets, the product owns evidence and state; interest is not experience; user-confirmed outranks inference; cross-domain links start as hypotheses; model output must cite real evidence; evals alongside the model, not after; make future domains possible without shipping them; never loosen a scorer to make a run pass; state the call count and cost before any paid run; never touch `main` without it being the deliberate promotion step; never kill processes broadly without asking. New this session: when a product decision is genuinely ambiguous, do the analysis (options + recommendation + what it blocks) rather than treating "needs judgment" as a stopping point — see the product-decision pass above for the shape that took.

**How to run everything:**

```
npm test                                              # the required gate (free, no model)
npm run test:full                                     # every look x every width (slower, manual)
node scripts/evals/run.mjs                            # deterministic eval baseline (free)
node scripts/evals/run.mjs --producer endpoint --yes   # PAID ~$0.20: live model through production
scripts/qa/headless.sh model|flow|layout|a11y <widths> # browser suites; LOOK=collage etc. for other looks
```

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

## One test command and CI (#41), done

`npm test` runs the required gate: the three no-browser suites (endpoint contract, escaping, async request state), model rules, flow/layout/a11y at 1440 in Clean editorial, and the free deterministic eval. Zero dependencies, so nothing to install; root `package.json` did not change Vercel's build (still framework "Other", no build step; verified on a preview deploy before promoting).

`.github/workflows/test.yml` runs `npm test` on every push to `main` and every PR, with Chrome via `browser-actions/setup-chrome`. It never runs a paid producer.

**First CI run failed:** `scripts/qa/headless.sh model` returned a bare "NO RESULT after 3 tries" with no visible cause, because Chrome's stderr was discarded. Fixed: added `--no-sandbox --disable-dev-shm-usage` (standard for headless Chrome in CI containers) and made the script print Chrome's stderr on the final retry instead of failing silently. Verified via a diagnostic PR's `pull_request`-triggered run before merging, then confirmed green on `main` itself.

`npm run test:full` (`scripts/qa/full-sweep.mjs`) is the slower every-look, every-width sweep this project has been run with by hand; it is not part of the required CI gate. `npm run test:eval:endpoint` is the paid live-model eval, run manually with `--yes`.

## Centralized evidence predicates (#40), done

`src/model/evidence.js` is now the one place that turns a stored reaction (`{ rating, detail }`) into a bucket: `isExperienced`, `isExperiencedPositive`, `isStrongPositive` (loved specifically), `isExperiencedNegative`, `isSaved`, `isDeclined`, `isIntentOnly`, `countsAsTaste`. `taste.js`'s `isPositiveExperience` and `isBookmarked` are now thin re-exports rather than their own decoders, so there is exactly one definition.

Converted to use the predicates instead of raw `feedback.detail === "loved-before"`-style checks: `taste.js`, `tastemap.js` (`patternEvidence`, `domainCoverage`), `library.js`, `mine.js`, `search.js` (`itemStatus`), `blindspots.js` (`isDisliked`), and `recommendations.js`'s `reactionLabel`. Visible label text is unchanged everywhere — only the *condition* that picks a label moved to the shared predicate. Action-encoding tables that *write* a new reaction (`app.js`'s `libraryOutcomes`, `search.js`'s `OUTCOMES`) were left alone on purpose: they define what a button writes, not how existing evidence is read, which is a different concern.

`scripts/qa/model-rules.js` gained a dedicated suite (47 checks): every predicate against every reaction kind, `taste.js`'s re-exports proven identical to `evidence.js`'s originals, and each converted module (library, mine, search, taste map) checked against real state built through `applySearchAction`. Model rules: 241 -> 288. No behavior change: flow 222/222 in all four looks, ranking parity untouched.

## Fixed the recommendation artwork collision (#34)

The decorative shape `.art-shape-b` sat bottom-left, directly behind where a left-aligned, possibly multi-line title lands. A new overlap checker (`checkArtwork()` in `layout-check.js`) confirmed this on **every** card, 9-53% coverage depending on the title, not just EEAAO — systemic, as the issue suspected. Fix: the decorative shapes now live in the top half of the artwork box (the same "reserved frame" principle the sticker system already uses), leaving the whole bottom title band clear. Verified with 0 hits across all four looks at 1440/768/390/320, for every catalog title plus a synthetic very long one, geometry-checked and screenshot-confirmed.

`checkArtwork()` is now wired into every layout/flow check going forward, with explicit named checks for a very-long synthetic title, so a title-length regression can't slip through silently again. Flow: 222 -> 224.

**Local Chrome reliability note:** mid-fix, this machine's local headless Chrome got stuck in updater/crash-handler churn (visible in stderr, likely contention from other concurrent Claude Code sessions on the same box) and stopped completing any run. `headless.sh` now reuses a project-local Chrome profile (`$ROOT/.git/tm-chrome-profile`, not the machine's default one and not a fresh dir per call — a brand-new profile triggers first-run/updater machinery that ignores the script's alarm timeout) plus `--no-first-run --disable-background-networking --disable-component-update`. When local runs are still unreliable, push to `live-producer-preview`, open a throwaway diagnostic PR so the `pull_request`-triggered CI run happens in the clean, isolated GitHub Actions container, check the result there, then close the PR without merging and fast-forward `main` directly (same pattern used for the #41 CI fix). That is how this fix was actually verified end-to-end.

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

**Decision (Paige, Sept 22, 2026):** the gate stays on. She is the only user of the site, so the risk of public spend is acceptable to her. Everything below still describes how the gate works; it is no longer an open question.

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
