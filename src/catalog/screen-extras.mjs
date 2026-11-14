// TMDb rows that are not films or shows anyone means when they ask for a pick: theatrical events, concert
// specials and making-of extras sold alongside a real title. Nov 13 live check: "Game of Thrones The IMAX
// Experience" came back as a recommendation. The screen counterpart of book-companions.mjs.
//
// Works on a raw TMDb row (title for movies, name for TV). A search that asks for one ("game of thrones
// imax") still gets it.

const EXTRA_TITLE = /\b(?:the imax experience|imax experience|live in concert|behind the scenes|the making of|making of|featurette|deleted scenes)\b/i;
const ASKED = /\b(?:imax|concert|behind the scenes|making of|featurette|deleted scenes)\b/i;

export function isScreenExtra(row, query = "") {
  const title = String(row?.title ?? row?.name ?? "");
  return EXTRA_TITLE.test(title) && !ASKED.test(String(query));
}
