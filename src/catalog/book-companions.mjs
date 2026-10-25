// Open Library records that are not books anyone means when they search or ask for a pick: study guides
// and summaries sold alongside a real book, and government documents. Oct 20 smoke test: searching "The
// Name of the Wind" showed "Study Guide -- The Other Wes Moore" (SuperSummary) and a Canadian legislature
// "Bill" above real books, both lifted by hundreds of catalogued editions. Oct 24 deep test: "Ascendance of a
// Bookworm: Fanbook 3" came back as a book pick, so fan books, art books and official guides count too.
//
// Works on a raw Open Library row (title, author_name). A search that asks for one ("name of the wind
// study guide") still gets it.

const COMPANION_TITLE = /\b(?:study guide|summary (?:of|and analysis)|analysis of|sparknotes|cliffs ?notes|reading guide|workbook for|trivia|quiz book|fan ?books?|art ?books?|official (?:guide|companion|handbook)|companion (?:guide|book)|colou?ring book)\b/i;
const COMPANION_PUBLISHER = /^(?:supersummary|bookrags|sparknotes|cliffsnotes|instaread|shmoop|bookcaps|book caps|readtrepreneur|quickread|gradesaver|worth books|kidpub)\b/i;
const GOVERNMENT_AUTHOR = /\b(?:legislature|legislative assembly|parliament|congress\.|general assembly|house of commons)\b/i;

export function isBookCompanion(row, query = "") {
  const title = String(row?.title ?? "");
  const authors = [].concat(row?.author_name ?? []).map(String);
  const asked = COMPANION_TITLE.test(String(query)) || /\b(?:summary|guide|notes)\b/i.test(String(query));
  if (!asked && (COMPANION_TITLE.test(title) || authors.some((a) => COMPANION_PUBLISHER.test(a.trim())))) return true;
  return authors.length > 0 && authors.every((a) => GOVERNMENT_AUTHOR.test(a));
}
