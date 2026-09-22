// One registry for taste domains and item types (#35). Everything that lists areas or kinds of things
// (area toggles, filters, search's "add something", coverage counts) reads from here, so adding a domain
// is one entry, not a hunt through model and screen files.
//
// `visible: false` domains are architecture only: the data model can represent them (items, evidence,
// hypothesis scope) but the product does not show or recommend them yet. Do not ship them from here.
//
// Terms:
//   domain       broad grouping ("watch", later "home")
//   type         what kind of thing inside a domain ("movie", later "furniture")
//   displayLabel how an item describes itself on a card ("Book + film"); optional, defaults to the type label
// A few words per domain are kept for later UI copy (an experience is "watched" vs "worn" vs "lived with");
// internal evidence semantics never depend on them (see src/model/evidence.js).

export const DOMAINS = [
  { id: "watch", label: "Watch", about: "Movies and TV", visible: true, experienced: "watched" },
  { id: "read", label: "Read", about: "Books", visible: true, experienced: "read" },
  { id: "play", label: "Play", about: "Games", visible: true, experienced: "played" },
  // future (not shown, not recommended)
  { id: "listen", label: "Listen", about: "Music and audio", visible: false, experienced: "listened to" },
  { id: "wear", label: "Wear", about: "Clothing and style", visible: false, experienced: "worn" },
  { id: "home", label: "Home", about: "Interiors and objects for home", visible: false, experienced: "lived with" },
  { id: "art", label: "Art / Design", about: "Art, design and images", visible: false, experienced: "seen" },
  { id: "visit", label: "See / Visit", about: "Places and spaces", visible: false, experienced: "visited" }
];

export const TYPES = [
  { id: "movie", label: "Movie", domain: "watch", addable: true },
  { id: "tv", label: "TV", domain: "watch", addable: true },
  { id: "book", label: "Book", domain: "read", addable: true },
  { id: "game", label: "Game", domain: "play", addable: true },
  // future
  { id: "album", label: "Album", domain: "listen" },
  { id: "garment", label: "Clothing", domain: "wear" },
  { id: "furniture", label: "Furniture", domain: "home" },
  { id: "artwork", label: "Artwork", domain: "art" },
  { id: "place", label: "Place", domain: "visit" }
];

export const visibleDomains = () => DOMAINS.filter((domain) => domain.visible);
export const domainById = (id) => DOMAINS.find((domain) => domain.id === id) ?? null;
export const typeById = (id) => TYPES.find((type) => type.id === id) ?? null;
// Types a user can add by hand today (only in visible domains).
export const addableTypes = () => TYPES.filter((type) => type.addable && domainById(type.domain)?.visible);

// How an item names itself on a card. Old items may still carry `medium`, which is display-only.
export function displayLabel(item) {
  return item?.displayLabel ?? item?.medium ?? typeById(item?.type)?.label ?? "";
}

// The domains an item belongs to: explicit `domains`, else its type's domain.
export function domainsOf(item) {
  if (item?.domains?.length) return item.domains;
  const type = typeById(item?.type);
  return type ? [type.domain] : [];
}

// "All" plus every visible domain, for filter chips.
export const domainFilterOptions = () => [{ id: "all", label: "All" }, ...visibleDomains().map(({ id, label }) => ({ id, label }))];
