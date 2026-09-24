import { state } from "../state.js";
import { MEDIA, applySearchAction, findExisting, itemStatus, makeCustomItem, searchableItems } from "../model/search.js";
import { displayLabel, domainFilterOptions } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { searchExternalCatalog } from "../catalog/client.js";
import { renderArtwork } from "./artwork.js";

// Search dialog (#13). It lives outside #app, so re-rendering a screen never closes it.
// Nothing here changes state except applySearchAction, called from an explicit button.


export function initSearch({ onChange, announce, goTo }) {
  // Filter chips come from the domain registry, so a new visible domain shows up here too.
  const filterGroup = document.querySelector("#search-dialog [data-search-filter]")?.parentElement;
  if (filterGroup) {
    filterGroup.innerHTML = domainFilterOptions().map((option) =>
      `<button type="button" class="domain-filter-button${option.id === "all" ? " is-active" : ""}" data-search-filter="${option.id}" aria-pressed="${option.id === "all"}">${option.label}</button>`).join("");
  }

  const dialog = document.querySelector("#search-dialog");
  const input = document.querySelector("#search-input");
  const view = document.querySelector("#search-view");
  const opener = document.querySelector("#open-search");
  if (!dialog || !input || !view || !opener || typeof dialog.showModal !== "function") return;

  const ui = { query: "", filter: "all", mode: "results", itemId: null, pending: null, addTitle: "", addMedium: "movie", addError: "", external: [], catalogLoading: false, catalogError: "" };
  let catalogTimer = null;
  let catalogController = null;
  let catalogSeq = 0;

  const itemById = (id) => (ui.pending?.id === id ? ui.pending : [...searchableItems(state), ...ui.external].find((item) => item.id === id));

  // User-facing search is the real external catalog. Seed data remains available to
  // deterministic product logic and to resolve items the user has already acted on, but it
  // never appears as temporary search inventory while providers are loading (#89).
  const existingEvidenceItem = (item) => {
    const existing = findExisting(state, item.title);
    if (!existing) return item;
    const isKnown = state.selectedFavorites.has(existing.id)
      || Boolean(state.feedbackByRecommendation[existing.id])
      || Boolean(state.customItems[existing.id]);
    return isKnown ? existing : item;
  };

  const externalHits = () => {
    const seen = new Set();
    return ui.external
      .map(existingEvidenceItem)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 16);
  };

  function statusChip(item) {
    const status = itemStatus(state, item);
    return status.key === "none" ? "" : `<em class="search-status is-${status.key}">${status.label}</em>`;
  }

  function resultsHTML() {
    const query = ui.query.trim();
    const readyToSearch = query.length >= 2;
    const hits = readyToSearch && !ui.catalogLoading && !ui.catalogError ? externalHits() : [];

    let list = "";
    if (!query) {
      list = '<p class="search-hint">Search movies, shows, books, and games. Looking something up never teaches Tastemake anything.</p>';
    } else if (!readyToSearch) {
      list = '<p class="search-hint">Keep typing to search the catalog.</p>';
    } else if (ui.catalogLoading) {
      list = `<div class="search-loading" role="status" aria-live="polite">
          <span class="search-spinner" aria-hidden="true"></span>
          <span><strong>Searching the catalog…</strong><small>Checking movies, shows, books, and games.</small></span>
        </div>
        <div class="search-skeleton" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>`;
    } else if (ui.catalogError) {
      list = '<p class="search-hint search-hint-error" role="status">The catalog is unavailable right now. You can still add this title yourself below.</p>';
    } else if (hits.length) {
      list = `<ul class="search-results" aria-label="Results">
          ${hits.map((item) => `
            <li>
              <button type="button" class="search-result" data-search-pick="${item.id}">
                ${renderArtwork(item, "search-artwork")}<span class="search-result-main"><b>${esc(item.title)}</b><span>${esc(displayLabel(item))}${item.by ? ` · ${esc(item.by)}` : ""}</span></span>
                ${statusChip(item)}
              </button>
            </li>`).join("")}
        </ul>`;
    } else {
      list = `<p class="search-hint" role="status">Nothing matches “${esc(query)}”. Try a different spelling, or add it yourself below.</p>`;
    }

    const addLabel = readyToSearch && !ui.catalogLoading && !hits.length
      ? `Can't find it? Add “${esc(query)}” yourself`
      : hits.length
        ? "Not it? Add something Tastemake doesn't know"
        : "Add something Tastemake doesn't know";
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
      <p class="search-sheet-meta">${esc(displayLabel(item))} &middot; ${status.label}</p>`;

    const starterSelected = state.selectedFavorites.has(item.id);
    const starterLabel = state.starterReplaceId
      ? `Replace with ${esc(item.title)}`
      : starterSelected ? "Remove favorite" : "Add favorite";
    const starterBlock = `
      <div class="search-starter">
        <span><strong>Favorites</strong><small>Things you have already tried and loved. Tastemake starts here.</small></span>
        <button type="button" class="button ${starterSelected ? "button-quiet" : "button-primary"}" data-search-starter="${starterSelected ? "remove" : "add"}">${starterLabel}</button>
      </div>`;

    if (!state.onboarded || status.key === "starter") {
      return `${head}${starterBlock}
        <p class="search-note">Favorites are things you have already tried and loved. Add or replace one here, then keep searching.</p>
        <p><button type="button" class="button button-primary" data-search-close>Done</button></p>`;
    }

    const on = (key) => status.key === key;
    return `${head}${starterBlock}
      <div class="search-groups">
        <div class="search-group" role="group" aria-label="I've tried it">
          <span class="search-group-label">I've tried it</span>
          ${actionButton(item, "loved", "Loved it", on("loved"))}
          ${actionButton(item, "liked", "Liked it", on("liked"))}
          ${actionButton(item, "disliked", "Didn't like it", on("disliked"))}
        </div>
        <div class="search-group" role="group" aria-label="I haven't tried it">
          <span class="search-group-label">I haven't tried it</span>
          ${actionButton(item, "bookmark", "Try Next", on("bookmarked"))}
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
        <p class="search-note">After you add it, you can make it a Favorite, put it in your Library, or save it to Try Next. Searching and typing alone never teach Tastemake anything.</p>
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
    Object.assign(ui, { query: "", filter: "all", mode: "results", itemId: null, pending: null, addTitle: "", addMedium: "movie", addError: "", external: [], catalogLoading: false, catalogError: "" });
    input.value = "";
    syncFilters();
    render();
    dialog.showModal();
    input.focus();
  }

  async function refreshExternal() {
    if (ui.mode !== "results") return;
    const query = ui.query.trim();
    if (query.length < 2) {
      ui.external = [];
      ui.catalogLoading = false;
      ui.catalogError = "";
      render();
      return;
    }
    catalogController?.abort();
    catalogController = new AbortController();
    const seq = ++catalogSeq;
    ui.catalogLoading = true;
    ui.catalogError = "";
    render();
    try {
      const payload = await searchExternalCatalog(query, ui.filter, { signal: catalogController.signal });
      if (seq !== catalogSeq) return;
      ui.external = payload.items;
    } catch (error) {
      if (error?.name === "AbortError" || seq !== catalogSeq) return;
      ui.external = [];
      ui.catalogError = "unavailable";
    } finally {
      if (seq === catalogSeq) {
        ui.catalogLoading = false;
        if (ui.mode === "results") render();
      }
    }
  }

  function queueExternal() {
    clearTimeout(catalogTimer);
    // Invalidate the previous request immediately, not after the debounce. Otherwise a slow
    // response for the old query can land during the 260ms window and briefly overwrite the
    // current search (#89).
    catalogController?.abort();
    catalogController = null;
    catalogSeq += 1;

    const query = ui.query.trim();
    ui.external = [];
    ui.catalogError = "";
    ui.catalogLoading = query.length >= 2;
    render();

    if (query.length < 2) return;
    catalogTimer = setTimeout(refreshExternal, 260);
  }

  opener.addEventListener("click", open);
  dialog.addEventListener("close", () => { state.starterReplaceId = null; });
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
    queueExternal();
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
      queueExternal();
      return;
    }

    if (event.target.closest("[data-search-close]")) { dialog.close(); return; }

    const pick = event.target.closest("[data-search-pick]");
    if (pick) {
      clearTimeout(catalogTimer);
      catalogController?.abort();
      catalogSeq += 1;
      ui.catalogLoading = false;
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
      clearTimeout(catalogTimer);
      catalogController?.abort();
      catalogSeq += 1;
      ui.catalogLoading = false;
      ui.mode = "add";
      ui.addTitle = ui.query.trim();
      ui.addError = "";
      render();
      focus("#search-add-name");
      return;
    }

    const goto = event.target.closest("[data-search-goto]");
    if (goto) { dialog.close(); goTo(goto.dataset.searchGoto); return; }

    const starterButton = event.target.closest("[data-search-starter]");
    if (starterButton) {
      const item = itemById(ui.itemId);
      if (!item) return;
      const action = starterButton.dataset.searchStarter;
      if (action === "remove") {
        state.selectedFavorites.delete(item.id);
        if (state.starterReplaceId === item.id) state.starterReplaceId = null;
        onChange(`${item.title} removed from your Favorites.`);
        render();
        focus("#search-sheet-title");
        return;
      }

      if (item.custom || item.provider) state.customItems[item.id] = item;
      const replacing = state.starterReplaceId;
      if (replacing && replacing !== item.id) state.selectedFavorites.delete(replacing);
      state.selectedFavorites.add(item.id);
      state.starterReplaceId = null;
      ui.pending = null;
      ui.mode = "results";
      ui.itemId = null;
      ui.query = "";
      input.value = "";
      onChange(`${item.title} added to your Favorites. ${state.selectedFavorites.size} of 4 selected.`);
      render();
      input.focus();
      return;
    }

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
