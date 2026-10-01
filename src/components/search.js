import { state } from "../state.js";
import { MEDIA, applyResolvedCatalogItem, applySearchAction, findExisting, itemStatus, makeCustomItem, markCustomResolution, searchableItems } from "../model/search.js";
import { displayLabel, domainFilterOptions } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { resolveCustomCatalogItem, searchExternalCatalog } from "../catalog/client.js";
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

  const ui = { query: "", filter: "all", mode: "results", itemId: null, pending: null, experiencePath: null, addTitle: "", addCreator: "", addMedium: "movie", addError: "", external: [], catalogLoading: false, catalogError: "" };
  let catalogTimer = null;
  let catalogController = null;
  let catalogSeq = 0;

  const itemById = (id) => (ui.pending?.id === id ? ui.pending : [...searchableItems(state), ...ui.external].find((item) => item.id === id));

  async function resolveAddedItem(item) {
    if (!item?.custom || item.provider) return;
    markCustomResolution(state, item.id, "resolving");
    if (ui.pending?.id === item.id) ui.pending = state.customItems[item.id];
    render();

    const result = await resolveCustomCatalogItem(item);
    let message = "";
    if (result.status === "resolved" && result.item) {
      const merged = applyResolvedCatalogItem(state, item.id, result.item);
      if (ui.pending?.id === item.id) ui.pending = merged;
      message = merged
        ? `${item.title} matched to the catalog. Tastemake can now use its real metadata when learning and recommending.`
        : "";
    } else {
      const status = result.status === "ambiguous" ? "ambiguous" : "unresolved";
      const merged = markCustomResolution(state, item.id, status);
      if (ui.pending?.id === item.id) ui.pending = merged;
      message = result.status === "ambiguous"
        ? `${item.title} has more than one plausible catalog match, so Tastemake kept your evidence without guessing.`
        : `${item.title} is saved as evidence, but Tastemake still has limited factual metadata for it.`;
    }
    if (message) onChange(message);
    render();
  }

  // User-facing search is the real external catalog. The old seeded title inventory is gone;
  // only items the user has actually acted on remain in local product state (#89).
  const existingEvidenceItem = (item) => {
    const existing = findExisting(state, item);
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
        if (state.selectedFavorites.has(item.id)) return false;
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
      list = '<p class="search-hint">Search movies, shows, books, and games.</p>';
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

  function outcomeButton(action, label, pressed) {
    return `<button type="button" class="detail-chip outcome-chip search-outcome" data-search-outcome="${action}" aria-pressed="${pressed}">${label}</button>`;
  }

  function pathForStatus(status) {
    if (["loved", "liked", "disliked"].includes(status.key)) return "tried";
    if (["bookmarked", "not-interested"].includes(status.key)) return "not-tried";
    return null;
  }

  function sheetHTML(item) {
    const status = itemStatus(state, item);
    const resolution = item.custom
      ? item.provider
        ? "Matched to catalog"
        : item.resolutionStatus === "resolving"
          ? "Identifying this…"
          : item.resolutionStatus === "ambiguous"
            ? "Needs more detail to identify"
            : "Limited metadata"
      : "";
    const head = `
      <button type="button" class="search-back" data-search-back>&larr; Back to results</button>
      <h3 id="search-sheet-title" tabindex="-1">${esc(item.title)}</h3>
      <p class="search-sheet-meta">${esc(displayLabel(item))} &middot; ${status.label}${resolution ? ` &middot; ${esc(resolution)}` : ""}</p>`;

    const starterSelected = state.selectedFavorites.has(item.id);
    const starterLabel = state.starterReplaceId
      ? `Replace with ${esc(item.title)}`
      : starterSelected ? "Remove favorite" : "Add to Favorites";
    const starterBlock = starterSelected
      ? `<div class="search-starter is-selected">
          <span><strong>Favorite</strong><small>This is one of your strongest Favorites.</small></span>
          <button type="button" class="button button-quiet" data-search-starter="remove">${starterLabel}</button>
        </div>`
      : `<button type="button" class="search-starter search-starter-choice" data-search-starter="add">
          <span>
            <strong>You loved this?</strong>
            <small>Add it to Favorites if it is one of the things you love most.</small>
          </span>
          <span class="search-starter-cta">${starterLabel}</span>
        </button>`;

    if (!state.onboarded || status.key === "starter") {
      return `${head}${starterBlock}
        <p class="search-note search-favorite-note">Pick the things you really love, then keep searching for more.</p>
        <p><button type="button" class="button button-primary" data-search-close>Done adding favorites</button></p>`;
    }

    const favorite = state.libraryFavorites.has(item.id);
    const hasReaction = status.key !== "none";
    const path = ui.experiencePath;
    const feedbackChoices = path ? `
      <div class="feedback-details experience-outcomes search-feedback-step">
        <span class="feedback-detail-prompt">${path === "tried" ? "How did it land?" : "Want to keep it around?"}</span>
        <div class="detail-chip-row" role="group" aria-label="${path === "tried" ? "How did it land?" : "What do you want to do with this untried item?"}">
          ${path === "tried"
            ? `${outcomeButton("loved", "Loved it", status.key === "loved")}
               ${outcomeButton("liked", "Liked it", status.key === "liked")}
               ${outcomeButton("disliked", "Didn’t like it", status.key === "disliked")}`
            : `${outcomeButton("bookmark", "Save", status.key === "bookmarked")}
               ${outcomeButton("not-interested", "Not interested", status.key === "not-interested")}`}
        </div>
      </div>` : "";

    return `${head}
      <div class="search-favorite-row">
        <button
          type="button"
          class="rec-favorite-star ${favorite ? "is-favorite" : ""} search-action"
          data-search-action="${favorite ? "unfavorite" : "favorite"}"
          aria-label="${favorite ? "Remove from Favorites" : "Add to Favorites"}"
          title="${favorite ? "Remove from Favorites" : "Add to Favorites"}"
          aria-pressed="${favorite}"
        ><span aria-hidden="true">${favorite ? "★" : "☆"}</span></button>
        <span>Favorites are automatically marked Tried · Loved.</span>
      </div>

      ${hasReaction && ui.experiencePath === null
        ? `<div class="reaction-complete search-reaction-complete">
            <span>${esc(status.label)}</span>
            <button class="button button-quiet reaction-change" type="button" data-search-edit>Change</button>
          </div>`
        : `<div class="rec-interaction search-reaction-start">
            <div class="reaction-question">Have you tried it?</div>
            <div class="reaction-rail reaction-rail-binary" aria-label="Have you tried ${esc(item.title)}?">
              <button class="rating-button experience-button" type="button" data-search-path="tried" aria-pressed="${path === "tried"}"><span>Tried it</span></button>
              <button class="rating-button experience-button" type="button" data-search-path="not-tried" aria-pressed="${path === "not-tried"}"><span>Not tried</span></button>
            </div>
          </div>`}
      ${feedbackChoices}
      <div class="search-extra">
        ${hasReaction ? `<button type="button" class="button button-quiet search-action" data-search-action="remove">Remove from Tastemake</button>` : ""}
      </div>
      <p class="search-note">Searching never changes your taste. Only the choices you make here do.</p>
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
        <label class="search-field" for="search-add-creator"><span>Creator / author <em>(optional)</em></span>
          <input id="search-add-creator" type="text" maxlength="120" value="${esc(ui.addCreator)}" autocomplete="off" />
        </label>
        <fieldset class="search-field"><legend>What is it?</legend>
          <div class="search-medium">
            ${Object.entries(MEDIA).map(([key, medium]) => `
              <label class="search-radio"><input type="radio" name="search-medium" value="${key}" ${ui.addMedium === key ? "checked" : ""}><span>${medium.label}</span></label>`).join("")}
          </div>
        </fieldset>
        <p class="search-error" role="alert" ${ui.addError ? "" : "hidden"}>${esc(ui.addError)}</p>
        <p class="search-note">After you act on it, Tastemake will try to identify an exact catalog match in the background. If it finds one confidently, it attaches real metadata without changing what you told it. If it cannot, your evidence stays and Tastemake will not guess.</p>
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
    Object.assign(ui, { query: "", filter: "all", mode: "results", itemId: null, pending: null, experiencePath: null, addTitle: "", addCreator: "", addMedium: "movie", addError: "", external: [], catalogLoading: false, catalogError: "" });
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
      ui.catalogError = payload.degraded ? "unavailable" : "";
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
    catalogTimer = setTimeout(refreshExternal, 160);
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
      ui.experiencePath = null;
      render();
      focus("#search-sheet-title");
      return;
    }

    if (event.target.closest("[data-search-back]")) {
      const from = ui.itemId;
      ui.mode = "results";
      ui.experiencePath = null;
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
      if (item.custom && !item.provider) void resolveAddedItem(state.customItems[item.id] ?? item);
      input.focus();
      return;
    }

    const searchEdit = event.target.closest("[data-search-edit]");
    if (searchEdit) {
      const item = itemById(ui.itemId);
      if (!item) return;
      ui.experiencePath = pathForStatus(itemStatus(state, item)) ?? "tried";
      render();
      focus(`[data-search-path="${ui.experiencePath}"]`);
      return;
    }

    const searchPath = event.target.closest("[data-search-path]");
    if (searchPath) {
      ui.experiencePath = searchPath.dataset.searchPath;
      render();
      focus("[data-search-outcome]");
      return;
    }

    const searchOutcome = event.target.closest("[data-search-outcome]");
    if (searchOutcome) {
      const item = itemById(ui.itemId);
      if (!item) return;
      const action = searchOutcome.dataset.searchOutcome;
      const message = applySearchAction(state, item, action);
      if (message) onChange(message);
      if (message && item.custom && !item.provider) void resolveAddedItem(state.customItems[item.id] ?? item);
      ui.experiencePath = null;
      render();
      focus("#search-sheet-title");
      return;
    }

    const actionButton = event.target.closest("[data-search-action]");
    if (actionButton) {
      const item = itemById(ui.itemId);
      if (!item) return;
      const action = actionButton.dataset.searchAction;
      const message = applySearchAction(state, item, action);
      if (message) onChange(message);
      if (message && action !== "remove" && item.custom && !item.provider) void resolveAddedItem(state.customItems[item.id] ?? item);
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
    const creator = form.querySelector("#search-add-creator")?.value.trim() ?? "";
    ui.addTitle = title;
    ui.addCreator = creator;
    ui.addMedium = medium;
    if (title.length < 2) {
      ui.addError = "Give it a title first.";
      render();
      focus("#search-add-name");
      return;
    }
    // Never create a second record for something already here (duplicate evidence): open the existing one.
    const existing = findExisting(state, { title, type: medium, by: creator || null });
    const knownExisting = existing && (
      state.selectedFavorites.has(existing.id)
      || Boolean(state.feedbackByRecommendation[existing.id])
      || Boolean(state.customItems[existing.id])
    );
    if (knownExisting) {
      ui.pending = null;
      ui.itemId = existing.id;
      ui.mode = "sheet";
      render();
      focus("#search-sheet-title");
      announce(`${existing.title} is already in Tastemake. Showing it instead of adding a copy.`);
      return;
    }
    ui.pending = makeCustomItem(title, medium, creator);
    ui.itemId = ui.pending.id;
    ui.mode = "sheet";
    render();
    focus("#search-sheet-title");
  });
}
