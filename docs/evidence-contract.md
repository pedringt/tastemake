# Evidence contract

What every action in Tastemake means, and what it may change. This is the rulebook the app follows today and the contract a live model would be given (see `docs/ai-readiness.md`). It is written from the code (`src/model/taste.js`, `src/model/tastemap.js`); a rule that appears here should be pinned by a test in `scripts/qa/model-rules.js`.

## The core rule

> **Interest is not experience.** Only things the user actually tried change what Tastemake believes about their taste. Everything else can steer what is recommended next, but it is never proof of preference.

Every action falls into exactly one class:

| Class | Meaning | Changes taste? | Changes what comes next? |
|---|---|---|---|
| **Experienced taste** | The user says they tried it, and how it went | **Yes** | Yes |
| **Intent** | What the user thinks they might want, without having tried it | No | Yes, lightly |
| **Setting** | How Tastemake should behave (areas, curveball, look) | No | Only how sets are put together |
| **Lookup** | Searching, browsing, opening something | No | No |
| **Correction** | The user says which pattern failed for a pick (Blind Spot) | Re-assigns *which patterns* a miss counts against | Yes |

## Every reaction

Weights are the current values in code. "Taste" is `tasteDelta`; "Steer" is `recommendationDelta`.

| Action | Class | Taste | Steer | Notes |
|---|---|---:|---:|---|
| Starter favorite picked | Experienced | counts | n/a | Listed as things the user told it; never confirms a pattern by itself (see Confidence) |
| **Loved it before** | Experienced | **+2** | +1.75 | Only offered after "More" |
| **Liked it before** | Experienced | **+1.25** | +1.45 | Only offered after "More" |
| **Tried it and disliked it** | Experienced | **−2** | −1.75 | Only offered after "Less". One never weakens a pattern; two do |
| More (untried) | Intent | 0 | +1 | Reaction to a pitch, not an experience |
| Less (untried) | Intent | 0 | −1 | Means "less like this in what you show me". It does **not** mean "I dislike this kind of thing" |
| Not interested | Intent | 0 | −1.5 | Stronger negative steer than plain Less; still not taste, and not a dislike |
| Bookmark | Intent | 0 | +0.35 | Save marker on an untried item. Leaves Bookmarks once the user tries it |
| Not tried (no bookmark) | Neutral | 0 | 0 | |
| Too predictable | Discovery note | 0 | 0 | Says the pick was low-novelty; must never weaken taste |
| Surprised me | Discovery note | 0 | 0 | Only after Loved/Liked it before; adds no weight of its own |
| Search, typing, opening a result | Lookup | 0 | 0 | Only the explicit action buttons write anything |
| Areas (Watch / Read / Play) | Setting | 0 | 0 | Hides a kind of thing from *new* sets. Says nothing about what the user likes |
| Include a curveball | Setting | 0 | 0 | Four picks plus Surprise Me, or the five best fits |
| Look (design) | Setting | 0 | 0 | Never evidence |
| Blind Spot | Correction | see below | see below | The user names which patterns *did* hold up; a miss is not counted against those |

Anything reacted to (even through search) is never recommended again.

### Decisions this table records
- **Less** is a steering preference, not a dislike. (#27)
- **Not interested** only steers ranking; it creates no negative lean in the Taste Profile. (#27)
- **Bookmarks** are intent only, with their own page, and are never taste. (#12, #24)
- A **repeated intent signal** does not become taste no matter how many there are. Untried reactions are shown on the Taste Profile only as a separate, labeled **lean** ("from N picks you haven't tried"), and only when the net signal is clear.
- One experienced dislike never weakens a pattern; it takes two. (Sept 20)

## What patterns are, and how sure Tastemake is (#26)

In this prototype the taste **patterns are a fixed, pre-written starting set**. They do not change with the user's favorites. What changes is *how much the user's own reactions back each one*:

| Level | Meaning |
|---|---|
| **Emerging** | A starting pattern. Nothing the user tried has tested it yet |
| **Supported** | At least one tried thing backs it, and more back it than count against it |
| **Strong** | Three or more tried things back it, and at least two more back it than count against it |
| **Still learning** | Something the user tried didn't land, and it isn't clearly backed. One miss never weakens a pattern |
| **Less certain** | Two or more misses that outweigh the support |

Two different ideas are kept apart: a pattern can be **plausible as a starting point** (inferred) while being **weakly validated** (not yet confirmed by anything the user tried). Only experienced reactions can move a pattern up; starter favorites alone never make anything Supported or Strong. A Blind Spot that says a pattern *held up* removes that miss from the count against it.

## What a live model must be given and must obey

If a model ever chooses recommendations, writes explanations or proposes patterns, it receives the evidence as **typed items** (class, item, what the user said), not as a prose summary, and it must follow these rules. They are the same rules the deterministic version follows; the deterministic version stays as the baseline it is measured against.

1. Treat only **Experienced** items as taste. Intent items may inform *what to show*, never *what the user likes*.
2. Never treat "Less" or "Not interested" as a dislike, and never infer a dislike of a genre or area from declined picks.
3. Every explanation must **cite the specific evidence items** it relies on. An explanation that cannot cite any is rejected.
4. Do not recommend anything the user already reacted to; respect areas that are off and the curveball setting.
5. Cross-domain links must be supported by evidence in both areas, not assumed.
6. Confidence follows the table above; a model may not label a pattern stronger than the evidence allows.
7. **Pending decision:** whether a user's explicit statement about a pattern ("not really me", "matters a lot") is a new evidence class. See `docs/ai-readiness.md`.

## Open
- Whether a fixed starting set of patterns stays once a model can infer them from a real user's favorites.
- How "Less" repeated across an area should be surfaced (as a lean only, today).
- Taste modes / contexts (#8): the same person, different tastes in different situations.
