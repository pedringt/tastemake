# #326: options for a Taste Profile refresh that uses new ratings

**Status:** options only, for Paige to decide. No code, no prompt change and no model calls were made for this document. Every paid number below is a proposal.

**Date:** Nov 14, 2026. Written against `main` at e18dd38 (after #363 and #364).

---

## 1. The problem in one paragraph

When the Taste Profile refreshes, the model gets every stored pattern, along with the evidence it cites, and is told to "return each of them again, with the same id and label". It does exactly that. On Nov 13, today's main returned **105 of 105** stored patterns with exactly their stored citations and cited **none** of the new ratings. A prompt-only fix (#361) asked for a re-check instead of a copy. Copies fell to 63/105 and the model attached the new dislike as a counter-example (3/3). But it still **never found the new heist preference** (0/3, and none of the 4 heist films was cited in any run), and it kept re-citing Resident Evil 7 and BioShock under the mythic pattern (6/6). #364 has since fixed that last part in software. Discovery is still open.

**What #361 taught us:** when the model sees the whole profile, it treats the stored patterns as the answer and pays little attention to the few rows that are new. Rewording the instruction didn't change that. The question is how to change the *job* the model is given.

## 2. What we know, and what we're assuming

| | Measured | Source |
|---|---|---|
| Today's refresh copies stored patterns | 105/105 copies; 0 new ratings cited | Nov 13 paid run, 15 calls (before arm) |
| Prompt-only re-check | 63/105 copies; counter 3/3; fitting ratings 9/9; heist preference 0/3; RE7/BioShock under mythic still 6/6 | Nov 13 paid run, 15 calls (after arm) |
| The same evidence with **no** stored patterns shown | 4–5 patterns, 16–18 of 19 positive ratings cited, newer dislikes used as counters | #326 offline test, 12 calls, **one profile** |
| A fresh profile never puts RE7 under mythic | 0/10 runs | Nov 6 baseline |
| Today's refresh cost per call (eval) | ≈ 6,000 input tokens, ≈ 1,100 output tokens, ≈ $0.001 | Nov 13 run reports |
| Today's Taste Profile call in production (last 30 days, fresh and refresh mixed) | 59 calls, $0.028 in total (≈ $0.0005 each, prompt caching helps); latency p50 **3.3 s**, p95 **5.0 s** | `/api/ai-metrics`, read Nov 14 |
| Example Profile ratings no stored pattern cites | 23 of 55 tried items (21 of them positive) | Counted offline, Nov 14 |
| Ratings carry no timestamp | — | Code: the feedback records have no date; only pattern history does |

**Assumed, not measured:** that a smaller, item-by-item question avoids the anchoring #361 hit; every latency figure for the new designs (I scaled from today's output size, which drives most of the wait); how well any design works on a profile other than the Example Profile. All the refresh evidence so far comes from that one profile.

---

## 3. The three designs at a glance

| | A. Bookkeeping (placement) | B. Blind re-read, software matches | C. Today's call plus a required ledger |
|---|---|---|---|
| What the model is asked | "Where does each **new** rating go?" | "Build a profile from scratch" (it never sees the stored one) | "Refresh the profile, and account for every new rating" |
| What the model sees | Pattern names and claims, plus only the new ratings | All ratings, no stored patterns | Everything it sees today, with new ratings marked |
| Who updates patterns | Software | Software (matching fresh to stored) | The model, then today's safety net |
| Fixes the anchoring #361 hit? | Yes by construction (assumed it works) | Yes by construction (partly measured, one profile) | Doubtful: same setup as #361 |
| Discovery | Model must answer for every new item; new patterns from unexplained items | Measured strong on one profile; churn risk | Forced to mention each item; may still file it badly |
| Confirmed patterns | Never sent for rewording; additions only | Never sent at all; additions only | Today's freeze rules (#325) |
| Cost vs today | ≈ ⅓ to ½ per call, and no call when nothing is new | About the same | About the same to +20% |
| Latency vs today (assumed) | ≈ 1.5–2.5 s p50 (vs 3.3 s) | ≈ same as today | ≈ same or a little slower |
| Build size | Largest (new state, new prompt, new merge logic) | Medium (matching logic) | Smallest |

---

## 4. Design A: software bookkeeping (the one Paige saw)

### How it works, end to end
1. **Software keeps a ledger.** After each successful refresh it saves, per tried item, a short fingerprint: whether it was liked or disliked, how strongly, and its reasons. Ratings have no dates, so this fingerprint is how "new" is decided.
2. **On refresh, software works out what's new.** An item is new when it isn't in the ledger, or when its fingerprint changed (say a liked item is now disliked, or reasons were added). It also keeps a small **"not yet explained" pool**: items an earlier refresh couldn't place.
3. **If nothing is new, there's no model call.** The profile is unchanged, and the message says so.
4. **Otherwise, one small model call.** The model gets:
   - each pattern's id, name, claim, areas and two or three example titles (no full evidence lists);
   - the new items;
   - the not-yet-explained pool.
   For **every** new item it must return exactly one placement, in a fixed structured format:
   - `supports` pattern X;
   - `counter` to pattern X (only things tried and disliked, following #278's rule: the same kind of thing, so it really pulls against the pattern);
   - `unexplained` (fits nothing yet);
   - `not-taste` (for example a disliked item that says nothing about any pattern).
   Optionally, it may propose **new patterns**, but only from new and pooled items, with a name, claim and citations.
5. **Software checks the answer.** Every new item must be accounted for once, every pattern id must exist, every citation must be real and of the right polarity. An item with a bad or missing placement stays "new" for next time; the rest is applied.
6. **Software applies it deterministically:**
   - adds supports and counter-examples to the named patterns;
   - recomputes each pattern's level, areas and cross-area status from its evidence, using the rules already in `src/model/evidence-rules.js`;
   - applies the "one miss never weakens a pattern; two can" rule from the evidence contract in code (see the open questions);
   - runs each proposed new pattern through today's validator and a redundancy check (most of its citations already support a stored pattern means it's rejected);
   - adds unplaced items to the pool;
   - runs the #364 support filing as today;
   - writes a history entry per changed pattern;
   - updates the ledger.
7. **First refresh after shipping:** there's no ledger yet, so "new" means "cited by no stored pattern". On the Example Profile that's 23 items, which fits in one call. A cap (say 30 items per call) leaves any extra for the next refresh.

### Model-written vs software
- **Model:** the judgement "does this item show this pattern?", and the name and claim of a new pattern.
- **Software:** what counts as new; every change to a pattern's citations, level, areas and cross-area status; when a pattern weakens or retires; the pool; history; redundancy.

### Confirmed patterns
- Their name and claim are sent as **read-only context** and never come back as editable text. There's nothing to reword.
- Placements can only **add** citations to them. Removal happens only through what already exists: a removed rating sets "Needs another look" (#325), and #364's narrowing flag is unchanged.
- Counter-examples never lower or drop a confirmed pattern automatically (see the open questions for what they *do* trigger).

### Cost and latency on Haiku 5.5 (estimates)
- **Input:** about 1,500–2,500 tokens (pattern summaries plus a handful of items), against ≈ 6,000 today in the eval.
- **Output:** about 150–400 tokens (one short line per item, plus a new pattern now and then), against ≈ 1,100 today.
- **Per call:** about $0.0003–0.0004, against ≈ $0.001 in the eval and ≈ $0.0005 in production.
- **Latency:** output size drives most of the wait, so roughly **1.5–2.5 s p50** against 3.3 s today. This is an assumption to be checked in the paid eval.
- **Fewer calls:** changes that add no new tried item (a pattern answer, a version bump) need no call.
- **First refresh after shipping:** larger (23 items is ≈ 800 output tokens). That's still under today.

### Failure and fallback
- **Call fails, times out or the budget is paused:** nothing changes, the ledger isn't advanced, and the items stay new for next time. The message is today's "couldn't update".
- **Some placements are invalid:** the valid ones are applied, and the rest stay new. A run never half-applies one item.
- **Repeated failure on the same item** (say three refreshes): it moves to the pool, so it can't block the queue.
- **Safety net:** today's full refresh path stays in the code behind a flag for one release, so it can be switched back without a deploy.

### Weaknesses
- **Old citations are never re-examined.** An existing bad support stays unless the #364 filing or the user removes it. That's acceptable now #364 has cleaned RE7 and BioShock, but it isn't a general audit.
- **Unconfirmed patterns never get reworded**, even as evidence piles up. Their claims can go stale over months. A deliberate "Rebuild my profile" (Design B, used occasionally) would cover that; see the open questions.
- **The model could squeeze a heist film into an ill-fitting pattern** rather than say "unexplained". The `unexplained` option, the #364 filing and the eval's support-fit pairs are the checks. Whether it happens is unmeasured.
- **One new heist film can't make a pattern alone.** The pool lets a preference build up over several refreshes, which is new behaviour that needs its own fixture.

---

## 5. Design B: blind re-read, then software matches

### How it works, end to end
1. On refresh, software sends the **fresh-profile prompt** (today's, without any stored patterns) with all tried items. The model builds a profile from scratch, the setup that cited 16–18 of 19 ratings in #326's offline test.
2. **Software matches** each fresh pattern to a stored one by shared citations (for example, they match when most of the smaller pattern's citations appear in the other).
3. **Matched, unconfirmed:** the stored pattern keeps its id and name. Its citations become the fresh pattern's citations, and its claim may take the fresh wording (a product choice). History records the change.
4. **Matched, confirmed:** name and claim are frozen. It gains only the **new** items (by the same ledger as in A) that the fresh pattern cites. Nothing is removed.
5. **Fresh pattern with no match:** a candidate new pattern. It must pass the validator and the redundancy check.
6. **Stored pattern with no match:** carried forward as today (#228/#325). It's never dropped just because one fresh run didn't produce it.
7. #364's filing doesn't run here. It was kept off fresh profiles because it made 8 doubtful moves in 112. That matters less here, since a fresh read didn't produce the RE7 problem in the first place (0/10).

### Model-written vs software
- **Model:** the whole interpretation, from scratch, every time.
- **Software:** matching, the confirmed-pattern freeze, carrying unmatched patterns, redundancy, history.

### Confirmed patterns
Never shown to the model, so never reworded. They only gain new items through matching, and lose evidence only through the existing removal and narrowing flags.

### Cost and latency
About the same as today: one call of similar size (≈ 5,000–6,000 input tokens, because the stored-pattern block goes away; output ≈ 1,000+ tokens). That's ≈ $0.001 per eval call, ≈ $0.0005 with production caching. Latency is today's p50 3.3 s and p95 5.0 s. Every refresh with any change makes a call.

### Failure and fallback
- **Call fails:** nothing changes, as today.
- **Matching is ambiguous** (one fresh pattern overlaps two stored ones): software takes no action on either, and the fresh pattern is dropped for this refresh.

### Weaknesses
- **Churn.** A fresh read varies from run to run. Patterns can split, merge or be renamed, which shows up as many small changes, or as "new" patterns that are reshuffles of old ones. The restraint criterion ("nothing new is a valid outcome") is the real risk here, and the 16–18/19 result came from **one profile with no stored patterns to match against**.
- **Matching by shared citations is rough.** A fresh pattern on a different idea can share titles with a stored one and hand it unrelated citations. The confirmed-pattern rule (only new items, never removals) limits the damage to unconfirmed patterns.
- **Cost doesn't shrink**, and every refresh re-reads everything.

**Where B fits best:** as an occasional **"Rebuild my profile"** action, or a check every N ratings, rather than every refresh. It's the only design that lets claims evolve.

---

## 6. Design C: today's call, plus a required ledger

### How it works
Today's refresh prompt and output stay, with three changes:
- software marks the new items in the prompt;
- the output gains a required `newItems` list, with one entry per new item saying where it went;
- software rejects (and retries once, or falls back to carrying patterns forward) an answer that leaves a new item unaccounted for, or whose ledger disagrees with the patterns it returned.

### Model-written vs software
Same as today. The model writes the whole profile; software checks it and carries what it leaves out. The only addition is the completeness check on new items.

### Confirmed patterns
Today's #325 freeze: a model version is used only when it keeps the same id, name and claim word for word.

### Cost and latency
Output grows by the ledger (≈ +100–300 tokens), so ≈ +10–20% on cost and ≈ +0.3–0.8 s (assumed). A retry on an incomplete ledger doubles that refresh.

### Failure and fallback
Incomplete ledger → one retry → otherwise today's carry-forward. The new items stay new.

### Weaknesses
It's the same setup #361 used. The model still sees the stored profile as the answer, and the Nov 13 evidence says that setup didn't produce discovery. The ledger forces an answer about each heist film, but the model could answer "unexplained" or "fits the crime-ish pattern" every time and still never write the new pattern. **It's cheapest to build, but most likely to repeat #361's result.**

---

## 7. How each design would be measured

### What `--suite refresh` (#363) already measures
- confirmed patterns are kept with unchanged wording (rule);
- stored patterns returned with exactly their stored citations;
- the new heist preference is found (a new pattern citing at least 2 of the 4);
- new ratings are cited;
- It Comes at Night is attached as a counter to the slow-burn pattern;
- fitting ratings (Amnesia, Babadook, Penelopiad) are cited by their pattern;
- the nothing-new control adds no new pattern;
- no redundant pattern is added;
- the #318 support-fit pairs (RE7/BioShock off mythic, fitting links kept).

**One metric changes meaning under A.** "Returned with exactly their stored citations" is expected to stay high, because A keeps old citations by design. Under A, the meaningful numbers are the new-item ones. Under B and C, the copy count stays meaningful.

### Fixtures and checks to add

**Plumbing (needed by A and C, free):** each refresh fixture needs a ledger saying which items were "seen" at the last refresh. Without it, every uncited item counts as new.

**Free checks, no model** (a big advantage of A: its software can be tested exhaustively with canned answers):
- a liked item that's later disliked comes off supports and becomes a counter candidate;
- two counters on an unconfirmed pattern lower it, per whatever rule Paige picks;
- two counters on a confirmed pattern flag it, never drop it;
- an incomplete or invalid answer applies the valid placements and leaves the rest new;
- nothing new means no call;
- a first refresh caps at 30 items.

**New paid fixtures:**
1. `refresh-one-unexplained`: a single heist film. Expected: placed as unexplained, no new pattern yet.
2. `refresh-pool-builds` (two calls in sequence): two heist films on the first refresh, two more on the second. Expected: no pattern after call 1; a heist pattern after call 2. *(A only.)*
3. `refresh-first-run`: no ledger, so the Example Profile's 23 uncited items are new. Expected: no invented patterns, fitting items placed, and output size and latency recorded.
4. **A second profile** (the existing "cal-" calibration profile, with new ratings added). All refresh evidence so far comes from the Example Profile. This is the cheapest way to see whether a result holds beyond it.
5. *(B only)* a **churn** check: run the same refresh twice and count unconfirmed patterns that are renamed, split or replaced between runs.

### Proposed paid eval (not run, needs Paige's OK)
The before arm is today's main, rerun because #364 changed it since Nov 13. Three repetitions, arms interleaved, criteria fixed in advance as on Nov 13.

| Design | Calls | Expected cost | Cap in code |
|---|---|---|---|
| A | Before: 5 fixtures × 3 = 15. After: 5 existing + fixtures 1, 2 (2 calls), 3, 4 = 10 × 3 = 30. **45 calls** | ≈ $0.02–0.03 | $0.06 (worst case ≈ $0.054) |
| B | Before 15. After: 5 existing + fixtures 3, 4, 5 (2 calls) = 9 × 3 = 27. **42 calls** | ≈ $0.04 | $0.10 |
| C | Before 15. After: 5 existing + fixtures 1, 3, 4 = 8 × 3 = 24 (plus up to 24 retries). **39–63 calls** | ≈ $0.04–0.06 | $0.14 |

Worst cases use the eval runner's own rule (every output cap used): ≈ $0.0022 per call today and ≈ $0.0007 for a placement call capped at 1,000 output tokens.

**Suggested pass rules for A** (to fix before running). Failing any starred one means it doesn't ship:
- ★ confirmed patterns kept, wording unchanged, every run;
- ★ the nothing-new control makes no new pattern in at least 2 of 3 runs, with no redundant pattern in any run;
- ★ RE7/BioShock under mythic at most 1 of 6;
- heist pattern found in at least 2 of 3 (fixture 2 on its second call, and `refresh-new-preference`);
- counter attached in at least 2 of 3;
- fitting ratings placed in at least 7 of 9;
- p50 latency below today's.

**On sample size:** "2 of 3" is a small sample. It catches a design that doesn't work, but can't prove one that does. Running a fourth and fifth repetition on the two discovery fixtures alone would add 6–8 calls (≈ $0.003).

---

## 8. Recommendation

**Build A. Keep B in reserve as a "Rebuild my profile" action. Don't build C.**

- **A changes the job, not the wording.** #361 showed that rewording the instruction doesn't stop the model from anchoring on a profile it can see. In A the model can't copy, because it never writes the profile; it answers one question per new item. Whether that produces discovery is **not yet measured**. That's what the paid eval is for.
- **It locks down what the user confirmed by construction**, rather than by catching rewrites after the fact.
- **It's cheaper and probably faster**, and it makes no call when nothing new arrived.
- **Its software can be tested for free**, with canned answers, before any paid run.
- **It enables a clearer refresh message**, for example "3 new ratings: 2 support *Uncanny slow-burn horror*, 1 counts against it; 1 not part of a pattern yet". That's a transparency gain worth considering for the portfolio story.
- **The price is a bigger build** (a ledger, a new prompt and schema, merge logic, a migration) and unconfirmed claims that never evolve. B, used now and then, covers the second point.

**C** is the cheapest to build but repeats #361's setup, so I'd expect #361's result.

**Suggested order:**
1. A's software and free checks, behind a flag, with no prompt in production.
2. Paid eval as proposed (about 45 calls, cap $0.06).
3. Decide from the pre-registered rules.
4. Only then, consider B as a manual rebuild.

## 9. Open product questions for Paige

1. **Do you approve building A** (software and free checks only, behind a flag), with the paid eval as a separate approval?
2. **When does a counter-example change an unconfirmed pattern?** Today's prompt says "two or more tried-and-disliked items" lower or drop it, but leaves the model to decide. In A, software decides. Options:
   - lower one level at 2 counters, and retire when counters outnumber supports;
   - lower only, never retire automatically;
   - something else.
3. **What do counter-examples do to a confirmed pattern?** It's never dropped or reworded. Should 2+ new counters raise "Needs another look", or should they only be listed on the pattern?
4. **How many unexplained items before a new pattern may be proposed?** Two tried items (enough for "emerging" under today's rules) or three ("no general rule from under three items", the existing reasons rule)?
5. **Should unconfirmed patterns ever be reworded?** In A they aren't. Is an occasional "Rebuild my profile" (Design B) the right way to let them evolve, or should it be automatic every N new ratings?
6. **Should the refresh tell the user where each new rating went?** And should the "not part of a pattern yet" pool be visible (for example on the Profile or in the Library)?
7. **First refresh after shipping:** treat every currently uncited item as new (23 on the Example Profile, one call per active profile), or start the ledger from today and only place items rated after the switch?
8. **Example Profile:** today its patterns are a frozen snapshot with no model calls. Should it be regenerated once through A for consistency, or stay as is?

## 10. Decisions (Nov 14)

Paige's answers to section 9, also recorded on issue #326:

1. **Build A**, software and free checks only, behind a flag that is off by default. The model only answers, for each new tried item, one of `supports <pattern>`, `counter <pattern>` (tried and disliked, the same kind of thing, per #278), `unexplained` or `not-taste`. It may also propose new patterns, but only from new and pooled items. Software applies every change. The paid eval is a separate approval.
2. **Unconfirmed patterns:** drop one level at 2 counters, and retire when counters outnumber supports. Enforced in code, not left to the model.
3. **Confirmed patterns:** 2+ new counters raise the existing "Needs another look" flag (#325). They are never dropped or reworded; their name and claim are sent as read-only context only.
4. **New patterns:** may be proposed from 2 unexplained (new or pooled) items. Each must pass today's validator and a redundancy check.
5. **No automatic rewording** of unconfirmed patterns. "Rebuild my profile" (Design B) is a later, separate step and isn't built now.
6. **The refresh message says where each new rating went**, e.g. "3 new ratings: 2 support X, 1 counts against it, 1 not part of a pattern yet". The pool of unplaced items isn't shown anywhere else.
7. **First refresh with no ledger:** "new" means every tried item no stored pattern cites. Cap 30 items per call; any extra waits for the next refresh.
8. **Example Profile stays frozen.** Its one-time regeneration through A happens only after A passes the paid eval.
