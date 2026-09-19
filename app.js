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

function favoriteCard(item) {
  const selected = state.selectedFavorites.has(item.id);
  return `
    <button class="favorite-card" type="button" data-favorite="${item.id}" aria-pressed="${selected}">
      <div class="card-top">
        <span class="media-tag">${item.medium}</span>
        <span class="select-dot" aria-hidden="true">✓</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.note}</p>
    </button>`;
}

function renderFavorites() {
  const count = state.selectedFavorites.size;
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">Start with signal, not homework</p>
        <h1>Give Tastemake a few things you really like.</h1>
        <p class="lede">You should not have to rebuild your entire media history. A small set of strong favorites is enough to start making recommendations, then your reactions make them better.</p>

        <div class="section-header">
          <div>
            <h2>Your starter set</h2>
            <p>This demo is prefilled with six favorites from the pilot taste profile. Change the mix to see how onboarding would feel.</p>
          </div>
        </div>

        <div class="favorite-grid">
          ${favorites.map(favoriteCard).join("")}
        </div>

        <div class="sticky-action">
          <p><strong>${count} selected.</strong> Four is enough to start. Your Taste Profile stays available if you want to inspect it.</p>
          <div class="action-group">
            <button class="primary-button" type="button" data-action="show-recs" ${count < 4 ? "disabled" : ""}>Get recommendations</button>
            <button class="secondary-button" type="button" data-action="view-model" ${count < 4 ? "disabled" : ""}>Preview Taste Profile</button>
          </div>
        </div>
      </div>
    </section>`;
}

function hypothesisCard(item) {
  const update = modelUpdateFor(item);
  return `
    <article class="hypothesis-card">
      <div class="card-top">
        <span class="media-tag">Inferred pattern</span>
        <span class="status-pill ${update.status === "conditional" ? "conditional" : ""} ${update.status === "revision" ? "revision" : ""}">${update.label}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.claim}</p>
      <p class="hypothesis-evidence"><strong>Based on:</strong> ${item.evidence}</p>
      ${update.note ? `<p class="model-change"><strong>From your feedback:</strong> ${update.note}</p>` : ""}
    </article>`;
}

function renderModel() {
  const selectedTitles = favorites.filter((item) => state.selectedFavorites.has(item.id)).map((item) => item.title);
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">Your Taste Profile</p>
        <h1>What Tastemake thinks tends to work for you.</h1>
        <p class="lede">You do not need to manage this profile for Tastemake to work. It is here if you want to see the patterns behind your recommendations and how your feedback is affecting them.</p>

        <div class="evidence-panel">
          <strong>Favorites you gave Tastemake</strong>
          <div class="evidence-list">${selectedTitles.map((title) => `<span class="evidence-chip">${title}</span>`).join("")}</div>
        </div>

        <div class="section-header">
          <div>
            <h2>Patterns Tastemake is using</h2>
            <p>These are working ideas, not permanent labels. Tastemake can strengthen or soften them as you react to recommendations.</p>
          </div>
        </div>

        <div class="hypothesis-grid">${hypotheses.map(hypothesisCard).join("")}</div>

        <div class="sticky-action model-next">
          <p><strong>Ready?</strong> Recommendations are the part that matters most. This profile can stay in the background.</p>
          <div class="action-group">
            <button class="primary-button" type="button" data-action="show-recs">View recommendations</button>
            <button class="secondary-button" type="button" data-action="back-favorites">Edit favorites</button>
          </div>
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

function mediaArt(item) {
  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("");

  return `
    <div class="media-art media-art-${item.id}" aria-hidden="true">
      <span class="media-art-grid"></span>
      <span class="media-art-title">${item.surprise ? "SURPRISE" : initials}</span>
      <span class="media-art-type">${item.medium}</span>
    </div>`;
}

function recommendationCard(item) {
  const heading = item.surprise ? "Surprise Me" : `#${item.rank}`;
  const saved = state.feedbackByRecommendation[item.id];

  return `
    <article class="recommendation-card ${item.surprise ? "surprise" : ""} ${saved ? "is-rated" : ""}" data-rec-id="${item.id}">
      ${item.surprise ? `<span class="surprise-sticker" aria-hidden="true">TRY ME</span>` : ""}
      <div class="card-top">
        <span class="media-tag">${heading} · ${item.medium}</span>
        ${saved
          ? `<span class="rated-pill rated-${saved.rating}">✓ ${ratingLabel(saved.rating)}</span>`
          : `<span class="fit-pill">${item.fit}</span>`}
      </div>

      <div class="card-content-grid">
        <div class="card-copy">
          <h3>${item.title}</h3>
          <p class="about">${item.about}</p>

          <details class="why-details">
            <summary>Why this recommendation?</summary>
            <p>${item.reason}</p>
          </details>
        </div>

        ${mediaArt(item)}
      </div>

      <div class="quick-feedback" aria-label="Rate ${item.title}">
        <span class="quick-feedback-label">Your take</span>
        <div class="rating-controls">
          ${ratingButton(item.id, "more", "More like this", "👍", saved)}
          ${ratingButton(item.id, "less", "Less like this", "👎", saved)}
          ${ratingButton(item.id, "not-tried", "Haven't tried", "○", saved)}
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
    <section class="screen recommendations-screen">
      <div class="screen-inner recommendations-inner">
        <div class="recommendations-hero">
          <div class="hero-copy">
            <span class="hero-doodle hero-doodle-left" aria-hidden="true">⌁</span>
            <p class="kicker">${roundTwo ? "Updated recommendations" : "Recommendations"}</p>
            <h1>${roundTwo ? "A fresh set, tuned by your feedback." : "Your recommendations"}</h1>
            <p class="lede">${roundTwo
              ? "A little more you, now that Tastemake has a few reactions to work with."
              : "Discover things that fit your taste. React as you go and Tastemake gets better at what it puts in front of you."}</p>
            <span class="hero-doodle hero-doodle-right" aria-hidden="true">✦</span>
          </div>

          <div class="hero-progress">
            <strong>${rated} of ${items.length} rated</strong>
            <div class="progress-track" aria-hidden="true">${segments}</div>
            <span class="progress-note">${currentRoundComplete() ? "ready for another set" : "a more you, coming right up."}</span>
          </div>
        </div>

        ${renderRoundRefresh(roundTwo)}

        <div class="recommendation-grid">${items.map(recommendationCard).join("")}</div>

        <div class="recommendation-footer">
          <span class="footer-note">same taste. brighter days. ✦</span>
          <div class="actions">
            <button class="secondary-button" type="button" data-action="view-model">View Taste Profile</button>
            <button class="text-button" type="button" data-action="back-favorites">Edit favorites</button>
          </div>
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