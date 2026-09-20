// Browser-side layout checks for the collage frame. No dependencies, no build step.
//
// Run it in the page (DevTools console, or a headless browser) at each width you care about
// (we use 1440, 1024 and 768):
//
//   await (await import("/scripts/qa/layout-check.js")).runAll()
//
// It visits Favorites, Recommendations and Taste Profile (checkCurrentScreen() also works on
// Bookmarks once something is bookmarked; see bookmark-flow.js) and reports, per page:
//   stickerTextHits  stickers whose box touches any text
//   stickerBoxHits   stickers whose box touches any visible element (cards, buttons, text)
//   stickerOutside   stickers that drifted more than 14px off the board
//   titleCollisions  Favorites tiles whose title runs into the tile's top row
//   textUnderControls  text that sits behind a button/link it does not belong to (overlapping layout)
//   hScroll          the page scrolls sideways
// A clean run has every list empty and hScroll false.
//
// "Visible" boxes are clipped by any ancestor that hides overflow, so art clipped inside a card
// is not counted as if it were sticking out.

const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function isVisible(el) {
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

export function checkCurrentScreen() {
  const screen = document.querySelector(".favorites-screen, .profile-screen, .recommendations-screen, .bookmarks-screen");
  const field = screen.querySelector(".sticker-field");
  const board = screen.getBoundingClientRect();
  const stickers = [...screen.querySelectorAll(".sticker")].filter(isVisible);

  const boxes = [];
  screen.querySelectorAll("*").forEach((el) => {
    if (field.contains(el) || !isVisible(el)) return;
    const r = visibleRect(el, screen);
    if (r) boxes.push({ el, r });
  });

  const texts = [];
  const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || field.contains(node) || !isVisible(node.parentElement)) continue;
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
  const controls = [...screen.querySelectorAll("button, a, input, select")].filter((el) => !field.contains(el) && isVisible(el));
  const textUnderControls = [];
  const textWalker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    if (!node.textContent.trim() || field.contains(node) || !isVisible(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      const clash = controls.find((c) => !c.contains(node) && overlapArea(r, c.getBoundingClientRect()) > 12);
      if (clash) { textUnderControls.push(`"${node.textContent.trim().slice(0, 28)}" under ${describe(clash)}`); break; }
    }
  }

  return {
    width: innerWidth,
    stickers: stickers.length,
    stickerTextHits,
    stickerBoxHits,
    stickerOutside,
    titleCollisions,
    textUnderControls,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
  };
}

export async function runAll() {
  const names = ["favorites", "recommendations", "profile"];
  const results = {};
  for (const [index, name] of names.entries()) {
    document.querySelectorAll(".step")[index].click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    results[name] = checkCurrentScreen();
  }
  return results;
}
