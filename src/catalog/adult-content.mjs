// #257 (decided Oct 20): a curveball may land on explicitly adult-tagged content only when the user's own
// tried items already include that kind of thing. Regular picks are unchanged; this is only about the one
// exploratory slot, which should stretch taste, not jump into explicit content nobody asked for.
//
// Deliberately a short list of explicit tags (provider genres/subjects, matched whole-word), not a guess
// from synopses: "Smut", "Erotica", "Erotic romance", "Sexually explicit". Broad words (romance, dark,
// mature, adult) are not on it. Browser-safe and dependency-free.

const ADULT_TAG = /\b(?:smut|erotica|erotic|sexually explicit|explicit sex(?:ual)?|bdsm)\b/i;

export function isAdultTagged(item) {
  return (item?.genres ?? []).some((value) => ADULT_TAG.test(String(value ?? "")));
}

// `records` are evidence records (src/model/evidence.js), whose facts.genres carry the item's genres.
export function triedAdultTagged(records = []) {
  return records.some((record) => record?.class === "experienced" && isAdultTagged({ genres: record.facts?.genres ?? record.genres }));
}
