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
| **User statement about a pattern** | "Accurate", "Not really me", "Matters a lot / a little" (user-confirmed) | No (not an experience) | Yes: weights or excludes the pattern in ranking |

## Where this lives in code (#35)

- **Items** carry `type` and `domains` from one registry (`src/data/domains.js`); `displayLabel` is display only. The old `medium` field is gone.
- **Evidence** is `src/model/evidence.js`: `evidenceKind(feedback)` maps every stored reaction to a generic kind, and `EVIDENCE_KINDS` holds the class and taste weight. `tasteDelta` reads its weight from there, so there is one table. `evidenceRecords(state)` returns typed records (`ref: "ev:<itemId>"`, kind, class, domains, source, authority `user`), which is what a model is handed and what its citations must point at.
- **Interpretations** are `src/model/interpretations.js`: working hypotheses with evidence refs, counter-evidence, domain scope and cross-domain status. They are never stored as evidence.

| Generic kind | Class | Taste weight | UI today (Oct 2026) |
|---|---|---:|---|
| experienced-favorite | experienced | +3 | A Loved item the user also marked Favorite (after onboarding) |
| experienced-strong-positive | experienced | +2 | Tried it → Loved it |
| experienced-positive | experienced | +1.25 | Tried it → Liked it |
| experienced-negative | experienced | −2 | Tried it → Didn't like it |
| starter-favorite | experienced | +3 | Picked on Favorites (experienced + loved by definition). Not counted as *tried* when setting a pattern's level (#231) |
| intent-positive | intent | 0 | Legacy: untried "More" (no longer offered since #192; old saved data may still carry it) |
| intent-negative | intent | 0 | Legacy: untried "Less" (same) |
| intent-declined | intent | 0 | Not tried → Not interested |
| saved | intent | 0 | Not tried → Save (Library's Saved tab) |
| neutral / unknown | neutral | 0 | Not tried, nothing chosen |

Reactions are still stored as `{ rating, detail }` with the older `more` / `less` / `not-tried` ratings (`src/actions/library.js`); `evidenceKind()` is the only place that decodes them.

Kind names carry no media words, so a jacket that was "worn a lot" and a film that was "loved" are the same kind.

## Every reaction

Weights are the current values in code. "Taste" is `tasteDelta`; "Steer" is `recommendationDelta`.

| Action | Class | Taste | Steer | Notes |
|---|---|---:|---:|---|
| **Favorite picked** | Experienced | **+3** | n/a | Favorites are explicitly things the user already tried and loved |
| **Loved it** | Experienced | **+2** | +1.75 | Offered after "Tried it" |
| **Liked it** | Experienced | **+1.25** | +1.45 | Offered after "Tried it" |
| **Didn't like it** | Experienced | **−2** | −1.75 | Offered after "Tried it". One never weakens a pattern; two do |
| More (untried), legacy | Intent | 0 | +1 | No longer offered (#192); still decoded for old data |
| Less (untried), legacy | Intent | 0 | −1 | Same. It never meant "I dislike this kind of thing" |
| Not interested | Intent | 0 | −1.5 | Offered after "Not tried". Not taste, and not a dislike. Live recommendations receive only the item id, so it is never shown again; the −1.5 feeds only the local, labeled lean (`taste.js`), not live ranking (#250) |
| Save | Intent | 0 | +0.35 | Offered after "Not tried". Lives in Library → Saved (the old Try Next / Bookmarks pages redirect there) and leaves it once the user tries it |
| Not tried (not saved) | Neutral | 0 | 0 | |
| Too predictable | Discovery note | 0 | 0 | Says the pick was low-novelty; must never weaken taste |
| Surprised me | Discovery note | 0 | 0 | Only after Loved/Liked it before; adds no weight of its own |
| Search, typing, opening a result | Lookup | 0 | 0 | Only the explicit action buttons write anything |
| Areas (Movies / TV / Books / Games) | Setting | 0 | 0 | Hides a kind of thing from *new* sets. Says nothing about what the user likes |
| Include a curveball | Setting | 0 | 0 | Four picks plus Surprise Me, or the five best fits |
| Look (design) | Setting | 0 | 0 | Never evidence |
| Blind Spot | Correction | see below | see below | The user names which patterns *did* hold up; a miss is not counted against those |

Anything reacted to (even through search) is never recommended again. A later book in a series (Open Library says its position is above 1) is not offered as a fresh recommendation either, whether or not the user has started the series; unknown positions are left alone (#255).

### Decisions this table records
- **Less** is a steering preference, not a dislike. (#27)
- **Not interested** is never taste. Today it removes the item from future sets; it does not yet steer live ranking (#250). (#27)
- **Saves** are intent only and are never taste. (#12, #24; their page is now Library → Saved, #94)
- A **repeated intent signal** does not become taste no matter how many there are. Untried reactions are shown on the Taste Profile only as a separate, labeled **lean** ("from N picks you haven't tried"), and only when the net signal is clear.
- One experienced dislike never weakens a pattern; it takes two. (Sept 20)

## Reasons on a tried reaction (#191, #250)

Optional reasons are stored on the reaction (`feedback.refinements`, `src/model/refinements.js`) and travel on its one evidence record. They never become evidence of their own.

- Only Loved, Liked or Didn't like can carry reasons. Not interested and Save cannot.
- Up to 5 per reaction, one per dimension. For books a dimension can carry a direction ("Pacing: too slow"); a direction counts with its dimension, never as a second reason. Directions belong to one polarity, so switching between liked and disliked clears all reasons.
- Content chips ("Romance took over the story") are offered only when one of the item's own provider subjects exactly matches an approved list; anything not on the list (including sensitive, identity and religious subjects) never becomes an option. Which ids are valid comes from the vocabulary, so a chosen reason never disappears because metadata changed.
- A reason describes that one experience. One reason never becomes a global preference.
- Reasons reach the model prompts and the Taste Profile ("You said …" next to cited items). They do not affect candidate retrieval or the deterministic fallback.
- A Taste Profile pattern must keep each reason with its own item and dimension (#256): "Characters" on one book plus "Writing / prose: flat" on another is not "flat characters". The validator rejects that.

## What patterns are, and how sure Tastemake is (#26)

The deterministic fallback uses a **fixed, pre-written starting set**. When live profile AI is explicitly enabled, Tastemake may propose and revise working hypotheses from experienced evidence, subject to the same validation and user-correction rules:

| Level | Meaning |
|---|---|
| **Emerging** | A starting pattern. Nothing the user tried has tested it yet |
| **Supported** | At least one tried thing backs it, and more back it than count against it |
| **Strong** | Three or more tried things back it, and at least two more back it than count against it |
| **Still learning** | Something the user tried didn't land, and it isn't clearly backed. One miss never weakens a pattern |
| **Less certain** | Two or more misses that outweigh the support |

Two different ideas are kept apart: a pattern can be **plausible as a starting point** (inferred) while being **weakly validated** (not yet confirmed by anything the user tried). Favorites are experienced strong-positive evidence. In a live profile they may support a working hypothesis when that hypothesis explicitly cites them; deterministic legacy patterns still rely on tagged reaction evidence because the original Favorites catalog has no pattern tags. A Blind Spot that says a pattern *held up* removes that miss from the count against it.

## What a live model must be given and must obey

If a model ever chooses recommendations, writes explanations or proposes patterns, it receives the evidence as **typed items** (class, item, what the user said), not as a prose summary, and it must follow these rules. They are the same rules the deterministic version follows; the deterministic version stays as the baseline it is measured against.

1. Treat only **Experienced** items as taste. Intent items may inform *what to show*, never *what the user likes*.
2. Never treat "Less" or "Not interested" as a dislike, and never infer a dislike of a genre or area from declined picks.
3. Every explanation must **cite the specific evidence items** it relies on. An explanation that cannot cite any is rejected.
4. Do not recommend anything the user already reacted to; respect areas that are off and the curveball setting.
5. Cross-domain links must be supported by evidence in both areas, not assumed.
6. Confidence follows the table above; a model may not label a pattern stronger than the evidence allows.
7. **Decided (Sept 22):** a user's explicit statement about a pattern ("not really me", "matters a lot", "accurate") is its own authority, **user-confirmed**, which outranks model inference. It is not taste evidence (it is not an experience of anything) and never raises a confidence level. A model must treat it as a hard constraint. Built (Sept 22): `src/model/statements.js`. "Not really me" sets that pattern's ranking weight to 0 and excludes it from what a model may use; "matters a lot / a little" is x1.5 / x0.5; "accurate" marks it user-confirmed. None of them changes evidence or confidence.

## Open
- How often live hypotheses should refresh once the feature has enough real-user evidence.
- How "Less" repeated across an area should be surfaced (as a lean only, today).
- Taste modes / contexts (#8): the same person, different tastes in different situations.
