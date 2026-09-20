# Tastemake Visual Design Spec v1

## Direction

**Bright 90s pop/editorial energy, cleaned up into a modern product.**

Tastemake should feel curious, expressive, and fun without becoming visually noisy. It should not look like a generic flat SaaS dashboard or retro-computer cosplay.

## Presentation rule

**Keep the workflow. Rebuild the presentation.**

The old prototype is a functional wireframe only. Do not preserve its two-column card grids, dashboard-like panels, or repeated card anatomy just because they already exist.

Each section should have its own visual behavior while sharing the same palette, typography, and interaction language:

- Favorites: collectible, collage-like, personal
- Taste Profile: expressive signal map / editorial spread
- Recommendations: media-forward, asymmetric editorial mosaic

## Design principles

- Recommendations are the visual and product center of gravity.
- Keep the base calm: pale lavender/off-white surfaces and dark navy text.
- Use neon accents selectively rather than as full-page fills.
- Combine a clean product UI with an editorial personality layer.
- Preserve depth through borders, shadows, overlap, texture, and varied card details.
- Use real or media-like artwork when available; avoid relying on flat vector illustration as the main visual language.
- One tap should remain enough to rate a recommendation.
- Personality should never reduce readability.
- Mixed card sizes should still resolve onto an intentional grid. Editorial does not mean misaligned.
- Shared actions should use one consistent button system across every screen.

## Palette

- Background: `#F8F5FF`
- Card: `#FFFDFE`
- Primary navy: `#111A4B`
- Secondary text: `#62688A`
- Hot pink: `#FF2FB3`
- Cyan: `#20D9E8`
- Acid lime: `#C8F52A`
- Violet: `#8870FF`
- Soft pink: `#FFE3F6`
- Soft cyan: `#DFFBFD`
- Soft lavender: `#ECE8FF`
- Neutral border: `#DEDDF0`

## Typography

Primary UI: geometric sans, currently Space Grotesk with system fallbacks. It should stay clean and familiar while feeling more playful and editorial than the portfolio typography.

Accent handwriting: Patrick Hand with casual system fallbacks. Use only for short annotations and decorative copy.

Hierarchy:
- Page title: heavy, compact, high contrast
- Card title: bold
- Body: calm, readable, medium line height
- Pills/buttons: compact and high-legibility
- Handwritten text: optional personality layer only

## Shape and depth

- Large surfaces: 16-24px radius
- Recommendation cards: strong bordered editorial blocks
- Pills: fully rounded
- Primary actions: consistent 12px radius and height
- Borders: 1-2px
- Shadows: layered and restrained, never large fuzzy glows
- Stickers and accent marks stay in the collage frame (below) and never overlap cards, text or controls; tape and pins that belong to a card may sit on that card's own edge

## Recommendation card anatomy

1. Medium/rank label
2. Saved state when rated
3. Media-like art panel
4. Title
5. Short plain-English description
6. Optional "Why this recommendation?" disclosure
7. Inline rating controls
8. Optional context chips

Primary rating controls:
- More like this
- Less like this
- Haven't tried

Rated state must be obvious without reordering the list.

## Personality layer

Use a small number of visible accents per viewport:
- marker underlines
- stars / bolts / crowns
- sticker labels
- scribbles
- handwritten margin notes
- small geometric shapes

Do not decorate every component.

## Collage frame (stickers)

The Favorites, Recommendations and Taste Profile boards read as a junk-journal bulletin board: washi tape, tickets, stamps, polaroids, tags, index cards, sticky notes, fabric scraps, doodles, die-cut stickers, and a few neon signs on black paper scraps. The look is dense on purpose.

- Every board reserves a **frame**: side gutters and top/bottom bands (`--gutter`, `--band` in `styles/base.css`). Stickers live only in the frame; content never enters it.
- Placement is data, not CSS offsets: `src/components/stickers.js` lists each piece as `[kind, zone, position %, size, rotation]`. Sizes are fractions of the gutter/band, so nothing drifts onto text when the layout reflows.
- Long pieces can stand up (rotated 90 degrees) to run along a gutter. Pieces marked hide-on-tablet drop out at 860px and below; the whole field is hidden at 620px and below.
- One shared look: white die-cut border on vinyl, thin ink edge on paper, one soft shadow, the existing palette.
- Neon is a black paper scrap with a glowing tube icon or word, static (no animation). It is inspired by bright neon signage generally; do not copy brand marks or specific artwork.
- To add or change decoration, edit the lists in `stickers.js`. Verify at 1440, 1024 and 768 that no sticker touches text, controls or cards.

## Surprise Me

Surprise items get a stronger cyan treatment, playful burst/sticker details, and permission to be visually louder than standard recommendation cards.

## Avoid

- gradients everywhere
- giant neon glow backgrounds
- glassmorphism
- generic blobs
- rainbow-everything pill systems
- flat AI-style vector art as the dominant imagery
- sparkles used as shorthand for "AI"
- excessive handwritten copy
- forcing every screen to look equally loud

## Fidelity workflow

Current implementation direction:

1. Keep the approved header/navigation language.
2. Treat Favorites, Taste Profile, and Recommendations as separate editorial compositions rather than one reusable dashboard grid.
3. Use varied scale, borders, overlap, and layout rhythm without sacrificing alignment.
4. Preserve the simple recommendation-feedback interaction even when presentation changes.
5. Keep browser navigation and direct routes working like a normal web app.
6. Review the live prototype for visual fidelity before adding more product features.

Treat this document as the source of truth when implementation and the original mockup differ.