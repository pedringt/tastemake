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

Vercel deployed `9c5a478` successfully (the earlier rate limit cleared). Confirm the preview is built from the current branch head before judging visuals.

## Layout check

`scripts/qa/layout-check.js` (browser-side, no dependencies; usage in the file header) checks each page at a given width: stickers touching text/cards, Favorites titles colliding with their tile's top row, and sideways scroll. Run it at 1440, 1024 and 768 after any layout or sticker change. It replaced the earlier ad-hoc checks.

## Recently fixed

- #22: Favorites tile text is now in normal flow at the bottom of the tile, so a long title/description grows the tile instead of running up into the number row (this also affected Circe and Alan Wake 2 at narrower widths, not only the Star Wars card). The earlier `padding-right` workaround for the check circle was removed as unnecessary.
- #23: the "Why this one?" popover is capped to its card's width, so it can no longer make Recommendations scroll sideways at ~900px.

## What to do next

1. Only if Paige has more visual notes: collect the whole round first, then scope, then implement.
2. Product focus returns to #15 (live unseen recommendation experiment), then #12 (Library + Up Next) or #14 (continuous recommendation loop).
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
