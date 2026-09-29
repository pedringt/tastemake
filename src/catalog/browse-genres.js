// Movie and TV genre chips share TMDb's genre taxonomy (each entry carries both a movie and a tv
// genre id, one of which may be null where TMDb has no equivalent on that side), so both domains
// browse from the same WATCH_GENRES list -- only the discover query (browse.mjs) picks movie vs tv.
const WATCH_GENRES = [
  { id: "drama", label: "Drama", provider: { kind: "genre", movie: 18, tv: 18 } },
  { id: "comedy", label: "Comedy", provider: { kind: "genre", movie: 35, tv: 35 } },
  { id: "horror", label: "Horror", provider: { kind: "genre", movie: 27, tv: null } },
  { id: "sci-fi", label: "Sci-fi", provider: { kind: "genre", movie: 878, tv: 10765 } },
  { id: "fantasy", label: "Fantasy", provider: { kind: "genre", movie: 14, tv: 10765 } },
  { id: "thriller", label: "Thriller", provider: { kind: "genre", movie: 53, tv: null } },
  { id: "documentary", label: "Documentary", provider: { kind: "genre", movie: 99, tv: 99 } },
  { id: "animation", label: "Animation", provider: { kind: "genre", movie: 16, tv: 16 } }
];

export const BROWSE_GENRES = {
  movies: WATCH_GENRES,
  tv: WATCH_GENRES,
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
    { id: "cozy", label: "Cozy", provider: { kind: "search", value: "cozy" } },
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
