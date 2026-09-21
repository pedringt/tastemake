// Browser-side accessibility audit: the things a machine can check, on every screen. No dependencies.
//
//   await (await import("/scripts/qa/a11y-check.js")).runAll()
//
// It seeds some data (so the screens have real content), then visits every screen, the search dialog and the
// look picker, and reports per screen:
//   noName          buttons, links, inputs and selects with no accessible name
//   badIds          duplicate ids, and aria-labelledby / aria-controls / aria-describedby pointing at nothing
//   headings        not exactly one h1 in the page content, or a heading level that skips (h1 -> h3)
//   unlabeled       form controls with no label
//   noAlt           images without alt text
//   smallTargets    visible controls smaller than 24x24 CSS px (WCAG 2.2 AA 2.5.8; text links inside a sentence are exempt)
//   noFocusRing     controls that show no visible change when keyboard-focused (WCAG 2.4.7)
//   landmarks       missing main / banner / nav, or an unlabeled nav
// A clean run has every list empty.

const visible = (el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden], [inert]") &&
    !el.closest("details:not([open]) > :not(summary)");
};

const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

function accessibleName(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textOf).join(" ");
    if (t) return t;
  }
  if (el.getAttribute("aria-label")?.trim()) return el.getAttribute("aria-label").trim();
  if (el.labels?.length) { const t = [...el.labels].map(textOf).join(" "); if (t) return t; }
  if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type) && el.value) return el.value;
  const inner = [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ");
  // visually-hidden text still counts; aria-hidden children do not
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return textOf(clone) || inner || (el.getAttribute("title") || "").trim();
}

const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""}`;

function audit(root = document) {
  const scope = root === document ? document.body : root;
  const controls = [...scope.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox]")].filter(visible);

  const noName = controls.filter((el) => !accessibleName(el)).map(describe);

  const ids = new Map();
  scope.querySelectorAll("[id]").forEach((el) => ids.set(el.id, (ids.get(el.id) || 0) + 1));
  const badIds = [...ids].filter(([, n]) => n > 1).map(([id, n]) => `duplicate id "${id}" x${n}`);
  scope.querySelectorAll("[aria-labelledby], [aria-controls], [aria-describedby]").forEach((el) => {
    for (const attr of ["aria-labelledby", "aria-controls", "aria-describedby"]) {
      (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean).forEach((id) => {
        if (!document.getElementById(id)) badIds.push(`${describe(el)} ${attr}="${id}" points at nothing`);
      });
    }
  });

  const content = document.querySelector("#app") || scope;
  const heads = [...content.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(visible);
  const headings = [];
  const h1s = heads.filter((h) => h.tagName === "H1").length;
  if (h1s !== 1) headings.push(`${h1s} h1 elements (want exactly 1)`);
  let last = 0;
  heads.forEach((h) => {
    const level = Number(h.tagName[1]);
    if (last && level > last + 1) headings.push(`heading jumps from h${last} to h${level}: "${textOf(h).slice(0, 30)}"`);
    last = level;
  });

  const unlabeled = [...scope.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")]
    .filter(visible).filter((el) => !accessibleName(el)).map(describe);

  const noAlt = [...scope.querySelectorAll("img")].filter(visible)
    .filter((img) => !img.hasAttribute("alt") && img.getAttribute("role") !== "presentation" && img.getAttribute("aria-hidden") !== "true").map(describe);

  const smallTargets = controls.filter((el) => {
    if (el.tagName === "INPUT" && (el.classList.contains("visually-hidden") || el.type === "radio" || el.type === "checkbox")) return false;
    if (el.tagName === "A" && el.closest("p, li, span") && getComputedStyle(el).display === "inline") return false;
    const r = el.getBoundingClientRect();
    return r.width < 24 || r.height < 24;
  }).map((el) => `${describe(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);

  const landmarks = [];
  if (!document.querySelector("main")) landmarks.push("no <main>");
  if (!document.querySelector("header")) landmarks.push("no <header>");
  const navs = [...document.querySelectorAll("nav")];
  if (!navs.length) landmarks.push("no <nav>");
  navs.filter((n) => !n.getAttribute("aria-label") && !n.getAttribute("aria-labelledby")).forEach(() => landmarks.push("a <nav> has no label"));
  if (!document.documentElement.lang) landmarks.push("no lang attribute");
  if (!document.title.trim()) landmarks.push("no page title");

  return { noName, badIds, headings, unlabeled, noAlt, smallTargets, landmarks };
}

// Does keyboard focus show? Compare the look of a control before and after focus().
function focusRings(scope = document.body) {
  const els = [...scope.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary")]
    .filter(visible).filter((el) => !el.disabled && !el.closest("[aria-hidden=true]")).slice(0, 60);
  const bad = [];
  const previous = document.activeElement;
  for (const el of els) {
    // visually-hidden inputs show focus on their visible sibling (e.g. a preview card), so judge the whole label
    const target = el.classList.contains("visually-hidden") ? (el.closest("label") || el) : el;
    const styleOf = (n) => { const cs = getComputedStyle(n); return [cs.outlineStyle, cs.outlineWidth, cs.boxShadow, cs.borderTopColor, cs.backgroundColor].join("|"); };
    const sib = el.parentElement?.querySelector(".look-preview");
    const before = styleOf(target) + (sib ? styleOf(sib) : "");
    el.focus({ focusVisible: true });
    const after = styleOf(target) + (sib ? styleOf(sib) : "");
    const cs = getComputedStyle(el);
    const hasOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    if (!hasOutline && before === after) bad.push(describe(el));
  }
  previous?.focus?.();
  return bad;
}

export function checkNow(scope) {
  // a modal dialog makes the page behind it inert, so audit just the dialog while it is open
  return { ...audit(scope), noFocusRing: focusRings(scope ?? document.body) };
}

export async function runAll() {
  const { state } = await import("/src/state.js");
  const search = await import("/src/model/search.js");
  const catalog = await import("/src/data/catalog.js");
  const all = [...catalog.recommendations, ...catalog.followUpPool];
  // seed a bit of everything so the screens have real content
  search.applySearchAction(state, all[0], "loved"); search.applySearchAction(state, all[1], "liked");
  search.applySearchAction(state, all[2], "disliked"); search.applySearchAction(state, all[3], "bookmark");
  search.applySearchAction(state, all[4], "not-interested");
  search.applySearchAction(state, search.makeCustomItem("Severance", "tv"), "loved");

  const wait = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = async (selector) => { document.querySelector(selector)?.click(); await wait(); };
  const results = {};
  const record = (name, scope) => { results[name] = checkNow(scope); };

  for (const [name, jump] of [["favorites", "favorites"], ["recommendations", "recommendations"], ["profile", "model"], ["library", "library"], ["bookmarks", "bookmarks"]]) {
    await click(`.step[data-step-jump="${jump}"]`);
    record(name);
  }
  await click('.step[data-step-jump="model"]'); await click('[data-profile-view="map"]'); record("profile map");
  await click('[data-profile-view="list"]');
  await click("#open-mine"); record("my tastemake");
  await click("#open-look"); record("look picker");
  await click('[data-action="look-done"]');
  await click("#open-search");
  record("search dialog", document.querySelector("#search-dialog"));
  document.querySelector("#search-dialog")?.close?.();
  await wait(100);
  return results;
}
