const MOVIE_GENRES = [
  { id: "drama", label: "Drama", provider: { kind: "genre", movie: 18 } },
  { id: "comedy", label: "Comedy", provider: { kind: "genre", movie: 35 } },
  { id: "horror", label: "Horror", provider: { kind: "genre", movie: 27 } },
  { id: "sci-fi", label: "Sci-fi", provider: { kind: "genre", movie: 878 } },
  { id: "fantasy", label: "Fantasy", provider: { kind: "genre", movie: 14 } },
  { id: "thriller", label: "Thriller", provider: { kind: "genre", movie: 53 } },
  { id: "documentary", label: "Documentary", provider: { kind: "genre", movie: 99 } },
  { id: "animation", label: "Animation", provider: { kind: "genre", movie: 16 } }
];

// TMDb does not expose dedicated Horror or Thriller TV genre ids. Treating both as Mystery
// made the two Browse filters identical and admitted crime procedurals such as Law & Order.
// Resolve those two labels through TMDb keywords instead; the remaining TV filters use the
// provider's real TV genre taxonomy.
const TV_GENRES = [
  { id: "drama", label: "Drama", provider: { kind: "genre", tv: 18 } },
  { id: "comedy", label: "Comedy", provider: { kind: "genre", tv: 35 } },
  { id: "horror", label: "Horror", provider: { kind: "keyword", value: "horror" } },
  { id: "sci-fi", label: "Sci-fi", provider: { kind: "genre", tv: 10765 } },
  { id: "fantasy", label: "Fantasy", provider: { kind: "genre", tv: 10765 } },
  { id: "thriller", label: "Thriller", provider: { kind: "keyword", value: "thriller" } },
  { id: "documentary", label: "Documentary", provider: { kind: "genre", tv: 99 } },
  { id: "animation", label: "Animation", provider: { kind: "genre", tv: 16 } }
];

export const BROWSE_GENRES = {
  movies: MOVIE_GENRES,
  tv: TV_GENRES,
  read: [
    { id: "fantasy", label: "Fantasy", provider: { kind: "subject", value: "fantasy" } },
    { id: "sci-fi", label: "Sci-fi", provider: { kind: "subject", value: "science_fiction" } },
    { id: "mystery-thriller", label: "Mystery / Thriller", provider: { kind: "subject", value: "mystery_and_detective_stories" } },
    { id: "horror", label: "Horror", provider: { kind: "subject", value: "horror" } },
    { id: "literary-fiction", label: "Literary fiction", provider: { kind: "subject", value: "literary_fiction" } },
    { id: "historical-fiction", label: "Historical fiction", provider: { kind: "subject", value: "historical_fiction" } },
    { id: "romance", label: "Romance", provider: { kind: "subject", value: "romance" } },
    { id: "memoir-nonfiction", label: "Memoir / nonfiction", provider: { kind: "subject", value: "biography" } }
  ],
  play: [
    { id: "action-adventure", label: "Action / Adventure", provider: { kind: "genre", value: 31 } },
    { id: "rpg", label: "RPG", provider: { kind: "genre", value: 12 } },
    { id: "horror", label: "Horror", provider: { kind: "theme", value: 19 } },
    { id: "puzzle", label: "Puzzle", provider: { kind: "genre", value: 9 } },
    { id: "narrative", label: "Narrative", provider: { kind: "search", value: "narrative" } },
    { id: "strategy", label: "Strategy", provider: { kind: "genre", value: 15 } },
    { id: "cozy", label: "Cozy", provider: { kind: "where", value: "genres = (13, 32) | themes = (35)" } },
    { id: "indie", label: "Indie", provider: { kind: "genre", value: 32 } }
  ]
};

export const BROWSE_DOMAINS = [
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV" },
  { id: "read", label: "Books" },
  { id: "play", label: "Games" }
];

export function browseGenresFor(domain) {
  return BROWSE_GENRES[domain] ?? [];
}

export function browseGenreById(domain, genreId) {
  return browseGenresFor(domain).find((genre) => genre.id === genreId) ?? null;
}

export function firstBrowseGenre(domain) {
  return browseGenresFor(domain)[0]?.id ?? null;
}
