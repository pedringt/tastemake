import { state } from "../state.js";
import { MEDIA, applySearchAction, findExisting, itemStatus, makeCustomItem, searchItems, searchableItems } from "../model/search.js";

// Search dialog (#13). It lives outside #app, so re-rendering a screen never closes it.
// Nothing here changes state except applySearchAction, called from an explicit button.

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function initSearch({ onChange, announce, goTo }) {
  const dialog = document.querySelector("#search-dialog");
  const input = document.querySelector("#search-input");
  const view = document.querySelector("#search-view");
  const opener = document.querySelector("#open-search");
  if (!dialog || !input || !view || !opener || typeof dialog.showModal !== "function") return;

  const ui = { query: "", filter: "all", mode: "results", itemId: null, pending: null, addTitle: "", addMedium: "movie", addError: "" };

  const itemById = (id) => (ui.pending?.id === id ? ui.pending : searchableItems(state).find((item) => item.id === id));

  function statusChip(item) {
    const status = itemStatus(state, item);
    return status.key === "none" ? "" : `<em class="search-status is-${status.key}">${status.label}</em>`;
  }

  function resultsHTML() {
    const query = ui.query.trim();
    const hits = query ? searchItems(state, query, ui.filter) : [];
    const list = hits.length
      ? `<ul class="search-results" aria-label="Results">
          ${hits.map((item) => `
            <li>
              <button type="button" class="search-result" data-search-pick="${item.id}">
                <span class="search-result-main"><b>${esc(item.title)}</b><span>${esc(item.medium)}${item.by ? ` · ${esc(item.by)}` : ""}</span></span>
                ${statusChip(item)}
              </button>
            </li>`).join("")}
        </ul>`
      : query
        ? `<p class="search-hint" role="status">Nothing matches "${esc(query)}". Try a different spelling, or add it yourself below.</p>`
        : `<p class="search-hint">Type a title to find it. Tastemake only knows a small hand-picked catalog for now, so you can also add anything it doesn't know.</p>`;
    // Only echo the query when nothing matched; next to a real result it would read like a typo to add.
    const addLabel = query.length >= 2 && !hits.length ? `Can't find it? Add "${esc(query)}" yourself` : hits.length ? "Not it? Add something Tastemake doesn't know" : "Add something Tastemake doesn't know";
    return `${list}<p class="search-add-row"><button type="button" class="button button-quiet" data-search-add>${addLabel}</button></p>`;
  }

  function actionButton(item, action, label, pressed) {
    return `<button type="button" class="button button-secondary search-action" data-search-action="${action}" aria-pressed="${pressed}">${label}</button>`;
  }

  function sheetHTML(item) {
    const status = itemStatus(state, item);
    const head = `
      <button type="button" class="search-back" data-search-back>&larr; Back to results</button>
      <h3 id="search-sheet-title" tabindex="-1">${esc(item.title)}</h3>
      <p class="search-sheet-meta">${esc(item.medium)} &middot; ${status.label}</p>`;

    if (status.key === "starter") {
      return `${head}
        <p class="search-note">This is one of your starter favorites, so it's already in your Library. Change it on the Favorites page.</p>
        <p><button type="button" class="button button-secondary" data-search-goto="favorites">Go to Favorites</button></p>`;
    }

    const on = (key) => status.key === key;
    return `${head}
      <div class="search-groups">
        <div class="search-group" role="group" aria-label="I've tried it">
          <span class="search-group-label">I've tried it</span>
          ${actionButton(item, "loved", "Loved it", on("loved"))}
          ${actionButton(item, "liked", "Liked it", on("liked"))}
          ${actionButton(item, "disliked", "Didn't like it", on("disliked"))}
        </div>
        <div class="search-group" role="group" aria-label="I haven't tried it">
          <span class="search-group-label">I haven't tried it</span>
          ${actionButton(item, "bookmark", "Bookmark it", on("bookmarked"))}
          ${actionButton(item, "not-interested", "Not interested", on("not-interested"))}
        </div>
      </div>
      <div class="search-extra">
        ${status.key === "loved"
          ? `<button type="button" class="button ${state.libraryFavorites.has(item.id) ? "button-quiet" : "button-primary"} search-action" data-search-action="${state.libraryFavorites.has(item.id) ? "unfavorite" : "favorite"}">${state.libraryFavorites.has(item.id) ? "Remove from Favorites" : "Add to Favorites"}</button>`
          : ""}
        ${status.key !== "none" ? `<button type="button" class="button button-quiet search-action" data-search-action="remove">Remove from Tastemake</button>` : ""}
      </div>
      <p class="search-note">Nothing changes until you choose one of these. Looking something up never teaches Tastemake anything.</p>
      <p><button type="button" class="button button-primary" data-search-close>Done</button></p>`;
  }

  function addHTML() {
    return `
      <button type="button" class="search-back" data-search-back>&larr; Back to results</button>
      <h3 id="search-add-title" tabindex="-1">Add something Tastemake doesn't know</h3>
      <form class="search-add" data-search-addform novalidate>
        <label class="search-field" for="search-add-name"><span>Title</span>
          <input id="search-add-name" type="text" maxlength="80" value="${esc(ui.addTitle)}" autocomplete="off" required />
        </label>
        <fieldset class="search-field"><legend>What is it?</legend>
          <div class="search-medium">
            ${Object.entries(MEDIA).map(([key, medium]) => `
              <label class="search-radio"><input type="radio" name="search-medium" value="${key}" ${ui.addMedium === key ? "checked" : ""}><span>${medium.label}</span></label>`).join("")}
          </div>
        </fieldset>
        <p class="search-error" role="alert" ${ui.addError ? "" : "hidden"}>${esc(ui.addError)}</p>
        <p class="search-note">Added items don't teach Tastemake about patterns yet (there's nothing to tag them with), but they fill your Library and Bookmarks.</p>
        <p><button type="submit" class="button button-primary">Continue</button></p>
      </form>`;
  }

  function render() {
    if (ui.mode === "sheet") {
      const item = itemById(ui.itemId);
      view.innerHTML = item ? sheetHTML(item) : resultsHTML();
    } else if (ui.mode === "add") {
      view.innerHTML = addHTML();
    } else {
      view.innerHTML = resultsHTML();
    }
  }

  // Focus a control inside the dialog; reports whether it was there.
  function focus(selector) {
    const target = view.querySelector(selector);
    if (target) target.focus();
    return Boolean(target);
  }

  function syncFilters() {
    dialog.querySelectorAll("[data-search-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.searchFilter === ui.filter));
      button.classList.toggle("is-active", button.dataset.searchFilter === ui.filter);
    });
  }

  function open() {
    Object.assign(ui, { query: "", filter: "all", mode: "results", itemId: null, pending: null, addTitle: "", addMedium: "movie", addError: "" });
    input.value = "";
    syncFilters();
    render();
    dialog.showModal();
    input.focus();
  }

  opener.addEventListener("click", open);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || dialog.open) return;
    const target = event.target;
    if (target.closest?.("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    open();
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  input.addEventListener("input", () => {
    ui.query = input.value;
    ui.mode = "results";
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = view.querySelector("[data-search-pick]");
    if (first) first.click();
  });

  dialog.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-search-filter]");
    if (filter) {
      ui.filter = filter.dataset.searchFilter;
      ui.mode = "results";
      syncFilters();
      render();
      return;
    }

    if (event.target.closest("[data-search-close]")) { dialog.close(); return; }

    const pick = event.target.closest("[data-search-pick]");
    if (pick) {
      ui.mode = "sheet";
      ui.itemId = pick.dataset.searchPick;
      render();
      focus("#search-sheet-title");
      return;
    }

    if (event.target.closest("[data-search-back]")) {
      const from = ui.itemId;
      ui.mode = "results";
      render();
      if (!(from && focus(`[data-search-pick="${from}"]`))) input.focus();
      return;
    }

    if (event.target.closest("[data-search-add]")) {
      ui.mode = "add";
      ui.addTitle = ui.query.trim();
      ui.addError = "";
      render();
      focus("#search-add-name");
      return;
    }

    const goto = event.target.closest("[data-search-goto]");
    if (goto) { dialog.close(); goTo(goto.dataset.searchGoto); return; }

    const actionButton = event.target.closest("[data-search-action]");
    if (actionButton) {
      const item = itemById(ui.itemId);
      if (!item) return;
      const action = actionButton.dataset.searchAction;
      const message = applySearchAction(state, item, action);
      if (message) onChange(message);
      // An item the user added by hand disappears entirely when removed: go back to the results.
      if (!itemById(ui.itemId)) {
        ui.mode = "results";
        ui.itemId = null;
        render();
        input.focus();
        return;
      }
      render();
      // keep focus on the button that was used; if it is gone (e.g. Remove), land on the item's title
      if (!focus(`[data-search-action="${action}"]`)) focus("#search-sheet-title");
    }
  });

  dialog.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-search-addform]");
    if (!form) return;
    event.preventDefault();
    const title = form.querySelector("#search-add-name").value.trim();
    const medium = form.querySelector('input[name="search-medium"]:checked')?.value ?? "movie";
    ui.addTitle = title;
    ui.addMedium = medium;
    if (title.length < 2) {
      ui.addError = "Give it a title first.";
      render();
      focus("#search-add-name");
      return;
    }
    // Never create a second record for something already here (duplicate evidence): open the existing one.
    const existing = findExisting(state, title);
    if (existing) {
      ui.pending = null;
      ui.itemId = existing.id;
      ui.mode = "sheet";
      render();
      focus("#search-sheet-title");
      announce(`${existing.title} is already in Tastemake. Showing it instead of adding a copy.`);
      return;
    }
    ui.pending = makeCustomItem(title, medium);
    ui.itemId = ui.pending.id;
    ui.mode = "sheet";
    render();
    focus("#search-sheet-title");
  });
}
