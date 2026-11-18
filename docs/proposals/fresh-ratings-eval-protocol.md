# Fresh-ratings evaluation: description scoring (protocol, for review)

Written Nov 17, 2026 for Paige. **A protocol, not results.** Nothing has been run. Once Paige approves this text, it's fingerprinted before any fresh rating, title list or description exists, and isn't changed afterwards.

**Question:** on titles nobody has used before, does scoring by AI appeal descriptions rank what Paige wants above what she doesn't, without frustrating matches to what she dislikes?

**Hypothesis, stated before the test:** **D0**, description scoring without a dislike penalty, beats today's genre scoring. This is Paige's working hypothesis (Nov 17), not a decision to ship. The held-out set confirms or rejects D0. It isn't used to pick a winner among arms.

## 1. Arms (fixed)

| Arm | Score | Role |
|---|---|---|
| **G** | Production `tasteScore` (genre, theme, creator; flat ×1.25 for any reason) | Baseline |
| **D0** | Appeal-description similarity: TF-IDF over summary, tone, pleasures, setting and format; the top 5 liked/loved matches × rating weight; **no** dislike term | **Primary hypothesis** |
| **D1** | D0 plus the dislike term: the top 3 disliked matches × \|weight\| subtracted, as in U9b's AP-sim | Secondary: does the penalty earn its place? |

The capped-penalty variant is dropped: it changed nothing on development data. No other arm is added after this protocol is fixed.

**Scored the same way in all arms:** raw score, ranked within each medium, no chooser and no retrieval order. This isolates the signal. The chooser and discovery rule (U15) are a separate test.

## 2. Data

**Fresh pool**
- **Size and spread:** 48 titles, 12 per medium (film, TV, books, games). Never rated, judged, described or used in any earlier experiment, and not in the Example Profile.
- **Source:** drawn from the offline catalog snapshot plus official provider lookups, by a fixed seed. Provider order and taste don't influence the draw. This mirrors C2's B2.
- **TV and comedy** get guaranteed coverage. At least 6 TV and 4 film titles are comedies, chosen by C2's humour-family rule: at most one per family, using provider keywords and type only. This fixes C2's and K1's "0 TV pairs".
- **Overlap titles:** for each dislike with a reason (below), the pool includes 1–2 titles that share the disliked characteristic, chosen by provider keywords only. This tests whether a dislike wrongly penalizes titles Paige might still like.

**Paige's ratings** (about 30 minutes, on a neutral page showing no scores, sources or arm labels)
- **For each pool title:** **want / fair / no**, and familiarity: **seen-read-played / heard of / new to me**.
- **Before rating the pool,** she adds reasons to about 4–6 titles she has already rated *disliked*, using the app's own chips. At least 2 should be cases where the disliked aspect appears in titles she likes, such as "characters didn't work" on a sitcom when she loves ensemble comedies.
- **Kept separate:** any "never recommend" exclusion (#48). Those are hard filters in production already, so excluded titles are removed before scoring and never count as a "no".

**Descriptions (paid, needs separate approval)**
- **What:** descriptions for the 48 pool titles, the newly reasoned dislikes and any rated titles that don't have one. Made with the production prompt `ap-v1-2026-11-04`, in a script, not via the production store.
- **Cost:** at most 70 Haiku calls, hard cap **$0.10** in code. Worst case about $0.03.
- **Check:** before any scoring, Paige spot-checks 8 descriptions of titles she knows for accuracy.

## 3. Measures

**Fit (primary)**
- **P1:** within-medium want-vs-no ordering (AUC) on titles **new to her or heard of only**, pooled across media. Ties count 0.5.
- **P1-all:** the same on all titles, secondary.

**Top recommendations**
- **T1:** wants, fairs and noes among each medium's top 3, and among the top 6 overall.

**Dislike avoidance (a separate guardrail)**
- **A1, near-dislike in the top 3:** a top-3 title whose description is closer to a disliked title than to any liked one. Count them, and how many are "no".
- **A2, reason-specific:** a top-3 title that shares the *reasoned* disliked characteristic with a dislike, in the matching description field. For example, "characters didn't work" checks the pleasures and summary. Count them, and how many are "no".

**Over-penalty (D1 vs D0)**
- **O1:** wants pushed out of a medium's top 3 by the dislike term, and the largest want drop in places.
- **O2:** of the overlap titles she rated **want**, how many D1 ranks lower than D0.

## 4. Gates (fixed)

**Minimum pairs:** at least 8 P1 pairs in at least 3 media, **TV included**. If that isn't met, the result is reported as **incomplete** and nothing passes.

**D0 is supported over G** only if all of these hold:
1. P1(D0) − P1(G) ≥ **+0.15**, with ≥ **90%** of bootstrap draws (2,000; titles resampled within medium; seed fixed) above 0. Same bar as C2.
2. T1: D0's top-3 "no" count ≤ G's.
3. A1 and A2 "no" counts ≤ G's (the dislike guardrail).
4. No medium where D0's P1 is below G's by more than 0.15 with ≥ 8 pairs.

**D1 vs D0 (penalty decision, secondary)**
- **Keep the penalty** only if D1 cuts A1+A2 "no" counts by ≥ 1 **and** costs ≤ 0.03 P1 **and** O1 = 0.
- **Otherwise drop it:** the simpler D0 stands.
- This decides the penalty only. It doesn't re-pick between G and D0.

**Not allowed:** tuning weights, fields, stop-words or the TF-IDF space after any fresh rating exists. The only free parameters are the ones fixed in U9b.

## 5. What a result can and can't show

- **A pass is evidence for D0 as a scoring signal on one person's held-out titles,** owner-tested only. It isn't evidence of external user satisfaction, and it doesn't test the chooser, discovery or live AI picks.
- **A fail or incomplete result is reported as such.** No re-run on the same pool.
- **Production stays unchanged either way.** Switching scoring would be its own proposal and PR, with Paige's approval, after the discovery-rule test (U15) and the description store's activation checks.

## 6. Development evidence this protocol builds on (not validation)

All from Paige's 60 Nov 4 ratings or synthetic profiles, used to design this test:
- **U1 / U3 / U9:** the genre score orders her wants above her noes at 0.39 (0.31 within medium). Wider pools, dropping retrieval order and reason weighting didn't help.
- **U9b:** description similarity at 0.73 (0.62 within medium).
- **D-check:**
  - D0 (no penalty) at 0.64 within medium, and D1 at 0.62.
  - "No" titles in top-3s: G 9 of 23, D1 1 of 12.
  - The penalty pushed Squid Game (want) from 6th to 11th via Severance.
  - None of the 7 dislikes had reasons, so reason overreach was untested.
- **Held-out reference:** K1's arm P (≈ D1) scored 0.84 vs 0.42 on the Nov 5 held-out 40, with no TV pairs. That pool is used up and isn't reused here.

## 7. Approvals needed before running

1. This protocol text, after which it's fingerprinted.
2. Paige's time: the dislike reasons and about 30 minutes of pool ratings.
3. The paid description step: ≤ 70 calls, $0.10 cap.
