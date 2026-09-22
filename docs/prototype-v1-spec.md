# Tastemake Prototype v1 Spec

## Goal
Validate whether Tastemake can make useful cross-media recommendations and improve them from low-friction feedback.

The primary loop is:

**Favorites -> Recommendations -> React -> Better recommendations**

The Taste Profile is inspectable, but it is secondary to recommendation quality.

## Product principles
- Ask for the smallest useful amount of information.
- Make one tap enough to give feedback.
- Keep richer context optional.
- Keep explicit user signals separate from inferred taste patterns.
- Keep interest in an unfamiliar item separate from evidence that the user actually enjoys it.
- Explain why a recommendation fits when the user wants that context.
- Do not force users to study model updates before getting better recommendations.
- Keep recommendation order stable while the user reacts to a set.

## Section 1: Favorites
Purpose: create enough initial signal without asking for an exhaustive history.

Requirements:
- Show a compact cross-media starter set.
- Allow multi-select.
- Preselect a plausible starter set for demo purposes.
- Require at least four selections before recommendations are available.
- Let the user go directly from Favorites to Recommendations.
- Keep Taste Profile available as an optional inspection path.

## Section 2: Taste Profile
Purpose: let curious users inspect the patterns Tastemake is using without making this a required workflow step.

Requirements:
- Show concise inferred taste patterns.
- Keep explicit favorites separate from inferred patterns.
- Avoid fake precision.
- Show stronger / less certain / still learning states when feedback provides useful taste evidence.
- Do not treat "Haven't tried" or simple interest as taste evidence.

## Section 3: Recommendations
Purpose: deliver the core product value and collect lightweight feedback.

Requirements:
- Show four ranked recommendations plus one Surprise Me item.
- Explain what each item is in plain language.
- Keep "Why this recommendation?" available but secondary.
- Let the user react directly on each card.
- Use three primary feedback actions:
  - More like this
  - Less like this
  - Haven't tried
- Save the first tap immediately.
- Show an obvious rated state on the card.
- Keep the recommendation order stable while rating.
- Never navigate away or scroll to the top just because the user rated an item.

## Optional feedback detail
Purpose: capture stronger signal without requiring a survey.

Requirements:
- After the primary reaction, offer optional one-tap context chips that say what each row is for.
- More like this: Loved it before, Liked it before ("Already tried it? Tell us how it went.").
- Less like this: Tried it and disliked it, Not interested.
- Haven't tried: Bookmark it (a save marker, see Bookmarks below). There is no Interested / Maybe.
- Discovery note (optional, about the pick and not about taste): Too predictable; Surprised me, which is offered only after Loved / Liked it before. Recorded, but it does not change taste or ranking.
- **Taste evidence rule:** only Loved it before, Liked it before and Tried it and disliked it count as taste evidence. Every other reaction, including a plain More or Less and a bookmark, steers what comes next but never changes the Taste Profile's "Stronger / Less certain" labels. You cannot know a pick fits until you have tried it.
- **Weakening needs more than one miss:** a pattern is marked "Less certain" only after at least two experienced dislikes on it. One dislike shows "Still learning" and says it takes more than one.

## Confidence in the Taste Profile

Each pattern shows a computed level, not an authored one: **Emerging** (a starting pattern nothing you tried has tested), **Supported**, **Strong** (three or more things you tried back it), **Still learning** (something didn't land; one miss never weakens a pattern) or **Less certain** (more than one miss). Each card says where its confidence comes from, and a legend explains the labels. The patterns themselves are a fixed starting set in this prototype. See `docs/evidence-contract.md`.

## Bookmarks
- One Bookmark replaces the earlier Up Next and Interested ideas. It is offered only on picks marked Haven't tried.
- Own page and nav tab, hidden until something is saved, with a count.
- Loved it / Liked it / Didn't like it turns a bookmark into a real reaction (which then counts as taste evidence and records that it was bookmarked first); Remove bookmark leaves the pick untried.
- A bookmark has no taste weight and only a small steering nudge.

## Library
- Things the user has actually tried and liked, plus their starter favorites. It is derived from the reactions already given, so it never disagrees with the Taste Profile.
- Favorites = starter favorites + Loved picks the user stars ("Add to Favorites" is offered only on Loved). Library = other Loved / Liked picks.
- Each pick can be corrected in place (Loved / Liked / Didn't like it); a pick marked Tried it and disliked leaves the Library but stays listed, correctable, under "Things you didn't like".
- Untried saves are Bookmarks, never Library.

## Search and add something
- A header button (and the `/` key) opens a search dialog from any screen. **Searching is not evidence**: typing, browsing and opening a result never change taste or collections; only an explicit action does.
- Results show title, type and where the item already stands (Loved it, Bookmarked, starter favorite...). Tolerates prefixes, acronyms and typos.
- Action sheet, kept short: I've tried it (Loved / Liked / Didn't like it) and I haven't tried it (Bookmark it / Not interested); Add to Favorites after Loved; Remove undoes it. Same evidence rules as everywhere else.
- Items Tastemake doesn't know can be added by title and type. They are stored only once acted on and never duplicate an existing item.
- The catalog is small and hand-picked for now; a real catalog is a future integration.

## Taste Blind Spot
- Trigger: the user tried and disliked a pick Tastemake was confident about (prediction "Likely to like/fit"). Untried dislikes and low-confidence picks are not prediction failures.
- Two short questions: which of the patterns it leaned on didn't hold up (or none), and what got in the way. The user confirms, changes or discards a plain-language summary before anything is saved.
- Effect: patterns the user says held up are no longer counted against them; the mismatch stays on record instead of rewriting history; one miss never creates a new rule. Themes are marked "Recurring" only when two blind spots share them.
- Shown on the card, in the Library's disliked list, and on the Taste Profile under "Things Tastemake keeps getting wrong about you".

## Taste Map
- A Map view of the Taste Profile (toggle beside List). One card per pattern; confidence and link strength are coarse steps (solid / dashed / dotted, weak / some / strong), never numbers, so it doesn't pretend to be a precise personality graph.
- Tap a pattern for what it came from and what the user has told Tastemake about it (grouped by what it does to the pattern, every row marked as told by the user); tap a pick to see which patterns it leans on.
- Tensions, thin spots and "little to go on" areas are shown, but only when the data supports them.
- Every connection also appears as text under the picture; small screens show stacked cards instead of lines.

## My Tastemake

A header button opens **My Tastemake**: what the user told Tastemake (split into "counts as taste" and "only steers what comes next", each with where it came from and a way to change or remove it), three **areas** (Watch, Read, Play) that show or hide a kind of thing in new sets, an **Include a curveball** setting, and **Start over**. Settings are configuration, not taste evidence; areas say nothing about what the user likes. Correcting an inferred pattern is not built yet (it would need a rule change). Details in `docs/HANDOFF.md`.

## Looks (#25)

Four looks (Clean editorial, Collage, Warm analog, Bold graphic) change only the visual expression. "Choose a starting look" appears before Favorites on a first visit, and a header **Look** button reopens it. The default is Clean editorial; Collage is one click away. Choosing a look changes no taste data. Details, the token system and the accessibility rules are in `docs/visual-design-spec.md`. A personalized, taste-based look is documented there as a future opt-in feature and is not built.

## Recommendation refresh
Purpose: show that feedback improves the next set without forcing a separate learning screen.

Requirements:
- Show progress such as "3 of 5 rated."
- Offer Keep discovering after any reaction, not only when every card is rated.
- Re-rank the next set from the feedback signals; never repeat a pick; when the small hand-written pool runs out, say so honestly.
- Do not require a "What Changed" / "Learned" screen.
- Keep the Taste Profile available for users who want to inspect model changes. It shows taste from things the user has tried, and shows reactions to untried picks separately as a "lean", clearly labeled as not taste.

## Keeping the user's place
- After any action the screen is rebuilt; keyboard focus returns to the control that was used (or to the next sensible target if it is gone), and changes are announced politely to screen readers (a status region outside the rebuilt screen).

## Prototype constraints
- No auth.
- No external integrations.
- No live LLM call.
- No production persistence.
- No catalog search.
- Static mock data derived from Experiments 001-003.
- Deterministic mock scoring for follow-up recommendations, from a small hand-written pool (the demo ends when it runs out).
- Responsive enough for mobile and desktop.

## Success criteria
A first-time reviewer can answer:
1. Do these recommendations feel plausibly tailored to me?
2. Can I react to them quickly without losing my place?
3. Is it obvious which recommendations I already rated?
4. Does the next set feel meaningfully better informed by my feedback?
5. If I want to know why Tastemake made a recommendation, can I inspect that without being forced to?
