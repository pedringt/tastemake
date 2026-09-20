# Tastemake handoff

Last updated: September 19, 2026

## Start here

- Repository: `pedringt/tastemake`
- Working branch: `prototype-v1-core-loop`
- Canonical handoff issue: #16
- Draft PR: #5
- Current working branch head: `df7895f2514c80a3c82301bbac1f5355bf926a04`
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

Important user preference: **do not solve overlap by making the design minimal.** Keep the collage energy and move decorations into genuine empty corkboard zones instead.

## Latest feedback pass

Paige completed a visual QA pass and called out these problems:

- `NO. 07` ticket / pin-ring cluster crowding the “The Fall” card
- `TM` sticker sitting over content
- flower stickers covering text
- purple squiggle sitting awkwardly on a card
- a large empty Favorites corkboard area was underused even though it was the intended place for more decoration
- lime square sitting on recommendation feedback UI
- Taste Profile top headline color clashing with the navy highlighted line below
- decorations covering Taste Profile hypothesis text/status areas

The intended fix was:

- keep roughly the same decoration count
- move decorations away from cards, body text, controls, status pills, helper copy, and reaction UI
- use open corkboard zones and perimeter space much more aggressively
- preserve the layered Taste Profile headline treatment
- change the first Taste Profile headline line from purple to the existing pink accent
- keep the navy highlight tight to the second-line text
- allow individual decorations to move/hide at narrower widths rather than overlap content

## Latest implementation

The cleanup pass was pushed to `prototype-v1-core-loop`.

Latest head:

`df7895f2514c80a3c82301bbac1f5355bf926a04` — **Clean up collage decoration placement**

Relevant code changes are primarily in:

- `styles/base.css`
- `styles/profile.css`
- `styles/responsive.css`

Notable implementation details:

- sticker layer moved behind main content as an additional overlap safeguard
- Favorites decoration positions were shifted toward open board space
- Profile and Recommendations decorations were shifted toward margins/perimeter zones
- the Taste Profile lead line now uses the existing pink accent
- some larger decorative elements are hidden at tablet widths where placement becomes unsafe

## Preview status

The usual preview is:

https://tastemake-git-prototype-v1-core-loop-cairn10.vercel.app

However, **the latest commit is not currently deployed there**.

GitHub/Vercel status for `df7895f` is:

> Deployment rate limited — retry in 24 hours.

That means the preview URL is stale and will look like the older design even though the branch code has changed.

Do **not** make another visual correction pass based on the stale preview. Wait until Vercel successfully deploys the current branch head, then visually inspect the actual latest version.

## What to do next

Once the Vercel deployment limit clears:

1. Confirm the preview is built from the latest `prototype-v1-core-loop` head.
2. Visually inspect Favorites, Recommendations, and Taste Profile.
3. Specifically verify that decorative objects no longer cover readable or interactive content.
4. Check that the large open Favorites corkboard region now carries more of the collage decoration.
5. Check the Taste Profile headline color/highlight treatment.
6. Check desktop and tablet widths.
7. Collect feedback before making another code pass.
8. Do not touch `main` without explicit authorization.

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
