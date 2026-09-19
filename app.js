const favorites = [
  { id: "lotr", title: "The Lord of the Rings", medium: "Book + film", note: "All-time favorite", selected: true },
  { id: "circe", title: "Circe", medium: "Book", note: "Mythic, adult, character-driven", selected: true },
  { id: "portal2", title: "Portal 2", medium: "Game", note: "Puzzle systems + specific humor", selected: true },
  { id: "alanwake2", title: "Alan Wake 2", medium: "Game", note: "Mystery + structure + tonal collision", selected: true },
  { id: "thefall", title: "The Fall", medium: "Movie", note: "Distinctive visual identity", selected: true },
  { id: "buffy", title: "Buffy the Vampire Slayer", medium: "TV", note: "Genre mixing + character", selected: true },
  { id: "starwars", title: "Original Star Wars trilogy", medium: "Film", note: "Adventure + worldbuilding", selected: false },
  { id: "breakingbad", title: "Breaking Bad", medium: "TV", note: "Moral messiness", selected: false }
];

const hypotheses = [
  {
    id: "H04",
    title: "Comedy works better when it has teeth",
    claim: "Absurd, abrasive, deconstructive, or highly specific comedy tends to fit better than warm, earnest comedy.",
    strength: "Strong",
    status: "strong",
    evidence: "Always Sunny, Eastbound & Down, MacGruber, Conan"
  },
  {
    id: "H05",
    title: "Fantasy lands when it feels adult",
    claim: "Mythic and fantastical material is a strong fit when the treatment feels mature, strange, serious, or formally distinctive.",
    strength: "Strong",
    status: "strong",
    evidence: "LOTR, Circe, Pan's Labyrinth, The Green Knight"
  },
  {
    id: "H03",
    title: "Moral messiness is not a turnoff",
    claim: "Compromised, selfish, abrasive, or manipulative characters can be a feature when the work has a strong point of view.",
    strength: "Strong",
    status: "strong",
    evidence: "Breaking Bad, Better Call Saul, The Americans, early Game of Thrones"
  },
  {
    id: "H01/H07",
    title: "Discovery needs structure",
    claim: "Mystery and exploration work best when goals, narrative, stakes, characters, or another system provide momentum.",
    strength: "Conditional",
    status: "conditional",
    evidence: "Alan Wake, Control, Obra Dinn vs. Outer Wilds, Myst"
  },
  {
    id: "H09",
    title: "Tonal collision is often a plus",
    claim: "Works that deliberately mix horror, comedy, fantasy, surrealism, or pulp can fit unusually well.",
    strength: "Conditional",
    status: "conditional",
    evidence: "Buffy, Twin Peaks, Control, Pan's Labyrinth"
  }
];

const recommendations = [
  {
    id: "eeaao",
    about: "A multiverse action-comedy about a laundromat owner pulled into increasingly strange alternate realities.",
    rank: 1,
    title: "Everything Everywhere All at Once",
    medium: "Movie",
    fit: "Very strong fit",
    prediction: "Likely to like",
    hypotheses: ["H04", "H08", "H09"],
    reason: "Absurd comedy, choreographed action, and deliberate tonal mixing all match established taste signals.",
    surprise: false
  },
  {
    id: "barry",
    about: "A dark comedy about a hitman who tries to leave crime behind after joining an acting class in Los Angeles.",
    rank: 2,
    title: "Barry",
    medium: "TV",
    fit: "Very strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04", "H09"],
    reason: "A morally compromised lead, dark comedy, and tonal shifts align with several strong parts of the model.",
    surprise: false
  },
  {
    id: "wwdits",
    about: "A mockumentary comedy about a group of selfish, centuries-old vampires sharing a house.",
    rank: 3,
    title: "What We Do in the Shadows",
    medium: "TV",
    fit: "Strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04", "H05"],
    reason: "Specific absurd comedy, selfish characters, and a supernatural frame make this a clean model match.",
    surprise: false
  },
  {
    id: "disco",
    about: "A dialogue-heavy detective RPG where you investigate a murder while rebuilding a deeply unstable protagonist.",
    rank: 4,
    title: "Disco Elysium",
    medium: "Game",
    fit: "Strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04"],
    reason: "Its morally messy protagonist and dark humor fit well, though dense dialogue remains an uncertainty.",
    surprise: false
  },
  {
    id: "inscryption",
    about: "A horror card game that gradually turns into a puzzle-box mystery and keeps changing its own rules.",
    rank: null,
    title: "Inscryption",
    medium: "Game",
    fit: "Exploratory fit",
    prediction: "Worth testing",
    hypotheses: ["H01", "H02", "H09"],
    reason: "The card-game format is outside the known pattern, but structured mystery, horror identity, and genre shifts create a deeper fit.",
    surprise: true
  }
];

const followUpPool = [
  {
    id: "fargo",
    title: "Fargo",
    medium: "TV",
    about: "A crime anthology series mixing violence, moral messiness, eccentric characters, and very dark humor.",
    hypotheses: ["H03", "H04"],
    reason: "Dark comedy and moral messiness give Tastemake two established signals to test together."
  },
  {
    id: "handmaiden",
    title: "The Handmaiden",
    medium: "Movie",
    about: "A stylized period thriller built around deception, shifting loyalties, and multiple reveals.",
    hypotheses: ["H03", "H01/H07"],
    reason: "Deception, morally complex characters, and structured reveals test whether mystery works best when it has strong narrative momentum."
  },
  {
    id: "golden-idol",
    title: "The Case of the Golden Idol",
    medium: "Game",
    about: "A deduction game where you inspect frozen crime scenes and reconstruct exactly what happened.",
    hypotheses: ["H01/H07"],
    reason: "Highly structured deduction makes this a focused test of the discovery-needs-structure hypothesis."
  },
  {
    id: "vita-nostra",
    title: "Vita Nostra",
    medium: "Book",
    about: "A strange adult fantasy about a student forced into a mysterious school that changes how she understands reality.",
    hypotheses: ["H05", "H01/H07"],
    reason: "Adult fantastical material and demanding strangeness test two parts of the model at once."
  },
  {
    id: "lighthouse",
    title: "The Lighthouse",
    medium: "Movie",
    about: "A surreal black-and-white psychological drama about two lighthouse keepers unraveling in isolation.",
    hypotheses: ["H04", "H09"],
    reason: "Black comedy, surrealism, and tonal collision make this useful when those signals are holding up."
  },
  {
    id: "yellowjackets",
    title: "Yellowjackets",
    medium: "TV",
    about: "A survival mystery following a girls soccer team after a crash and the adults they later become.",
    hypotheses: ["H03", "H09"],
    reason: "Messy characters, horror, and tonal shifts make this a broader cross-signal test."
  },
  {
    id: "dnd",
    title: "Dungeons & Dragons: Honor Among Thieves",
    medium: "Movie",
    about: "A fast-moving fantasy adventure about a mismatched group of thieves trying to fix a very bad mistake.",
    hypotheses: ["H05", "H04"],
    reason: "Fantasy plus comedy tests whether those signals still work when the tone is lighter and more conventional."
  }
];

const state = {
  screen: "favorites",
  selectedFavorites: new Set(favorites.filter((item) => item.selected).map((item) => item.id)),
  feedbackByRecommendation: {},
  recommendationRound: 1
};

const app = document.querySelector("#app");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tasteDelta(feedback) {
  if (!feedback || feedback.rating === "not-tried") return 0;

  if (feedback.rating === "more") {
    if (feedback.detail === "loved-before") return 2;
    if (feedback.detail === "want-to-try") return 0;
    if (feedback.detail === "surprising-fit") return 1.25;
    if (feedback.detail === "exactly-my-taste") return 1.75;
    return 0.75;
  }

  if (feedback.rating === "less") {
    if (feedback.detail === "tried-disliked") return -2;
    if (feedback.detail === "not-interested") return 0;
    if (feedback.detail === "wrong-vibe") return -1.5;
    if (feedback.detail === "too-obvious") return 0;
    return -0.75;
  }

  return 0;
}

function recommendationDelta(feedback) {
  if (!feedback) return 0;

  let score = ({ more: 1, less: -1, "not-tried": 0 })[feedback.rating] || 0;
  const detailAdjustments = {
    "loved-before": 0.75,
    "want-to-try": 0.5,
    "surprising-fit": 0.5,
    "exactly-my-taste": 0.75,
    "tried-disliked": -0.75,
    "not-interested": -0.5,
    "wrong-vibe": -0.75,
    "too-obvious": -0.5,
    interested: 0.35,
    "maybe-interested": 0.1,
    "not-interested-untried": -0.35
  };

  return score + (detailAdjustments[feedback.detail] || 0);
}

function hypothesisMatches(itemHypotheses, hypothesisId) {
  const aliases = hypothesisId === "H01/H07" ? ["H01", "H07", "H01/H07"] : [hypothesisId];
  return itemHypotheses.some((id) => aliases.includes(id));
}

function hypothesisSignal(hypothesisId, feedbacks = Object.values(state.feedbackByRecommendation)) {
  return feedbacks.reduce((sum, feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesisId) ? sum + recommendationDelta(feedback) : sum;
  }, 0);
}

function tasteSignal(hypothesisId, feedbacks = Object.values(state.feedbackByRecommendation)) {
  return feedbacks.reduce((sum, feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesisId) ? sum + tasteDelta(feedback) : sum;
  }, 0);
}

function modelUpdateFor(hypothesis) {
  const related = Object.values(state.feedbackByRecommendation).filter((feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesis.id) && tasteDelta(feedback) !== 0;
  });

  if (!related.length) return { label: hypothesis.strength, status: hypothesis.status, note: null };

  const signal = related.reduce((sum, feedback) => sum + tasteDelta(feedback), 0);
  if (signal >= 1.5) {
    return {
      label: "Stronger",
      status: "strengthened",
      note: "Your reactions gave this pattern more support."
    };
  }
  if (signal <= -1.5) {
    return {
      label: "Less certain",
      status: "revision",
      note: "Your reactions suggest this pattern should carry less weight."
    };
  }
  return {
    label: "Still learning",
    status: "conditional",
    note: "Your feedback added signal, but not enough to make this pattern much stronger or weaker yet."
  };
}

function roundOneFeedback() {
  return recommendations.map((item) => state.feedbackByRecommendation[item.id]).filter(Boolean);
}

function followUpRecommendations() {
  const scored = followUpPool.map((item) => {
    const score = item.hypotheses.reduce((sum, id) => sum + hypothesisSignal(id, roundOneFeedback()), 0);
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 4).map((item, index) => ({
    ...item,
    rank: index + 1,
    fit: item.score > 1 ? "Stronger after feedback" : item.score < 0 ? "Cautious fit" : "Promising fit",
    prediction: item.score > 1 ? "Likely to fit" : "Worth testing",
    surprise: false
  }));

  const surpriseSource = scored.slice(4)[0] || scored[scored.length - 1];
  const surprise = {
    ...surpriseSource,
    rank: null,
    fit: "Exploratory fit",
    prediction: "Worth testing",
    surprise: true,
    reason: `${surpriseSource.reason} This is the less-obvious option for the next round.`
  };

  return [...top, surprise];
}

function activeRecommendations() {
  return state.recommendationRound === 1 ? recommendations : followUpRecommendations();
}

function currentRoundRatedCount() {
  return activeRecommendations().filter((item) => state.feedbackByRecommendation[item.id]).length;
}

function currentRoundComplete() {
  return currentRoundRatedCount() === activeRecommendations().length;
}

function updateStepper() {
  const order = ["favorites", "model", "recommendations"];
  const activeIndex = order.indexOf(state.screen);
  const hasEnoughFavorites = state.selectedFavorites.size >= 4;
  const unlocked = [true, hasEnoughFavorites, hasEnoughFavorites];

  document.querySelectorAll(".step").forEach((step, index) => {
    step.disabled = !unlocked[index];
    step.classList.toggle("is-active", index === activeIndex);
    step.classList.toggle("is-complete", index < activeIndex);
  });
}

function setScreen(screen) {
  state.screen = screen;
  updateStepper();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => app.focus({ preventScroll: true }), 0);
}

function favoriteCard(item, index) {
  const selected = state.selectedFavorites.has(item.id);
  const sizeClass = ["tile-xl", "tile-md", "tile-lg", "tile-md", "tile-lg", "tile-sm", "tile-md", "tile-sm"][index] || "tile-md";

  return `
    <button class="favorite-tile ${sizeClass} favorite-tone-${index + 1}" type="button" data-favorite="${item.id}" aria-pressed="${selected}">
      <span class="favorite-tape" aria-hidden="true"></span>
      <div class="favorite-tile-top">
        <span class="favorite-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="favorite-medium">${item.medium}</span>
        <span class="favorite-check" aria-hidden="true">✓</span>
      </div>
      <div class="favorite-tile-copy">
        <h3>${item.title}</h3>
        <p>${item.note}</p>
      </div>
    </button>`;
}

function renderFavorites() {
  const count = state.selectedFavorites.size;
  return `
    <section class="favorites-screen">
      <div class="favorites-hero">
        <div>
          <p class="kicker">Build your starter mix</p>
          <h1>Pick the things that feel the most <span class="marker-word">you.</span></h1>
          <p class="lede">No giant onboarding quiz. A handful of strong favorites is enough to start.</p>
        </div>
        <div class="favorites-side-note" aria-hidden="true">
          <span>your taste,</span>
          <strong>not a genre box.</strong>
          <span class="note-arrow">↙</span>
        </div>
      </div>

      <div class="taste-board" aria-label="Starter favorites">
        ${favorites.map(favoriteCard).join("")}
      </div>

      <div class="favorites-footer">
        <div class="selection-counter">
          <span class="selection-number">${count}</span>
          <span>selected<br /><small>4 is enough to start</small></span>
        </div>
        <div class="action-group">
          <button class="secondary-button" type="button" data-action="view-model" ${count < 4 ? "disabled" : ""}>Peek at my taste</button>
          <button class="primary-button" type="button" data-action="show-recs" ${count < 4 ? "disabled" : ""}>Show me what I might like →</button>
        </div>
      </div>
    </section>`;
}

function hypothesisCard(item, index) {
  const update = modelUpdateFor(item);
  const confidenceLabel = update.label === item.strength ? item.strength : update.label;
  return `
    <article class="signal-row signal-row-${index + 1}">
      <div class="signal-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-main">
        <div class="signal-title-row">
          <h3>${item.title}</h3>
          <span class="signal-status ${update.status}">${confidenceLabel}</span>
        </div>
        <p class="signal-claim">${item.claim}</p>
        <div class="signal-evidence"><span>shows up in</span> ${item.evidence}</div>
        ${update.note ? `<div class="signal-update"><strong>New signal:</strong> ${update.note}</div>` : ""}
      </div>
    </article>`;
}

function renderModel() {
  const selectedTitles = favorites.filter((item) => state.selectedFavorites.has(item.id)).map((item) => item.title);
  return `
    <section class="profile-screen">
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1>Less “you like fantasy.”<br /><span>More “this is what tends to click.”</span></h1>
          <p class="lede">These are working patterns Tastemake uses in the background. They can get stronger, softer, or more specific as you react.</p>
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

      <div class="profile-evidence-strip">
        <span class="profile-evidence-label">Built from</span>
        <div class="profile-evidence-track">
          ${selectedTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${title}</span>`).join("")}
        </div>
      </div>

      <div class="profile-map">
        <aside class="profile-map-aside">
          <span class="profile-aside-number">${hypotheses.length}</span>
          <p>patterns currently shaping your recommendations</p>
          <div class="profile-aside-note">not permanent labels ↗</div>
        </aside>

        <div class="signal-stack">
          ${hypotheses.map(hypothesisCard).join("")}
        </div>
      </div>

      <div class="profile-footer">
        <span class="footer-note">useful if you are curious. invisible if you are not.</span>
        <div class="action-group">
          <button class="text-button" type="button" data-action="back-favorites">Edit favorites</button>
          <button class="primary-button" type="button" data-action="show-recs">Back to recommendations →</button>
        </div>
      </div>
    </section>`;
}

function ratingLabel(value) {
  return ({
    more: "More like this",
    less: "Less like this",
    "not-tried": "Haven't tried"
  })[value] || value;
}

function ratingButton(itemId, value, label, icon, saved) {
  const pressed = saved?.rating === value;
  return `
    <button
      class="rating-button"
      type="button"
      data-feedback-item="${itemId}"
      data-rating="${value}"
      aria-pressed="${pressed}"
    ><span aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

function detailOptionsFor(feedback) {
  if (!feedback) return [];

  if (feedback.rating === "more") {
    return [
      ["loved-before", "Loved it before"],
      ["want-to-try", "Want to try"],
      ["surprising-fit", "Surprising fit"],
      ["exactly-my-taste", "Exactly my taste"]
    ];
  }

  if (feedback.rating === "less") {
    return [
      ["tried-disliked", "Tried it and disliked it"],
      ["not-interested", "Not interested"],
      ["wrong-vibe", "Wrong vibe"],
      ["too-obvious", "Too obvious"]
    ];
  }

  return [
    ["interested", "Interested"],
    ["maybe-interested", "Maybe"],
    ["not-interested-untried", "Not interested"]
  ];
}

function feedbackDetails(itemId, feedback) {
  if (!feedback) return "";

  const options = detailOptionsFor(feedback);
  const prompt = feedback.rating === "not-tried"
    ? "Interested in trying it? Optional."
    : "Want to add a little context? Optional.";

  return `
    <div class="feedback-details">
      <span class="feedback-detail-prompt">${prompt}</span>
      <div class="detail-chip-row">
        ${options.map(([value, label]) => `
          <button
            class="detail-chip"
            type="button"
            data-feedback-item="${itemId}"
            data-feedback-detail="${value}"
            aria-pressed="${feedback.detail === value}"
          >${label}</button>
        `).join("")}
      </div>
    </div>`;
}

function mediaArt(item, index) {
  const shortTitle = item.title
    .replace(/\b(the|a|an|of|in|and|at|to)\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");

  return `
    <div class="editorial-art art-${item.id} art-layout-${(index % 4) + 1}" aria-hidden="true">
      <span class="art-kicker">${item.medium}</span>
      <span class="art-shape art-shape-a"></span>
      <span class="art-shape art-shape-b"><function recommendationCard(item, index) {
  const saved = state.feedbackByRecommendation[item.id];
  const layoutClass = item.surprise ? "rec-surprise" : `rec-layout-${index + 1}`;

  return `
    <article class="editorial-rec ${layoutClass} ${saved ? "is-rated" : ""}" data-rec-id="${item.id}">
      ${item.surprise ? `<span class="surprise-burst" aria-hidden="true">GO<br />WEIRD</span>` : ""}

      ${mediaArt(item, index)}

      <div class="editorial-rec-body">
        <div class="editorial-rec-meta">
          <span>${item.surprise ? "Surprise Me" : `Pick ${String(index + 1).padStart(2, "0")}`}</span>
          <span>${item.medium}</span>
        </div>

        <div class="editorial-title-row">
          <h3>${item.title}</h3>
          ${saved ? `<span class="reaction-stamp reaction-${saved.rating}">✓ ${ratingLabel(saved.rating)}</span>` : ""}
        </div>

        <p class="editorial-about">${item.about}</p>

        <details class="editorial-why">
          <summary>Why this one?</summary>
          <p>${item.reason}</p>
        </details>

        <div class="reaction-rail" aria-label="Rate ${item.title}">
          ${ratingButton(item.id, "more", "More", "👍", saved)}
          ${ratingButton(item.id, "less", "Less", "👎", saved)}
          ${ratingButton(item.id, "not-tried", "Not tried", "○", saved)}
        </div>

        ${feedbackDetails(item.id, saved)}
      </div>
    </article>`;
}
function renderRoundRefresh(roundTwo) {
  if (!currentRoundComplete()) return "";

  if (!roundTwo) {
    return `
      <div class="refresh-banner">
        <div>
          <span class="refresh-kicker">Nice. That is enough signal.</span>
          <strong>Want a fresh set?</strong>
          <p>Your reactions can now reshape what Tastemake shows next.</p>
        </div>
        <button class="primary-button" type="button" data-action="refresh-recommendations">Refresh recommendations</button>
      </div>`;
  }

  return `
    <div class="refresh-banner is-finished">
      <div>
        <span class="refresh-kicker">Prototype round complete</span>
        <strong>Tastemake would keep learning from here.</strong>
        <p>This prototype stops after two recommendation sets.</p>
      </div>
      <button class="secondary-button" type="button" data-action="view-model">View Taste Profile</button>
    </div>`;
}

function renderRecommendations() {
  const items = activeRecommendations();
  const rated = currentRoundRatedCount();
  const roundTwo = state.recommendationRound === 2;
  const segments = items.map((_, index) => `<span class="progress-segment ${index < rated ? "is-filled" : ""}"></span>`).join("");

  return `
    <section class="recommendations-screen">
      <div class="recommendations-masthead">
        <div class="rec-masthead-copy">
          <p class="kicker">${roundTwo ? "Fresh picks" : "For you right now"}</p>
          <h1>${roundTwo ? "Okay, that changed things." : "Things worth your time."}</h1>
          <p class="lede">${roundTwo
            ? "A new set shaped by what you just told Tastemake."
            : "Movies, shows, books, games, and the occasional curveball. React in one tap and keep moving."}</p>
        </div>

        <div class="rec-progress-card">
          <div class="rec-progress-top">
            <strong>${rated}/${items.length}</strong>
            <span>rated</span>
          </div>
          <div class="progress-track" aria-hidden="true">${segments}</div>
          <div class="progress-note">${currentRoundComplete() ? "new set unlocked ↘" : "teach it by using it"}</div>
        </div>
      </div>

      ${renderRoundRefresh(roundTwo)}

      <div class="editorial-grid">
        ${items.map(recommendationCard).join("")}
      </div>

      <div class="recommendation-footer">
        <span class="footer-note">discover. react. repeat.</span>
        <div class="actions">
          <button class="secondary-button" type="button" data-action="view-model">See my Taste Profile</button>
          <button class="text-button" type="button" data-action="back-favorites">Change favorites</button>
        </div>
      </div>
    </section>`;
}
function render() {
  const views = {
    favorites: renderFavorites,
    model: renderModel,
    recommendations: renderRecommendations
  };
  app.innerHTML = views[state.screen]();
}

function saveQuickFeedback(itemId, rating) {
  const item = activeRecommendations().find((rec) => rec.id === itemId);
  if (!item) return false;

  state.feedbackByRecommendation[itemId] = {
    item,
    rating,
    detail: null
  };

  return true;
}

function saveFeedbackDetail(itemId, detail) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.detail = existing.detail === detail ? null : detail;
  return true;
}

function renderPreservingCardPosition(itemId) {
  const before = document.querySelector(`[data-rec-id="${itemId}"]`);
  const beforeTop = before?.getBoundingClientRect().top;

  updateStepper();
  render();

  if (beforeTop === undefined) return;
  const after = document.querySelector(`[data-rec-id="${itemId}"]`);
  if (!after) return;

  const afterTop = after.getBoundingClientRect().top;
  window.scrollBy({ top: afterTop - beforeTop, left: 0, behavior: "auto" });
}

app.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = favorite.dataset.favorite;
    if (state.selectedFavorites.has(id)) state.selectedFavorites.delete(id);
    else state.selectedFavorites.add(id);
    updateStepper();
    render();
    return;
  }

  const rating = event.target.closest("[data-rating][data-feedback-item]");
  if (rating) {
    const itemId = rating.dataset.feedbackItem;
    if (saveQuickFeedback(itemId, rating.dataset.rating)) {
      renderPreservingCardPosition(itemId);
    }
    return;
  }

  const detail = event.target.closest("[data-feedback-detail][data-feedback-item]");
  if (detail) {
    const itemId = detail.dataset.feedbackItem;
    if (saveFeedbackDetail(itemId, detail.dataset.feedbackDetail)) {
      renderPreservingCardPosition(itemId);
    }
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "go-home" || action === "back-favorites") setScreen("favorites");
  if (action === "view-model" && state.selectedFavorites.size >= 4) setScreen("model");
  if (action === "show-recs" && state.selectedFavorites.size >= 4) setScreen("recommendations");

  if (action === "refresh-recommendations" && currentRoundComplete() && state.recommendationRound === 1) {
    state.recommendationRound = 2;
    setScreen("recommendations");
  }
});

document.addEventListener("click", (event) => {
  const jump = event.target.closest("[data-step-jump]")?.dataset.stepJump;
  if (!jump) return;

  if (jump === "favorites") setScreen("favorites");
  if (jump === "model" && state.selectedFavorites.size >= 4) setScreen("model");
  if (jump === "recommendations" && state.selectedFavorites.size >= 4) setScreen("recommendations");
});

updateStepper();
render();