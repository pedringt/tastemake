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

// TMDb's TV taxonomy combines Sci-Fi & Fantasy and has no dedicated Horror or Thriller genres.
// Use keyword discovery for those user-facing distinctions instead of exposing duplicate/misleading filters.
const TV_GENRES = [
  { id: "drama", label: "Drama", provider: { kind: "genre", tv: 18 } },
  { id: "comedy", label: "Comedy", provider: { kind: "genre", tv: 35 } },
  { id: "horror", label: "Horror", provider: { kind: "keyword", value: "horror" } },
  { id: "sci-fi", label: "Sci-fi", provider: { kind: "keyword", value: "science fiction" } },
  { id: "fantasy", label: "Fantasy", provider: { kind: "keyword", value: "fantasy" } },
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
    { id: "action-adventure", label: "Action / Adventure", provider: { kind: "metadata", genres: ["Adventure"], themes: ["Action"] } },
    { id: "rpg", label: "RPG", provider: { kind: "metadata", genres: ["Role-playing (RPG)"] } },
    { id: "horror", label: "Horror", provider: { kind: "metadata", themes: ["Horror"] } },
    { id: "puzzle", label: "Puzzle", provider: { kind: "metadata", genres: ["Puzzle"] } },
    { id: "narrative", label: "Narrative", provider: { kind: "metadata", genres: ["Visual Novel", "Point-and-click"], themes: ["Drama", "Mystery", "Romance"] } },
    { id: "strategy", label: "Strategy", provider: { kind: "metadata", genres: ["Strategy", "Real Time Strategy (RTS)", "Turn-based strategy (TBS)", "Tactical"] } },
    { id: "cozy", label: "Cozy", provider: { kind: "metadata", genres: ["Simulator"], themes: ["Kids", "Sandbox", "Comedy", "Romance"], excludeThemes: ["Action", "Horror", "Thriller", "Survival", "Warfare"] } },
    { id: "indie", label: "Indie", provider: { kind: "metadata", genres: ["Indie"] } }
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
