import { state } from "../state.js";
import { canKeepDiscovering } from "../model/taste.js";
import { CONTEXT, FIT, WEIGHT, statementFor } from "../model/statements.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { activeBlindSpots, blindSpotsFor, isRecurring, recurringThemes } from "../model/blindspots.js";
import { displayLabel, domainById } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { libraryItems } from "../model/library.js";
import { evidenceRecords } from "../model/evidence.js";
import { renderTasteMap } from "./tastemap.js";

function sayButton(item, field, value, label, said) {
  const pressed = said?.[field] === value;
  return `<button type="button" class="button button-secondary signal-say-button" data-statement-pattern="${item.id}" data-statement-field="${field}" data-statement-value="${value}" aria-pressed="${pressed}">${label}</button>`;
}

// #36: a lighter correction than "Not really me" — scope a pattern out of one domain without
// rejecting it everywhere. Only shown when the pattern has been backed in more than one domain,
// since a single-domain pattern has nothing to scope down from.
function domainScopeControls(item, record) {
  const domains = [...new Set([...record.scope.supported, ...record.scope.excluded])];
  if (domains.length < 2) return "";
  const excluded = record.scope.excluded;
  return `
    <div class="signal-say signal-scope" role="group" aria-label="Where does “${esc(item.title)}” apply?">
      <span class="signal-say-label signal-scope-label">This pattern applies to</span>
      <div class="signal-scope-options">
        ${domains.map((domainId) => {
          const label = domainById(domainId)?.label ?? domainId;
          const isExcluded = excluded.includes(domainId);
          return `<button type="button" class="signal-scope-option" data-scope-pattern="${item.id}" data-scope-domain="${domainId}" aria-pressed="${!isExcluded}" aria-label="${esc(label)}: ${isExcluded ? "not included" : "included"}">
            <span class="signal-scope-check" aria-hidden="true">${isExcluded ? "" : "✓"}</span>
            <span>${esc(label)}</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
}

// Pattern corrections: what the user says here is user-confirmed and outranks inference, but it is not taste
// evidence, so it never changes the confidence level (see src/model/statements.js).
function sayControls(item, said, record) {
  const fit = said?.says ?? null;
  const primary = `
    <div class="signal-say-primary" role="group" aria-label="Does “${esc(item.title)}” sound right?">
      <span class="signal-say-label">Does this sound right?</span>
      ${sayButton(item, "says", "accurate", "Yes", said)}
      ${sayButton(item, "says", "partial", "Partly", said)}
      ${sayButton(item, "says", "not-me", "No", said)}
      ${sayButton(item, "says", "unsure", "Not sure", said)}
    </div>`;

  if (fit === "accurate") {
    return `
      <div class="signal-say">
        ${primary}
        <div class="signal-followups">
          <div class="signal-say-group" role="group" aria-label="How important is “${esc(item.title)}” to your taste?">
            <span class="signal-say-label">How important is it?</span>
            ${sayButton(item, "weight", "lot", "Important to my taste", said)}
            ${sayButton(item, "weight", "little", "Nice, but not important", said)}
          </div>
          <div class="signal-say-group" role="group" aria-label="How often is “${esc(item.title)}” true for you?">
            <span class="signal-say-label">How often is this true for you?</span>
            ${sayButton(item, "context", "broad", "Usually", said)}
            ${sayButton(item, "context", "some", "Depends", said)}
          </div>
        </div>
      </div>`;
  }

  if (fit === "partial") {
    return `
      <div class="signal-say">
        ${primary}
        <div class="signal-followups signal-followups-partial">
          <span class="signal-followup-heading">What makes it only partly true?</span>
          <div class="signal-say-group" role="group" aria-label="What makes “${esc(item.title)}” only partly true?">
            ${sayButton(item, "context", "some", "Depends on context", said)}
            ${sayButton(item, "context", "unsure", "Not sure yet", said)}
          </div>
          ${domainScopeControls(item, record)}
        </div>
      </div>`;
  }

  return `<div class="signal-say">${primary}</div>`;
}

export function partitionProfilePatterns(patterns = [], statements = []) {
  const rejectedIds = new Set(
    (statements ?? []).filter((entry) => entry?.says === "not-me").map((entry) => entry.hypothesisId)
  );
  return {
    active: (patterns ?? []).filter((item) => !rejectedIds.has(item.id)),
    corrected: (patterns ?? []).filter((item) => rejectedIds.has(item.id))
  };
}

function statementConsequence(item, said) {
  if (!said?.says) return "";
  const excluded = (said.excludedDomains ?? []).map((id) => domainById(id)?.label ?? id);

  let text = "";
  if (said.says === "not-me") text = "Future recommendations will leave this pattern out.";
  else if (said.says === "unsure") text = "Tastemake will keep this tentative instead of leaning on it.";
  else if (said.says === "partial") text = "Tastemake will use this pattern more selectively.";
  else if (said.weight === "lot") text = "This pattern will count more when Tastemake ranks future picks.";
  else if (said.weight === "little") text = "This pattern will count less when Tastemake ranks future picks.";
  else if (said.context === "some") text = "Tastemake will treat this as conditional rather than broadly true.";
  else if (said.says === "accurate") text = "Tastemake can keep using this pattern when it explains a future pick.";

  if (excluded.length) text += ` It will not use it for ${excluded.join(", ")}.`;
  if (!text) return "";
  return `<div class="signal-consequence"><strong>What this changes</strong><span>${esc(text)}</span></div>`;
}

function hypothesisCard(item, index) {
  const update = { level: item.strength ?? "Emerging", status: item.status ?? "emerging", provenance: item.provenance ?? "Live AI interpretation." };
  const said = statementFor(state, item.id);
  const record = { scope: { supported: item.domains ?? [], excluded: said?.excludedDomains ?? [] } };
  const spots = blindSpotsFor(state, item.id);
  const blindLine = spots.length
    ? `<div class="signal-blind">Blind spot: ${spots.map((spot) => `\u201c${esc(spot.item.title)}\u201d`).join(", ")} didn't hold up here.${spots.length === 1 ? " It takes more than one to change what Tastemake thinks." : ""}</div>`
    : "";
  return `
    <article class="signal-row signal-row-${index + 1}" data-profile-pattern="${item.id}">
      <div class="signal-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-main">
        <div class="signal-title-row">
          <h3>${esc(item.title)}</h3>
          <span class="signal-badges">
            ${item.status === "conditional" ? `<span class="signal-flag" title="This pattern holds in some picks and not others.">Conditional</span>` : ""}
            ${said?.says === "accurate" ? `<span class="signal-flag signal-confirmed">You confirmed this</span>` : ""}
            ${said?.says === "partial" ? `<span class="signal-flag">Partly accurate</span>` : ""}
            ${said?.says === "unsure" ? `<span class="signal-flag">Not sure yet</span>` : ""}
            <span class="signal-status ${update.status}">${esc(update.level)}</span>
          </span>
        </div>
        <p class="signal-claim">${esc(item.claim)}</p>
        <div class="signal-evidence"><span>What this comes from</span> ${esc(item.evidence)}</div>
        <div class="signal-provenance">${esc(update.provenance)}</div>
        ${said?.says === "not-me" ? `<div class="signal-said"><strong>${FIT["not-me"]}.</strong> Tastemake leaves it out of what it picks for you. The pattern stays here so you can change your mind.</div>` : ""}
        ${said?.says === "partial" ? `<div class="signal-said"><strong>${FIT.partial}.</strong> Tastemake treats it as a narrower pattern and uses the details you add below.</div>` : ""}
        ${said?.says === "unsure" ? `<div class="signal-said"><strong>${FIT.unsure}.</strong> Tastemake keeps the pattern tentative rather than treating your uncertainty as evidence.</div>` : ""}
        ${said?.says === "accurate" && said?.weight ? `<div class="signal-said">${WEIGHT[said.weight]}. That changes how much it counts when picking, not how sure Tastemake is.</div>` : ""}
        ${["accurate", "partial"].includes(said?.says) && said?.context ? `<div class="signal-said">${CONTEXT[said.context] ?? "You refined when this applies."}.</div>` : ""}
        ${sayControls(item, said, record)}
        ${statementConsequence(item, said)}
        ${blindLine}
      </div>
    </article>`;
}

function correctedPatternsSection(items) {
  if (!items.length) return "";
  return `
    <details class="corrected-patterns">
      <summary>Corrected patterns <span class="corrected-pattern-count">${items.length}</span></summary>
      <p class="corrected-patterns-note">Patterns you said do not fit you. They no longer shape recommendations, but you can revisit them.</p>
      <div class="corrected-pattern-list">
        ${items.map((item) => `
          <div class="corrected-pattern-row" data-profile-pattern="${item.id}">
            <div>
              <strong>${esc(item.title)}</strong>
              <span>You said this isn’t you.</span>
            </div>
            <button type="button" class="button button-quiet corrected-pattern-reconsider" data-statement-pattern="${item.id}" data-statement-field="says" data-statement-value="not-me">Reconsider</button>
          </div>`).join("")}
      </div>
    </details>`;
}

function learningPanel(patterns = []) {
  if (!patterns.length) return "";

  const history = state.hypothesisHistory ?? [];
  const evidence = new Map(evidenceRecords(state).map((row) => [row.ref, row]));
  const changes = [];

  for (const pattern of patterns) {
    const revisions = history.filter((entry) => entry.hypothesisId === pattern.id);
    if (revisions.length < 2) continue;
    const previous = revisions[revisions.length - 2];
    const current = revisions[revisions.length - 1];

    const addedSupport = (current.supports ?? []).find((ref) => !(previous.supports ?? []).includes(ref));
    const source = addedSupport ? evidence.get(addedSupport) : null;
    const sourceLine = source ? `You told Tastemake: ${source.title} → ${source.polarity > 0 ? "positive signal" : "didn’t work for you"}.` : "";

    let changed = "";
    let consequence = "";
    if (previous.level && current.level && previous.level !== current.level) {
      changed = `${previous.level} → ${current.level}.`;
      consequence = String(current.level).toLowerCase() === "strong"
        ? "This pattern can carry more weight in future recommendations."
        : "Tastemake will lean on this pattern more cautiously.";
    } else if (String(previous.claim ?? "") !== String(current.claim ?? "")) {
      changed = "The pattern became more specific.";
      consequence = "Future picks will use the narrower interpretation instead of the older broad one.";
    } else if ((current.supports?.length ?? 0) > (previous.supports?.length ?? 0)) {
      changed = "This pattern gained another supporting example.";
      consequence = "Tastemake has more reason to test this pattern again in future picks.";
    } else if (JSON.stringify(previous.domains ?? []) !== JSON.stringify(current.domains ?? [])) {
      changed = "Where this pattern applies changed.";
      consequence = "Tastemake will apply it more selectively across books, movies, shows, and games.";
    } else if (current.origin === "user-confirmed" && current.reason) {
      changed = current.reason;
      consequence = "Your correction now outranks Tastemake’s earlier inference.";
    } else {
      continue;
    }

    changes.push({ title: pattern.title, sourceLine, changed, consequence });
  }

  const hasChanges = changes.length > 0;
  const items = hasChanges
    ? changes.slice(-3).reverse()
    : patterns.slice(0, 3).map((pattern) => ({
        title: pattern.title,
        sourceLine: "",
        changed: pattern.claim,
        consequence: "This is one of the patterns Tastemake is currently testing when it chooses recommendations."
      }));

  return `
    <section class="profile-learning" aria-labelledby="profile-learning-title">
      <div class="profile-learning-head">
        <div>
          <p class="kicker">Learning out loud</p>
          <h2 id="profile-learning-title">${hasChanges ? "What changed" : "What Tastemake learned"}</h2>
          <p>${hasChanges
            ? "Your recent reactions and corrections changed how Tastemake will choose future picks."
            : "A few patterns Tastemake is starting to see in what you love."}</p>
        </div>
      </div>
      <div class="profile-learning-list">
        ${items.map((item) => `
          <article class="profile-learning-item">
            <strong>${esc(item.title)}</strong>
            ${item.sourceLine ? `<span class="profile-learning-source">${esc(item.sourceLine)}</span>` : ""}
            <span><b>${hasChanges ? "So Tastemake changed:" : "Current read:"}</b> ${esc(item.changed)}</span>
            <span><b>What that means:</b> ${esc(item.consequence)}</span>
          </article>`).join("")}
      </div>
    </section>`;
}

function blindSpotSection() {
  const spots = activeBlindSpots(state);
  if (!spots.length) return "";
  const themes = recurringThemes(state);
  const lines = [
    ...themes.patterns.map((theme) => `\u201c${esc(theme.title)}\u201d (${theme.n} times)`),
    ...themes.reasons.map((theme) => `${esc(theme.label.toLowerCase())} (${theme.n} times)`)
  ];
  return `
    <section class="blind-section" aria-labelledby="blind-heading">
      <h2 id="blind-heading">Things Tastemake keeps getting wrong about you</h2>
      <p class="blind-intro">When Tastemake was confident you'd like something and you tried it and didn't, that is evidence about the model, not just a thumbs-down. These stay on record so it can see where it overreaches. Nothing here rewrites your patterns until the same thing keeps happening.</p>
      ${lines.length ? `<p class="blind-themes"><strong>Keeps coming up:</strong> ${lines.join("; ")}.</p>` : ""}
      <ul class="blind-list">
        ${spots.map((spot) => `
          <li class="blind-card">
            <div class="blind-card-head">
              <h3>${esc(spot.item.title)} <em>${esc(displayLabel(spot.item))}</em></h3>
              <span class="blind-status ${isRecurring(state, spot) ? "is-recurring" : ""}">${isRecurring(state, spot) ? "Recurring" : "Noted once"}</span>
            </div>
            ${renderBlindSpotPanel(spot.itemId)}
          </li>`).join("")}
      </ul>
    </section>`;
}

export function renderProfile() {
  const favoriteTitles = libraryItems(state).favorites.map((entry) => entry.item.title);
  const visibleFavoriteTitles = favoriteTitles.slice(0, 12);
  const hiddenFavoriteTitles = favoriteTitles.slice(12);
  const workingHypotheses = state.modelHypotheses ?? [];
  const { active: activeHypotheses, corrected: correctedHypotheses } = partitionProfilePatterns(workingHypotheses, state.patternStatements);
  const liveProfile = workingHypotheses.length > 0;
  const profileView = ["list", "full", "map"].includes(state.profileView) ? state.profileView : "list";
  const primaryHypotheses = activeHypotheses.slice(0, 6);
  const hasMorePatterns = activeHypotheses.length > primaryHypotheses.length;
  const shownHypotheses = profileView === "full" ? activeHypotheses : primaryHypotheses;

  return `
    <section class="profile-screen">
      ${renderStickerField("profile")}
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1><span class="profile-headline-lead">Less "you like fantasy."</span><br class="profile-headline-break" /><span class="profile-headline-highlight">More "this is what tends to click."</span></h1>
          <p class="lede profile-compact-lede">Working patterns based on what you’ve actually tried. Refine them when Tastemake gets you wrong.</p>
          ${state.hypothesisAiMessage ? `<div class="profile-ai-status profile-ai-status-compact ${state.hypothesisAiStatus === "loading" ? "is-loading" : ""}" role="status" aria-busy="${state.hypothesisAiStatus === "loading"}"><span class="profile-ai-status-dot" aria-hidden="true"></span><span>${esc(state.hypothesisAiMessage)}</span>${state.hypothesisAiStatus !== "loading" ? `<button class="button button-quiet profile-retry" type="button" data-action="retry-profile">${liveProfile ? "Refresh" : "Try again"}</button>` : ""}</div>` : ""}
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

            ${liveProfile ? (
        profileView === "map"
          ? renderTasteMap(activeHypotheses)
          : `
            <div class="profile-depth-head">
              <div>
                <p class="kicker">${profileView === "full" ? "Full profile" : "Current read"}</p>
                <h2>${profileView === "full" ? "All the patterns Tastemake is tracking." : "The patterns Tastemake is leaning on most."}</h2>
                <p>${profileView === "full"
                  ? "Refine any active pattern here."
                  : "The overview keeps the strongest six easy to scan."}</p>
              </div>
              <div class="profile-depth-tools">
                <div class="profile-view-toggle" role="group" aria-label="Taste Profile views">
                  <button type="button" class="button button-secondary profile-view-button" data-profile-view="list" aria-pressed="${profileView === "list"}">Overview</button>
                  <button type="button" class="button button-secondary profile-view-button" data-profile-view="full" aria-pressed="${profileView === "full"}">Full profile</button>
                  <button type="button" class="button button-secondary profile-view-button" data-profile-view="map" aria-pressed="${profileView === "map"}">Taste Map</button>
                </div>
              </div>
            </div>
            <h2 class="visually-hidden">Patterns Tastemake is working with</h2>
            <div class="profile-map">
              <aside class="profile-map-aside">
                <span class="profile-aside-number">${shownHypotheses.length}</span>
                <p>${profileView === "full" ? "active patterns in your full profile" : "patterns currently shaping the overview"}</p>
                <div class="profile-aside-note">working patterns, not one aesthetic &nearr;</div>
              </aside>
              <div class="signal-stack">${shownHypotheses.length ? shownHypotheses.map(hypothesisCard).join("") : `<div class="profile-no-active-patterns">No active patterns right now. Tastemake will keep learning from what you try.</div>`}</div>
            </div>
            <details class="profile-legend profile-legend-inline">
              <summary>What do the confidence labels mean?</summary>
              <ul>
                <li><strong>Emerging:</strong> an early pattern with limited support.</li>
                <li><strong>Supported:</strong> experienced evidence backs it.</li>
                <li><strong>Strong:</strong> several experienced items back it without stronger counterevidence.</li>
                <li><strong>Still learning:</strong> the evidence is mixed.</li>
                <li><strong>Less certain:</strong> repeated misses outweigh the support.</li>
              </ul>
            </details>
            ${profileView === "list" && hasMorePatterns ? `<div class="profile-more-callout">
              <div><strong>There’s more underneath the overview.</strong><span>Tastemake is tracking ${activeHypotheses.length} active patterns in total.</span></div>
              <div class="profile-more-actions">
                <button class="button button-secondary" type="button" data-profile-view="full">Explore full profile</button>
                <button class="button button-quiet" type="button" data-profile-view="map">See Taste Map</button>
              </div>
            </div>` : ""}
          `
      ) : `
        <div class="profile-empty" role="status">
          <strong>No generated patterns yet.</strong>
          <p>Tastemake needs more ratings from things you have actually tried before it can infer patterns responsibly. Favorites start the conversation; reactions give it evidence.</p>
          <button class="button button-primary" type="button" data-action="browse">Rate more things</button>
        </div>`}

      ${liveProfile && profileView === "list" ? learningPanel(primaryHypotheses) : ""}

      ${liveProfile && profileView !== "map" ? `<details class="profile-evidence-strip profile-evidence-collapsed">
        <summary>Built from ${favoriteTitles.length} favorite${favoriteTitles.length === 1 ? "" : "s"}</summary>
        <div class="profile-evidence-track">
          ${visibleFavoriteTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${esc(title)}</span>`).join("")}
          ${hiddenFavoriteTitles.length ? `<details class="profile-evidence-more"><summary>+${hiddenFavoriteTitles.length} more</summary><span class="profile-evidence-more-items">${hiddenFavoriteTitles.map((title, index) => `<span class="profile-evidence-item evidence-${((index + visibleFavoriteTitles.length) % 4) + 1}">${esc(title)}</span>`).join("")}</span></details>` : ""}
        </div>
      </details>` : ""}

      ${liveProfile && profileView !== "map" ? correctedPatternsSection(correctedHypotheses) : ""}
      ${profileView !== "map" ? blindSpotSection() : ""}

      <div class="profile-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">working patterns, not a fixed identity.</span>
        <div class="page-actions-right">
          ${canKeepDiscovering(state) ? `<button class="button button-primary" type="button" data-action="keep-discovering">Keep discovering &rarr;</button>` : `<button class="button button-primary" type="button" data-action="show-recs">Recommendations &rarr;</button>`}
        </div>
      </div>
    </section>`;
}
