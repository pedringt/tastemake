# Tastemake handoff

Last updated: September 20, 2026

## Start here

- Repository: `pedringt/tastemake`
- Working branch: `prototype-v1-core-loop`
- Canonical handoff issue: #16
- Draft PR: #5
- Current visual state: the collage-frame sticker rebuild at `9c5a4783d21712cfe754b0d9bd1190ff958310ba` (supersedes the `df7895f` cleanup); later commits may only update handoff documentation
- `main` is intentionally unchanged at `1a12d709bbebfd748a926a3397ee6c1995eb2e09`
- Do not merge or push anything to `main` unless Paige explicitly says to.

## Current product direction

Tastemake learns patterns in what a person likes, recommends things across domains, gets lightweight reactions, and revises the taste model over time.

Current prototype flow:

**Favorites → Recommendations → Taste Profile**

The current prototype is deterministic and front-end only.

## Visual direction

The current design direction is a personalized corkboard / Trapper-Keeper collage:

- warm speckled corkboard surface
- pinned/taped cards
- stickers, scraps, doodles, stars, hearts, lightning, mini labels
- playful physical layering
- dense enough to feel collected-over-time
- readable content always wins over decoration
- decoration should frame the interface, not sit on top of the interface

Sticker system (since `9c5a478`):

- Each board reserves a **frame**: side gutters and top/bottom bands (`--gutter`, `--band` in `styles/base.css`). Stickers live only in the frame; content never enters it.
- Stickers are data, not CSS offsets: `src/components/stickers.js` (~38 SVG kinds; placement lists per page as `[kind, zone, position %, size, rotation]`).
- Look: junk-journal bulletin board (washi tape, tickets, stamps, polaroids, tags, index cards, sticky notes, fabric scraps, doodles, die-cut stickers) plus a few static neon signs/icons on black paper scraps. Neon is inspired by bright neon signage generally, not a copy of any brand or artwork.
- Hard rule verified at 1440 / 1024 / 768: no sticker touches text, controls, helper copy, reaction UI or status pills. There is no automated test for this yet; the check was an ad-hoc browser script (each sticker's box vs. every text/control/card box). Worth turning into a committed check if the sticker lists change often.
- Details are in `docs/visual-design-spec.md` ("Collage frame").

Important user preference: **do not solve overlap by making the design minimal.** Keep the collage energy and move decorations into genuine empty corkboard zones instead.

## Latest visual pass (done)

Paige's feedback this round: stickers must never cover text, but keep a good amount of them; more variety; looks appealing as a whole; parts should feel like a bright neon collage (90s-inspired, not a direct reference); overall a junk-journal bulletin-board scrapbook.

Implemented in `9c5a478` — "Rebuild collage decoration as a reserved frame with a junk-journal sticker set":

- placement moved from fixed pixel offsets to the gutter/band frame described above
- hero `::before/::after` decorations removed; page-owned decoration (note arrow, profile stamp, surprise burst) pulled inside the content column
- 38–43 stickers per page on desktop, 30–35 at 768px (was 15–16)
- verified: 0 stickers touch any text, control or card at 1440, 1200, 1024, 900 and 768; sticker field is hidden at 620px and below, some pieces hide at 860px and below

Paige's reaction to the deployed result: "liking that better."

## Preview status

Preview: https://tastemake-git-prototype-v1-core-loop-cairn10.vercel.app

Vercel deployed `9c5a478` successfully. The Sept 20 batch (Bookmarks, Library, Search, Blind Spots, Taste Map; head `d94cfe3` on GitHub) was pushed to the branch, but Vercel refused the build: "Deployment rate limited — retry in 24 hours" (Hobby plan, limit shared with the State project). Until a build for the current head is READY, the preview still shows the older collage-only version. Confirm the preview is built from the current branch head before judging visuals. Do not push again just to retry; the next push should carry real changes.

## QA scripts

Three browser-side scripts (no dependencies; usage in each file header) live in `scripts/qa/`:

- `layout-check.js` — per page (Favorites, Recommendations, Taste Profile, Library) at the current width, ignoring anything inside a collapsed `<details>`: header parts overlapping or running off the page, Taste Map cards overlapping or leaving the map, stickers touching text/cards, Favorites titles colliding with their tile's top row, text hidden behind buttons, sideways scroll. Run at 1440, 1024 and 768 after any layout or sticker change.
- `model-rules.js` — the evidence, Library and Search rules checked directly against `src/model/*` (137 checks). Note: ranking parity against the *original* two-round code was verified once in a scratch Node harness (30,000 random reaction sets) and is not committed.
- `bookmark-flow.js` — drives the real UI (with real keyboard focus) through Bookmark, Keep discovering, the chip sets, the taste-evidence rule, the Taste Profile lean, the Library, Search, Blind Spots, the Taste Map, and focus/announcement behavior (123 checks).

Headless Chrome will not go below a 500px layout width; to test real phone widths load the page in a narrower iframe.

## Recently fixed

- #22: Favorites tile text is now in normal flow at the bottom of the tile, so a long title/description grows the tile instead of running up into the number row (this also affected Circe and Alan Wake 2 at narrower widths, not only the Star Wars card). The earlier `padding-right` workaround for the check circle was removed as unnecessary.
- #23: the "Why this one?" popover is capped to its card's width, so it can no longer make Recommendations scroll sideways at ~900px.

## Bookmark, Keep discovering and the taste-evidence rule (built on this branch)

Decisions (also on #12, #14, #24): a single **Bookmark** replaces both Up Next and Interested; **an untried item never counts as taste evidence**; Favorites stays for things actually experienced.

- Under **Not tried**, a single "Bookmark it" chip replaces Interested / Maybe / Not interested. A bookmark has zero taste weight and a small steering nudge (+0.35, the old Interested value) on which picks come next.
- **Bookmarks** is its own page and nav tab (`/bookmarks`), hidden until something is saved, with a count. From there: Loved it / Liked it / Didn't like it turn it into a real reaction (which then counts as taste evidence and records `wasBookmarked`), or Remove bookmark.
- **Keep discovering** replaces the two-round limit: available after any reaction (not every card), never repeats a pick, and ends honestly when the small hand-written pool runs out (opening 5, then 5, then the 2 left, then the end-of-demo message). Round 2 is identical to the previous behavior, and next-set ranking is unaffected by the evidence rule below (both checked against the original code on 30,000 random reaction sets).
- **Taste evidence** (`tasteDelta`) is exactly three things: **Loved it before** (+2), **Liked it before** (+1.25) and **Tried it and disliked it** (-2). Everything else is 0 as taste (plain More/Less, Not interested, Bookmark). Those reactions still steer what comes next (`recommendationDelta`, whose ranking is unchanged from the original, checked on 30,000 random reaction sets). The Taste Profile says so in one line. Until a user says they've tried something, reacting to the opening set leaves the profile's notes unchanged.
- **Chips (decided in #24):** More offers only Loved it before / Liked it before; Less offers only Tried it and disliked it / Not interested. "Exactly my taste" and "Wrong vibe" were removed; "Surprising fit" became **"Surprised me"**, an optional note next to "Too predictable" that only appears after Loved/Liked it before (a stale one is cleared if that choice changes). It is recorded but does not change taste or ranking.
- **Taste Profile lean:** reactions to untried picks (plain More/Less, Not interested, bookmarks) show on the matching pattern card as a separate dashed line, "Your reactions lean toward/away from this (from N picks you haven't tried)". It needs a clear net signal (about one plain More or Less); it is never shown as Stronger / Less certain. Once a pick is tried (Loved / Liked / Tried it and disliked) it moves out of the lean and into taste.
- **Keeping the user's place:** after any action focus returns to the control used (or the next bookmark card / the page if it is gone), and changes are announced through a polite status region (`#live`, outside the re-rendered `#app`). Previously focus dropped to the page body after every tap.
- **Library (#12), built:** own page and nav tab (04; Bookmarks is 05, hidden until something is saved), route `/library`. It is **derived, never stored separately** (`src/model/library.js`), so it cannot disagree with the Taste Profile and every correction is free:
  - **Favorites** section = your starter favorites + any *Loved it before* pick you chose to star ("Add to Favorites" is only offered on Loved; correcting Loved to Liked drops the star).
  - **Library** section = every pick you said you tried and Loved or Liked it before (from Recommendations or from a Bookmark you then tried).
  - **Things you didn't like** (collapsed) keeps "Tried it and disliked" picks out of the Library but listed, with "Actually, I liked/loved it" corrections. They stay as background taste evidence.
  - Each Library card has Loved it / Liked it / Didn't like it, which change the underlying reaction (so Taste Profile and Bookmarks follow).
  - Starring does NOT change the taste model. #12 says Favorites should carry stronger weight than a plain Loved; not decided or built.
- Header: with five tabs the compact two-row header now starts at 1280px (was 1120px), and the nav wraps to two rows on phones. The decorative "↙" doodle on Favorites is hidden on phones (it poked over the "All" filter).
- **Decided (Paige, Sep 20): no saving between visits until there is a real backend.** The prototype deliberately stays in-memory (everything, including the Library, resets on reload); keep building features prototype-style.
- **Search / add something (#13), built:** a magnifier button in the header (and `/` from anywhere) opens a modal dialog outside `#app` (`src/components/search.js`, model in `src/model/search.js`).
  - **Searching is not evidence.** Typing, browsing and opening a result change nothing (tested); only an explicit action does. The dialog says so.
  - Finds by title, prefix, acronym (LOTR, EEAAO), and typos (swapped or missing letters); filter by Watch/Read/Play. Enter opens the top result.
  - **Action sheet:** *I've tried it* (Loved it / Liked it / Didn't like it) and *I haven't tried it* (Bookmark it / Not interested); Add to Favorites appears after Loved; Remove from Tastemake undoes it. These write the same reactions as the Recommendations screen, so Library, Bookmarks, the Taste Profile and the next set all follow. A starter favorite shows "already a starter favorite" with no actions.
  - **Add something Tastemake doesn't know:** title + Movie/TV/Book/Game. Stored only once you act on it; typing an existing title opens the existing item instead of making a duplicate. Added items have no pattern tags, so they fill the Library and Bookmarks but cannot move the Taste Profile.
  - Anything the user has reacted to (even via search) is never recommended again, and reactions to items outside the shown sets still steer the next set. Ranking with no search use is unchanged (parity test still 30,000/30,000).
  - **Catalog = the ~20 hand-written picks + anything the user adds.** `data/training.json` (77 titles WITH Paige's personal ratings from Experiment 001) was deliberately NOT used as a catalog; ask before exposing those titles.
  - Not built: Mixed/neutral, Listen and other domains, creator search, imports/canonical identity, images.
- **Taste Blind Spot (#20), built:** when Tastemake was *confident* (prediction "Likely to like/fit") and the user *tried and disliked* the pick, the card offers "Want to help it see what it got wrong?" (untried dislikes and "Worth testing" picks never count: no prediction failed).
  - Two tappable questions (`src/components/blindspot.js`): which of the patterns it leaned on didn't hold up (or "none of these"), then what got in the way (tone, pacing, characters, how it was told, subject, "fine, just not for me", something else). Then a summary to keep, change or discard. Steps live in `state.blindSpotDrafts`, so a re-render never loses your place. "Not now" leaves a quiet link back.
  - **Model (`src/model/blindspots.js`, `taste.js`):** a confirmed blind spot stops counting the patterns the user says DID hold up against them (taste evidence and steering); "none of these" clears all of them. The pattern that failed is still counted. It never creates a new rule. It only applies while the reaction is still "Tried it and disliked" (correcting it to Liked drops it; disliking again brings the answers back). With no blind spots, ranking is unchanged (parity 30,000/30,000).
  - **Where it shows:** the Recommendations card, the Library's "Things you didn't like" list, and a new Taste Profile section "Things Tastemake keeps getting wrong about you" (each marked "Noted once" or "Recurring" once two blind spots share a pattern or a specific reason; "just not for me"/"something else" never count as recurring), plus a "Blind spot" line on the affected pattern card.
  - **Decided (Paige, Sep 20): one dislike is not enough.** A pattern is only marked "Less certain" after **at least two** experienced dislikes on it; a single one shows "Still learning" with the note "A pick you tried didn't land. It takes more than one to weaken this pattern." (A blind spot that says the pattern held up for one of them stops it counting.) Strengthening is unchanged (one Loved/Liked can still make a pattern "Stronger").
  - Not built: Taste Autopsy / "put it into words" (#18, #19), surfacing which assumptions are wrong most often over time, using blind spots to choose recommendation experiments.
- **Taste Map (#21), built:** a **List / Map** toggle on the Taste Profile (not a new tab). Design rule from the issue: avoid fake precision. So confidence is three border styles (solid / dashed / dotted, plus a word), link strength is three steps (weak / some / strong), and nothing is a number.
  - **Picture (`src/screens/tastemap.js`, `src/model/tastemap.js`):** one card per Taste Profile pattern around a "you, still learning" centre. Lines join patterns that show up together in picks Tastemake knows about (link strength = how many known picks lean on both). Cards show confidence and small notes ("Mixed evidence", "Blind spot", "No reactions yet"). Below 760px it becomes stacked cards. A written version of every connection sits under the picture for screen readers and phones.
  - **Interactions:** tap a card for its detail (what it came from, "what you've told it" grouped as Supports / Counts against / Didn't land but held up / Only steers, each row tagged "Told by you", filterable by type, connected patterns); tap a pick to ring every pattern it leans on; tap a card again to clear.
  - **Tensions and thin spots come only from real data:** mixed evidence (supported and counted against), blind spots, and patterns Tastemake treats as conditional; patterns with no reactions yet; counts of things you told it by type (starter favorites count). Invented contradictions (the issue's "likes ambiguity, dislikes vagueness") are NOT shown because the data has nothing to back them.
  - Link strength describes the model's known picks, not the user, and is labelled that way.
  - Not built: "what changed" over time, domain filters on the cards, challenging or correcting a cluster, launching recommendation experiments from the map, cross-domain highlighting, and Taste Autopsy (#19).
- Header: three columns only from 1440px (five tabs + search would overflow between ~1280 and 1439 once Bookmarks is visible); below that it is two rows. The search button is icon-only on purpose.
- Not done: Favorites carrying extra taste weight, other domains beyond Watch/Read/Play, search/imports/provider links, and decoration on phones (stickers hidden below 620px; Paige is fine holding that).

## What to do next

1. Only if Paige has more visual notes: collect the whole round first, then scope, then implement.
2. Product focus returns to #15 (live unseen recommendation experiment). Its pre-try "Up Next" baseline maps to Bookmark now; do not rewrite the recorded predictions.
3. #17 (taste-driven site skins) can build on the sticker data lists.
4. Do not touch `main` without explicit authorization.

## Workflow rule

Use the controlled workflow:

1. Feedback is read-only.
2. Collect the whole feedback round.
3. Summarize the agreed scope.
4. Implement only after Paige authorizes it.
5. Verify before promotion.
6. Push only to the explicitly authorized branch/environment.
7. Never treat “looks good,” “ship it,” or prior approval as permission to update `main`.

## Source-of-truth rule

Use this file, issue #16, linked issues, and the current repository state together.

If an old chat or memory conflicts with GitHub, trust GitHub.
