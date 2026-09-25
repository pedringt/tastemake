// Browser-side layout checks for the collage frame. No dependencies, no build step.
//
// Run it in the page (DevTools console, or a headless browser) at each width you care about
// (we use 1440, 1024 and 768):
//
//   await (await import("/scripts/qa/layout-check.js")).runAll()
//
// It visits Favorites, Recommendations, Taste Profile and Library (checkCurrentScreen() also works on
// Bookmarks once something is bookmarked; see bookmark-flow.js) and reports, per page:
//   stickerTextHits  stickers whose box touches any text
//   stickerBoxHits   stickers whose box touches any visible element (cards, buttons, text)
//   stickerOutside   stickers that drifted more than 14px off the board
//   titleCollisions  Favorites tiles whose title runs into the tile's top row
//   textUnderControls  text that sits behind a button/link it does not belong to (overlapping layout)
//   topbarOverlaps   header parts (brand, nav tabs, search/label) overlapping each other or running off the page
//   mapOverlaps      Taste Map cards overlapping each other or leaving the map
//   lowContrast      text below WCAG AA (4.5:1, or 3:1 for large text) against its background; skips text over
//                    images/gradients, disabled controls, de-emphasized (unselected) tiles and decoration
//   hScroll          the page scrolls sideways
// A clean run has every list empty and hScroll false.
//
// "Visible" boxes are clipped by any ancestor that hides overflow, so art clipped inside a card
// is not counted as if it were sticking out.

const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function isVisible(el) {
  // Content inside a collapsed <details> (other than its summary) is not on screen.
  const closed = el.closest("details:not([open])");
  if (closed && closed !== el && !el.closest("summary")) return false;
  // Visually-hidden text (screen-reader-only headings and labels) is not on screen, so it cannot sit under anything.
  if (el.closest(".visually-hidden")) return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
}

function visibleRect(el, boundary) {
  const r = el.getBoundingClientRect();
  let { left, top, right, bottom } = r;
  for (let p = el.parentElement; p && p !== boundary; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const pr = p.getBoundingClientRect();
      left = Math.max(left, pr.left); top = Math.max(top, pr.top);
      right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

const describe = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
const stickerName = (el) => [...el.classList].find((c) => c.startsWith("st-") && c !== "st-neon") || "sticker";


// ---- text contrast (WCAG AA) ------------------------------------------------------------------
const parseColor = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
};
const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const BOARD = ".favorites-screen, .profile-screen, .recommendations-screen, .library-screen";

// The color behind an element, or null when it sits over an image/gradient (can't be judged from CSS colors).
function backgroundBehind(el) {
  const layers = [];
  for (let p = el; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    const isPage = p === document.body || p === document.documentElement || p.matches(BOARD);
    if (cs.backgroundImage !== "none" && !isPage) return null;
    if (Number(cs.opacity) < 0.99) return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  let base = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
  return base;
}

function lowContrast(root, field) {
  const found = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.textContent.trim() || !isVisible(el) || field?.contains(el)) continue;
    if (el.closest('[aria-hidden="true"], [aria-pressed="false"].favorite-tile, :disabled, [aria-disabled="true"], .look-preview')) continue;
    const bg = backgroundBehind(el);
    if (!bg) continue;
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);
    if (got < need) {
      const key = `${node.textContent.trim().slice(0, 32)} (${got.toFixed(1)}:1, needs ${need})`;
      if (!found.has(key)) found.set(key, describe(el));
    }
  }
  return [...found.entries()].map(([text, where]) => `${text} in ${where}`);
}

export function checkCurrentScreen() {
  const screen = document.querySelector(".favorites-screen, .profile-screen, .recommendations-screen, .library-screen, .mine-screen");
  const field = screen.querySelector(".sticker-field");
  const board = screen.getBoundingClientRect();
  const stickers = [...screen.querySelectorAll(".sticker")].filter(isVisible);

  const boxes = [];
  screen.querySelectorAll("*").forEach((el) => {
    if (field?.contains(el) || !isVisible(el)) return;
    const r = visibleRect(el, screen);
    if (r) boxes.push({ el, r });
  });

  const texts = [];
  const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || field?.contains(node) || !isVisible(node.parentElement) || node.parentElement?.closest?.('.editorial-art[aria-hidden="true"]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width > 1 && r.height > 1) texts.push({ label: node.textContent.trim().slice(0, 30), r });
    }
  }

  const stickerTextHits = [];
  const stickerBoxHits = [];
  const stickerOutside = [];
  for (const sticker of stickers) {
    const r = sticker.getBoundingClientRect();
    const name = `${stickerName(sticker)}@${Math.round(r.left)},${Math.round(r.top + scrollY)}`;
    const t = texts.filter((x) => hit(r, x.r));
    if (t.length) stickerTextHits.push(`${name} -> ${t.slice(0, 2).map((x) => x.label).join(" | ")}`);
    const b = boxes.filter((x) => hit(r, x.r));
    if (b.length) stickerBoxHits.push(`${name} -> ${b.slice(0, 2).map((x) => describe(x.el)).join(" | ")}`);
    if (r.left < board.left - 14 || r.right > board.right + 14 || r.top < board.top - 14 || r.bottom > board.bottom + 14) {
      stickerOutside.push(name);
    }
  }

  // Favorites tiles: the title (bottom-anchored) must stay clear of the tile's top row.
  const titleCollisions = [];
  screen.querySelectorAll(".favorite-tile").forEach((tile) => {
    const title = tile.querySelector(".favorite-tile-copy h3");
    const top = tile.querySelector(".favorite-tile-top");
    if (!title || !top) return;
    const t = title.getBoundingClientRect();
    const tr = tile.getBoundingClientRect();
    const collides = [...top.children].some((child) => isVisible(child) && hit(t, child.getBoundingClientRect()));
    if (collides || t.top < tr.top) titleCollisions.push(`${title.textContent.trim().slice(0, 30)} (${Math.round(tr.width)}px tile)`);
  });

  // Text hidden behind a control it is not part of (e.g. a paragraph running under a button).
  const controls = [...screen.querySelectorAll("button, a, input, select")].filter((el) => !field?.contains(el) && isVisible(el));
  const textUnderControls = [];
  const textWalker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    if (!node.textContent.trim() || field?.contains(node) || !isVisible(node.parentElement) || node.parentElement?.closest?.('.editorial-art[aria-hidden="true"]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      const clash = controls.find((c) => !c.contains(node) && overlapArea(r, c.getBoundingClientRect()) > 12);
      if (clash) {
        textUnderControls.push(`"${node.textContent.trim().slice(0, 28)}" under ${describe(clash)}`);
        break;
      }
    }
  }

  // Header: brand, nav tabs and the search/label area must not overlap or run off the page. Compared by the
  // extent of their content, because a part can overflow its grid cell without changing its own box.
  const topbarOverlaps = [];
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    const extent = (el) => {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const node of [el, ...el.querySelectorAll("*")]) {
        if (!isVisible(node)) continue;
        const r = node.getBoundingClientRect();
        left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      return { left, top, right, bottom };
    };
    const parts = [".brand-cluster", ".stepper", ".topbar-aside"]
      .map((selector) => ({ selector, el: topbar.querySelector(selector) }))
      .filter((part) => part.el && isVisible(part.el))
      .map((part) => ({ ...part, box: extent(part.el) }));
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    parts.forEach((a, i) => {
      if (a.box.left < shell.left - 1 || a.box.right > shell.right + 1) topbarOverlaps.push(`${a.selector} runs off the page`);
      parts.slice(i + 1).forEach((b) => { if (hit(a.box, b.box)) topbarOverlaps.push(`${a.selector} overlaps ${b.selector}`); });
    });
  }

  // Taste Map: the pattern cards must not overlap one another or spill out of the map.
  const mapOverlaps = [];
  const mapBox = screen.querySelector(".taste-map")?.getBoundingClientRect();
  const mapNodes = [...screen.querySelectorAll(".taste-map-node")].filter(isVisible);
  mapNodes.forEach((node, i) => {
    const r = node.getBoundingClientRect();
    if (mapBox && (r.left < mapBox.left - 1 || r.right > mapBox.right + 1 || r.top < mapBox.top - 1 || r.bottom > mapBox.bottom + 1)) mapOverlaps.push(`${node.textContent.trim().slice(0, 24)} leaves the map`);
    mapNodes.slice(i + 1).forEach((other) => {
      if (hit(r, other.getBoundingClientRect())) mapOverlaps.push(`${node.textContent.trim().slice(0, 20)} overlaps ${other.textContent.trim().slice(0, 20)}`);
    });
  });

  return {
    width: innerWidth,
    stickers: stickers.length,
    stickerTextHits,
    stickerBoxHits,
    stickerOutside,
    titleCollisions,
    textUnderControls,
    topbarOverlaps,
    mapOverlaps,
    lowContrast: [...lowContrast(screen, field), ...lowContrast(document.querySelector(".topbar"), null)],
    artworkHits: checkArtwork(),   // #34: recommendation artwork title vs. decorative shapes
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
  };
}

export async function runAll() {
  const { state } = await import("/src/state.js");
  const favorites = [
    {id:"tmdb-movie-801",provider:"tmdb",providerId:"801",title:"A Very Long Favorite Film Title for Layout Testing",type:"movie",domains:["watch"],about:"A deliberately long but readable summary that checks card proportions in every look.",artwork:null},
    {id:"openlibrary-book-802",provider:"openlibrary",providerId:"802",title:"Favorite Book",type:"book",domains:["read"],about:"Book.",artwork:null},
    {id:"igdb-game-803",provider:"igdb",providerId:"803",title:"Favorite Game",type:"game",domains:["play"],about:"Game.",artwork:null},
    {id:"tmdb-tv-804",provider:"tmdb",providerId:"804",title:"Favorite Show",type:"tv",domains:["watch"],about:"Show.",artwork:null}
  ];
  state.customItems=Object.fromEntries(favorites.map(item=>[item.id,item]));
  state.selectedFavorites=new Set(favorites.map(item=>item.id));
  state.setupComplete=true;
  state.displayName="QA";
  const picks=Array.from({length:5},(_,i)=>({
    id:`tmdb-movie-${820+i}`,provider:"tmdb",providerId:String(820+i),title:`Catalog Recommendation ${i+1}`,
    type:"movie",domains:["watch"],about:"A real-catalog-style recommendation with enough copy to exercise the card layout.",
    prediction:"Worth testing",fit:i===4?"Exploratory fit":"Catalog match",rank:i===4?null:i+1,surprise:i===4,
    reason:"Related to a favorite in the external catalog.",artwork:null,ai:null
  }));
  state.recommendationSets=[picks];
  state.feedbackByRecommendation={
    [picks[0].id]:{item:picks[0],rating:"more",detail:"loved-before"},
    [picks[1].id]:{item:picks[1],rating:"not-tried",detail:"bookmarked"}
  };
  state.modelHypotheses=[{
    id:"ai-layout-one",title:"Structure supports experimentation",claim:"Unusual ideas seem stronger when a clear structure keeps them moving.",
    evidence:"Favorite Film, Catalog Recommendation 1",supports:[`ev:${favorites[0].id}`,`ev:${picks[0].id}`],counters:[],
    domains:["watch"],strength:"Supported",status:"supported",crossDomain:"untested",provenance:"Live AI interpretation, validated against experienced evidence."
  }];
  state.hypothesisAiStatus="loading";

  const pages={favorites:"favorites",recommendations:"recommendations",profile:"model",library:"library"};
  const results={};
  for(const [name,jump] of Object.entries(pages)){
    document.querySelector(`.step[data-step-jump="${jump}"]`)?.click();
    await new Promise(resolve=>setTimeout(resolve,220));
    results[name]=checkCurrentScreen();
  }
  return results;
}

// ---- Recommendation artwork (#34): the decorative title/badges must never be obscured by the ----
// ---- decorative shapes behind them. `.editorial-art` and its children are aria-hidden (the real, ----
// ---- readable title is in the card body), but a hard-to-read decoration is still a visual bug. ----
export function checkArtwork() {
  const boxOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const hits = [];
  document.querySelectorAll(".editorial-art").forEach((art) => {
    const title = art.querySelector(".art-title");
    if (!title || !isVisible(title)) return;
    const titleBox = boxOf(title);
    const titleArea = Math.max(1, (titleBox.right - titleBox.left) * (titleBox.bottom - titleBox.top));
    // .art-pattern is a faint full-bleed texture under everything by design, not a decoration that can
    // "cover" the title; only the solid accent shapes are checked.
    art.querySelectorAll(".art-shape-a, .art-shape-b").forEach((shape) => {
      if (!isVisible(shape)) return;
      const shapeBox = boxOf(shape);
      const overlap = overlapArea(titleBox, shapeBox);
      if (overlap / titleArea > 0.05) {
        const artName = art.className.split(" ").find((c) => c.startsWith("art-") && c !== "art-layout-1" && c !== "art-layout-2" && c !== "art-layout-3" && c !== "art-layout-4") || "art";
        const shapeName = [...shape.classList].find((c) => c === "art-shape-a" || c === "art-shape-b");
        hits.push(`${artName}: ${shapeName} covers ${Math.round((overlap / titleArea) * 100)}% of the title`);
      }
    });
  });
  return hits;
}
