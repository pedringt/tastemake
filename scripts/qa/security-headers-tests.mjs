#!/usr/bin/env node
// Security headers in vercel.json (Oct 27). Free, no browser, no network.
//
//   node scripts/qa/security-headers-tests.mjs
//
// Checks:
// 1. vercel.json is valid JSON, keeps its rewrites and functions, and sends every security header on
//    every path ("/(.*)").
// 2. The CSP's 'sha256-...' source matches index.html's one inline <script> (the look-before-paint
//    snippet). Edit that script and this fails until the hash in vercel.json is updated.
// 3. Every external https origin the front end references for styles, fonts and images is allowed by
//    the matching CSP directive.
//
// Limits of the static scan in check 3 (read before trusting a green run):
// - It reads literal "https://host" strings in index.html, src/ and styles/. Origins that only arrive
//   at runtime in API data are invisible to it. Google Books thumbnails are one: the host comes from
//   the Google Books response (books.google.com), so it is pinned in RUNTIME_IMAGE_ORIGINS below.
// - Redirect targets are invisible too. covers.openlibrary.org 302s to archive.org and then to
//   iaNNNNN.us.archive.org (checked with curl on Oct 27), so those are pinned in RUNTIME_IMAGE_ORIGINS.
// - Image origins are found by keyword: a URL on a line that mentions artwork, img, image(s), cover(s),
//   poster, thumbnail or a *_IMAGE constant, or whose path ends in an image extension. An image URL
//   built on a line with none of those words would be missed.
// - src/ also holds server-only modules (provider API calls). Those API hosts (api.themoviedb.org,
//   openlibrary.org, ...) are fetched by api/*, not the browser, so they are not required in
//   connect-src. Browser fetches are checked separately: every fetch() in the browser client files
//   must target a same-origin "/api/..." path.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuite } from "./lib/assert.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { check, eq, finish } = createSuite("security headers tests");

// ---- 1. vercel.json shape and headers ------------------------------------------------------------
let config = null;
try { config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")); } catch (error) { check("vercel.json parses", false, error.message); }
check("vercel.json parses", Boolean(config));
check("rewrites are still there", Array.isArray(config?.rewrites) && config.rewrites.length > 0 && config.rewrites.every((r) => r.destination === "/index.html"));
check("functions are still there", Boolean(config?.functions?.["api/recommendations.mjs"]?.maxDuration));

const rule = (config?.headers ?? []).find((h) => h.source === "/(.*)");
check("a headers rule covers every path", Boolean(rule));
const headers = Object.fromEntries((rule?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]));

eq("X-Content-Type-Options", headers["x-content-type-options"], "nosniff");
eq("Referrer-Policy", headers["referrer-policy"], "strict-origin-when-cross-origin");
eq("Permissions-Policy", headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
eq("X-Frame-Options", headers["x-frame-options"], "DENY");

const cspText = headers["content-security-policy-report-only"] ?? headers["content-security-policy"] ?? "";
check("a Content-Security-Policy is sent", cspText.length > 0);
check("CSP starts in Report-Only mode", Boolean(headers["content-security-policy-report-only"]) && !headers["content-security-policy"]);

const csp = new Map();
for (const part of cspText.split(";")) {
  const [name, ...sources] = part.trim().split(/\s+/);
  if (name) csp.set(name.toLowerCase(), sources);
}
const has = (directive, source) => (csp.get(directive) ?? []).includes(source);

for (const [directive, source] of [
  ["default-src", "'self'"],
  ["script-src", "'self'"],
  ["style-src", "'self'"],
  ["style-src", "https://fonts.googleapis.com"],
  ["style-src-attr", "'unsafe-inline'"],
  ["font-src", "https://fonts.gstatic.com"],
  ["img-src", "'self'"],
  ["img-src", "data:"],
  ["connect-src", "'self'"],
  ["frame-ancestors", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["object-src", "'none'"]
]) {
  check(`CSP ${directive} allows ${source}`, has(directive, source), (csp.get(directive) ?? []).join(" "));
}
check("script-src has no 'unsafe-inline' or 'unsafe-eval'", !has("script-src", "'unsafe-inline'") && !has("script-src", "'unsafe-eval'"));
check("style-src (elements) has no 'unsafe-inline'", !has("style-src", "'unsafe-inline'"));
eq("connect-src is same-origin only", (csp.get("connect-src") ?? []).join(" "), "'self'");

// ---- 2. inline script hash -----------------------------------------------------------------------
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
const inlineScripts = [...indexHtml.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/i.test(m[1] ?? ""))
  .map((m) => m[2]);
eq("index.html has exactly one inline script", inlineScripts.length, 1);
const scriptHashes = (csp.get("script-src") ?? []).filter((s) => s.startsWith("'sha256-"));
eq("script-src carries exactly one hash", scriptHashes.length, 1);
if (inlineScripts.length) {
  const want = `'sha256-${createHash("sha256").update(inlineScripts[0], "utf8").digest("base64")}'`;
  eq("CSP hash matches index.html's inline script (update vercel.json if you edited it)", scriptHashes[0], want);
}
check("index.html has no inline event handlers", !/<[^>]+\son[a-z]+\s*=/i.test(indexHtml));

// ---- 3. external origins vs directives -----------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(m?js|css|html|json)$/.test(name)) out.push(path);
  }
  return out;
}
const files = [join(ROOT, "index.html"), ...walk(join(ROOT, "src")), ...walk(join(ROOT, "styles"))];

const RUNTIME_IMAGE_ORIGINS = [
  "https://books.google.com", // Google Books volumeInfo.imageLinks.thumbnail (http rewritten to https)
  "https://archive.org", // covers.openlibrary.org redirect, hop 1
  "https://*.us.archive.org" // covers.openlibrary.org redirect, hop 2 (iaNNNNNN.us.archive.org)
];

const IMAGE_LINE = /\bartwork\b|<img\b|\bimg\b|\bimages?\b|_IMAGE\b|\bcovers?\b|\bposter|\bthumbnail|url\(/i;
const IMAGE_PATH = /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i;
const URL_RE = /https:\/\/[a-z0-9.-]+(?:\.[a-z]{2,})[^\s"'`)<>]*/gi;

const found = { style: new Set(), font: new Set(), img: new Set() };
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(URL_RE)) {
      const url = match[0];
      const origin = new URL(url).origin;
      const where = `${rel}:${i + 1}`;
      if (rel === "index.html" && /<link[^>]+rel="stylesheet"/.test(line)) found.style.add([origin, where]);
      else if (rel.startsWith("styles/") && /@import/.test(line)) found.style.add([origin, where]);
      else if (rel.startsWith("styles/") && /url\(/.test(line) && /\.(woff2?|ttf|otf)/i.test(url)) found.font.add([origin, where]);
      else if (/fonts\.gstatic\.com/.test(origin)) found.font.add([origin, where]);
      else if (IMAGE_LINE.test(line) || IMAGE_PATH.test(new URL(url).pathname)) found.img.add([origin, where]);
    }
  });
}

function allows(directive, origin) {
  return (csp.get(directive) ?? []).some((source) => {
    if (source === origin) return true;
    const wild = /^https:\/\/\*\.(.+)$/.exec(source);
    return Boolean(wild) && origin.startsWith("https://") && origin.slice(8).endsWith(`.${wild[1]}`);
  });
}

// Guard against the scan silently finding nothing (e.g. a regex break): the known hosts must show up.
const imgOrigins = new Set([...found.img].map(([o]) => o));
for (const known of ["https://image.tmdb.org", "https://images.igdb.com", "https://covers.openlibrary.org"]) {
  check(`scan finds image origin ${known}`, imgOrigins.has(known));
}
check("scan finds the Google Fonts stylesheet", [...found.style].some(([o]) => o === "https://fonts.googleapis.com"));
check("scan finds the Google Fonts font host", [...found.font].some(([o]) => o === "https://fonts.gstatic.com"));

for (const [kind, directive] of [["style", "style-src"], ["font", "font-src"], ["img", "img-src"]]) {
  const seen = new Set();
  for (const [origin, where] of found[kind]) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    check(`${directive} allows ${origin} (first seen ${where})`, allows(directive, origin));
  }
}
for (const origin of RUNTIME_IMAGE_ORIGINS) {
  check(`img-src allows runtime image origin ${origin}`, has("img-src", origin));
}
check("wildcard matcher sanity: ia902809.us.archive.org is covered", allows("img-src", "https://ia902809.us.archive.org"));

// Browser-side fetches must stay same-origin, since connect-src is 'self' only.
const BROWSER_FETCH_FILES = [
  "src/catalog/client.js",
  "src/catalog/browse-client.js",
  "src/catalog/similar-client.js",
  "src/ai/live-client.js",
  "src/ai/hypothesis-profile.js",
  "src/ai/prefetch.js"
];
for (const rel of BROWSER_FETCH_FILES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  check(`${rel} references no external https origin`, !/https?:\/\/(?!localhost)/.test(text));
}

finish();
