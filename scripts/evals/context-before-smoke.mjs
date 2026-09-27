#!/usr/bin/env node

const endpoint = "https://tastemake.vercel.app/api/recommendations";

const favorite = {
  id: "openlibrary-book-OL-WOK",
  provider: "openlibrary",
  providerId: "OL-WOK",
  title: "The Way of Kings",
  type: "book",
  domains: ["read"],
  genres: ["Fantasy", "Epic fiction", "Magic"]
};

const known = [
  ["Circe","book","read","loved-before"],
  ["Piranesi","book","read","liked-before"],
  ["The Song of Achilles","book","read","liked-before"],
  ["The Lies of Locke Lamora","book","read","liked-before"],
  ["The Witch's Heart","book","read","liked-before"],
  ["The Night Circus","book","read","liked-before"],
  ["Six of Crows","book","read","liked-before"],
  ["Gideon the Ninth","book","read","liked-before"],
  ["Ninth House","book","read","liked-before"],
  ["Mexican Gothic","book","read","liked-before"],
  ["The Starless Sea","book","read","tried-disliked"],
  ["The Green Knight","movie","watch","loved-before"],
  ["Pan's Labyrinth","movie","watch","loved-before"],
  ["The Northman","movie","watch","liked-before"],
  ["Control","game","play","loved-before"],
  ["Alan Wake 2","game","play","liked-before"],
  ["Portal 2","game","play","liked-before"],
  ["Outer Wilds","game","play","tried-disliked"]
];

const feedbackByRecommendation = {};
for (let i = 0; i < 58; i += 1) {
  const base = known[i % known.length];
  const [title,type,domain,detail] = base;
  const id = `eval-${domain}-${i}`;
  feedbackByRecommendation[id] = {
    rating: detail === "tried-disliked" ? "less" : "more",
    detail,
    source: "recommendations",
    item: { id, title: i < known.length ? title : `${title} variant ${i}`, type, domains:[domain], custom:true }
  };
}

const state = {
  selectedFavorites: [favorite.id],
  libraryFavorites: [],
  feedbackByRecommendation,
  recommendationSets: [],
  customItems: { [favorite.id]: favorite },
  blindSpots: {},
  blindSpotDrafts: {},
  blindSpotDismissed: [],
  patternStatements: [],
  areas: { watch:true, read:true, play:true },
  curveball: true,
  recommendationFilter: "read",
  recommendationStyle: "balanced"
};

for (let run = 1; run <= 3; run += 1) {
  const started = Date.now();
  const response = await fetch(endpoint, {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({state})
  });
  const payload = await response.json();
  console.log(JSON.stringify({
    run,
    status:response.status,
    clientMs:Date.now()-started,
    source:payload.source,
    reason:payload.reason,
    usage:payload.meta?.usage ?? null,
    picks:(payload.picks ?? []).map((p)=>({title:p.title,reason:p.reason,cites:p.ai?.cites ?? []}))
  }));
  if (run < 3) await new Promise((resolve)=>setTimeout(resolve,12000));
}
