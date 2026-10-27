import { state } from "../state.js";
import { AREAS } from "../model/taste.js";
import { toldItems } from "../model/mine.js";
import { reasonLabel } from "../model/blindspots.js";
import { CONTEXT, FIT, WEIGHT, activeStatements } from "../model/statements.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { EXCLUDABLE_GENRES } from "../model/exclusions.js";
import { exampleLinkHtml } from "../example-profile.js";

// My Tastemake (#8, phase 1): what you've told Tastemake, which areas it may use, how picks are put together,
// and a way to start over. It is the deeper management layer behind Library (Saved and Tried) and the Taste Profile.
// Settings here are configuration, not taste evidence; the page says so.

const mediumOf = (item) => displayLabel(item);

function actionButton(id, action, label, pressed = false, extra = "") {
  return `<button class="button button-secondary mine-action ${extra}" type="button" data-mine-item="${id}" data-mine-action="${action}" aria-pressed="${pressed}">${label}</button>`;
}

// Real usability report (2026-09-29): "my profile is super long now" -- every told-Tastemake row
// always rendered all four action buttons open, so a real history of any real size (dozens of
// reacted-to picks) became a wall of repeated buttons. Library's own Tried cards solved the same
// problem with a collapsed "Change" disclosure (library-reaction-edit in screens/library.js); this
// mirrors that exact pattern rather than inventing a new one, so title/medium/status/source stay
// visible at a glance and the buttons only appear once someone actually wants to change something.
function row(entry) {
  const { id, item } = entry;
  const controls = entry.starter
    ? `<div class="mine-actions"><button class="button button-quiet mine-action" type="button" data-action="back-favorites">Edit favorites</button></div>`
    : `<details class="mine-row-edit">
        <summary>Change</summary>
        <div class="mine-actions" role="group" aria-label="Change what you told Tastemake about ${esc(item.title)}">
          ${actionButton(id, "loved", "Loved it", Boolean(entry.loved))}
          ${actionButton(id, "liked", "Liked it", Boolean(entry.liked))}
          ${actionButton(id, "disliked", "Didn't like it", Boolean(entry.disliked))}
          ${actionButton(id, "remove", "Remove", false, "mine-remove")}
        </div>
      </details>`;
  return `
    <li class="mine-row" data-mine-id="${id}">
      <div class="mine-row-main">
        <strong class="mine-title">${esc(item.title)}</strong>
        <span class="mine-medium">${esc(mediumOf(item))}</span>
        <span class="mine-status">${esc(entry.status)}</span>
        <span class="mine-source">${esc(entry.source)}</span>
      </div>
      ${controls}
    </li>`;
}

// Favorites are one compact card, so they don't bury the things you told it since.
function startersRow(starters) {
  if (!starters.length) return "";
  return `
    <li class="mine-row mine-starters">
      <div class="mine-row-main">
        <strong class="mine-title">Favorites <span class="mine-count">${starters.length}</span></strong>
        <span class="mine-source">The known loves Tastemake started from</span>
        <ul class="mine-chips">${starters.map((entry) => `
          <li>
            <span>${esc(entry.item.title)}</span>
            <button type="button" data-starter-replace="${entry.id}">Replace</button>
            <button type="button" data-starter-remove="${entry.id}">Remove</button>
          </li>`).join("")}</ul>
      </div>
    </li>`;
}

function group(title, blurb, entries, emptyText) {
  const starters = entries.filter((entry) => entry.starter);
  const rest = entries.filter((entry) => !entry.starter);
  const id = `mine-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return `
    <section class="mine-group" aria-labelledby="${id}">
      <h3 id="${id}">${title} <span class="mine-count">${entries.length}</span></h3>
      <p class="mine-blurb">${blurb}</p>
      ${entries.length ? `<ul class="mine-list">${startersRow(starters)}${rest.map(row).join("")}</ul>` : `<p class="mine-empty">${emptyText}</p>`}
    </section>`;
}

function blindSpotList(spots) {
  if (!spots.length) return "";
  return `
    <section class="mine-group" aria-labelledby="mine-blind">
      <h3 id="mine-blind">Things you told it it got wrong <span class="mine-count">${spots.length}</span></h3>
      <p class="mine-blurb">Removing one puts the patterns it set aside back in play for that pick.</p>
      <ul class="mine-list">
        ${spots.map((spot) => `
          <li class="mine-row" data-mine-blind="${spot.itemId}">
            <div class="mine-row-main">
              <strong class="mine-title">${esc(spot.item.title)}</strong>
              <span class="mine-status">${spot.none ? "None of the patterns held up" : `${spot.hypotheses.length} pattern${spot.hypotheses.length === 1 ? "" : "s"} set aside`}</span>
              <span class="mine-source">${(spot.reasons ?? []).map(reasonLabel).join(", ") || "No reason chosen"}</span>
            </div>
            <div class="mine-actions"><button class="button button-secondary mine-action mine-remove" type="button" data-mine-blind-remove="${spot.itemId}">Remove</button></div>
          </li>`).join("")}
      </ul>
    </section>`;
}

function statementList() {
  const said = activeStatements(state);
  if (!said.length) return "";
  return `
    <section class="mine-group" aria-labelledby="mine-said">
      <h3 id="mine-said">What you've said about patterns <span class="mine-count">${said.length}</span></h3>
      <p class="mine-blurb">These come from you, so they outrank anything Tastemake guessed. They can confirm, narrow, set aside, or leave a pattern uncertain.</p>
      <ul class="mine-list">
        ${said.map((s) => `
          <li class="mine-row" data-mine-said="${s.hypothesisId}">
            <div class="mine-row-main">
              <strong class="mine-title">${esc(s.label)}</strong>
              <span class="mine-status">${[
                s.says ? FIT[s.says] : "",
                s.weight ? WEIGHT[s.weight] : "",
                s.context ? CONTEXT[s.context] : "",
                s.excludedDomains?.length ? `Not in ${s.excludedDomains.join(", ")}` : ""
              ].filter(Boolean).join(" \u00b7 ")}</span>
              <span class="mine-source">Said on the Taste Profile</span>
            </div>
            <div class="mine-actions"><button class="button button-secondary mine-action mine-remove" type="button" data-mine-said-remove="${s.hypothesisId}">Remove</button></div>
          </li>`).join("")}
      </ul>
    </section>`;
}

// #19 v1: lets a Tastebreak be revisited or removed from the same place as everything else told to Tastemake,
// rather than only being reachable by finding the item again in the Library.
function tastebreakList() {
  const entries = Object.entries(state.tastebreaks)
    .map(([itemId, entry]) => ({ itemId, entry, item: state.feedbackByRecommendation[itemId]?.item }))
    .filter((row) => row.item);
  if (!entries.length) return "";
  return `
    <section class="mine-group" aria-labelledby="mine-tastebreak">
      <h3 id="mine-tastebreak">Tastebreaks <span class="mine-count">${entries.length}</span></h3>
      <p class="mine-blurb">What you said actually pulled you in, or pushed you away, when you broke something down.</p>
      <ul class="mine-list">
        ${entries.map(({ itemId, entry, item }) => {
          const names = (state.modelHypotheses ?? []).filter((p) => entry.confirmed.includes(p.id)).map((p) => p.title);
          return `
          <li class="mine-row" data-mine-id="tastebreak-${itemId}">
            <div class="mine-row-main">
              <strong class="mine-title">${esc(item.title)}</strong>
              <span class="mine-status">${names.length ? esc(names.join(", ")) : "Something else"}</span>
              <span class="mine-source">${entry.positive ? "Why it landed" : "Why it didn't land"}</span>
            </div>
            <div class="mine-actions"><button class="button button-secondary mine-action mine-remove" type="button" data-tastebreak-item="${itemId}" data-tastebreak-action="remove">Remove</button></div>
          </li>`;
        }).join("")}
      </ul>
    </section>`;
}

function setupBlock() {
  const scope = state.setupAreas.has("all")
    ? "All"
    : AREAS.filter((area) => state.setupAreas.has(area.id)).map((area) => area.label).join(", ");
  const style = ({ safe: "Mostly safe bets", balanced: "Balanced", adventurous: "More adventurous" })[state.recommendationStyle] ?? "Balanced";
  return `
    <section class="mine-block mine-setup" aria-labelledby="mine-setup">
      <h2 id="mine-setup">Your setup</h2>
      <dl class="mine-setup-list">
        <div><dt>Name</dt><dd>${esc(state.displayName || "Not set")}</dd></div>
        <div><dt>Recommendations</dt><dd>${esc(scope || "All")}</dd></div>
        <div><dt>Discovery style</dt><dd>${esc(style)}</dd></div>
      </dl>
      <button class="button button-quiet mine-setup-edit" type="button" data-action="edit-setup">Edit setup</button>
      <p class="mine-blurb">These are product settings. They don’t change your Taste Profile.</p>
    </section>`;
}

function areasBlock() {
  const onCount = AREAS.filter((area) => state.areas[area.id] !== false).length;
  return `
    <section class="mine-block" aria-labelledby="mine-areas">
      <h2 id="mine-areas">Areas</h2>
      <p class="mine-blurb">Which kinds of things Tastemake may suggest in <em>new</em> sets. This says nothing about what you like; it only shows or hides a kind of thing. Search always finds everything.</p>
      <div class="mine-toggles">
        ${AREAS.map((area) => {
          const on = state.areas[area.id] !== false;
          const last = on && onCount === 1;
          return `
            <label class="mine-toggle ${on ? "is-on" : ""}">
              <input type="checkbox" data-mine-area="${area.id}" ${on ? "checked" : ""} ${last ? "disabled" : ""} />
              <span class="mine-toggle-name">${area.label}</span>
              <span class="mine-toggle-about">${area.about}${last ? " (keep at least one on)" : ""}</span>
            </label>`;
        }).join("")}
      </div>
    </section>`;
}

// #48: hard boundaries. Kept apart from taste on purpose: nothing here is evidence or a dislike.
function neverBlock() {
  const exclusions = state.exclusions ?? [];
  const blockedGenres = new Set(exclusions.filter((e) => e.kind === "genre").map((e) => e.key));
  const others = exclusions.filter((e) => e.kind !== "genre");
  const kindLabel = { creator: "Creator", series: "Series" };
  return `
    <section class="mine-block mine-never" aria-labelledby="mine-never">
      <h2 id="mine-never">Never recommend</h2>
      <p class="mine-blurb">Hard limits for new sets. Not a dislike, and they don’t change your Taste Profile. Search still finds everything.</p>
      <fieldset class="mine-never-genres">
        <legend>Kinds of thing</legend>
        <div class="mine-never-chips">
          ${EXCLUDABLE_GENRES.map((genre) => `
            <label class="mine-never-chip ${blockedGenres.has(genre.id) ? "is-on" : ""}">
              <input type="checkbox" data-mine-never-genre="${genre.id}" ${blockedGenres.has(genre.id) ? "checked" : ""} />
              <span>${esc(genre.label)}</span>
            </label>`).join("")}
        </div>
        <p class="mine-never-note">TV shows have no Horror or Romance label in the catalog, so those two cover movies, books and games.</p>
      </fieldset>
      <form class="mine-never-add" data-mine-never-form>
        <label for="mine-never-creator">A creator</label>
        <div class="mine-never-add-row">
          <input id="mine-never-creator" name="creator" type="text" autocomplete="off" placeholder="e.g. Stephen King" maxlength="80" />
          <button class="button button-secondary" type="submit">Add</button>
        </div>
        <p class="mine-never-note">Matches book authors, and a director, showrunner or studio once Tastemake knows it. To rule out a series, use “Don’t recommend…” on a pick.</p>
      </form>
      ${others.length ? `<ul class="mine-never-list" aria-label="Creators and series you ruled out">
        ${others.map((e) => `
          <li class="mine-never-row" data-mine-never-row="${esc(e.id)}">
            <span><small>${kindLabel[e.kind] ?? "Rule"}</small>${esc(e.label)}</span>
            <button class="button button-quiet mine-action" type="button" data-mine-never-remove="${esc(e.id)}" aria-label="Allow ${esc(e.label)} again">Remove</button>
          </li>`).join("")}
      </ul>` : ""}
    </section>`;
}

function picksBlock() {
  return `
    <section class="mine-block" aria-labelledby="mine-picks">
      <h2 id="mine-picks">How new sets are put together</h2>
      <label class="mine-toggle mine-toggle-wide ${state.curveball ? "is-on" : ""}">
        <input type="checkbox" data-mine-curveball ${state.curveball ? "checked" : ""} />
        <span class="mine-toggle-name">Include a Surprise Me pick</span>
        <span class="mine-toggle-about">One less-obvious pick in each new set, often found from something you liked but didn’t love. Off means the five best fits. This changes how a set is chosen, not what Tastemake thinks you like.</span>
      </label>
    </section>`;
}

function resetBlock() {
  return `
    <section class="mine-block" aria-labelledby="mine-reset">
      <h2 id="mine-reset">Start over</h2>
      <p class="mine-blurb">Clears everything you have told Tastemake in this browser, including on earlier visits: favorites, reactions, Saved items, things you added, corrections and these settings. Your look stays.</p>
      ${state.resetArmed
        ? `<div class="mine-actions"><button class="button button-primary" type="button" data-mine-reset="confirm">Yes, clear everything</button><button class="button button-quiet" type="button" data-mine-reset="cancel">Cancel</button></div>`
        : `<div class="mine-actions"><button class="button button-secondary" type="button" data-mine-reset="arm">Start over</button></div>`}
    </section>`;
}

export function renderMine() {
  const told = toldItems(state);
  const tasteCount = told.counts.length;
  const steerCount = told.steers.length;
  return `
    <section class="mine-screen">
      <div class="mine-back"><button class="button button-quiet mine-back-button" type="button" data-action="mine-back">&larr; Back</button></div>
      <p class="mine-eyebrow">My Tastemake</p>
      <h1>Your Tastemake.</h1>
      <p class="mine-lede">Manage what Tastemake may recommend and how discovery works. Your full taste history stays available when you need to correct it, but it does not have to fill this page every time.</p>

      <div class="mine-settings-grid">
        ${setupBlock()}
        ${areasBlock()}
        ${picksBlock()}
      </div>

      ${neverBlock()}

      <section class="mine-data-summary" aria-labelledby="mine-data-summary-title">
        <div>
          <p class="mine-eyebrow">Your data</p>
          <h2 id="mine-data-summary-title">What Tastemake is working with</h2>
          <p class="mine-blurb">Your Library is the place to browse Saved and Tried items. Taste Profile shows what Tastemake thinks those experiences add up to.</p>
          <div class="mine-data-actions">
            <button class="button button-secondary" type="button" data-mine-export="html">Export readable copy</button>
            <button class="button button-secondary" type="button" data-mine-export="backup">Download backup</button>
            <button class="button button-quiet" type="button" data-mine-restore>Restore backup</button>
            <input class="visually-hidden" type="file" name="tastemake-backup" aria-label="Choose a Tastemake backup file" accept="application/json,.json" data-mine-restore-file />
          </div>
          <p class="mine-data-note">The readable HTML copy includes Saved, Tried, Favorites and your Taste Profile. The JSON backup can restore Tastemake after you reset it for testing.</p>
          ${exampleLinkHtml()}
        </div>
        <div class="mine-data-counts" aria-label="Evidence summary">
          <span><strong>${tasteCount}</strong> ${tasteCount === 1 ? "rating" : "ratings"} shaping your taste</span>
          <span><strong>${steerCount}</strong> ${steerCount === 1 ? "save or skip" : "saves and skips"}</span>
          <span><strong>${told.blindSpots.length}</strong> ${told.blindSpots.length === 1 ? "blind spot" : "blind spots"} you noted</span>
        </div>
      </section>

      <details class="mine-evidence-manager">
        <summary>
          <span><strong>Manage ratings & corrections</strong><small>Open this only when you want to change something you've told Tastemake.</small></span>
          <span class="mine-count">${told.total}</span>
        </summary>
        <div class="mine-evidence-manager-body">
          ${told.total === 0 ? `<p class="mine-empty">Nothing yet. As you pick favorites and react to things, they show up here.</p>` : ""}
          ${group("Counts as taste", "Favorites and things you have tried. These shape the Taste Profile.", told.counts, "Nothing here yet.")}
          ${group("Only steers what comes next", "Reactions to things you haven't tried, including Saved saves. These nudge which picks appear, but they are not taste.", told.steers, "Nothing here yet.")}
          ${blindSpotList(told.blindSpots)}
          ${statementList()}
          ${tastebreakList()}
        </div>
      </details>

      <div class="mine-reset-wrap">${resetBlock()}</div>
    </section>`;
}
