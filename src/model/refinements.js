import { isExperiencedNegative, isExperiencedPositive } from "./evidence.js";

export const MAX_REFINEMENTS = 3;

const COMMON = [
  { id: "characters", label: "Characters" },
  { id: "story", label: "Story" },
  { id: "atmosphere-style", label: "Atmosphere / style" },
  { id: "pacing", label: "Pacing" },
  { id: "humor", label: "Humor" },
  { id: "world-setting", label: "World / setting" }
];

const BY_TYPE = {
  book: [
    { id: "writing-prose", label: "Writing / prose" },
    { id: "structure", label: "Structure" }
  ],
  movie: [
    { id: "performances", label: "Performances" },
    { id: "visual-style", label: "Visual style" }
  ],
  tv: [
    { id: "performances", label: "Performances" },
    { id: "visual-style", label: "Visual style" }
  ],
  game: [
    { id: "gameplay", label: "Gameplay" },
    { id: "exploration", label: "Exploration" },
    { id: "difficulty-challenge", label: "Difficulty / challenge" }
  ]
};

export function refinementOptionsFor(item) {
  return [...COMMON, ...(BY_TYPE[item?.type] ?? [])];
}

export function refinablePolarity(feedback) {
  if (isExperiencedPositive(feedback)) return "positive";
  if (isExperiencedNegative(feedback)) return "negative";
  return null;
}

export function normalizedRefinements(feedback) {
  if (!refinablePolarity(feedback)) return [];
  const allowed = new Set(refinementOptionsFor(feedback?.item).map((option) => option.id));
  return [...new Set(Array.isArray(feedback?.refinements) ? feedback.refinements : [])]
    .filter((id) => allowed.has(id))
    .slice(0, MAX_REFINEMENTS);
}

export function refinementRecords(feedback) {
  const labels = new Map(refinementOptionsFor(feedback?.item).map((option) => [option.id, option.label]));
  return normalizedRefinements(feedback).map((id) => ({ id, label: labels.get(id) ?? id }));
}

export function clearInvalidRefinements(feedback, previousPolarity = null) {
  const nextPolarity = refinablePolarity(feedback);
  if (!nextPolarity || (previousPolarity && previousPolarity !== nextPolarity)) {
    feedback.refinements = [];
    return;
  }
  feedback.refinements = normalizedRefinements(feedback);
}

export function toggleRefinement(feedback, refinementId) {
  if (!refinablePolarity(feedback)) return false;
  const allowed = new Set(refinementOptionsFor(feedback.item).map((option) => option.id));
  if (!allowed.has(refinementId)) return false;

  const current = normalizedRefinements(feedback);
  if (current.includes(refinementId)) {
    feedback.refinements = current.filter((id) => id !== refinementId);
    return true;
  }
  if (current.length >= MAX_REFINEMENTS) return false;
  feedback.refinements = [...current, refinementId];
  return true;
}
