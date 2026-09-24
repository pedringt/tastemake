// Starting looks (#25). A look changes typography, color, texture and decoration only. Layout, features,
// accessibility and interaction stay the same in every look. Choosing a look is never taste evidence.

export const DEFAULT_LOOK = "editorial";

export const LOOKS = [
  { id: "editorial", label: "Clean editorial", blurb: "Warm, polished and type-first. Quiet decoration." },
  { id: "collage", label: "Soft circuit", blurb: "Cool, rounded and airy with a quiet interface-grid feel." },
  { id: "analog", label: "Electric night", blurb: "Deep indigo surfaces, luminous accents and crisp floating panels." },
  { id: "graphic", label: "Bold graphic", blurb: "High contrast, big type and flat blocks of color." }
];

export const isLook = (id) => LOOKS.some((look) => look.id === id);
export const lookLabel = (id) => (LOOKS.find((look) => look.id === id) ?? LOOKS[0]).label;
