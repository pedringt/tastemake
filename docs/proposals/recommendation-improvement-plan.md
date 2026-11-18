# Recommendation improvement plan (proposal, for review)

Written Nov 17, 2026 for Paige. **A proposal, not an approved plan.** The status notes below ("unmerged", "main is at …") are a snapshot from when each section was written. Current state, end of Nov 17:

- **Merged and live:**
  - **#381:** recognized "Not me" and unticked-area conflicts are left out of picks, at `1847728`.
  - **#384:** retrieval prefers clean anchors, at `1ae454f`.
- **In release PR #385 (not merged):**
  - Surprise refill and honest Surprise label.
  - The corrections empty-set message.
  - The appeal-profile store, **off** (U14's store only; no scoring).
  - The eval cleanup.
  - This document.
- **Merged since:** **#385** (`58869c4`), with the Surprise fixes, the corrections empty-set message, the appeal-profile store (**off**), the eval cleanup and this document.
- **Not built:** the appeal-profile scorer, the discovery rule (U15), #383, D-1/D-2 work, and the fresh-ratings validation.

**Planning update, Nov 17 (late): development evidence only, not validation**
- **Dislike check (D-check)** on Paige's 60 Nov 4 ratings (`~/tastemake-research-local/dcheck-2026-11-17/`).
  - Description scoring doesn't raise dislike risk compared with genre. Her "no" titles in the per-medium top 3s: genre 9 of 23 (inflated by ties), description scoring 1 of 12. Top-3 titles nearer a dislike than any like: 1 against 0.
  - **The dislike penalty isn't earning its place:**
    - without it, within-medium ordering is 0.64; with it, 0.62;
    - it moves about as many wants down as up;
    - it pushed Squid Game (want) from 6th to 11th via Severance;
    - a 0.5× cap changed nothing.
  - None of the 7 dislikes has a reason, so reason overreach (C2's failure) is untested.
- **Working hypothesis (Paige):** description scoring **without** the dislike penalty. It's to be tested on fresh ratings, not shipped.
- **Next:** the fresh-ratings protocol in `docs/proposals/fresh-ratings-eval-protocol.md`.
  - Arms: genre, D0 (no penalty), D1 (penalty).
  - Gates fixed in advance, with separate fit and dislike-avoidance measures.
  - Dislikes with reasons included, with dislike-overlap titles in a separate challenge set, never pooled with the 48 taste-independent primary titles.
  - Too few comparisons means inconclusive, with no thresholds changed afterwards.
  - "Never recommend" exclusions kept separate from "no" ratings.

**Sources:**
- #380, PR #381, #382, #383
- #341 (the improvement-cycle tracker), #250, #323, #28
- `docs/feedback-semantics.md` (approved Nov 7)
- the Nov 4 diagnosis and its "understanding" step, the 6-of-8 experiment, C2 (Nov 5), K1 (Nov 13)
- the parked #341 step 4 captures (`~/tastemake-research-local/step4`)

**Goal:** recommendations that respond to what people tell Tastemake, and that are measurably better, not just different.

---

## 1. Improvement map

**Status key:**
- **Fixed:** on main.
- **PR:** in PR #381 (unmerged when written; merged Nov 17 as `1847728`).
- **Exp:** a planned experiment.
- **Decide:** an unresolved design choice for Paige.
- **Deferred:** not planned now.
- **Settled:** already decided in `docs/feedback-semantics.md`.

### From #380 (corrections)
| # | Concern | Status | Where |
|---|---|---|---|
| 1 | Nothing checks final picks against corrections | **PR**: checked for recognized conflicts | #381 |
| 2 | A "Not me" title could outrank a clean one, and media turns gave it a slot | **PR** | #381 |
| 3 | The validator's `tests` check never runs (`tests` is always null) | **PR** adds a working check. The dead code stays. The same null breaks Tastebreak for live picks (#341 cross-cutting finding) | #381; cleanup **Deferred** |
| 4 | "Not me" misses patterns with no distinctive labels, and untagged titles (often games) | **Exp** (conflict recognition from existing structured data), then **Decide** | U8 |
| 5 | Retrieval ignores corrections and starts from rejected patterns' titles | **Exp** | U5 (with #382) |
| 6 | Picks already on screen aren't re-checked after a correction | **Decide** | #383 |
| 7 | Bare Partly, context, weight and Not sure are prompt-only; the fallback ignores them | **Settled** for Not sure and bare Partly: they never touch the shortlist (principle 2, D6). Weight and context are **Decide** (D3 in the semantics doc is still open) | D-3 below |
| 8 | "Doesn't describe me" vs "never recommend anything like this" | **Decide** later. The strict rule stays (Paige, Nov 17) | D-6 |
| 9 | A title near a dislike is offered when few candidates score ≥ 0 | **Exp** (ranking measure: dislike guardrail) | U2, U4 |
| 10 | Above 96 ratings, older ratings stop counting | **Exp** (measure first; the fix may be trivial or a wire-size issue) | U2 |
| 11 | Blocking is by id only (other editions, related titles) | **Deferred** | — |
| 12 | "Fits a different side" reasons and dismissal notes are stored only | **Decide**: #323 phase 4 and the dismissal-notes learning policy | #323 |
| 13 | No test of whether corrections improve later picks | **Exp** | U1 (offline compliance), U12 (paid) |

### From #382 (taste evidence)
| # | Concern | Status | Where |
|---|---|---|---|
| 14 | About 99% of score is genre | **Exp** (U3, U4, U7) and **Decide** (D-1, D-2) | — |
| 15 | Film, TV and games have no themes; IGDB themes unused | **Mostly answered**: K1 (Nov 13) already scored IGDB themes and TMDb keywords and **failed** held-out (−0.016). Don't re-run tags alone | U7 (book themes only, low priority) |
| 16 | The pool is cut to 30 before scoring | **Exp** | U3 |
| 17 | About 50% of the order comes from retrieval | **Exp**. Mixed evidence: Nov 4 "step 0" improved synthetic fit, but on Paige's rated pool it lost the one new want | U4 |
| 18 | Only 40% of the taste top 6 reach the offered 6 | Baseline metric | U1 |
| 19 | Synopses unused in scoring | **Deferred**. Nov 4 TF-IDF cut ties (23.8% → 1.1%) but ordering barely moved (0.39 → 0.43) | — |
| 20 | Thin book descriptions ("First published …") | **Deferred** to #249 (Hardcover) / phase 5 | #249 |
| 21 | Reasons are a flat ×1.25, whatever they say | **Decide** (D-1), then **Exp** | #250, U9 |
| 22 | Mixed reasons can't be entered; a reason can push toward the disliked aspect | **Decide** (D-1). #250 already designs directions for books | #250 |
| 23 | Confirmed patterns never raise matching titles | **Decide** (D-2), then **Exp** | U10 |
| 24 | The model sees only 6 and must use all 6 | **Exp**, paid, phase 5. The 6-of-8 test (Nov 4, about $0.79) gave a small gain | U12 |
| 25 | AI appeal profiles per title | **Exp**, paid, phase 5. Best signal so far, but C2 narrowly failed | U12 |
| 26 | Starting points are 4–8 random rated titles | **Exp** (with U3 and U5) | U3 |

---

## 2. Work plan: small units

Each unit is one PR or one report. Each is measured against the U1 baseline and merged only with Paige's OK.

### P0: measure first
- **U1. Recommendation baseline report (offline, free).** One script, run on main, that reports the measures in section 3 for four input sets:
  1. the stress profiles (synthetic; behaviour only)
  2. the correction fixtures (compliance)
  3. Paige's 60-title rated pool from Nov 4 (human-judged; the main ground truth)
  4. the step 4 recorded retrieval captures (real provider answers, replayed)

  It reuses `trace-request.mjs`, `corrections/shortlist-334.mjs`, and the step 4 replay tooling. That tooling is read from the parked `eval/step4-capture` branch and never merged. The data stays in `~/tastemake-research-local`, never in the repo.
  - *Accept when:* it's reproducible run to run, every measure is labelled synthetic or human-judged, and it makes no network or model calls.
  - *Regression check:* `npm test` is unchanged.
  - **New issue proposed** (no existing issue covers it; #341 step 4 was the closest and is parked).
- **U2. Coverage gaps.**
  - Add TV and comedy, mixed reasons, sparse profiles, and several corrections at once to the synthetic fixtures.
  - **Ground truth needs Paige** (D-4): a fresh held-out rated pool. The Nov 5 held-out 40 is used up (no tuning against it), and every test so far had no TV pairs.
  - Also measure how often the 96-rating cap applies (#380 item 10).

### P1: retrieval and ranking with what exists (offline first)
- **U3. Score a wider pool.** Cut after scoring, not before: try 40 and 60 against today's 30. Paige's Nov 4 pool is exactly 60 titles from current retrieval, so this can be judged against her ratings for free.
  - *Accept when:* within-medium want-vs-no ordering improves by an amount agreed beforehand (suggest ≥ +0.10, as C2 required ≥ 90% of bootstrap draws), with no rise in "no" titles in the top 6, no lost media, and a dislike guardrail no worse than today.
  - Report provider latency: does fetching more raise timeouts?
- **U4. Retrieval-order weight.** Try 0, 0.25 and 0.5 (today), with and without U3. Pre-register the gate. The Nov 4 result was mixed, so the outcome isn't assumed.
- **U5. Correction-aware retrieval** (depends on #381 being merged, or branches from it). Don't use a rejected pattern's supporting titles as starting points, and fetch more when a medium runs out after filtering. The person's ratings are untouched: only their use as starting points changes.
  - *Accept when:* fewer lost media and short sets on the correction fixtures, 100% of recognized conflicts still excluded, and no fit regression on unrelated profiles.
- **U6. Finish #381.** Already reviewed and the wording fixed. A merge decision (D-5).
- **U7. Book themes beyond 3** (low priority, after U3/U4). Only if the approved-list rule from #250 holds. Game and film tags aren't retried (K1).

### P1: making preference evidence count (needs design decisions first)
- **U8. Better conflict recognition** from existing structured data (TMDb genre ids, IGDB genres; no model). Report how many fixture conflicts are recognized vs missed, by medium.
  - *Accept when:* tests separate "recognized and excluded" from "missed: no usable labels".
- **U9. Reason meaning, offline** (after D-1). Map each existing chip to the features it plausibly refers to, and boost only those, not the whole title. The Atmosphere case: tone/mood features gain, genre doesn't.
  - Measure with fixture profiles in four versions: no reasons, matching reasons, reasons that contradict genre, and qualified reasons.
  - **Reuses #250**, which also owns any rating-screen change.
- **U10. Confirmed patterns in selection** (after D-2). For example, a small, capped boost for titles matching a *confirmed* pattern's distinctive labels, never a hard rule.
  - Measure on the human-judged pool. A new sub-issue under #341 or #382, chosen at review.
- **U11. Previously displayed picks.** #383, after D-4b.

### P2: richer AI context (paid, one change per run)
- **U12.** Each runs separately: 8 candidates, better descriptions, rated titles' facts, then appeal profiles.
  - Every run needs Paige's OK on call count and a cost cap enforced in code.
  - Measure fit, variety, dislike avoidance, explanation quality, latency, and tokens and cost.

### Then: product check
- **U13. Human review protocol.** Owner testing only: Paige noted on Nov 4 that she can't test with other people. Reports and the case study must say "owner-tested", not "user research".
  - Include first-time and returning profiles, and cases where Tastemake should say it lacks enough evidence.

**Proposed new issues:** U1 (baseline report), U3+U4 (shortlist recall; or a sub-task on #382), U5 (correction-aware retrieval; or a sub-task on #382), U8 (conflict recognition; or a sub-task on #380). **Reuse, no new issue:** #250 (U9), #383 (U11), #341 (stays the tracker; update its plan), #28 (explanation quality in U12).

---

## 3. Immediate offline evaluation plan (no paid calls)

**Baseline:** main at `aab1f56` when written. PR #381 was measured as its own arm because it was unmerged then; it has since merged (`1847728`), so today's baseline is main with #381 and #384.

| Layer | Measure | Data | Existing script |
|---|---|---|---|
| Retrieval | Wanted titles in the pool (recall of Paige's "want" titles); pool size; media present after filtering | Nov 4 pool (human), step 4 captures | step 4 replay (branch, read-only); `trace-request.mjs` |
| Ranking | Within-medium want-vs-no ordering (Nov 4 baseline: genre 0.24–0.40 within medium; 0.39 overall); taste top-6 offered rate (40%); tie rate (43%); "no" titles in the offered 6 | Nov 4 pool (human); stress profiles (synthetic) | `trace-request.mjs --all`; Nov 4 scoring script (archived) |
| Corrections | Recognized conflicts offered (target 0); missed conflicts by reason (no labels, broad labels); lost media; short and empty sets | Correction fixtures (synthetic) | `corrections/shortlist-334.mjs`, `run.mjs`, `run3.mjs`, `run4.mjs` |
| Dislikes | Offered titles closer to a dislike than to any like | Stress + Nov 4 pool | `trace-request.mjs` (score parts) |
| Selection and explanation | **Not offline.** The model chooses and explains; deterministic fallback reasons only | — | `scripts/evals/run.mjs` (rules only, already in `npm test`) |

**Counts as improvement:**
- a pre-registered gain on human-judged within-medium ordering, with a bootstrap check
- no worse on "no" titles in the 6, dislike closeness, lost media, or recognized-conflict compliance

**Counts as regression:** any of those getting worse beyond noise, or a gain only on synthetic profiles.

**Overfitting guard:** the Nov 4 pool is for development. A gain must be confirmed on a fresh held-out pool (D-4) before anyone calls it better.

---

## 4. Decisions needed from Paige

| | Decision | Options | Recommended default | Trade-off |
|---|---|---|---|---|
| D-1 | **What reasons mean** (#382 items 21–22) | (a) map existing chips to features, no UI change; (b) #250's directions ("too slow / too rushed") extended beyond books; (c) a free-text reason read by AI | **(a) offline first, then (b) for books as #250 planned** | (a) is free and invisible but limited by the chip list. (b) lets mixed feelings be said but adds taps. (c) is the most expressive but costs AI calls and is hard to verify |
| D-2 | **Should confirming a pattern change picks?** (item 23) | none (today); small capped boost; use as a retrieval starting point | **Small capped boost, measured on the human pool, never a hard rule** | A boost rewards confirming but narrows variety if too strong. Retrieval use is bigger and later |
| D-3 | **Weight and context** ("matters a lot", "depends") | prompt only (today); a weak shortlist effect | **Keep prompt only until U10 shows patterns can move picks reliably** | Settled principle 2 leaves this open (semantics doc D3) |
| D-4 | **New human-judged pool** | rate about 40–60 fresh titles, including TV and comedy (about 30 minutes), splitting "seen" from "heard of" | **Yes, before any fit claim** | Without it, every gain is on data we've already looked at, or on synthetic profiles |
| D-4b | **Picks already on screen** (#383) | leave; mark ("You said this pattern isn't you"); hide unacted-on picks; replace | **Mark unacted-on picks; never touch Saved or rated ones** | Marking is honest and reversible; hiding is cleaner but surprising |
| D-5 | **#381 merge timing** | now (reviewed, wording fixed); after U5 (so fewer lost media) | **Now, as its own change.** U5 builds on it | Waiting means "Not me" conflicts keep reaching picks in production |
| D-6 | **"Doesn't describe me" vs "never recommend like this"** | keep strict (today); split into two answers | **Keep strict until #383 and U8 land** | A split is more precise but adds a choice to every correction |
| D-7 | **Paid budget for phase 5** | per run | Decide per run, smallest first (8 candidates, about 20–40 calls) | — |

**Paige's answers (Nov 17):**
- **D-1:** investigate mapping the existing reasons offline. UI additions are reviewed separately.
- **D-2:** test a small capped boost; don't implement it. It must not reinforce inaccurate patterns or reduce variety.
- **D-3:** keep current behavior.
- **D-4:** use the existing 60 ratings to try ideas out. Collect fresh ratings to validate afterward. The 60 can't be the final evidence if they were used to pick the winner.
- **D-4b:** mark affected, unacted-on picks. Review the UI before implementing.
- **D-5:** hold #381 until its final verification and release review.
- **D-6:** keep the strict rule.
- **D-7:** approve paid runs one at a time, each with a call count and cost cap.

**Authorized now:** U1 and U3, offline and read-only only. No product implementation, commits or merges.

**U1 and U3 results (Nov 17, offline, development set: Paige's 60 Nov 4 ratings).** Scripts and numbers are in `~/tastemake-research-local/u1u3-2026-11-17/`.
- **Parity check:** the variant code matched production's shortlist in 678 of 678 runs.
- **Baseline (U1):**
  - Today's genre score puts her "want" titles above her "no" titles only **0.39** of the time (0.31 within the same medium; 0.27 on titles she hasn't experienced), reproducing Nov 4. That's below chance (0.5).
  - Retrieval order alone ranks her preferences better than the genre score does.
- **U3, scoring 40 or 60 candidates (B40, B60):** ordering got worse: −0.20 and −0.15 within medium. It also lost wants she hadn't experienced. The added titles were mostly near-duplicates and titles she already knew. **Not supported.**
- **U4 preview, removing retrieval order (C):** −0.30 within medium. **Not supported.** It's the same offered 6, with a worse order behind them.
- **Both together (D):** −0.16, and it loses every new-to-her want. **Not supported.**
- **What it means:** reordering or widening around today's score defers more to a weak signal. The constraint is the **signal**, not how many candidates are scored. That matches K1's failure and the Nov 4 paid result, where AI appeal profiles ordered her preferences at 0.83–0.88.
- **Limits:**
  - one profile, 60 titles and 14 "no" ratings (books and games have one "no" each)
  - the offered 6 is a single set
  - the retrieval order comes from the eval's stand-in retriever, not live retrieval
  - familiarity is uncertain
- **Plan change proposed:** park U3 and U4. Move to improving the signal, U9 (reason mapping, offline, approved for investigation under D-1), then a separately approved paid test of appeal profiles under phase 5.

**U9 results (Nov 17, offline, same development set).** Files are in `~/tastemake-research-local/u9-2026-11-17/`.
- **Checks:** the scorer reimplementation matched production on all 14,908 scores, and the chooser on all 678 sets. The R0 version reproduces U3's A exactly.
- **Verdict: not supported.** No version passed the pre-registered gates.
- **Today's flat ×1.25 boost barely matters on this data.** Its one visible effect is lifting the comedy sitcoms she rated "no" (Friends, HIMYM, Cheers), because they share Comedy with Nathan for You.
- **Mapping reasons to genre (Humor → Comedy) changes nothing.** Similarity is normalised, so extra weight on one genre barely moves scores. "Atmosphere", "Exploration" and "Characters" have **no** feature to map onto in any medium.
- **Synopsis word matching:** +0.12 on the 30, but only from 6 movie pairs. Across the 60 it's flat to negative (−0.01 to +0.04). It loses a new-to-her want and pulls in HIMYM ("journey", "friends").
- **What it means:** with today's item data (genres plus a short plot premise), the scorer can't use what a reason says. The deterministic options are exhausted. The constraint is **how items are described**, not how reasons are weighted.
- **Next options:**
  - **(a) free:** reuse the AI appeal profiles already generated for these 60 titles on Nov 4 (`appeal-profiles.json`, no new calls). Test whether reasons match better against them than against synopses.
  - **(b) paid:** a capped test of appeal profiles for scoring, needing D-7 approval.

**U9b results (Nov 17, offline, free: reuses the Nov 4 AI appeal profiles, no new calls).** Files are in `~/tastemake-research-local/u9b-2026-11-17/`.
- **Coverage and checks:** profiles exist for all 60 pool titles and all 55 rated titles. Parity checks are clean.
- **The signal is much better.** Want-vs-no ordering of the raw score over all 60:

  | Score | All pairs | Within medium | Not experienced |
  |---|---|---|---|
  | Genre score (today) | 0.39 | 0.31 | 0.27 |
  | Appeal-profile similarity | **0.73** | **0.62** | **0.65** |

  - The gain is +0.34 (90% CI 0.18–0.51); within medium +0.31 (98% of draws above 0). It matches the Nov 4 paid result's direction, without any new calls.
  - Per medium, the gain is clear in movies and TV. Books and games have one "no" each, so they say little.
- **Reasons against profiles** match far more often than against synopses. But "atmosphere" matches nearly everything, and "humor" still leans toward the sitcoms she rated "no". Focusing reasons on specific profile fields adds a little (0.62 → 0.73 within medium on raw scores), but that rests on 6 rated items and changes no picks.
- **Through today's chooser, no variant passes the gates.** Similarity pulls in close neighbours of titles she knows (Dune, Dead Space 3, Mortal Engines). Wants that are new to her drop out, failing gate 4: discovery.
- **What it means:**
  - **How items are described is the lever.** Appeal profiles roughly double the ordering quality on her ratings.
  - **Using them well also needs a chooser that protects discovery.** Fusion and media turns weren't designed around a good score.
  - **Producing profiles for every candidate is a paid step**, at about $0.0002 per title, cached.
- **Proposed next, needing Paige's approval:**
  1. Paige rates a fresh validation pool (D-4).
  2. A capped paid run generates profiles for that pool only.
  3. Pre-register an AP-sim chooser with an explicit novelty rule, judged on the fresh ratings.

  Tuning the chooser further on these 60 risks overfitting.

**Correction to the U9b next step (Nov 17).** The held-out validation of the signal **already exists**. K1 (Nov 13) scored arm P on the held-out 40: the same appeal-profile TF-IDF scoring shape as U9b's AP-sim, on titles no development step had used.
- P scored **0.844 [0.62, 1.00]** against genre G's **0.422** on the primary measure: within medium, untried titles, 32 pairs.
- Film 1.00 (6 pairs), books 0.88 (16), games 0.70 (10). TV was untested (0 pairs).
- Its top 6 by pure score: 5 want / 0 maybe / 1 no, with 5 untried finds.
- `~/tastemake-research-local/k1-results-2026-11.md`; `~/code/tastemake-research/archive/heldout/analysis-output.txt`.

**What's settled:** appeal profiles are a better *signal* than genre, on development data (U9b, including TV) and on held-out data (P, excluding TV).

**What isn't settled:**
1. **TV on held-out data.** It needs fresh ratings, which can wait.
2. **How picks are chosen** without losing discovery: U9b's loss came from a retrieval pool full of familiar neighbours, not from the score.
3. **Production design:** when profiles are made, where they're cached, cost, latency, and what happens when one is missing.

Items 2 (exploratory, development data only) and 3 (design, read-only) can proceed without new ratings.

### Production design sketch: appeal profiles as the scoring signal (U14; design only, not approved)

**What changes:** the shortlist score compares appeal-profile text (summary, tone, pleasures, setting, format) instead of genre labels. Today's genre score stays as the fallback for any title without a profile. Retrieval, corrections and the model call are unchanged in the first step.

**Where profiles live:** the canonical item store (Neon). `items.traits` already exists, is reserved for AI-inferred traits, and nothing writes it today (`src/catalog/canonical-store.mjs`). A profile is about a *title*, never a person:
- no user data goes into the prompt;
- one cached profile serves everyone;
- browser storage doesn't change.

**When profiles are made (options):**

| Option | How | Latency | Cost | Risk |
|---|---|---|---|---|
| A. On demand | Generate missing profiles during the request | +1–3 s on a cold title (parallel Haiku) | About $0.0002 per new title, once | Slow first requests; timeouts |
| **B. Write-behind (recommended start)** | Score with what's cached; queue missing titles; generate after the response, as `canonicalizeWriteBehind` already does for facts | None added | Same, once per title | A title's first appearance uses the genre score |
| C. Precompute | Batch-profile the titles retrieval returns most | None | One-off batch, capped | Misses the long tail |

- **Rated titles** need profiles too, made the same way: on first rating, then cached.
- **Worst case cold:** about 30 candidates × $0.0002 = about $0.006 per request, falling toward zero as the cache fills. Existing spend caps and rate limits apply.

**Mixed signals:** while some candidates have profiles and others don't, scores aren't on one scale. Rank within the profiled and unprofiled groups separately, or use rank-based fusion. **This needs a pre-registered test.**

**Safety and quality:**
- **Profile output is checked in code:** schema, field lengths, no instructions carried over from a synopsis, and an omission check for the provider's tone keywords (K1's "option 2").
- **A failed profile is never cached.** The title falls back to genre.
- **The Nov 4 accuracy check** found all 8 judged profiles accurate. A larger check before release would use a sample she reads, not rates: about 20 profiles.

**Metrics:** a new `/api/ai-metrics` operation (for example `appeal_profile`). Existing fields don't change; the totals grow, as with `partly_reasons`.

**Discovery (unsolved):** U9b lost new-to-her wants because retrieval brings familiar neighbours, and similarity ranks them high. Tastemake can't know what someone has merely heard of. Options to test:
- a popularity penalty, as a proxy for "probably known";
- keeping one or two slots for the best-scoring title not found from a top-weighted favourite;
- telling the model to prefer less familiar titles.

Each would be pre-registered, explored on the development pool only, and judged on fresh ratings.

**Flags and rollout:** a server switch, as with `TASTEMAKE_PARTLY_REASONS`. Write-behind can run (filling the cache) with the scoring switch off, so the cache warms before anything changes for users. Released only after the held-out TV check and Paige's OK.

**What it doesn't fix:** retrieval still anchors on genre-like provider neighbours (#382 item 26). Corrections still match by labels (#380); profiles could later make conflict recognition better (U8).

**U15: discovery rules (Nov 17; exploratory, development set only, not evidence).** Files are in `~/tastemake-research-local/u15-2026-11-17/`. The held-out sets weren't touched.
- **N1 (order by score, no retrieval-order fusion):**
  - With appeal-profile similarity, fit and order both improve: within-medium 0.59 → 0.71 on the first 30, 0.45 → 0.62 on all 60.
  - With today's genre score it hurts: at 60 it loses every new-to-her want. **Never pair N1 with the genre score.**
- **N2 (one pick per favourite it was found from):** no effect with profiles. With genre it cost a new want.
- **N3 (near-duplicate guard):** skip a candidate whose profile similarity to any single liked title is above that pool's 85th percentile.
  - It removes familiar neighbours (Dune, Dead Space 3, Authority), raising new-to-her wants from 1 to 2–3.
  - The cost: those were mostly wants, so overall order AUC dips.
  - Meaningless with genre, which is 1.0 similarity for most candidates.
- **Combined, with profiles (first 30):** 5 want / 1 fair / 0 no, 4 of them new to her. Today: 4/1/1, 3 new. At 60: 4/2/0 (2 new) against today's genre 3/1/2 (2 new).
- **Untestable offline:** a popularity penalty. The pool data deliberately has no popularity counts.

**Draft rule to pre-register for the fresh-ratings test (not approved):**
- **Score:** appeal-profile similarity (AP-sim, as P / U9b).
- **Order:** by score only, no retrieval-order fusion. Media turns, franchise rule and the Surprise rule are unchanged.
- **Guard:** skip any candidate whose cosine to a single liked or loved title exceeds the 85th percentile of that request's pool. The guard also applies to the Surprise.
- **Primary measure:** new-to-her wants among the 6, with no rise in "no".
- **Secondary:** within-medium want-vs-no order AUC, and media kept.
- **Comparison:** today's production chooser and genre score on the same fresh pool.
- **Needs:**
  - fresh ratings that mark seen vs heard-of, with TV wants present;
  - appeal profiles for that pool and the rated titles (a small capped paid run);
  - τ and the rule fixed before any rating.

**Already settled; reopen only if you want to:**
- Not sure and bare Partly never change the shortlist (`docs/feedback-semantics.md` principle 2, D6).
- The strict "Not me" rule (Nov 17).

---

## 5. Release and verification boundaries

- **Promotion path:** there's no staging site (no Vercel previews, by Paige's rule). "Ready for staging" means:
  1. local `npm test` passes
  2. the offline U1 report is attached to the PR
  3. Paige's explicit OK to merge to main
  4. a production smoke test, via /setup → "See Paige's Example Profile"
- **Can be tested on their own (offline):** U3, U4, U5, U7, U8, U9 each change one stage. Measure each against U1 and against each other, never bundled.
- **Need end-to-end checks before production:** anything that changes what the model is shown or must choose (U12), or what a pick's explanation can claim (U9 and U10, if reasons reach the prompt). These need a paid run with an approved cap.
- **Must be checked before any merge:**
  - **Shortlist or retrieval changes (U3–U5, U7, U8, U10):** the human-judged gain is confirmed on the held-out pool; no regression in recognized-conflict compliance, dislike closeness, or lost media; provider latency and timeouts reported; and the fallback gives the same 6 as the model is offered.
  - **Copy:** says only what the code does, distinguishing recognized from missed matches.
  - **UI changes (#250, #383):** Paige approves the interaction first, and the flow, layout and accessibility suites pass at 1440 and 390.
  - **Project Health:** `/api/ai-metrics` fields unchanged.
- **Case study:** describe only what's on main. #381 and everything here is proposed, not shipped. Changes go through the coordinating chat, staging first.

**Suggested first step:** U1, then U3 against Paige's Nov 4 pool. It's free, it answers whether scoring a wider pool finds titles she wants (not just different rankings), and it needs no product decision.
