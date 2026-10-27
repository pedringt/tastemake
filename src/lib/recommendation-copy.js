// User-facing recommendation copy must never expose internal evidence identifiers.
// Structured refs such as ev:tmdb-movie-123 remain available separately in ai.cites for validation/provenance.
const INTERNAL_RETRIEVAL_LANGUAGE = /\b(catalog (?:neighbor|neighborhood|branch|path|cluster|signals?)|provider relationship|provider data|nearby metadata|metadata (?:path|relationship)|catalog relationship|catalog overlap|retrieval (?:path|signal|source)|embedding|similarity score)\b/i;

// Raw provider tags ("franchise:本好きの下剋上", "series:Red Rising") are catalog data, not prose.
const RAW_CATALOG_TAG = /\b(?:franchise|series|serie|nyt|form)\s?:\S/i;
// Before Oct 20 the catalog fallback put a raw genre tag into its sentence ("...; it also shares some holes
// territory." or "This is a franchise:...-leaning pick..."). Saved picks keep that text, so it is cleaned here.
const LEGACY_TAG_CLAUSE = /;\s*it also shares some [^.;]{1,80} territory\./i;
const LEGACY_TAG_SENTENCE = /^This is an? [^.]{1,80}-leaning pick that may connect with things you've liked\.$/i;

export function sanitizeRecommendationCopy(text) {
  let value = String(text ?? "");
  if (!value) return "";

  value = value
    .replace(LEGACY_TAG_CLAUSE, ".")
    // Common model forms: (ev:...), **(ev:...)**, or a bare ev:... token.
    .replace(/\*{0,2}\(?\s*ev:[\w-]+\s*\)?[.,;:]?\*{0,2}/gi, "")
    // Clean punctuation/spacing left behind by removing a citation token.
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Retrieval provenance is useful for debugging, not for explaining taste to a user. If a model
  // leaks provider/catalog plumbing into its rationale, discard that rationale and let the caller
  // substitute a plain, user-facing fallback.
  if (INTERNAL_RETRIEVAL_LANGUAGE.test(value) || RAW_CATALOG_TAG.test(value) || LEGACY_TAG_SENTENCE.test(value)) return "";

  // If the only visible content was an internal ref or markdown around it, render nothing rather
  // than leaking an implementation detail or leaving a punctuation-only rationale.
  if (!/[\p{L}\p{N}]/u.test(value)) return "";
  return value;
}


export function readableRecommendationCopy(reason, item = {}) {
  const cleaned = sanitizeRecommendationCopy(reason);
  if (cleaned) return cleaned;
  if (item?.surprise || item?.ai?.kind === "curveball") {
    return "A deliberate curveball to test the edges of what fits your taste.";
  }
  return "A recommendation based on the patterns in what you’ve loved, liked, and disliked so far.";
}
