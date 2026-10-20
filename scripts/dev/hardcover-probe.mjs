#!/usr/bin/env node
// #249: check Hardcover's real API against what the research report assumed, before building on it.
// Free: no Anthropic call. It makes about 8 Hardcover requests (the free plan allows 60 a minute and 5,000 a
// day). Report: reports/Hardcover as book metadata source.md (local, git-excluded).
//
//   HARDCOVER_TOKEN=... node scripts/dev/hardcover-probe.mjs      # needs a read-only `read:catalog` token
//   node scripts/dev/hardcover-probe.mjs --self-test              # no network: checks the romance rule
//
// The token comes from hardcover.app/account/api (create it with only `read:catalog`). It is read from the
// environment and never printed. Nothing here is wired into the product.

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const TITLES = ["Fourth Wing", "The Night Circus", "Piranesi", "Circe", "The Hero of Ages", "The Lies of Locke Lamora"];

// Romance subgenres that, together with enough "Romance" votes, mark romance as central.
const ROMANCE_SUB = /^(romantasy|fantasy romance|romantic fantasy|paranormal romance|contemporary romance|historical romance|dark romance|romantic suspense)$/i;

// The three-state rule from the report (thresholds to tune against more books before shipping):
//   central  Romance >= 10 votes and a romance subgenre >= 3
//   minor    Romance >= 3 votes
//   absent   enough votes overall (top genre >= 5) and no Romance
//   unknown  too few votes to judge
export function romanceRole(cachedTags) {
  const genres = cachedTags?.Genre ?? [];
  const top = Math.max(0, ...genres.map((g) => g.count ?? 0));
  if (top < 5) return "unknown";
  const romance = genres.find((g) => /^romance$/i.test(g.tag))?.count ?? 0;
  const sub = Math.max(0, ...genres.filter((g) => ROMANCE_SUB.test(g.tag)).map((g) => g.count ?? 0));
  if (romance >= 10 && sub >= 3) return "central";
  if (romance >= 3) return "minor";
  return "absent";
}

function selfTest() {
  // Genre vote counts observed on public book pages, Oct 20 (see the report).
  const cases = [
    ["Fourth Wing", { Genre: [{ tag: "Fantasy", count: 42 }, { tag: "Romance", count: 18 }, { tag: "Romantasy", count: 17 }] }, "central"],
    ["The Night Circus", { Genre: [{ tag: "Fantasy", count: 14 }, { tag: "Romance", count: 7 }] }, "minor"],
    ["Piranesi", { Genre: [{ tag: "Fantasy", count: 25 }, { tag: "Mystery", count: 11 }] }, "absent"],
    ["A sparse book", { Genre: [{ tag: "Fiction", count: 2 }, { tag: "Romance", count: 1 }] }, "unknown"]
  ];
  let failed = 0;
  for (const [title, tags, want] of cases) {
    const got = romanceRole(tags);
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} ${title}: ${got}${got === want ? "" : ` (wanted ${want})`}`);
  }
  process.exit(failed ? 1 : 0);
}

async function hardcover(query, variables, token) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": "Tastemake probe (https://tastemake.vercel.app)" },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.data;
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const token = process.env.HARDCOVER_TOKEN;
  if (!token) {
    console.error("Set HARDCOVER_TOKEN to a read-only (read:catalog) token from hardcover.app/account/api. It is never printed.");
    process.exit(2);
  }

  // 1. Do the fields the report relies on exist?
  const schema = await hardcover(`{ __type(name: "books") { fields { name } } }`, {}, token);
  const fields = new Set((schema?.__type?.fields ?? []).map((f) => f.name));
  for (const name of ["cached_tags", "featured_book_series", "alternative_titles", "users_count", "editions"]) {
    console.log(`${fields.has(name) ? "has    " : "MISSING"} books.${name}`);
  }

  // 2. The six test books: tag counts, the romance rule, series position.
  const query = `query($title: String!) { books(where: { title: { _eq: $title } }, order_by: { users_count: desc }, limit: 1) {
    id title users_count cached_tags featured_book_series { position series { name primary_books_count } } } }`;
  for (const title of TITLES) {
    const book = (await hardcover(query, { title }, token))?.books?.[0];
    if (!book) { console.log(`\n${title}: not found by exact title`); continue; }
    const genres = (book.cached_tags?.Genre ?? []).slice(0, 6).map((g) => `${g.tag} ${g.count}`).join(", ");
    const series = book.featured_book_series;
    console.log(`\n${book.title} (id ${book.id}, ${book.users_count} readers)`);
    console.log(`  genres: ${genres || "none"}`);
    console.log(`  romance: ${romanceRole(book.cached_tags)}`);
    console.log(`  series: ${series?.series ? `${series.series.name} #${series.position} of ${series.series.primary_books_count}` : "none"}`);
  }
}

main().catch((error) => { console.error(String(error?.message ?? error)); process.exit(1); });
