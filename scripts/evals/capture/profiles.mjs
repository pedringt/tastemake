// #341 step 4: the only profiles the capture route accepts. Nothing comes from the request, so the route
// can't be used to retrieve for arbitrary or someone else's data.
// - example-profile: Paige's published Example Profile (data/example-profile.json).
// - rosa / theo / mara / dev: the drafted personas. Not usable yet. Each needs Paige's approval
//   (approved: true) and its titles resolved to provider ids (a counted, separately approved step).
import { readFileSync } from "node:fs";

const example = JSON.parse(readFileSync(new URL("../../../data/example-profile.json", import.meta.url), "utf8"));

const persona = (id, label, rows) => ({ id, label, approved: false, resolved: false, titles: rows.map(([title, type, rating, reasons]) => ({ title, type, rating, reasons })) });

export const PROFILES = {
  "example-profile": { id: "example-profile", label: "Paige's Example Profile", approved: true, resolved: true, feedbackByRecommendation: (example.state ?? example).feedbackByRecommendation },
  rosa: persona("rosa", "Rosa: the conventions of a genre", [
    ["Murder on the Orient Express", "book", "loved", ["story", "ending"]], ["Knives Out", "movie", "loved", ["story", "characters", "ending"]],
    ["Only Murders in the Building", "tv", "loved", ["characters", "humor"]], ["The Thursday Murder Club", "book", "loved", ["characters", "humor"]],
    ["Glass Onion", "movie", "liked", ["story"]], ["Death in Paradise", "tv", "liked", ["story"]],
    ["The Case of the Golden Idol", "game", "loved", ["puzzles", "story"]], ["Return of the Obra Dinn", "game", "liked", ["puzzles", "atmosphere"]],
    ["The Girl with the Dragon Tattoo", "movie", "disliked", ["too violent"]], ["Mindhunter", "tv", "disliked", ["too dark", "pacing"]]
  ]),
  theo: persona("theo", "Theo: one quality across genres", [
    ["The Long Way to a Small, Angry Planet", "book", "loved", ["characters", "tone"]], ["Ted Lasso", "tv", "loved", ["characters", "tone", "humor"]],
    ["Paddington 2", "movie", "loved", ["tone", "humor"]], ["Stardew Valley", "game", "loved", ["tone", "relaxing"]],
    ["The House in the Cerulean Sea", "book", "loved", ["characters", "tone"]], ["Abbott Elementary", "tv", "liked", ["characters", "humor"]],
    ["A Short Hike", "game", "liked", ["tone", "exploration"]], ["Spiritfarer", "game", "liked", ["characters", "story"]],
    ["Game of Thrones", "tv", "disliked", ["too dark", "characters"]], ["The Office", "tv", "disliked", ["cringe humor"]]
  ]),
  mara: persona("mara", "Mara: dislikes and an exception", [
    ["The Haunting of Hill House", "tv", "loved", ["atmosphere", "characters"]], ["The Witch", "movie", "loved", ["atmosphere", "style"]],
    ["Annihilation", "movie", "loved", ["atmosphere", "ideas"]], ["Dredge", "game", "loved", ["atmosphere", "unease"]],
    ["Mexican Gothic", "book", "liked", ["atmosphere"]], ["The Exorcist", "movie", "loved", ["craft", "dread"]],
    ["The Conjuring 2", "movie", "disliked", ["jump scares", "possession"]], ["Annabelle", "movie", "disliked", ["jump scares"]],
    ["Saw", "movie", "disliked", ["too gory"]], ["Inside", "game", "liked", ["atmosphere"]]
  ]),
  dev: persona("dev", "Dev: mixed across media", [
    ["Outer Wilds", "game", "loved", ["exploration", "puzzles", "story"]], ["Subnautica", "game", "loved", ["exploration", "survival"]],
    ["Factorio", "game", "liked", ["systems"]], ["Project Hail Mary", "book", "loved", ["problem-solving", "humor"]],
    ["The Martian", "movie", "liked", ["problem-solving"]], ["The Expanse", "tv", "loved", ["world", "plausibility"]],
    ["For All Mankind", "tv", "liked", ["plausibility", "characters"]], ["Call of Duty: Modern Warfare II", "game", "disliked", ["shallow", "action only"]],
    ["Star Wars: The Rise of Skywalker", "movie", "disliked", ["implausible", "story"]], ["Seveneves", "book", "liked", ["ideas", "plausibility"]]
  ])
};

export const usableProfile = (id) => {
  const profile = Object.hasOwn(PROFILES, id) ? PROFILES[id] : null;
  return profile?.approved && profile?.resolved && profile.feedbackByRecommendation ? profile : null;
};
