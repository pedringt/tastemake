# Tastemake handoff — Sept 29, 2026 (end of session)

This is the current continuation guide for Tastemake. If older notes conflict with this file, issue #16, newer issue-specific acceptance criteria, or current `main`, trust the newer material.

## Current repo / production

- Repo: https://github.com/pedringt/tastemake
- Production: https://tastemake.vercel.app
- Current `main`: **5c85c854151af89b04fd41ce4c3b0a20bba28e56**
- Vercel production deployment for that exact commit is confirmed `READY` directly against the Vercel API, and re-verified live in a fresh (non-cached) browser tab with a clean console.
- CI is green on `main`.
- **Draft PR #101** ("Refresh Claude Code handoff") is still stale — do not merge it.

### Real incident this session: an automated bot PR broke production for every visitor

An automated Vercel bot PR (#162, "Install Vercel Web Analytics") added `import { inject } from "@vercel/analytics"` to `src/app.js`. This app has **no build step** — `app.js` loads as a native browser ES module, and a bare package-name specifier only resolves under Node/bundler resolution, never in a real browser. Every page load threw `Failed to resolve module specifier` synchronously, aborting `app.js`'s entire module evaluation before any of the app's own code ran. The static HTML shell (header/nav) still rendered, which is why it read as a confusing partial blank rather than fully blank — but nothing else worked: no routing, no recommendations, nothing. This is what Paige reported as "tastemake is down" / a black screen, and it also explains why CI had been failing on every run since #162 merged (not flaky GPU drivers, a real regression).

**Fix**: reverted the import and `inject()` call, removed the unusable `@vercel/analytics` dependency (PR #168, hotfix). Verified live in a fresh tab.

**Standing lesson**: automated bot PRs (Vercel's own installers, "codex/project-health-*" branches) merge into `main` in this repo outside of Paige's or Claude's review. If something that used to work suddenly breaks with no corresponding human-authored change, check `git log main` for an unreviewed automated commit first. Still an open, unresolved gap in this repo's process (see "what's open" below) — it has not recurred since, but nothing prevents it from recurring.

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
- **Favorite = strongest explicit experienced-positive signal** — Library is the single durable source of truth. The Recommendations screen can also toggle a Favorite directly on a card, using the exact same invariant (and the same invariant is now also enforced there when a reaction changes away from strong-positive — see the QA sweep below).
- **Taste Profile = inspectable/correctable working model of taste**
- **Domains are five, not three, and the labels are nouns**: `movies` ("Movies"), `tv` ("TV"), `read` ("Books"), `play` ("Games") are visible/recommendable. `watch` no longer exists anywhere in the codebase. If you find a stray `"watch"` string or a "Read"/"Play" label anywhere, it's a leftover bug, not intentional.
- **My Tastemake** (`src/screens/mine.js`) rows now collapse their reaction-change buttons behind a "Change" disclosure by default, same pattern as Library's Tried cards — a long real history no longer renders as a wall of always-open buttons.

## This session's real thread: a recurring wire-payload 413, a live production incident, a feature backlog, a deep QA sweep, and then a real multi-round debugging chase on the domain filters

Distinct pieces of work, in order. Every fix here was driven by a real report from Paige or a deliberate QA pass — none of it is speculative hardening.

### 1. The 413 bug recurred a third time, then got a structural fix instead of another field trim

Real report: **"getting the same 3 video game recs now no matter the filter or what i do."** Confirmed in Vercel logs: `POST /api/recommendations 413`. Same failure class fixed twice before (trim `recommendationSets` to ids, then trim `about`/`artwork`/`sourceUrl`) — a long session with many reactions grows `feedbackByRecommendation`/`customItems` back past the 160KB body cap.

Immediate fix (PR #163): two more purely-display fields — `reason` and `ai` (`cites`/`tests`/`kind`/`contract`) — were never trimmed.

Paige then asked directly: **"how do we keep it from happening again?"** PR #165 bounds the *shape* instead of trimming another field list:
- `feedbackByRecommendation`: an **intent-only** reaction's id can never be dropped (that would silently un-exclude an already-seen item), but its item payload shrinks to just `id/title/type/domains/custom`. **Experienced** reactions keep their full trimmed item.
- `customItems`: only ever read server-side for ids already in `selectedFavorites` or carrying *experienced* feedback — any other entry is dropped entirely.
- `blindSpots`/`blindSpotDrafts`/`blindSpotDismissed` (found by the QA sweep, folded into #165): sent whole and unbounded despite being read nowhere server-side. Not sent at all now.
- `[tastemake-recommendations-payload]` now logs the request's content-length on **every** call, so a rising payload shows up in logs before anyone hits a 413 again.

**This is genuinely load-bearing**: if a 413 recurs a fourth time, look at *new* fields being added to pick/feedback objects — don't just trim another field and call it done.

### 2. Feature backlog cleared: TV/Movie filter split, Add to Favorites from Recommendations, canonical-store batching

- **PR #159**: `upsertManyCanonicalItems()` batches the write-behind canonicalization path into one tuple-IN lookup + one multi-row UPDATE + per-item atomic-CTE inserts only for genuinely new items + one multi-row provenance INSERT.
- **PR #160**: split the "Watch" domain into separate `movies`/`tv` domains everywhere (`src/data/domains.js` is the single source of truth). TMDb browse/search queries are now movie-only or TV-only depending on which is selected.
- **PR #161**: an explicit "Add to Favorites" toggle on recommendation cards, gated the same way Library/Search gate favoriting.

### 3. Deep QA sweep: 6 parallel review agents, 6 real bugs found and fixed (PR #167, one folded into #165)

1. **AI prompt/validation read the full eligible-candidate pool, not the 6 actually offered.** Fixed with a `promptCtx` (candidates capped to the offered set) used everywhere the model's answer is built or checked.
2. **Filter change mid-request went undetected** by `evidenceFingerprint` — became directly relevant again in the filter-click saga below.
3. **Favorite↔reaction invariant could be silently violated on the Recommendations screen** — `saveQuickFeedback`/`saveFeedbackDetail` now clear `libraryFavorites` when a reaction moves away from strong-positive, same as Library/Search.
4. `api/hypotheses.mjs` now has the same pre-parse content-length guard as `api/recommendations.mjs`.
5. `canonical-store.mjs`'s per-field provenance inserts are now parallelized (`Promise.all`) instead of sequential.
6. (Folded into #165) `blindSpots`/`blindSpotDrafts`/`blindSpotDismissed` unbounded on the wire.

### 4. The domain-filter saga: three real reports, three real fixes, only the third one was the actual root cause

This is the part worth reading carefully if a filter bug ever gets reported again. Paige reported, across several messages, that the Movies/TV/Books/Games filter chips "don't seem to be working" — and it took three passes to find the *actual* cause, not because the earlier fixes were wrong, but because there were genuinely three separate real bugs stacked on top of each other:

1. **First report** ("switching to TV filter doesn't seem to work... not able to generate recs"): confirmed real — filtering to a domain with zero evidence in it (she has no TV reactions at all) returns zero candidates by design, but the UI showed the exact same generic "no eligible picks" message as true exhaustion, with the message computed server-side but never actually read by the client (hardcoded string). **Fixed in PR #170**: server names the real cause, client reads `result.reason` instead of a hardcoded string.
2. **Second report** ("no button to get new recs" / screenshot showing two identical "Recommendations" buttons on the Taste Profile footer): once `recommendationExhausted` is true (exactly the state #1 leaves you in), the entire "More recommendations" footer is replaced by a "Prototype checkpoint" banner whose only actions were Change favorites / See profile — **no way to switch the filter back at all**, a genuine dead end, not just a confusing one. **Fixed in PR #171**: added a "Show all instead" recovery action to the banner, reusing the SHOW ME bar's own attributes.
3. **Third report, after both of the above were live** ("filters still don't appear to be working for movies/tv/books/games etc.", broader than just TV): dug into real production logs and found the actual mechanism — **a real request routinely takes 11-20+ seconds** (candidate retrieval fan-out plus the live model call is the dominant cost). The SHOW ME filter click handler only re-fetched when `state.aiStatus !== AI_LOADING`. Clicking through filter chips at a normal pace (not knowing to wait out a 20-second load between each click) hit this on nearly every click: the button visually flipped to "selected," but **no request was ever sent for it** — it looked exactly like "nothing happens" for any domain, not just one with no evidence. When the original in-flight request finally resolved, `staleReason`'s filter check (from #167, item 2 above) correctly caught the mismatch and discarded it — but that only explained the problem one click too late, and never actually fetched the filter that was clicked. **Fixed in PR #172**: removed the `AI_LOADING` gate entirely. `startRequest()` already cancels any in-flight request safely via its own `AbortController`, so the gate was not just unnecessary but actively wrong. Verified in a browser by patching `fetch` to simulate the real ~20s delay and confirming two rapid filter clicks now both produce real requests (before the fix, only the first one ever did).

**Why this matters for next time**: #3 was the actual root cause of the majority of what Paige experienced as "filters broken." #1 and #2 were real, independently worth fixing, but a user who never waited out a full load would have hit #3 regardless of whether #1/#2 existed. If a similar "X doesn't seem to work" report comes in again for a slow, async part of this app, check the request's actual latency in the logs *first* — a slow request plus an overly conservative "don't retry while loading" guard is an extremely easy trap to fall into and very hard to diagnose from the UI alone.

## What's genuinely still open, in rough priority order

1. **The automated-PR review gap is still unresolved.** Nothing currently prevents another bot PR (Vercel installer, "codex/project-health-*", etc.) from merging straight to `main` unreviewed the way #162 did. Worth a real decision: branch protection requiring review, or at minimum checking `git log main` for unreviewed automated commits at the start of every session.
2. **`api/ai-metrics.mjs` / `src/server/ai-metrics.mjs`** — added by an automated PR (#166) that also merged without review. Still not investigated beyond confirming it doesn't conflict with anything.
3. **Canonical-store race-condition fix — still only verified against a real Neon database once**, before this session's batching rewrite (#159) landed on top of it. Worth a real-DB spot check that `upsertManyCanonicalItems` doesn't reintroduce the race the single-item path already closed.
4. **Confirm the filter-click fix (PR #172) actually resolves it from Paige's real usage.** It's verified by direct reproduction in a browser, but hasn't yet been confirmed against her real account/history since deploy.
5. **Kids' profiles idea (parked, not scoped)**: Paige wants separate Tastemake profiles for her kids so she doesn't have to rate kids' movies on her own profile. Explicitly told to not worry about it "for now." There is currently no concept of profiles/accounts at all — everything is one global state object in a single browser's localStorage. The lightweight approach discussed: a profile-switcher that swaps which localStorage key state reads/writes (still local-only, no server-side identity), not a full multi-user backend. Tradeoff: stays single-device. Saved as a memory; don't start without Paige picking it back up explicitly.
6. **#135's remaining half** — lazy web-enrichment for thin metadata is still entirely unbuilt.
7. **#142** — book sequel-suppression residual gap (Open Library lacks series data for some real books). Accepted limitation.
8. **#115** — exact-match search ranking can promote an obscure title over a well-known one with a longer official title. Two real reproductions on file.
9. Long-tail future/idea issues, parked, no new signal to revisit: #6, #7, #9, #10, #11, #14, #15, #17, #19, #28, #37, #48, #69, #29, #100.

## Standing workflow rules (followed carefully this session, keep following them)

- Only merge to `main` on Paige's explicit instruction, every time — passing CI is never permission by itself.
- Before any *intentional* paid Anthropic call: state expected call count + cost estimate, get explicit approval, every time.
- Do not weaken validation/grounding/novelty-suppression to make a metric look better.
- No seeded/demo data, ever.
- **When something claims to fix a backend/infra bug, verify it against the real deployed system before believing it — not just green tests, and not just "the first fix I found."** This session's clearest example is the domain-filter saga above: two real, shippable fixes (#170, #171) still weren't the actual root cause of what Paige was experiencing. Pull real production logs (request timing, not just error status) before declaring a UX bug fixed.
- After a hard-to-reproduce report, try to reproduce the *exact* real-world conditions (e.g. real request latency, not an instant local mock) rather than only testing the happy path — the filter-click bug was invisible in every earlier manual check because those checks didn't wait through a realistic 11-20s load before clicking again.
- Before branching for new work, check `git log`/`git status` against `origin/main` for anything unexpected (an automated bot merge, a leftover local commit from a prior tool run).

## Suggested next sequence

1. Sync with current `main` at `5c85c854151af89b04fd41ce4c3b0a20bba28e56`.
2. Read this file, then issue #16, then whichever open item above you're picking up.
3. Check `git log --oneline -20 main` for any automated-bot commits that landed since this handoff was written, and read what they changed before doing anything else.
4. If a filter/UX report comes in that sounds similar to the saga above, check real request latency in Vercel logs before assuming the bug is in the filtering logic itself.
5. Any paid-model verification: state count + cost, wait for explicit approval.
