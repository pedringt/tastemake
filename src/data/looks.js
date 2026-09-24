// Starting looks (#25). A look changes typography, color, texture and decoration only. Layout, features,
// accessibility and interaction stay the same in every look. Choosing a look is never taste evidence.

export const DEFAULT_LOOK = "editorial";

export const LOOKS = [
  { id: "editorial", label: "Clean editorial", blurb: "Warm, polished and type-first. Quiet decoration." },
  { id: "collage", label: "Studio cutouts", blurb: "Layered paper shapes, bright tabs and editorial energy." },
  { id: "analog", label: "Night ledger", blurb: "Ink-dark framing, cream paper and restrained cinema-club details." },
  { id: "graphic", label: "Bold graphic", blurb: "High contrast, big type and flat blocks of color." }
];

export const isLook = (id) => LOOKS.some((look) => look.id === id);
export const lookLabel = (id) => (LOOKS.find((look) => look.id === id) ?? LOOKS[0]).label;
