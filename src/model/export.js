import { displayLabel } from "../data/domains.js";

export const BACKUP_VERSION = 1;

const SET_FIELDS = ["selectedFavorites", "libraryFavorites", "blindSpotDismissed", "setupAreas"];
const BACKUP_FIELDS = [
  "selectedFavorites", "feedbackByRecommendation", "recommendationSets", "recommendationExhausted",
  "libraryFavorites", "customItems", "blindSpots", "patternStatements", "blindSpotDismissed",
  "tastebreaks", "hypothesisHistory", "modelHypotheses", "profileView", "mapPattern", "mapItem",
  "mapFilter", "favoriteFilter", "recommendationFilter", "libraryFilter", "expandedFeedback",
  "areas", "curveball", "displayName", "setupAreas", "recommendationStyle", "setupComplete",
  "setupReturn", "onboarded", "libraryView", "look"
];

function plain(value) {
  return value instanceof Set ? [...value] : value;
}

export function buildBackup(state, generatedAt = new Date().toISOString()) {
  const snapshot = {};
  for (const field of BACKUP_FIELDS) snapshot[field] = plain(state[field]);
  return {
    product: "Tastemake",
    format: "tastemake-backup",
    version: BACKUP_VERSION,
    generatedAt,
    state: snapshot
  };
}

export function parseBackupText(text) {
  let parsed;
  try { parsed = JSON.parse(String(text || "")); }
  catch { throw new Error("That file is not valid JSON."); }
  if (!parsed || parsed.format !== "tastemake-backup") throw new Error("That is not a Tastemake backup.");
  if (parsed.version !== BACKUP_VERSION) throw new Error("That Tastemake backup version is not supported.");
  if (!parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) throw new Error("That backup is missing its Tastemake data.");

  const state = {};
  for (const field of BACKUP_FIELDS) {
    if (!(field in parsed.state)) continue;
    state[field] = SET_FIELDS.includes(field) && Array.isArray(parsed.state[field])
      ? new Set(parsed.state[field])
      : parsed.state[field];
  }
  return state;
}

function reactionKind(feedback) {
  if (!feedback) return "unknown";
  if (feedback.rating === "more" && feedback.detail === "loved-before") return "experienced-strong-positive";
  if (feedback.rating === "more" && feedback.detail === "liked-before") return "experienced-positive";
  if (feedback.rating === "less" && feedback.detail === "tried-disliked") return "experienced-negative";
  if (feedback.rating === "not-tried" && feedback.detail === "bookmarked") return "saved";
  if (feedback.rating === "less" && feedback.detail === "not-interested") return "intent-declined";
  if (feedback.rating === "more") return "intent-positive";
  if (feedback.rating === "less") return "intent-negative";
  return "unknown";
}

function isExperienced(feedback) {
  return ["experienced-strong-positive", "experienced-positive", "experienced-negative"].includes(reactionKind(feedback));
}

function isSaved(feedback) {
  return reactionKind(feedback) === "saved";
}

function reactionLabel(feedback) {
  const kind = reactionKind(feedback);
  return ({
    "experienced-strong-positive": "Loved",
    "experienced-positive": "Liked",
    "experienced-negative": "Didn't like",
    "saved": "Saved",
    "intent-declined": "Not interested",
    "intent-positive": "Want more",
    "intent-negative": "Less like this"
  })[kind] ?? "Recorded";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function itemRow(item, status = "") {
  const meta = [displayLabel(item), item?.year, item?.by].filter(Boolean).map(htmlEscape).join(" · ");
  return `<li><strong>${htmlEscape(item?.title || "Untitled")}</strong>${meta ? `<span>${meta}</span>` : ""}${status ? `<em>${htmlEscape(status)}</em>` : ""}</li>`;
}

function listSection(title, rows, emptyText) {
  return `<section><h2>${htmlEscape(title)}</h2>${rows.length ? `<ul class="items">${rows.join("")}</ul>` : `<p class="empty">${htmlEscape(emptyText)}</p>`}</section>`;
}

export function buildHtmlExport(state, generatedAt = new Date().toISOString()) {
  const feedback = Object.values(state.feedbackByRecommendation ?? {});
  const saved = feedback.filter(isSaved);
  const tried = feedback.filter(isExperienced);
  const favoriteIds = new Set([...(state.selectedFavorites ?? []), ...(state.libraryFavorites ?? [])]);
  const favorites = [];
  const seenFavorite = new Set();
  for (const id of favoriteIds) {
    const item = state.customItems?.[id] ?? state.feedbackByRecommendation?.[id]?.item
      ?? (state.recommendationSets ?? []).flat().find((candidate) => candidate?.id === id);
    if (item && !seenFavorite.has(item.id)) { favorites.push(item); seenFavorite.add(item.id); }
  }

  const correctedIds = new Set(
    (state.patternStatements ?? []).filter((entry) => entry?.says === "not-me").map((entry) => entry.hypothesisId)
  );
  const activePatterns = (state.modelHypotheses ?? []).filter((item) => !correctedIds.has(item.id));
  const correctedPatterns = (state.modelHypotheses ?? []).filter((item) => correctedIds.has(item.id));
  const exported = generatedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

  const patternHtml = activePatterns.length
    ? activePatterns.map((pattern) => `<article class="pattern"><h3>${htmlEscape(pattern.title || pattern.label || "Pattern")}</h3><p>${htmlEscape(pattern.claim || "")}</p><small>Status: ${htmlEscape(pattern.strength || pattern.level || "working pattern")}</small></article>`).join("")
    : '<p class="empty">No active patterns yet.</p>';

  const correctedHtml = correctedPatterns.length
    ? `<ul class="items">${correctedPatterns.map((pattern) => `<li><strong>${htmlEscape(pattern.title || pattern.label || "Pattern")}</strong><em>You said this isn’t you.</em></li>`).join("")}</ul>`
    : '<p class="empty">No corrected patterns.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Tastemake</title>
<style>
  :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111a4b;background:#fbfaf7}
  *{box-sizing:border-box} body{margin:0;padding:40px 20px} main{max-width:860px;margin:0 auto}
  header{padding-bottom:24px;border-bottom:3px solid #111a4b;margin-bottom:30px}
  h1{font-size:clamp(36px,7vw,68px);line-height:.95;margin:0 0 10px} h2{font-size:25px;margin:34px 0 14px} h3{margin:0 0 7px;font-size:18px}
  .meta,.empty,small{color:#6d7087} .meta{margin:0;font-size:13px}
  .items{list-style:none;margin:0;padding:0;display:grid;gap:9px}.items li,.pattern{padding:14px 16px;border:1.5px solid #111a4b;border-radius:12px;background:white}
  .items strong{display:block}.items span,.items em{display:block;margin-top:3px;font-size:13px;color:#6d7087;font-style:normal}
  .pattern{margin-bottom:10px}.pattern p{margin:0 0 8px;line-height:1.5}.pattern small{font-weight:700}
  footer{margin-top:42px;padding-top:18px;border-top:1px solid #d9d9e2;color:#77798c;font-size:12px}
  @media print{body{padding:0;background:white}.items li,.pattern{break-inside:avoid}}
</style>
</head>
<body>
<main>
<header><h1>My Tastemake</h1><p class="meta">Exported ${htmlEscape(exported)}</p></header>
${listSection("Saved", saved.map((entry) => itemRow(entry.item)), "Nothing saved.")}
${listSection("Tried", tried.map((entry) => itemRow(entry.item, reactionLabel(entry))), "Nothing tried yet.")}
${listSection("Favorites", favorites.map((item) => itemRow(item)), "No favorites recorded.")}
<section><h2>Taste Profile</h2>${patternHtml}</section>
<section><h2>Corrected patterns</h2>${correctedHtml}</section>
<footer>Generated by Tastemake. Your JSON backup is the file to use if you want to restore this data later.</footer>
</main>
</body>
</html>`;
}


export function backupFileName(date = new Date()) {
  return `tastemake-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function htmlFileName(date = new Date()) {
  return `my-tastemake-${date.toISOString().slice(0, 10)}.html`;
}
