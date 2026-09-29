# Tastemake handoff — Sept 29, 2026 (end of session)

This is the current continuation guide for Tastemake. If older notes conflict with this file, issue #16, newer issue-specific acceptance criteria, or current `main`, trust the newer material.

## Current repo / production

- Repo: https://github.com/pedringt/tastemake
- Production: https://tastemake.vercel.app
- Current `main`: **79d0d3c1d18120dae1e3788233ea55803c97d8eb**
- Vercel production deployment for that exact commit is confirmed `READY` directly against the Vercel API, and the live site was re-verified in a real (non-cached) browser tab after deploy — see the incident writeup below before trusting "CI is green" as proof the site actually works.
- Required CI is green on `main` again as of this commit, after being red on every run since ~23:56 the prior session (see incident below — it was a real regression, not flakiness).
- **Draft PR #101** ("Refresh Claude Code handoff") is stale — do not merge it. Untouched again this session; close it or ignore it.

### Real incident this session: an automated bot PR broke production for every visitor

**What happened**: an automated Vercel bot PR (#162, "Install Vercel Web Analytics", merged before this session started reviewing it) added `import { inject } from "@vercel/analytics"` to `src/app.js`. This app has **no build step** — `app.js` loads as a native browser ES module, and a bare package-name specifier like `"@vercel/analytics"` only resolves under Node/bundler resolution, never in a real browser. Every real page load threw `Uncaught TypeError: Failed to resolve module specifier "@vercel/analytics"` synchronously, which aborted `app.js`'s entire module evaluation before any of the app's own code ran. The static HTML shell (header/nav) still rendered — which is why it read as a confusing partial blank rather than a totally blank page — but nothing else did: no routing, no recommendations, nothing.

This is what Paige reported live as "tastemake is down" / a black screen. It also explains why CI had been failing on every run since #162 merged: `test:flow` and the other headless-browser suites were hanging trying to exercise a page whose `app.js` throws immediately, not because of flaky GPU drivers in the CI runner as first suspected.

**Fix**: reverted the import and `inject()` call in `src/app.js`, removed the now-unusable `@vercel/analytics` entry from `package.json` (PR #168, merged as a hotfix). Verified live on `tastemake.vercel.app` in a fresh, uncached tab: no console errors, full app renders (recommendations, filters, routing).

**Lesson for next time**: automated bot PRs (Vercel's own analytics/insights installer, "codex/project-health-*" branches, etc.) merge into `main` outside of Paige's or Claude's review in this repo. If something that used to work suddenly breaks with no corresponding human-authored change, check `git log main` for an unreviewed automated commit first — this cost real production uptime before it was caught. Consider whether this repo should require review on automated PRs going forward.

## Product north star

Tastemake helps people understand patterns in what they are drawn to, then uses those patterns to discover and test more things they may like.

> Most recommenders let you react to items. Tastemake also lets you react to the model it builds from those reactions.

Core authority model (unchanged, do not re-litigate without new evidence):
- software owns evidence, state, eligibility and mutation;
- AI interprets, ranks and explains;
- only experienced items become taste evidence;
- Saved / intent does not become experience;
- user-confirmed correction outranks model inference;
- Taste Profile patterns are working hypotheses, not personality labels;
- search/browse/opening an item is never taste evidence;
- model output must remain grounded in real evidence;
- novelty / repeat / franchise suppression is deterministic and cannot be overridden by the model.

## Current product model

- **Recommendations = discovery**
- **Library = ongoing relationship management** (Saved / Tried / Favorite / Disliked)
- **Favorite = strongest explicit experienced-positive signal** — Library is the single durable source of truth for this. As of this session, the Recommendations screen can also toggle a Favorite directly on a card (see below) using the exact same invariant.
- **Taste Profile = inspectable/correctable working model of taste**
- **Domains are now five, not three**: `movies`, `tv`, `read`, `play` are visible/recommendable; `watch` no longer exists anywhere in the codebase (see the filter split below). If you find a stray `"watch"` string anywhere, it's a leftover bug, not intentional.

## This session's real thread: a recurring wire-payload 413, a live production incident, a feature backlog, and a deep QA sweep

Distinct pieces of work, roughly in the order they happened. Each was driven by either a real production report from Paige or a deliberate QA pass — none of this is speculative hardening.

### 1. The 413 bug recurred a third time, then got a structural fix instead of another field trim

Real report: **"getting the same 3 video game recs now no matter the filter or what i do."** Confirmed in Vercel logs: `POST /api/recommendations 413`. This is the same failure class fixed twice in the prior session (trim `recommendationSets` to ids, then trim `about`/`artwork`/`sourceUrl`) — a long session with many reactions grows `feedbackByRecommendation`/`customItems` back past the 160KB body cap, every request (including a filter change, which also re-POSTs) fails before ever reaching the model, and the client just keeps showing whatever set last succeeded. Reads exactly like "stuck on the same picks."

Immediate fix (PR #163): two more purely-display fields — `reason` (the AI's full rationale sentence) and `ai` (`cites`/`tests`/`kind`/`contract`) — were never trimmed. Confirmed unused server-side by grep, same as the earlier fields.

Paige then asked directly: **"how do we keep it from happening again?"** Rather than trim another field list (which only raises the ceiling), PR #165 bounds the *shape*:
- `feedbackByRecommendation`: an **intent-only** reaction's id can never be dropped (that would silently un-exclude an already-seen item — the #152 bug class), but its item payload now shrinks to just `id/title/type/domains/custom`, the only fields `evidenceRecords()`/`displayLabel()`/the exclusion set actually read for a non-experienced item. **Experienced** reactions (Loved/Liked/Tried-disliked) keep their full trimmed item, since anchor selection needs provider/genre data for those.
- `customItems`: only ever read server-side for ids already in `selectedFavorites` or carrying *experienced* feedback — any other entry is dropped entirely, zero information loss.
- `blindSpots`/`blindSpotDrafts`/`blindSpotDismissed` (found by the later QA sweep, folded into #165): sent whole and unbounded despite being read nowhere server-side on either `/api/recommendations` or `/api/hypotheses`. Not sent at all now.
- `[tastemake-recommendations-payload]` now logs the request's content-length on **every** call (accepted or rejected), so a rising payload shows up in logs before anyone hits a 413 again.

This is genuinely load-bearing: if a 413 recurs a fourth time, look at *new* fields being added to pick/feedback objects, or reconsider whether the intent-only stub needs to shrink further — don't just trim another field and call it done.

### 2. Feature backlog cleared: TV/Movie filter split, Add to Favorites from Recommendations, canonical-store batching

Three independent PRs, all merged:
- **PR #159**: `upsertManyCanonicalItems()` batches what used to be one `upsertCanonicalItem()` call per item in `canonicalizeWriteBehind` into one tuple-IN lookup + one multi-row UPDATE + per-item atomic-CTE inserts only for genuinely new items + one multi-row provenance INSERT.
- **PR #160**: split the "Watch" domain into separate `movies`/`tv` domains everywhere (`src/data/domains.js` is the single source of truth; the Recommendations filter bar, Browse tabs, and the search "add something" filter chips all derive from it, so the split shows up everywhere automatically). TMDb browse/search queries are now movie-only or TV-only depending on which is selected, instead of one combined query.
- **PR #161**: an explicit "Add to Favorites" toggle on recommendation cards, gated the same way Library/Search already gate favoriting (`isStrongPositive`). Reuses Library's exact `data-library-action`/`data-library-item` markup, so it needed no new wiring — `app.js`'s existing handler already covers it.

### 3. Deep QA sweep: 6 parallel review agents, 6 real bugs found and fixed (PR #167, plus one folded into #165)

Angles: line-by-line critical-path review, cross-file data-flow tracing, async races/invariants, security (XSS/SQL injection), taste-evidence-model correctness, and a check for whether the (at-the-time) 4 open unmerged PRs would conflict if merged together (they didn't — one trivial one-line test-fixture conflict, no logic conflicts). Findings, all fixed with regression tests verified to fail-without/pass-with each fix:

1. **AI prompt/validation read the full eligible-candidate pool, not the 6 actually offered.** `api/recommendations.mjs` sliced `candidates = ctx.candidates.slice(0, 6)` for the fallback/exhaustion logic, but `buildPickPrompt`/`promptSizeBreakdown`/`validatePicks` all read `ctx.candidates` directly (up to 30). A model could validly pick and return an item outside the intended 6. Fixed with a `promptCtx` (candidates capped to the offered set) used everywhere the model's answer is built or checked.
2. **Filter change mid-request went undetected.** `recommendationFilter` was missing from `evidenceFingerprint` (`src/ai/requests.js`), so switching the filter while a request was in flight let the stale, old-filter response land and render under the new filter selection.
3. **Favorite↔reaction invariant could be silently violated on the Recommendations screen.** Unlike Library's `saveLibraryAction` and Search's `applySearchAction`, `saveQuickFeedback`/`saveFeedbackDetail` never cleared `libraryFavorites` when a reaction moved away from strong-positive — a stale Favorite flag could survive a "Less" reaction and silently resurrect if the user flipped back to Loved.
4. `api/hypotheses.mjs` measured request body size only after fully parsing it into memory, unlike `api/recommendations.mjs`'s pre-parse content-length guard. Added the same guard.
5. `canonical-store.mjs`'s per-field provenance inserts in `upsertCanonicalItem` were awaited sequentially despite being independent, idempotent rows. Parallelized with `Promise.all`.
6. (Folded into #165, see above) `blindSpots`/`blindSpotDrafts`/`blindSpotDismissed` unbounded on the wire.

All 5 PRs from this session (#159, #160, #161, #165, #167) merged cleanly — auto-merge handled every cross-branch overlap correctly, verified by running the real test suite after each merge, not just trusting a clean `git merge` exit code.

## What's genuinely still open, in rough priority order

1. **The automated-PR review gap that caused the production incident above.** Nothing currently prevents another bot PR from merging straight to `main` unreviewed. Worth a real decision: branch protection requiring review, or at minimum a habit of checking `git log main` for unreviewed automated commits at the start of every session.
2. **`api/ai-metrics.mjs` / `src/server/ai-metrics.mjs`** — added by a different automated PR (#166, "Project Health AI telemetry") that also merged mid-session without review. Not investigated this session beyond confirming it doesn't conflict with anything; worth a real look at what it actually collects/logs before trusting it in production.
3. **Canonical-store race-condition fix (from two sessions ago) — still only verified against a real Neon database once, not re-verified after this session's batching rewrite (#159) landed on top of it.** Worth a real-DB spot check that the batched path (`upsertManyCanonicalItems`) doesn't reintroduce the race the single-item path already closed.
4. **#135's remaining half** — lazy web-enrichment for thin metadata is still entirely unbuilt. Don't start without re-reading the full issue (no AI-invented facts, lazy growth only, provenance required).
5. **#142** — book sequel-suppression residual gap (Open Library lacks series data for some real books). Accepted limitation, no new direction.
6. **#115** — exact-match search ranking can promote an obscure title over a well-known one with a longer official title. Two real reproductions on file. Not started.
7. Long-tail future/idea issues, parked, no new signal to revisit: #6, #7, #9, #10, #11, #14, #15, #17, #19, #28, #37, #48, #69, #29, #100.

## Standing workflow rules (followed carefully this session, keep following them)

- Only merge to `main` on Paige's explicit instruction, every time — passing CI is never permission, and as this session showed, **CI being green is also not proof the site actually works** (it was red for the right reason this time, but don't assume "unstable" always means "ignore it" either — check *why* before merging through it).
- Before any *intentional* paid Anthropic call: state expected call count + cost estimate, get explicit approval, every time.
- Do not weaken validation/grounding/novelty-suppression to make a metric look better.
- No seeded/demo data, ever, in any of this work.
- **When something claims to fix a backend/infra bug, verify it against the real deployed system before believing it — not just green tests.** This session's clearest example: after merging the production hotfix, the live site still showed the old error until checked in a *fresh, uncached* browser tab — a hard reload in the same tab wasn't enough (a `304 Not Modified` served the stale cached module). If a fix "isn't taking effect" in production, try a genuinely fresh tab/session before assuming the deploy failed.
- When a real user report is ambiguous, pull the real logs before assuming which mechanism is at fault — this session's 413 recurrence, the favorite-invariant bug, and the production incident were all found this way.
- Before branching for new work, check `git log` / `git status` against `origin/main` for anything unexpected (an automated bot merge, a leftover local commit from a prior tool run) — this session had both happen mid-session and each needed to be caught before it silently became part of the next PR.

## Suggested next sequence

1. Sync with current `main` at `79d0d3c1d18120dae1e3788233ea55803c97d8eb`.
2. Read this file, then issue #16, then whichever open item above you're picking up.
3. Check `git log --oneline -20 main` for any automated-bot commits that landed since this handoff was written, and read what they changed before doing anything else — see item #1 above.
4. If continuing canonical-store work: do the real-DB spot check on the batched upsert path (#3 above) before building anything further on top of it.
5. Any paid-model verification: state count + cost, wait for explicit approval, exactly like every call this session.
