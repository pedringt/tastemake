#!/usr/bin/env node

import { buildBackup, buildHtmlExport, htmlFileName, parseBackupText } from "../../src/model/export.js";
import { renderArtwork } from "../../src/components/artwork.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => ok ? passed += 1 : failures.push(`${name}${detail ? ` (${detail})` : ""}`);

const saved = {
  item:{id:"book-1",title:"Saved Book",type:"book",domains:["read"],by:"Writer",year:2024},
  rating:"not-tried",detail:"bookmarked"
};
const liked = {
  item:{id:"movie-1",title:"Liked Movie",type:"movie",domains:["movies"],year:2020},
  rating:"more",detail:"liked-before"
};
const state = {
  selectedFavorites:new Set(["movie-1"]),
  libraryFavorites:new Set(["movie-1"]),
  blindSpotDismissed:new Set(["x"]),
  setupAreas:new Set(["all"]),
  feedbackByRecommendation:{"book-1":saved,"movie-1":liked},
  recommendationSets:[],
  recommendationExhausted:false,
  customItems:{"book-1":saved.item,"movie-1":liked.item},
  blindSpots:{},
  patternStatements:[{hypothesisId:"ai-no",says:"not-me"}],
  tastebreaks:{},
  hypothesisHistory:[],
  modelHypotheses:[
    {id:"ai-yes",title:"Active pattern",claim:"You like a thing.",level:"supported"},
    {id:"ai-no",title:"Rejected pattern",claim:"Nope.",level:"emerging"}
  ],
  profileView:"list",mapPattern:null,mapItem:null,mapFilter:"all",favoriteFilter:"all",
  recommendationFilter:"all",libraryFilter:"all",expandedFeedback:{},
  areas:{movies:true,tv:true,read:true,play:true},curveball:true,displayName:"QA",
  recommendationStyle:"balanced",setupComplete:true,setupReturn:"favorites",onboarded:true,
  libraryView:"saved",look:"graphic"
};

const backup=buildBackup(state,"2026-09-30T12:00:00.000Z");
check("backup identifies Tastemake format",backup.format==="tastemake-backup"&&backup.version===1);
check("backup serializes Sets as arrays",Array.isArray(backup.state.selectedFavorites)&&backup.state.selectedFavorites[0]==="movie-1");
const restored=parseBackupText(JSON.stringify(backup));
check("restore rebuilds Set fields",restored.selectedFavorites instanceof Set&&restored.selectedFavorites.has("movie-1")&&restored.setupAreas instanceof Set);
check("restore keeps profile and library data",restored.modelHypotheses.length===2&&restored.feedbackByRecommendation["book-1"].detail==="bookmarked");

const html=buildHtmlExport(state,"2026-09-30T12:00:00.000Z");
check("readable export is a standalone HTML document",html.startsWith("<!doctype html>")&&html.includes("<title>My Tastemake</title>"));
check("readable export includes Saved",html.includes("<h2>Saved</h2>")&&html.includes("Saved Book"));
check("readable export includes Tried and reaction",html.includes("<h2>Tried</h2>")&&html.includes("Liked Movie")&&html.includes(">Liked<"));
check("readable export includes active Taste Profile",html.includes("<h2>Taste Profile</h2>")&&html.includes("Active pattern"));
check("readable export includes corrected patterns",html.includes("Corrected patterns")&&html.includes("Rejected pattern"));
check("readable export filename uses html",htmlFileName(new Date("2026-09-30T12:00:00.000Z"))==="my-tastemake-2026-09-30.html");
check("readable collections use a compact responsive grid",html.includes(".collection .items{grid-template-columns:repeat(3,minmax(0,1fr))}"));
check("collection headers include item counts",html.includes("<h2>Saved <span class=\"count\">1</span></h2>")&&html.includes("<h2>Tried <span class=\"count\">1</span></h2>"));
check("corrected patterns are collapsed by default",html.includes('<details class="corrected">')&&html.includes("<summary>Corrected patterns"));
check("readable export escapes user content",buildHtmlExport({...state,feedbackByRecommendation:{"x":{...saved,item:{...saved.item,title:"<script>alert(1)</script>"}}}}).includes("&lt;script&gt;alert(1)&lt;/script&gt;"));

let invalid=false;
try{parseBackupText('{"hello":"world"}');}catch{invalid=true;}
check("restore rejects non-Tastemake JSON",invalid);

const fallback=renderArtwork({title:"Portal Walk",type:"game",year:2025}, "library-compact-artwork");
check("missing artwork renders designed media fallback",fallback.includes("artwork-fallback-game")&&fallback.includes("Portal Walk")&&fallback.includes("2025"));
check("fallback escapes titles",renderArtwork({title:"<script>",type:"book"}).includes("&lt;script&gt;"));

console.log(`export tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f)=>console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
