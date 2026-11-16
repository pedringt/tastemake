# #323 Partly: build plan (proposal, not built)

Written Nov 16, 2026 for Paige. Nothing here is built. Paige answered the seven design decisions on Nov 16 (section 7); the rest of the plan reflects her answers.

## 1. What we're building, in one paragraph

Today, a **Partly** answer keeps a pattern and tells the AI to treat it cautiously. Since #370 it also lowers matching titles in any area the person unticks. It can't express the misunderstanding Paige hit in every prototype trial: *this one title belongs for a different reason* (The Office: warmer, a traditional sitcom; The Leftovers: grief drama, not horror; Obra Dinn: grounded history, not myth). The feature lets a person:

1. say whether the whole pattern is off or only certain titles are;
2. flag a title and tap what's different about it;
3. review a suggested correction (renamed, narrowed or split) and choose **Use this**, **Keep original**, **Edit** or **Suggest another**.

Nothing changes until they choose.

## 2. Evidence so far

| Step | What it showed | Where |
|---|---|---|
| Prototype rounds 1–2 (Nov 7) | Step 1 must let people point at titles, not only characteristics | #323 comment, Nov 7 |
| Prototype round 3 (Nov 15) | All 4 trials were one title plus a reason. Every one was "captured", with "less effort". Chips versus tap-the-sentence didn't matter | #323 comment 6898675797 |
| Reason eval v1 and v2 (Nov 15–16) | With the "X, not Y" prompt, 29 of 30 sets held a reason Paige would tap, and 20% of options were off (too general, wrong about the show, repetitive) | #323 comment 6919978807, draft PR #373 |
| Not yet tested | Whether the model can write the **suggested correction** (the new name, claim and split). In the prototype these were hand-written | Phase 1 below |

## 3. The flow

```mermaid
flowchart TD
  A[Partly] --> B{"Wrong for all of them,<br/>or just certain ones?"}
  B -->|whole pattern| C[Tap the words that are wrong]
  C --> C2{"Which titles is that about?"}
  C2 -->|all of them| H
  C2 -->|some| D
  B -->|certain titles| D[Flag a title]
  D --> E{"Doesn't fit this description"<br/>or "Fits a different side of my taste"}
  E -->|doesn't fit| F[Software only:<br/>stop citing it here]
  E -->|different side| G["What's different about it?"<br/>3 AI reasons + Something else]
  G --> H[Suggested correction]
  H --> I{Use this · Keep original ·<br/>Edit · Suggest another}
```

- **Tapped words** are followed by "Which titles is that about?" (Decision 5). "All of them" goes straight to the suggestion. Picking some titles flags them, so the suggestion can narrow or split the pattern instead of rewording it for every title.
- **Doesn't fit this description** needs no AI. The title stops being cited by this pattern and is never cited by it again (section 4). The pattern's wording stays as it is.
- **Fits a different side of my taste** asks for reasons (AI call 1). A title with a reason but no matching pattern is *set aside* and visible, never dropped silently. That was round 2's flaw, fixed in round 3.
- **Two or more** "different side" titles bring back the grouping question ("go together?"), with nothing pre-selected.
- **The suggestion** (AI call 2) runs only when wording would change: a word was tapped, or a title was set aside with a reason. If the only change is that a title stops being cited, software does it and shows the same review screen.

## 4. Data: what is stored and what reads it

All new fields live in the browser's saved state, like the rest of the profile. They need additions to `state-shape.js`, backups and export.

| What | Where | Read by |
|---|---|---|
| The person's answers: tapped words, and each title's verdict, reasons and own words | the pattern's `patternStatements` entry gains `elements: { words: [], titles: { ref: { verdict, reasons, note } }, grouped }` | the review screen; the refresh prompt as user-confirmed context; history |
| Titles that must not be cited by this pattern | the pattern gains `excludedRefs: [ref]` | the refresh validator (drops such a citation); Design A placement (never places the title as that pattern's support); `corrections.js` (leaves it out of the pattern's labels) |
| The correction itself | `hypothesisHistory`: a `user-confirmed` revision with reason "Corrected from your Partly answer". A split gets new pattern ids, each revision carrying `splitFrom` | the profile's history line; Undo |
| Set-aside titles and why | Design A's ledger: the title joins `profileLedger.pool`, and a new `poolNotes: { ref: { reasons, fromPattern } }` keeps the person's words | the placement call. Two or more pooled titles can already become a new pattern, and the person's reasons go in as context (Decision 2) |
| A refresh's proposed rewording of an accepted correction | the pattern gains `proposedWording: { title, claim, proposedAt }` | the Taste Profile, which shows old and new side by side with **Use new wording** / **Keep mine**; nothing changes until the person picks (Decision 1) |

**What changes for picks:**
- The corrected pattern's **supports** change, so #366/#370's label matching (which titles "Not me" and unticked areas lower) follows the correction automatically.
- The **wording** of patterns doesn't reach the picks prompt today; only statements do. Per Decision 6, a corrected pattern's accepted name and claim **will** reach the picks prompt, as quoted, user-confirmed context. That is a picks prompt change, so it gets its own paid eval before it ships (phase 4b).
- The profile copy must say exactly what reaches picks, and no more.

**Accepted wording:** an accepted correction is a user-confirmed pattern, so a refresh never rewrites it silently. Per Decision 1, a refresh may *propose* new wording. The proposal is stored apart from the pattern, shown old-beside-new on the Taste Profile, and applied only if the person chooses it. Until then, the person's wording is what the profile and the picks prompt use.

## 5. The two AI calls

| | Call 1: reasons | Call 2: suggestion |
|---|---|---|
| When | the person marks a title "different side" | the person taps "See suggested correction" |
| Input | the pattern's name and claim, the title's facts, the other titles (the v2 eval prompt) | the pattern; tapped words; each flagged title's verdict and reasons; the grouping answer; the titles' facts |
| Output | 3 reasons, each at most about 8 words, "X, not Y" | 1–3 patterns (name, claim, cited titles), plus the set-aside titles. Structured output |
| Software checks | count; length; no title names; no near-duplicates (a v3 fix); the "not …" part drawn from the claim | every original title accounted for exactly once (cited, set aside or dropped as the person said); only original titles cited; no title cited against its verdict; a claim that names a format or medium agrees with its titles (round 2's sitcom mismatch); confirmed wording elsewhere untouched |
| If it fails | show "Something else" and the title rows; the person can still finish | show the original with "Couldn't suggest a change"; **Keep original** and **Edit** still work |
| Cost on Haiku 5.5 | about $0.00014 per call (v2 eval) | estimate about $0.0003 per call; measured in phase 1 |
| Endpoint | a new mode on `api/hypotheses.mjs`, behind its own env flag like `TASTEMAKE_PROFILE_PLACEMENT` | the same |

The person's own words ("Something else", a pattern's description edited by hand) go to call 2 as quoted data. They are never instructions, and the call's prompt will say so, as the reasons-eval prompt already does.

## 6. Phases (each its own PR, behind flags, merged only with Paige's OK)

1. **Suggestion eval** (paid, small). Fixtures come from Paige's round-3 answers plus a few made-up ones (a split, a narrowed claim, only one title flagged). The model writes the correction, and Paige judges it blind against the hand-written prototype versions. The call count and cap are stated first: about 30 calls, under $0.02. If useful, try reasons v3 in the same run.
2. **Data and software-only paths** (free). `elements`, `excludedRefs`, history entries, and "Doesn't fit this description" end to end, including the refresh validator, placement and corrections honoring `excludedRefs`. The Partly UI gains the two framing questions and title rows, with no AI yet. This alone fixes the RE7/BioShock-under-mythic problem (#318) for good.
3. **Call 1 wired** (reasons), behind a flag. Includes a loading state, failure fallback and tests with canned answers.
4. **Call 2 wired** (suggestion and review screen), behind a flag: Use this, Keep original, Edit, Suggest another, and Undo. Includes copy saying exactly what changes, the "Which titles is that about?" step (Decision 5), and the refresh's proposed-rewording state (Decision 1).
   - **4b. Corrected wording in the picks prompt** (Decision 6), behind its own flag. A paid picks eval comes first, comparing picks with and without the corrected wording on fixed fixtures. Its call count and cap are stated and approved by Paige before it runs.
5. **Turn on**, with the same switch-on and rollback plan as Design A (#369), then a production smoke test. The Example Profile is regenerated only on Paige's separate OK.

## 7. Decisions (answered by Paige, Nov 16)

| # | Question | Paige's answer | Recommended was |
|---|---|---|---|
| 1 | Does an accepted correction freeze its wording? | **Refreshes may propose new wording**, shown old-beside-new, applied only on her OK | Freeze |
| 2 | Do set-aside titles go into Design A's "not yet explained" pool with the person's reasons? | Yes | Yes |
| 3 | When do reasons load? | When a title is flagged (one call per flagged title) | Same |
| 4 | Does "Doesn't fit this description" mean the pattern never cites the title again? | Yes; the rating still counts elsewhere; Undo from the title row or history | Yes |
| 5 | Tapped words with no flagged titles? | **Ask which titles the words are about** | Go straight to the suggestion |
| 6 | Should a corrected pattern's wording reach the picks prompt? | **Yes, as part of this** (phase 4b, with its own paid eval) | Not yet |
| 7 | What happens to element-level answers after a refresh? | They stay with the pattern id and its split children; a retired pattern keeps them in history | Same |

**Follow-up found while answering Decision 1 (outside #323):** refreshes already reword patterns the person hasn't confirmed, almost silently. The Taste Profile's "What changed" panel says only "The pattern became more specific" without the old wording, and a name change alone isn't shown at all (`learningPanel` in `src/screens/profile.js`). Worth its own issue.

## 8. Risks

- **Suggestion quality is the unknown.** If phase 1 shows corrections Paige wouldn't use, phases 3–4 should stop at reasons and "Edit wording" only.
- **Off reasons (20%) erode trust.** Mitigations: the v3 rules, the "Something else" box always shown, and never more than 3 options.
- **Picks prompt change (Decision 6)** can shift picks for every person with a correction. It stays behind its own flag until its eval passes, and can ship after phases 2–4 or not at all.
- **Refresh interplay.** `excludedRefs` must hold through Design A placement *and* the full refresh fallback. Both paths are covered by tests in phase 2.
- **Scope creep into #335/#336** (dislike reasons; Save and Not interested teaching nothing). Kept out of this plan.
