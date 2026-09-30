import { displayLabel } from "../data/domains.js";
import { evidenceKind, isExperienced, isSaved } from "./evidence.js";

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

function reactionLabel(feedback) {
  const kind = evidenceKind(feedback);
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

function itemLine(item, suffix = "") {
  const bits = [displayLabel(item), item.year, item.by].filter(Boolean);
  return `- **${item.title || "Untitled"}**${bits.length ? ` — ${bits.join(" · ")}` : ""}${suffix}`;
}

export function buildMarkdownExport(state, generatedAt = new Date().toISOString()) {
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

  const lines = [
    "# My Tastemake",
    "",
    `Exported ${generatedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`,
    "",
    "## Saved",
    "",
    ...(saved.length ? saved.map((entry) => itemLine(entry.item)) : ["Nothing saved."]),
    "",
    "## Tried",
    "",
    ...(tried.length ? tried.map((entry) => itemLine(entry.item, ` — **${reactionLabel(entry)}**`)) : ["Nothing tried yet."]),
    "",
    "## Favorites",
    "",
    ...(favorites.length ? favorites.map((item) => itemLine(item)) : ["No favorites recorded."]),
    "",
    "## Taste Profile",
    "",
    ...(activePatterns.length ? activePatterns.flatMap((pattern) => [
      `### ${pattern.title || pattern.label || "Pattern"}`,
      "",
      pattern.claim || "",
      "",
      `Status: ${pattern.strength || pattern.level || "working pattern"}`,
      ""
    ]) : ["No active patterns yet.", ""]),
    "## Corrected patterns",
    "",
    ...(correctedPatterns.length ? correctedPatterns.map((pattern) => `- **${pattern.title || pattern.label || "Pattern"}** — You said this isn't you.`) : ["No corrected patterns."]),
    ""
  ];
  return lines.join("\n");
}

export function backupFileName(date = new Date()) {
  return `tastemake-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function markdownFileName(date = new Date()) {
  return `my-tastemake-${date.toISOString().slice(0, 10)}.md`;
}
