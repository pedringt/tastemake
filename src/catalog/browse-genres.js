export const BROWSE_GENRES = {
  watch: [
    { id: "drama", label: "Drama", provider: { kind: "genre", value: 18 } },
    { id: "comedy", label: "Comedy", provider: { kind: "genre", value: 35 } },
    { id: "horror", label: "Horror", provider: { kind: "genre", value: 27 } },
    { id: "sci-fi", label: "Sci-fi", provider: { kind: "genre", value: 878 } },
    { id: "fantasy", label: "Fantasy", provider: { kind: "genre", value: 14 } },
    { id: "thriller", label: "Thriller", provider: { kind: "genre", value: 53 } },
    { id: "documentary", label: "Documentary", provider: { kind: "genre", value: 99 } },
    { id: "animation", label: "Animation", provider: { kind: "genre", value: 16 } }
  ],
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
  { id: "watch", label: "Watch" },
  { id: "read", label: "Read" },
  { id: "play", label: "Play" }
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
