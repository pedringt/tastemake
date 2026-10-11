#!/usr/bin/env node
// Review #15/#17: same-title search results carry year and creator (plus a synopsis hint for look-alikes);
// the display name is optional. Free, no network.
import { readFileSync } from "node:fs";

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
const { itemMeta } = await import("../../src/data/domains.js");
const { lookAlikeHints } = await import("../../src/model/search.js");

let passed = 0;
const failures = [];
const eq = (name, got, want) => { if (got === want) passed += 1; else failures.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
const check = (name, ok) => { if (ok) passed += 1; else failures.push(name); };

const a = { type: "movie", year: 1982, by: "Ridley Scott" };
const b = { type: "movie", year: 2017, by: "Denis Villeneuve" };
eq("film gets type, year and director", itemMeta(a), "Movie · 1982 · Ridley Scott");
check("two same-title films read differently", itemMeta(a) !== itemMeta(b));
eq("year-less item still reads cleanly", itemMeta({ type: "movie", by: "X" }), "Movie · X");
eq("creator-less item keeps the year", itemMeta({ type: "movie", year: 1999 }), "Movie · 1999");
eq("the sheet can leave the creator off", itemMeta(a, { withBy: false }), "Movie · 1982");
eq("empty item yields an empty string, not a stray separator", itemMeta({}), "");

// Look-alikes: the same-title rows TMDb really returned for "Arrival" (production /api/catalog, Oct 10),
// trimmed to the fields the result list reads. TMDb search rows carry no director.
const arrival = [
  { id: "tmdb-movie-329865", title: "Arrival", type: "movie", year: "2016", about: "Taking place after alien crafts land around the world, an expert linguist is recruited by the military to determine whether they come in peace or are a threat." },
  { id: "openlibrary-book-OL27774W", title: "The Arrival", type: "book", year: "2000", by: "Katherine Applegate", about: "First published 2000." },
  { id: "tmdb-movie-10547", title: "The Arrival", type: "movie", year: "1996", about: "Zane Ziminski is an astrophysicist who receives a message that seems to have extraterrestrial origins." },
  { id: "tmdb-movie-1738637", title: "Arrival", type: "movie", year: "2026", about: "After arriving in Aotearoa as refugees, a mother and daughter find their roles upended." },
  { id: "tmdb-movie-472349", title: "Arrival", type: "movie", year: "2016", about: "This traditionally animated film tells the journey of how a young boy's personal discovery affects the long-distance relationship he keeps with his mother." },
  { id: "tmdb-movie-1520078", title: "Arrival", type: "movie", year: "2025", about: "A man sees warnings about an ongoing alien invasion while he is heating up his TV dinner." },
  { id: "tmdb-movie-1453473", title: "arrival", type: "movie", year: "2025", about: "A psychological sci-fi drama about love, identity, and the unknown." },
  { id: "tmdb-movie-696430", title: "Arrival", type: "movie", year: "2018", about: "After an alien escapes from a government facility, a town is sent into chaos trying to capture it." },
  { id: "igdb-game-256831", title: "Arrival", type: "game", year: "2021", about: "9 + 1 (+ 1?) limit-removing levels for Doom II." },
  { id: "tmdb-movie-1567483", title: "The Arrival", type: "movie", year: null, about: "As two long-lost blood brothers grow closer, seduced by the idea of their shared history finally making sense." },
  { id: "igdb-game-73566", title: "The Arrival", type: "game", year: "1997", about: "You've been abducted. You're in a cold, steel room." }
];
const hints = lookAlikeHints(arrival);
const visible = (item) => `${item.title.toLowerCase()} | ${itemMeta(item)} | ${hints.get(item.id) ?? ""}`;
check("every Arrival row reads differently once hints are added", new Set(arrival.map(visible)).size === arrival.length);
check("the two 'Movie · 2016' Arrivals both get a hint", hints.has("tmdb-movie-329865") && hints.has("tmdb-movie-472349"));
check("'Arrival' and 'arrival' (2025) count as the same title", hints.has("tmdb-movie-1520078") && hints.has("tmdb-movie-1453473"));
check("a same-title movie with no year and no creator gets a hint", hints.has("tmdb-movie-1567483"));
check("rows already told apart by year/creator get no hint", ["tmdb-movie-1738637", "tmdb-movie-696430", "tmdb-movie-10547", "openlibrary-book-OL27774W", "igdb-game-73566"].every((id) => !hints.has(id)));
check("hints are short excerpts, not whole synopses", [...hints.values()].every((hint) => hint.length <= 81));
eq("a long synopsis is cut at a word with an ellipsis", hints.get("tmdb-movie-329865"), "Taking place after alien crafts land around the world, an expert linguist is…");
check("a unique title never gets a hint, even with no year", lookAlikeHints([{ id: "x", title: "Solo", type: "movie", about: "Something." }]).size === 0);
check("a provider placeholder synopsis is not used as a hint", lookAlikeHints([
  { id: "a", title: "Twin", type: "movie", year: "2001", about: "No description available." },
  { id: "b", title: "Twin", type: "movie", year: "2001", about: "No description available." }
]).size === 0);
check("a flagged synopsis is replaced by the safe fallback in the hint", !/molest/i.test(lookAlikeHints([
  { id: "a", title: "Twin", type: "movie", year: "2001", genres: ["18"], about: "A man is accused of molesting a neighbour." },
  { id: "b", title: "Twin", type: "movie", year: "2001", about: "Two brothers run a bakery." }
]).get("a") ?? ""));

const search = readFileSync(new URL("../../src/components/search.js", import.meta.url), "utf8");
check("result list uses itemMeta (year shown)", search.includes("esc(itemMeta(item))"));
check("result list renders look-alike hints", search.includes("lookAlikeHints(hits)") && search.includes("search-result-hint"));
check("detail sheet uses itemMeta (year shown)", search.includes('search-sheet-meta">${esc(itemMeta(item))}'));

const setup = readFileSync(new URL("../../src/screens/setup.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");
check("setup Next button is not gated on the display name", !/setup-done"[^>]*disabled/.test(setup) && !setup.includes('state.displayName.trim() ? "" : "disabled"'));
check("setup labels the display name optional", setup.includes("Display name (optional)"));
check("finishSetup no longer blocks on an empty name", !app.includes("Add your name to continue."));
check("typing a name no longer toggles the Next button", !/setupName\.value\.trim\(\)/.test(app));

if (failures.length) {
  console.error(`search-meta tests: ${failures.length} failed\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log(`search-meta tests: ${passed} passed, 0 failed`);
