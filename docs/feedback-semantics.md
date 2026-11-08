# Feedback semantics

When somebody tells Tastemake it misunderstood their taste, what should actually change? This is Tastemake's agreed answer: the product-design contract for every kind of feedback, approved by Paige on Nov 7, 2026 (revision 3, reviewed in #341).

**What this document is and isn't**
- **It's the design contract.** Feature work, UI copy and code review check claims against it.
- **It isn't a description of current behavior,** except in the "Today" columns. `docs/evidence-contract.md` describes what the app does now.
- **It authorizes nothing by itself.** Each proposed effect still needs its own scope, tests, review and release approval. Shortlist effects also need their evaluation gates (principle 8), and principle 13's label requirements become explicit acceptance criteria when #334 is implemented.
- "Today" columns were checked against main at `62c5c9d` (Nov 7, 2026). Re-check them before relying on them.

## 1. Where an effect can land
| Surface | What it is | Who enforces it |
|---|---|---|
| **Profile** | The Taste Profile: which patterns exist, their wording, level and evidence | Software (the refresh validator, #325 freeze) |
| **AI instruction** | What the recommendation and refresh prompts tell the model | The model; not guaranteed |
| **Shortlist** | Which candidate titles are retrieved and which six are offered (`chooseCandidates`) | Software |
| **Fallback** | The no-AI recommendations | Software (same shortlist) |
| **Copy** | What the UI says the answer does | Must match the rows above |

An effect counts as **enforced** only if software does it. An AI instruction can be described as an instruction, never as a result.

## 2. Principles
1. **Reject the interpretation, not the favorite.** A correction changes how Tastemake reads your ratings. It never deletes or devalues a title you rated.
2. **Strength follows specificity and certainty.** A specific, certain answer ("not me"; "excluding books") can change the shortlist. An ambiguous one (Partly with no detail, Not sure) only adds caution: profile and AI, not the shortlist.
3. **Soft by default; hard only when you ask for a rule.** Corrections reduce, they don't exclude. Hard filters come only from controls that say they're hard: exclusions and area switches.
4. **Software enforces; the AI is told as well.** Any effect the UI promises must be enforced in software, or worded as an instruction.
5. **Intent isn't taste.** Untried reactions (Save, Not interested) may steer what's shown next. They're never taste evidence, never support a pattern, and never change a pattern's level.
6. **The AI and the fallback respect the same constraints.** Every software-enforced candidate-selection rule applies whether the AI or the no-AI fallback makes the final choice. They may still pick different recommendations from the same constrained candidates. Testable: the same rule, the same candidates, both paths checked.
7. **Visible and reversible.** Each effect is shown where it applies; undoing an answer restores the previous behavior; history is kept (#37).
8. **No effect ships without a gate.** Any shortlist effect passes the no-op, valid-recommendation-loss, compliance, media and diversity gates (correction eval, now on main) before release, and shows value beyond its own metric (#341 section 3).
9. **Enforced isn't the same as good.** Enforcement makes a behavior dependable; only evaluation shows whether it helps people. Every enforced effect in this spec is a hypothesis until its evaluation passes.
10. **Evidence strength and confirmation are separate.** A pattern's level says how much evidence supports it. The person's answer says whether they agree with the interpretation. One never silently changes the other: a confident model doesn't make a pattern confirmed, and an unsure person doesn't make the evidence weaker.
11. **Exceptions are kept, not overwritten.** A preference with an exception ("atmospheric horror, but not possession films") is one conditional preference, not two contradicting answers.
12. **Correcting a support isn't changing a rating.** Saying a title doesn't belong to a pattern removes that one support relationship. The title's rating, and its contribution to every other pattern and to the shortlist, are unchanged. The corrected pattern's level is then recalculated from its remaining supports, or flagged "Needs another look" when there isn't enough left to judge, so the profile never reports evidence it no longer has. (Today's "Needs another look" text is about evidence that's no longer available; this case needs its own wording.)
13. **Enforce only on reliable labels.** A shortlist effect based on catalog labels is enforced only when the label is **specific** (not a broad genre like "comedy" or "horror"), **validated** (checked on a sample for this use: it means what the correction means) and has **enough coverage** among candidates. Otherwise software declines to enforce it, the correction reaches the profile and AI only, and the UI says so. Better to do nothing in software than to overgeneralize.

## 3. Each signal: what changes today, and what should change
"Proposed" means agreed design, not yet built.
"Today" columns: **P** profile, **AI** instruction, **S** shortlist and fallback. "—" means no effect.

### A. Answers about a whole pattern
| Answer | Today | Proposed | Strength | Shown and undone |
|---|---|---|---|---|
| **Yes** | P: confirmed; wording frozen through refreshes (#325); level not raised (an answer isn't evidence). AI: told. S: — | Keep P and AI. **S: none.** Confirming shouldn't push more of the same; your ratings already do that | — | Badge "You confirmed this"; choose again to clear |
| **Yes + matters a lot / a little** | P: no level change. AI: told how much it matters. S: — (`statementFactor` was written for this, but never called) | Keep. Decide later whether importance should weight the shortlist (D3) | None until D3 | "Tastemake tells its AI how much it matters to you" |
| **Yes + usually / depends** | P: "depends" caps the level at Supported. AI: told it's conditional. S: — | Keep. No shortlist effect: "depends" says when, not what | — | As today |
| **Partly** (no detail) | P: kept; wording frozen. AI: treat cautiously, don't broaden. S: — | Keep. **S: none**, because nothing says which part is wrong. This is the gap #323 closes | Caution only | Shipped copy: "It doesn't yet know which part doesn't fit." |
| **Partly + depends on context** | As Partly, plus the level cap. S: — | Keep | Caution only | As today |
| **Partly + not sure yet** | As Partly. S: — | Keep | Caution only | As today |
| **Partly + excluded areas** ("not for books") | P: a refresh can't add the pattern to those areas (enforced). AI: told. S: — | **S: soft reduction** of titles in the excluded area that the pattern would explain, via the same mechanism as "not me" but scoped to the area, and only where Tastemake can identify which titles the pattern explains (principle 13). Comes after "not me" is validated (D2) | Soft, area-scoped | "Not for books": shows on the pattern; remove the area to undo |
| **No ("not me")** | P: refresh rejects the pattern; moved to Corrected patterns. AI: told not to use it. S: —. The pick check never runs (live picks don't name a pattern). Tastebreak skips the pattern | **S: soft reduction** (D1) of candidates whose **own labels** confirm the rejected kind **and** that come only from that pattern's supporting titles. Never removes or devalues the rated titles themselves. #334 Round 4 is the leading design | Soft; strength set by testing | Copy changes to name a shortlist effect **only after** it ships; until then, today's wording ("Picks can still resemble the titles behind it") stays |
| **Not sure** | P: no level change in code. AI: told it isn't confirmed. S: — | P: **level unchanged** (it reflects evidence). The pattern is marked **unconfirmed**: not frozen by #325, and never cited to the AI as a confirmed preference. AI: as today. S: none. **Copy changes** to say what's true (D6) | Caution only | **Copy finding:** today's two lines ("Tastemake keeps the pattern tentative rather than treating your uncertainty as evidence" and, under What this changes, "Tastemake will keep this tentative instead of leaning on it") imply a profile effect that isn't enforced. Proposed: "You're not sure this fits. Tastemake treats it as unconfirmed: it won't present it to its AI as something you agreed with. How strong the evidence looks doesn't change." |

### B. Answers about part of a pattern (#323, proposed and not built)
| Element answer | Proposed effect |
|---|---|
| **Fits** | Like Yes, for that element only: keep it in the wording; no shortlist effect |
| **Doesn't fit** (an aspect, e.g. "character-driven") | P: the suggested narrower or split pattern, **after the person approves it**. AI: told. **S: soft reduction** only if the element maps to a **specific, validated** catalog label with enough coverage (principle 13): e.g. a "sketch" or "docuseries" format, not "comedy". It uses the "not me" mechanism scoped to that element. If no label qualifies, it reaches P and AI only. Tone-only elements always reach P and AI only (D7) |
| **Doesn't fit** (a title, e.g. *Nathan for You*) | P: that one support relationship is removed (principle 12). The title stays rated and keeps counting toward other patterns and the shortlist. The pattern's level is recalculated from its remaining supports, or flagged "Needs another look" if too little is left. This is the user-driven half of #318 |
| **Depends** | Like "depends on context", per element: level cap; no shortlist effect |
| **Not sure** | Caution only. Unanswered elements stay uncertain, never inferred |

### C. Reactions to titles you tried
| Reaction | Today | Proposed |
|---|---|---|
| **Loved / Liked** | Evidence (taste weight 2 / 1.25); drives retrieval and the score | Keep |
| **Disliked** | Evidence (−2); the three closest dislikes count against similar candidates, matched on the whole title | Keep for now (see #335) |
| **Reasons on a liked or loved title** | Boost that rating's weight ×1.25; reach the AI as item-level context | Keep |
| **Reasons on a disliked title** (#335) | No boost (since #322). Reach the AI. "Characters didn't work" on *Friends* can still be over-read as "avoid ensembles" (C2 guardrail) | A dislike reason names **which part** didn't work, not a rule. **S: none** from the reason alone (D4). AI: item-local context only, never a global preference unless several independent dislikes agree |
| **Directional reasons** (#250, e.g. "pacing: too slow") | Not built | Treat the direction as the signal ("too slow" and "slow burn paid off" are opposites). Same surfaces as reasons |

### D. Reactions to titles you haven't tried
| Reaction | Today | Proposed |
|---|---|---|
| **Save** | Not taste evidence (validator enforced). S: removed from future picks only. Profile shows an untried "lean" | Keep. Never evidence (principle 5) |
| **Not interested** | Same: removed; a lean on the profile; never evidence | **One:** affects only that title (removed). **Repeated** on the same *specific* kind may lower that kind's share of exploratory picks: modest, temporary (decays), visible and resettable (D5). **Never** rewrites the Taste Profile, never becomes "not me", never touches a whole medium or broad genre, and always loses to positive ratings and explicit answers. A skip is ambiguous (not interested, already seen, wrong mood, wrong kind of horror), so it's treated as a weak, short-lived signal |

### E. Other structured answers
| Answer | Today | Proposed |
|---|---|---|
| **Blind spot** (#20: which pattern failed on a disliked pick) | P: that dislike doesn't count against the patterns you cleared (level display). S: — | Keep. Optionally exclude that dislike from the shortlist's negative matches for titles of the cleared patterns (later; low priority) |
| **Tastebreak** (per-item confirm or reject of patterns) | Recorded as user-confirmed revisions | Same meaning as A or B for that pattern |
| **Exclusions** (genre or title) | **Hard filter** on candidates and New this week | Keep hard; the control says so |
| **Area switches** | **Hard filter** | Keep |
| **"Applies to … too"** (#252, parked) | Not shipped | P: user's word, never evidence. AI: told. S: only through a labelled cross-media test pick; the copy must not promise retrieval that doesn't exist |

## 4. When answers conflict
1. **Hard rules first:** exclusions and areas.
2. **Your ratings of specific titles** beat any pattern-level correction (principle 1).
3. **The more specific answer wins, without erasing the general one:** an element answer beats the pattern answer *for that element*; a scoped area beats the whole pattern *in that area*. Both are kept and read together as a conditional preference ("comedy I like, except sketch formats").
4. **Recency is only a tie-breaker:** it applies when two answers are about the same target, have comparable specificity, **and** genuinely conflict (e.g. Yes, then later No, on the same pattern). Otherwise both are kept: a later exception doesn't cancel an earlier preference. History keeps everything.
5. **Two patterns pull opposite ways on one title** (one rejected, one confirmed): balance them, don't zero the title. #334's "endorsed kept" gate measures exactly this.
6. **Explicit beats inferred:** anything you said outweighs anything inferred from skips or reactions to titles you haven't tried.

## 5. How this sequences existing work
- **#334:** ship "not me" as a soft shortlist reduction first (Round 4 design; D1 strength). Round 4's label check is where principle 13 applies first: its labels need the specificity and validation check before release. Partly with excluded areas comes next. Importance waits on D3. Bare Partly and Not sure never touch the shortlist.
- **#323:** element answers reuse the "not me" mechanism for label-mapped elements only. Element answers about titles are the user-driven half of #318.
- **#335 / #250:** reasons stay item-local; a shared refinements model (part + direction).
- **#336:** repeated Not interested is an exploration control, not taste; it goes through the #334 gates.
- **Pick-to-pattern link (D4 from #341):** none of the proposed shortlist effects needs the model to name a pattern. They use candidate labels and stored supports, which supports **not** re-adding `tests` for enforcement. Tastebreak on live picks can trigger from cited items instead (#19 option 1).
- **Copy:** each row's "Shown" text replaces current wording only when its effect ships, plus the Not sure fix (D6).

## 6. Decisions (recorded Nov 7, 2026)
| # | Decision | Position |
|---|---|---|
| D1 | How strong is "not me"'s soft reduction? | **Agreed Nov 7, refined in revision 3:** a meaningful soft reduction. Passing the gates (no-op, valid-loss, endorsed-kept, media) makes a strength **eligible**; independent recommendation-quality comparisons (blind ratings on realistic profiles) **choose** among eligible strengths, for the best balance between honoring the correction and keeping appealing picks. Stronger isn't assumed to be better |
| D2 | Should Partly with excluded areas reduce shortlist titles in those areas? | **Agreed Nov 7:** yes, a soft, area-scoped reduction after "not me" is validated, acting only where Tastemake can identify the relevant titles |
| D3 | Should "matters a lot / a little" weight the shortlist? | **Agreed Nov 7:** not now. "Matters a lot" must not become a stronger genre bias or crowd out variety; revisit with realistic-profile tests. "A little" must never act like "not me" |
| D4 | Should a dislike reason ever reduce candidates? | **Agreed Nov 7:** not independently, for now. Revisit only if several independent dislikes agree on the same aspect and aspect-aware matching exists |
| D5 | Should repeated Not interested lower a kind? | **Agreed Nov 7, narrowly:** temporary, reversible, specific kinds only; one skip affects one title; never rewrites the profile; positives and explicit answers outweigh it. "Repeated" and "specific" are defined by testing |
| D6 | Not sure: enforce "tentative", or change the copy? | **Revised Nov 7:** keep evidence strength and confirmation separate. Don't lower the level; mark the pattern unconfirmed and fix the copy (row A) |
| D7 | Can element answers about tone affect the shortlist? | **Agreed Nov 7:** no, profile and AI only, until the catalog can represent tone reliably (principle 13) |
| D8 | Where does this spec live once agreed? | **Agreed Nov 7:** `docs/feedback-semantics.md` in the repo after approval, linked from #341 |

## 7. Test cases (the shared fixtures)
| Case | What the semantics must do |
|---|---|
| **Comedy split** (sketch and docu-reality vs sitcoms) | Partly alone: no shortlist change. Element "Doesn't fit: *Nathan for You*" (title): it stops supporting the pattern but stays a rated favorite. Element "sketch format doesn't fit": soft reduction of sketch-labelled candidates explained only by that pattern |
| **Friends vs The Office** | "Characters didn't work" on *Friends* never reduces ensemble shows in general; *The Office* and *Detroiters* stay recommendable |
| **Mythic / uncanny evidence** (RE7, BioShock) | "Not me" on the mythic pattern never devalues RE7 or BioShock, which support other patterns you like (round 4's 30/30 wrong-support kept) |
| **Positive recovery** (loves BioShock for exploration, atmosphere and its unsettling world; rejects a proposed fantasy / mythology interpretation) | The rejection isn't treated as a dislike of BioShock or its appealing traits: atmospheric exploration games are still recommended, BioShock keeps supporting the exploration and atmosphere patterns, and only titles explained solely by the rejected interpretation (with a validated label) are softly reduced |
| **Repeated skips** (several Not interested on horror for someone who loves atmospheric horror) | Exploratory horror picks of that specific kind become modestly less frequent, for a while. Horror as a genre, and the person's atmospheric-horror pattern, are untouched, and the effect decays and can be reset |
| **Later exception** (dislikes a kind of comedy, later loves one example) | Both answers are kept; the exception narrows the earlier preference instead of cancelling it |
| **Related but plainly poor** (Grey's Anatomy from Suits) | Not a feedback-semantics fix; it's 2a (shortlist ordering). Listed so the two aren't confused |

## 8. Worked example: the target experience
**Someone says:** "I like unsettling, atmospheric horror, but I don't particularly like supernatural-possession movies."

**What a correct system does:**
1. **Profile:** keeps the atmospheric-horror pattern (confirmed) and records a conditional exception: possession-focused films don't fit. This is one preference with an exception, not two contradicting answers (principle 11). It comes from an element answer (#323) or a refinement, approved by the person.
2. **Shortlist:** softly reduces possession-focused candidates that the horror pattern would otherwise explain, **only if** a possession label has passed the reliability check (principle 13). A keyword alone may not tell a film *about* possession from one that merely mentions it, so a raw keyword match doesn't qualify. Other atmospheric horror is unaffected. If no label qualifies, nothing changes in software, the exception reaches the profile and AI only, and the UI says the shortlist isn't affected yet.
3. **Exceptions still possible:** because the reduction is soft, an exceptionally strong match can still appear. Its explanation says why, rather than hiding the conflict.
4. **Visible and reversible:** the pattern shows "except supernatural possession" with a way to remove it, and removing it restores the earlier behavior.
5. **Evaluated:** the possession reduction ships only if it passes the gates and a check beyond its own metric, e.g. blind ratings showing the remaining horror picks are at least as appealing (principle 9).

## 9. Out of scope here
Building any of it; prompt wording; new UI; paid evaluations; cross-media retrieval; per-area importance.
