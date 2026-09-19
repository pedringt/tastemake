# Tastemake Visual Design Spec v1

## Direction

**Bright 90s pop/editorial energy, cleaned up into a modern product.**

Tastemake should feel curious, expressive, and fun without becoming visually noisy. It should not look like a generic flat SaaS dashboard or retro-computer cosplay.

## Design principles

- Recommendations are the visual and product center of gravity.
- Keep the base calm: pale lavender/off-white surfaces and dark navy text.
- Use neon accents selectively rather than as full-page fills.
- Combine a clean product UI with an editorial personality layer.
- Preserve depth through borders, shadows, overlap, texture, and varied card details.
- Use real or media-like artwork when available; avoid relying on flat vector illustration as the main visual language.
- One tap should remain enough to rate a recommendation.
- Personality should never reduce readability.

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

Primary UI: rounded/geometric sans, currently Plus Jakarta Sans with system fallbacks.

Accent handwriting: Patrick Hand with casual system fallbacks. Use only for short annotations and decorative copy.

Hierarchy:
- Page title: heavy, compact, high contrast
- Card title: bold
- Body: calm, readable, medium line height
- Pills/buttons: compact and high-legibility
- Handwritten text: optional personality layer only

## Shape and depth

- Large surfaces: 24-30px radius
- Recommendation cards: 20-22px radius
- Pills: fully rounded
- Controls: 12-14px radius
- Borders: 1-2px
- Shadows: layered and restrained, never large fuzzy glows
- Allow stickers and accent marks to overlap card edges

## Recommendation card anatomy

1. Medium/rank pill
2. Saved state or fit label
3. Media-like art panel
4. Title
5. Short plain-English description
6. Optional “Why this recommendation?” disclosure
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

## Surprise Me

Surprise items get a stronger cyan treatment, playful burst/sticker details, and permission to be visually louder than standard recommendation cards.

## Avoid

- gradients everywhere
- giant neon glow backgrounds
- glassmorphism
- generic blobs
- rainbow-everything pill systems
- flat AI-style vector art as the dominant imagery
- sparkles used as shorthand for “AI”
- excessive handwritten copy
- forcing every screen to look equally loud

## Fidelity workflow

Implement and review in this order:

1. Global shell/navigation
2. Recommendations hero/progress
3. One fully polished recommendation card
4. Rated state
5. Surprise card
6. Side-by-side visual review
7. Only then spread the system to Favorites and Taste Profile

Treat this document as the source of truth when implementation and the original mockup differ.
