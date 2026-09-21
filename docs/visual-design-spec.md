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
- To add or change decoration, edit the lists in `stickers.js`. Verify with `scripts/qa/layout-check.js` (usage is in the file header) at 1440, 1024 and 768: no sticker may touch text, controls or cards, no Favorites title may collide with its tile's top row, no text may sit behind a button, and no page may scroll sideways. The Bookmarks page uses the same frame.

## Looks (#25)

Tastemake has four **looks**: different visual expressions of one product. A look changes typography, color, texture and decoration. It never changes layout, features, accessibility or interaction.

| Look | Feel | Heading face | Decoration |
|---|---|---|---|
| **Clean editorial** (starting point) | warm, polished, type-first | Newsreader (serif) | none in the frame; thin rules, soft shadows |
| **Collage** | the playful pinned-and-stickered corkboard (the original look) | Space Grotesk | full sticker frame, tilted cards, hard shadows |
| **Warm analog** | soft paper, archive tabs, hand-written labels | Fraunces | quieter sticker set (tape, tickets, tags, stamps, notes), muted like old paper |
| **Bold graphic** | high contrast, big type, flat blocks of color | Archivo 900 | flat color blocks in the frame, thick black borders, hard black shadows |

How it works:

- The look is a `data-look` attribute on `<html>` (default `editorial`). Everything a look can change is a **token** (`--navy`, `--pink`, `--heading`, `--tilt`, `--hard`, `--tone-1..8`, `--tint-*` ...) or one of the marked overrides in `styles/looks.css`. Adding a look is one token block plus a few surface rules.
- `--tilt` multiplies every card/label rotation and `--hard` multiplies every hard offset shadow (0 = none). Collage is `1`/`1`, so it is **pixel-identical to the pre-looks styling**; this was verified by comparing computed styles of 1,658 elements before and after the refactor (0 differences).
- Choosing: **"Choose a starting look"** is shown before Favorites on a first visit to the bare address, with small previews drawn in each look's own tokens (people choose by seeing, not by reading a label). A **Look** button in the header reopens the same picker any time. Picking a look applies it to the whole page straight away, so the page behind the picker is a live preview.
- `?look=collage|editorial|analog|graphic` in a link skips the picker and uses that look (handy for sharing a link that matches what you want a reviewer to see). Deep links such as `/library` also skip the picker and use the default look. Like everything else, the choice is in memory only.
- **Choosing a look is never taste evidence**, and the picker says so.

Rules every look must keep (checked by `scripts/qa/layout-check.js` and the flow test in all four looks, on every main screen):

- no overlaps, no sideways scroll, decoration never covers text or controls;
- **text contrast at least WCAG AA** (4.5:1, or 3:1 for large text). Collage is the original look and is not gated (it has known low-contrast decorative labels such as the pink kickers on cork);
- the same markup, controls, focus behavior and announcements in every look.

## Future: a look from your taste (opt-in, not built)

Once Tastemake has enough evidence about someone's taste, it could offer an optional personalized look, built from what the taste model has learned. Not built; the design intent, so the door stays open (#25, #17):

- **An explicit reveal, never a silent change.** Something like *"Your taste has a look now."* The interface must not change by itself as Tastemake learns.
- **It explains itself.** A short note on the signals behind the look (for example "you keep coming back to restrained, geometric work"), not an unexplained AI-generated theme.
- **The user stays in control:** *Use it*, *Tweak it*, *Keep my current look*, and *Regenerate later* as the profile evolves.
- **Compatible looks, not "your style is X".** Build it from the existing look families (or a blend of a few) so it stays usable and accessible; eclectic taste can be offered several looks rather than one.
- **Guardrails** (from #17): readability and accessibility always outrank aesthetic adaptation; never infer personality from visual taste; picking or keeping a look is not itself preference evidence unless the user explicitly reacts to it; no commercial or affiliate influence on which look is offered; provide a stable default and easy manual control.

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