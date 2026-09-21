// Starting looks (#25). A look changes typography, color, texture and decoration only. Layout, features,
// accessibility and interaction stay the same in every look. Choosing a look is never taste evidence.

export const DEFAULT_LOOK = "editorial";

export const LOOKS = [
  { id: "editorial", label: "Clean editorial", blurb: "Warm, polished and type-first. Quiet decoration." },
  { id: "collage", label: "Collage", blurb: "The playful pinned-and-stickered corkboard." },
  { id: "analog", label: "Warm analog", blurb: "Soft paper, archive tabs and hand-written labels." },
  { id: "graphic", label: "Bold graphic", blurb: "High contrast, big type and flat blocks of color." }
];

export const isLook = (id) => LOOKS.some((look) => look.id === id);
export const lookLabel = (id) => (LOOKS.find((look) => look.id === id) ?? LOOKS[0]).label;
