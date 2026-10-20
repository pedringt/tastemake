// Optional "why" on a tried reaction (#191, #250). Stored on the reaction as `feedback.refinements`, a
// list of ids. A reaction plus its reasons is still one piece of evidence (see evidence.js).
//
// An id is either a plain dimension ("pacing") or, for books, a dimension with a direction
// ("pacing:too-slow"). One entry per dimension: a direction replaces its plain dimension and never
// counts as a second reason. Directions only exist for one polarity, so switching between liked and
// disliked clears them (clearInvalidRefinements).
//
// Content chips ("romance:took-over") are directions on a dimension that has no plain chip. Which ids are
// *valid* comes from this vocabulary alone; whether a content chip is *offered* depends on the item's
// provider subjects (contentOptionsFor). A chosen reason never disappears because metadata changed.
export const MAX_REFINEMENTS = 5;
export const MAX_CONTENT_OPTIONS = 2;

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

// Directions, books only for now (#250). Item-agnostic on purpose: "too slow" needs no metadata, and no
// option may hint at the plot.
const DIRECTIONS = {
  book: {
    pacing: {
      negative: [{ id: "too-slow", label: "Too slow" }, { id: "too-rushed", label: "Too rushed" }, { id: "uneven", label: "Uneven" }],
      positive: [{ id: "kept-me-reading", label: "Kept me reading" }, { id: "slow-burn", label: "Slow burn paid off" }]
    },
    structure: {
      negative: [{ id: "hard-to-follow", label: "Hard to follow" }, { id: "added-little", label: "Didn't add much" }],
      positive: [{ id: "added-to-it", label: "Added to the experience" }]
    },
    "world-setting": {
      negative: [{ id: "too-much-exposition", label: "Too much exposition" }, { id: "too-thin", label: "Felt thin" }],
      positive: [{ id: "gradual-discovery", label: "Gradual discovery" }, { id: "rich-detail", label: "Rich detail" }]
    },
    "writing-prose": {
      negative: [{ id: "overwritten", label: "Overwritten" }, { id: "flat", label: "Flat" }],
      positive: [{ id: "beautiful", label: "Beautiful sentences" }, { id: "clean", label: "Clean and clear" }]
    }
  }
};

// Content chips: an approved list only. A provider subject that is not on a list here never becomes an
// option, which is what keeps sensitive, identity and religious subjects out. Matching is strict: the
// whole normalized subject must equal one of these, so "Fiction, romance, fantasy" does not count.
const CONTENT = {
  book: [
    {
      dimension: "romance",
      label: "Romance",
      subjects: ["romance", "romance fiction", "romantic fiction", "romance novels", "love stories", "romántica"],
      negative: { id: "took-over", label: "Romance took over the story" },
      positive: { id: "highlight", label: "The romance was a highlight" }
    },
    {
      dimension: "mystery",
      label: "Mystery",
      subjects: ["mystery", "mystery fiction", "detective and mystery stories", "detective and mystery fiction"],
      negative: { id: "predictable", label: "The mystery was easy to guess" },
      positive: { id: "kept-guessing", label: "The mystery kept me guessing" }
    },
    {
      dimension: "horror",
      label: "Horror",
      subjects: ["horror", "horror fiction", "horror tales", "horror stories"],
      negative: { id: "didnt-land", label: "The scares didn't land" },
      positive: { id: "worked", label: "The scares worked" }
    }
  ]
};

export function refinementOptionsFor(item) {
  return [...COMMON, ...(BY_TYPE[item?.type] ?? [])];
}

export function refinablePolarity(feedback) {
  if (feedback?.rating === "more" && ["loved-before", "liked-before"].includes(feedback?.detail)) return "positive";
  if (feedback?.rating === "less" && feedback?.detail === "tried-disliked") return "negative";
  return null;
}

export const dimensionOf = (id) => String(id ?? "").split(":")[0];
const directionPart = (id) => String(id ?? "").split(":")[1] ?? null;

export function directionOptionsFor(item, dimension, polarity) {
  return DIRECTIONS[item?.type]?.[dimension]?.[polarity] ?? [];
}

const normalizeSubject = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// Content chips this item's own subjects clearly support, at most MAX_CONTENT_OPTIONS.
export function contentOptionsFor(item, polarity) {
  if (!polarity) return [];
  const subjects = new Set((item?.genres ?? []).map(normalizeSubject));
  return (CONTENT[item?.type] ?? [])
    .filter((entry) => entry.subjects.some((subject) => subjects.has(subject)))
    .slice(0, MAX_CONTENT_OPTIONS)
    .map((entry) => ({ id: `${entry.dimension}:${entry[polarity].id}`, label: entry[polarity].label, dimension: entry.dimension }));
}

// Every id valid for this item and polarity, with the label a record carries.
function labelsFor(item, polarity) {
  const labels = new Map();
  for (const option of refinementOptionsFor(item)) {
    labels.set(option.id, option.label);
    for (const direction of directionOptionsFor(item, option.id, polarity)) {
      labels.set(`${option.id}:${direction.id}`, `${option.label}: ${direction.label.toLowerCase()}`);
    }
  }
  for (const entry of CONTENT[item?.type] ?? []) {
    const choice = entry[polarity];
    if (choice) labels.set(`${entry.dimension}:${choice.id}`, choice.label);
  }
  return labels;
}

export function normalizedRefinements(feedback) {
  const polarity = refinablePolarity(feedback);
  if (!polarity) return [];
  const allowed = labelsFor(feedback?.item, polarity);
  const seenDimensions = new Set();
  return [...new Set(Array.isArray(feedback?.refinements) ? feedback.refinements : [])]
    .filter((id) => allowed.has(id))
    .filter((id) => !seenDimensions.has(dimensionOf(id)) && seenDimensions.add(dimensionOf(id)))
    .slice(0, MAX_REFINEMENTS);
}

// Records stay { id, label }: they travel into model prompts as-is, and the dimension/direction can be
// read back from the id (dimensionOf).
export function refinementRecords(feedback) {
  const polarity = refinablePolarity(feedback);
  if (!polarity) return [];
  const labels = labelsFor(feedback?.item, polarity);
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

// Toggle a plain dimension, a direction or a content chip. A direction swaps in for its dimension (and
// back to the plain dimension when chosen again); a plain dimension removes the whole entry.
export function toggleRefinement(feedback, refinementId) {
  const polarity = refinablePolarity(feedback);
  if (!polarity || !labelsFor(feedback.item, polarity).has(refinementId)) return false;

  const current = normalizedRefinements(feedback);
  const dimension = dimensionOf(refinementId);
  const existing = current.find((id) => dimensionOf(id) === dimension);
  const plainChip = refinementOptionsFor(feedback.item).some((option) => option.id === dimension);

  if (existing === refinementId) {
    // Choosing a selected direction again goes back to the plain dimension when one exists.
    feedback.refinements = directionPart(refinementId) && plainChip
      ? current.map((id) => (id === refinementId ? dimension : id))
      : current.filter((id) => id !== refinementId);
    return true;
  }
  if (existing) {
    // A plain dimension chip clears the whole entry; a different direction replaces the old one.
    feedback.refinements = directionPart(refinementId)
      ? current.map((id) => (id === existing ? refinementId : id))
      : current.filter((id) => id !== existing);
    return true;
  }
  if (current.length >= MAX_REFINEMENTS) return false;
  feedback.refinements = [...current, refinementId];
  return true;
}
