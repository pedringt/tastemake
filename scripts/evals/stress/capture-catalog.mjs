#!/usr/bin/env node
// #28 stress eval: capture a snapshot of REAL catalog items from production's free browse endpoint
// (GET https://tastemake.vercel.app/api/browse?domain=..&genre=..&page=..). No model call, no key, no
// writes anywhere but the snapshot file. Run once; the snapshot is committed so profile building is
// deterministic and offline from then on.
//
//   node scripts/evals/stress/capture-catalog.mjs              # writes catalog-snapshot.json
//   node scripts/evals/stress/capture-catalog.mjs --url <base>  # another deployment
//
// Items are kept in the shape production's wire carries for experienced items (src/ai/live-client.js,
// compactExperiencedItem) plus a short `about` (production trims it to 220 characters in the pick
// prompt). `_bucket` records which browse shelves an item came from; profiles.mjs strips it.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://tastemake.vercel.app").replace(/\/$/, "");

// domain:genre -> pages (12 items per page). Movies sci-fi is deep because the "narrow" profile at
// 100+ needs ~120 sci-fi films plus unseen candidates.
export const SHELVES = {
  "movies:sci-fi": 14, "movies:drama": 3, "movies:comedy": 3, "movies:horror": 6, "movies:thriller": 5,
  "movies:fantasy": 3, "movies:animation": 2, "movies:documentary": 1,
  "tv:drama": 3, "tv:comedy": 5, "tv:sci-fi": 3, "tv:fantasy": 2, "tv:thriller": 4, "tv:horror": 4,
  "tv:animation": 1, "tv:documentary": 1,
  "read:fantasy": 6, "read:sci-fi": 3, "read:mystery-thriller": 3, "read:literary-fiction": 3,
  "read:historical-fiction": 2, "read:horror": 4, "read:romance": 2, "read:memoir-nonfiction": 1,
  "play:rpg": 5, "play:puzzle": 3, "play:narrative": 3, "play:horror": 4, "play:strategy": 2,
  "play:cozy": 2, "play:indie": 3, "play:action-adventure": 3
};

function compact(item) {
  const meta = item.providerMeta ? { ...item.providerMeta } : null;
  if (meta) delete meta.isbns;
  return {
    id: item.id, provider: item.provider ?? null, providerId: item.providerId ?? null,
    title: item.title, type: item.type ?? null, domains: item.domains ?? [],
    by: item.by ?? null, year: item.year ?? null,
    genres: (item.genres ?? []).slice(0, 12),
    providerMeta: meta,
    about: typeof item.about === "string" ? item.about.slice(0, 220) : null
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byId = new Map();
for (const [shelf, pages] of Object.entries(SHELVES)) {
  const [domain, genre] = shelf.split(":");
  for (let page = 1; page <= pages; page += 1) {
    const url = `${base}/api/browse?domain=${domain}&genre=${genre}&page=${page}`;
    let payload = null;
    for (let attempt = 1; attempt <= 3 && !payload; attempt += 1) {
      const res = await fetch(url);
      if (res.ok) payload = await res.json();
      else await sleep(1500 * attempt);
    }
    const items = payload?.items ?? [];
    for (const raw of items) {
      if (!raw?.id || !raw.title) continue;
      const existing = byId.get(raw.id);
      if (existing) { if (!existing._bucket.includes(shelf)) existing._bucket.push(shelf); continue; }
      byId.set(raw.id, { ...compact(raw), _bucket: [shelf] });
    }
    console.log(`${shelf} page ${page}: ${items.length} items (total ${byId.size})`);
    if (!payload?.hasMore) break;
    await sleep(250);
  }
}

const out = join(here, "catalog-snapshot.json");
writeFileSync(out, JSON.stringify({ capturedFrom: `${base}/api/browse`, capturedAt: new Date().toISOString().slice(0, 10), shelves: SHELVES, items: [...byId.values()] }) + "\n");
console.log(`wrote ${byId.size} items to ${out}`);
