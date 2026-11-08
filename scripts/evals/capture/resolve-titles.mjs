#!/usr/bin/env node
// #341 step 4: match each persona title to a catalog item (provider and id), through the public search
// route the app itself uses (GET /api/catalog), so no credentials or new routes are needed. One request
// per title, against a hard cap with no default: at the cap the run stops, and nothing is retried
// automatically. Matches are proposals: Paige confirms them before a persona is marked resolved.
//
//   node scripts/evals/capture/resolve-titles.mjs --max-requests 45 --out <file.json>
import { writeFileSync } from "node:fs";
import { PROFILES } from "./profiles.mjs";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const maxRequests = Number(arg("--max-requests"));
const out = arg("--out");
if (!Number.isInteger(maxRequests) || maxRequests < 1) { console.error("refused: --max-requests is required (no default)"); process.exit(2); }
if (!out) { console.error("refused: --out <file.json> is required"); process.exit(2); }

const BASE = "https://tastemake.vercel.app/api/catalog";
const DOMAIN = { movie: "movies", tv: "tv", book: "read", game: "play" };
// Year hints for titles with several candidates (remakes, adaptations, same-name works).
const YEAR = {
  "The Office": 2005, "Inside": 2016, "Saw": 2004, "The Witch": 2015, "Annihilation": 2018, "The Martian": 2015,
  "The Exorcist": 1973, "The Girl with the Dragon Tattoo": 2011, "Murder on the Orient Express": 1934, "Death in Paradise": 2011,
  "Annabelle": 2014, "Dredge": 2023, "Factorio": 2020, "Subnautica": 2018, "Knives Out": 2019, "Glass Onion": 2022,
  "Paddington 2": 2017, "The Conjuring 2": 2016, "Mindhunter": 2017, "The Haunting of Hill House": 2018
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let attempts = 0;
let stopped = null;
const results = [];
for (const profile of Object.values(PROFILES).filter((p) => p.titles)) {
  for (const t of profile.titles) {
    if (attempts >= maxRequests) { stopped = `request cap ${maxRequests} reached before "${t.title}"`; break; }
    attempts += 1;
    const url = `${BASE}?q=${encodeURIComponent(t.title)}&domain=${DOMAIN[t.type]}`;
    let items = [];
    let status = 0;
    try {
      const response = await fetch(url);
      status = response.status;
      items = response.ok ? (await response.json()).items ?? [] : [];
    } catch (error) {
      status = `error ${error?.name ?? "Error"}`;
    }
    const sameType = items.filter((item) => item.type === t.type);
    const titleMatch = sameType.filter((item) => norm(item.title) === norm(t.title));
    const pool = titleMatch.length ? titleMatch : sameType;
    const wanted = YEAR[t.title];
    const best = wanted ? [...pool].sort((a, b) => Math.abs(Number(a.year) - wanted) - Math.abs(Number(b.year) - wanted))[0] : pool[0];
    results.push({
      profile: profile.id, title: t.title, type: t.type, rating: t.rating, reasons: t.reasons, status,
      match: best ? { id: best.id, provider: best.provider, providerId: best.providerId, title: best.title, year: best.year, type: best.type } : null,
      exactTitle: Boolean(titleMatch.length), yearHint: wanted ?? null,
      alternatives: pool.filter((item) => item !== best).slice(0, 3).map((item) => `${item.title} (${item.year ?? "?"})`),
      item: best ?? null
    });
    await sleep(1100);
  }
  if (stopped) break;
}
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), maxRequests, attempts, stopped, results }, null, 2));
console.log(JSON.stringify({ maxRequests, attempts, stopped, matched: results.filter((r) => r.match).length, exactTitle: results.filter((r) => r.exactTitle).length, unmatched: results.filter((r) => !r.match).map((r) => r.title) }));
