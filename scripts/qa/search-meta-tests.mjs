#!/usr/bin/env node
// Review #15/#17: same-title search results carry year and creator; the display name is optional. Free, no network.
import { readFileSync } from "node:fs";

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
const { itemMeta } = await import("../../src/data/domains.js");

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

const search = readFileSync(new URL("../../src/components/search.js", import.meta.url), "utf8");
check("result list uses itemMeta (year shown)", search.includes("esc(itemMeta(item))"));
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
