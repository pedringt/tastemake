// Oct 27: moved out of related.mjs unchanged, so browser code (bridges.mjs) can read a book's genre
// families without loading the server-side catalog modules. Dependency-free.

// Genre families a subject points to. A book's family set is what "the same kind of book" means for
// retrieval: a candidate must share one with the book it came from (when that book has any).
const BOOK_GENRE_FAMILIES = [
  ["fantasy", /\b(?:fantasy|fantastic|magic|magicians?|wizards?|witch(?:es|craft)?|dragons?|elves|fairies|fairy tales?|mytholog(?:y|ical)|myths?|sword and sorcery|romantasy)\b/i],
  ["science fiction", /\b(?:science fiction|sci-?fi|space opera|dystopi(?:a|an|as)|cyberpunk|time travel|robots?|extraterrestrial|interplanetary|aliens?)\b/i],
  ["horror", /\b(?:horror|ghosts?|ghost stories|vampires?|haunted|gothic|supernatural|monsters?|zombies?|demons?|exorcism)\b/i],
  ["mystery", /\b(?:mystery|mysteries|detective|whodunit|private investigators?)\b/i],
  ["thriller", /\b(?:thrillers?|suspense|espionage|spy stories)\b/i],
  ["crime", /\b(?:crime|murder|criminals?|heists?|swindlers?|gangsters?)\b/i],
  ["romance", /\b(?:romance|romantic|love stories)\b/i],
  ["historical", /\b(?:historical|history)\b/i],
  ["literary", /\bliterary\b/i],
  ["humor", /\b(?:humou?r|humorous|comedy|satire)\b/i],
  ["adventure", /\b(?:adventure|quests?|voyages)\b/i],
  ["war", /\b(?:war stories|military|soldiers?)\b/i]
];

export function bookGenreFamilies(subjects = []) {
  const families = new Set();
  for (const subject of subjects) {
    const value = String(subject ?? "").replace(/^genre\s*:\s*/i, "");
    for (const [family, re] of BOOK_GENRE_FAMILIES) if (re.test(value)) families.add(family);
  }
  return families;
}
