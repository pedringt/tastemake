// #348: one shape check for saved and restored Tastemake data. A single field with the wrong shape (a
// hand-edited or old backup, or a future bug that saves a reaction without its item) used to throw on
// every screen that read it, and because render() saves state first, a reload kept the app blank.
//
// checkStateShape() keeps every field and entry it can use and reports the rest. Loading uses what it
// keeps (so a browser that already holds bad data recovers with everything else intact); restoring a
// backup refuses the file if anything was dropped, leaving the current data untouched.
// Dependency-free: persistence.js and export.js both use it.

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isItem = (value) => isObject(value) && typeof value.id === "string" && value.id.length > 0;
const isString = (value) => typeof value === "string";
const isStringOrNull = (value) => value === null || typeof value === "string";
const isBoolean = (value) => typeof value === "boolean";

// Keyed collections: the whole field must be an object; each entry is checked on its own.
const MAPS = {
  feedbackByRecommendation: (entry) => isObject(entry) && isItem(entry.item),
  customItems: isItem,
  blindSpots: isObject,
  tastebreaks: isObject,
  expandedFeedback: () => true
};

// Lists: the whole field must be an array; each entry is checked on its own.
const LISTS = {
  patternStatements: isObject,
  exclusions: isObject,
  hypothesisHistory: isObject,
  modelHypotheses: isObject
};

// Saved as arrays of ids, loaded as Sets.
const ID_LISTS = ["selectedFavorites", "libraryFavorites", "blindSpotDismissed", "setupAreas"];

const SCALARS = {
  recommendationExhausted: isBoolean,
  curveball: isBoolean,
  setupComplete: isBoolean,
  onboarded: isBoolean,
  displayName: isString,
  profileView: isString,
  mapFilter: isString,
  favoriteFilter: isString,
  recommendationFilter: isString,
  libraryFilter: isString,
  libraryView: isString,
  recommendationStyle: isString,
  setupReturn: isString,
  look: isString,
  mapPattern: isStringOrNull,
  mapItem: isStringOrNull,
  areas: (value) => isObject(value) && Object.values(value).every(isBoolean),
  hypothesisAiChecked: (value) => value === null || isObject(value)
};

// `value` is the saved `state` object. Returns { state, dropped }: the usable fields (unknown fields pass
// through untouched) and a list of what was left out, e.g. "feedbackByRecommendation" for a whole field
// or "feedbackByRecommendation.tmdb-movie-1" for one entry.
export function checkStateShape(value) {
  if (!isObject(value)) return { state: {}, dropped: value == null ? [] : ["state"] };
  const out = { ...value };
  const dropped = [];
  const drop = (field) => { delete out[field]; dropped.push(field); };

  for (const [field, entryOk] of Object.entries(MAPS)) {
    if (!(field in value)) continue;
    if (!isObject(value[field])) { drop(field); continue; }
    const kept = {};
    for (const [key, entry] of Object.entries(value[field])) {
      if (entryOk(entry)) kept[key] = entry;
      else dropped.push(`${field}.${key}`);
    }
    out[field] = kept;
  }

  for (const [field, entryOk] of Object.entries(LISTS)) {
    if (!(field in value)) continue;
    if (!Array.isArray(value[field])) { drop(field); continue; }
    out[field] = value[field].filter((entry, index) => entryOk(entry) || (dropped.push(`${field}.${index}`), false));
  }

  if ("recommendationSets" in value) {
    if (!Array.isArray(value.recommendationSets)) drop("recommendationSets");
    else {
      out.recommendationSets = value.recommendationSets
        .map((set, index) => {
          if (!Array.isArray(set)) { dropped.push(`recommendationSets.${index}`); return null; }
          const items = set.filter((item, at) => isItem(item) || (dropped.push(`recommendationSets.${index}.${at}`), false));
          return items.length ? items : null;
        })
        .filter(Boolean);
    }
  }

  for (const field of ID_LISTS) {
    if (!(field in value)) continue;
    const list = value[field] instanceof Set ? [...value[field]] : value[field];
    if (!Array.isArray(list)) { drop(field); continue; }
    const ids = list.filter((id, index) => isString(id) || (dropped.push(`${field}.${index}`), false));
    out[field] = value[field] instanceof Set ? new Set(ids) : ids;
  }

  for (const [field, ok] of Object.entries(SCALARS)) {
    if (field in value && !ok(value[field])) drop(field);
  }

  return { state: out, dropped };
}
