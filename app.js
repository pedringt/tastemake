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
  selectedRecommendation: null,
  reaction: null,
  recommendationQuality: null,
  interest: null,
  reason: "",
  lastFeedback: null,
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

function feedbackDelta(feedback) {
  if (feedback.reaction === "not-tried") return 0;
  const reaction = ({ loved: 2, liked: 1, meh: -0.5, disliked: -1.5 })[feedback.reaction] || 0;
  const quality = ({ good: 1, maybe: 0, bad: -1.5 })[feedback.quality] || 0;
  return reaction + quality;
}

function hypothesisMatches(itemHypotheses, hypothesisId) {
  const aliases = hypothesisId === "H01/H07" ? ["H01", "H07", "H01/H07"] : [hypothesisId];
  return itemHypotheses.some((id) => aliases.includes(id));
}

function hypothesisSignal(hypothesisId, feedbacks = Object.values(state.feedbackByRecommendation)) {
  return feedbacks.reduce((sum, feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesisId) ? sum + feedbackDelta(feedback) : sum;
  }, 0);
}

function modelUpdateFor(hypothesis) {
  const related = Object.values(state.feedbackByRecommendation).filter((feedback) => {
    return feedback.reaction !== "not-tried" && hypothesisMatches(feedback.item.hypotheses, hypothesis.id);
  });
  if (!related.length) return { label: hypothesis.strength, status: hypothesis.status, note: null };
  const signal = related.reduce((sum, feedback) => sum + feedbackDelta(feedback), 0);
  if (signal >= 2) return { label: "Strengthened", status: "strengthened", note: `${related.length} experienced item${related.length === 1 ? "" : "s"} gave this idea more support.` };
  if (signal <= -1.5) return { label: "Needs revision", status: "revision", note: `${related.length} experienced item${related.length === 1 ? "" : "s"} pushed against this idea.` };
  return { label: "More conditional", status: "conditional", note: "Your reactions were mixed, so Tastemake should use this idea more cautiously." };
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
    prediction: item.score > 1 ? "Likely to like" : "Worth testing",
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

function startFeedback(id) {
  state.selectedRecommendation = id;
  const saved = state.feedbackByRecommendation[id];
  state.reaction = saved?.reaction || null;
  state.recommendationQuality = saved?.quality || null;
  state.interest = saved?.interest || null;
  state.reason = saved?.reason || "";
  state.screen = "recommendations";
  updateStepper();
  render();
  setTimeout(() => document.querySelector(".feedback-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
}

function updateStepper() {
  const order = ["favorites", "model", "recommendations", "changed"];
  const activeIndex = order.indexOf(state.screen);
  const hasEnoughFavorites = state.selectedFavorites.size >= 4;
  const unlocked = [
    true,
    hasEnoughFavorites,
    hasEnoughFavorites,
    currentRoundComplete()
  ];

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
        <p class="lede">You should not have to rebuild your entire media history. A small set of strong favorites is enough to form a first theory, then recommendations and feedback make it better.</p>

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
          <p><strong>${count} selected.</strong> Four is enough for this prototype.</p>
          <button class="primary-button" type="button" data-action="build-model" ${count < 4 ? "disabled" : ""}>Build my Taste Model</button>
        </div>
      </div>
    </section>`;
}

function hypothesisCard(item) {
  const update = modelUpdateFor(item);
  return `
    <article class="hypothesis-card">
      <div class="card-top">
        <span class="media-tag">Inferred · ${item.id}</span>
        <span class="status-pill ${update.status === "conditional" ? "conditional" : ""} ${update.status === "revision" ? "revision" : ""}">${update.label}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.claim}</p>
      <p class="hypothesis-evidence"><strong>Evidence:</strong> ${item.evidence}</p>
      ${update.note ? `<p class="model-change"><strong>After feedback:</strong> ${update.note}</p>` : ""}
    </article>`;
}

function renderModel() {
  const selectedTitles = favorites.filter((item) => state.selectedFavorites.has(item.id)).map((item) => item.title);
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">Your Taste Model</p>
        <h1>Not a list of genres. A set of testable ideas.</h1>
        <p class="lede">Tastemake keeps your explicit reactions separate from what it infers. The hypotheses below can strengthen, weaken, or change as recommendations succeed and fail.</p>

        <div class="evidence-panel">
          <strong>What you explicitly told Tastemake</strong>
          <div class="evidence-list">${selectedTitles.map((title) => `<span class="evidence-chip">${title}</span>`).join("")}</div>
        </div>

        <div class="section-header">
          <div>
            <h2>What Tastemake currently thinks</h2>
            <p>Strength describes how much evidence supports a hypothesis. It is not a claim that the system knows you with mathematical certainty.</p>
          </div>
        </div>

        <div class="hypothesis-grid">${hypotheses.map(hypothesisCard).join("")}</div>

        <div class="sticky-action model-next">
          <p><strong>Next:</strong> See what Tastemake recommends from this model.</p>
          <div class="action-group">
            <button class="primary-button" type="button" data-action="show-recs">Show recommendations</button>
            <button class="secondary-button" type="button" data-action="back-favorites">Edit favorites</button>
          </div>
        </div>
      </div>
    </section>`;
}

function recommendationCard(item, { interactive = true } = {}) {
  const heading = item.surprise ? "Surprise Me" : `#${item.rank}`;
  const saved = state.feedbackByRecommendation[item.id];
  const interaction = interactive
    ? `data-rate="${item.id}" role="button" tabindex="0" aria-label="${saved ? "Update rating for" : "Rate recommendation"}: ${item.title}"`
    : "";
  return `
    <article class="recommendation-card ${item.surprise ? "surprise" : ""} ${saved ? "is-rated" : ""}" ${interaction}>
      <div class="card-top">
        <span class="media-tag">${heading} · ${item.medium}</span>
        ${saved ? `<span class="rated-pill">Rated · ${prettyReaction(saved.reaction)}</span>` : `<span class="fit-pill">${item.fit}</span>`}
      </div>
      <h3>${item.title}</h3>
      <p class="about"><strong>What it is:</strong> ${item.about}</p>
      <p class="reason"><strong>Why Tastemake picked it:</strong> ${item.reason}</p>
      <div class="rec-footer">
        <div class="prediction">Predicted reaction: <strong>${item.prediction}</strong></div>
        ${interactive ? `<button class="primary-button" type="button" data-rate="${item.id}">${saved ? "Update rating" : "Rate this recommendation"}</button>` : ""}
      </div>
    </article>`;
}

function reactionButton(value, label) {
  return `<button class="option-button" type="button" data-reaction="${value}" aria-pressed="${state.reaction === value}">${label}</button>`;
}

function qualityButton(value, label) {
  return `<button class="option-button" type="button" data-quality="${value}" aria-pressed="${state.recommendationQuality === value}">${label}</button>`;
}

function interestButton(value, label) {
  return `<button class="option-button" type="button" data-interest="${value}" aria-pressed="${state.interest === value}">${label}</button>`;
}

function feedbackIsComplete() {
  return Boolean(state.reaction && (state.reaction === "not-tried" || state.recommendationQuality));
}

function renderFeedbackPanel(item) {
  if (!item) return "";
  const complete = feedbackIsComplete();
  const untried = state.reaction === "not-tried";
  return `
    <section class="feedback-panel" aria-label="Rate ${item.title}">
      <div class="feedback-panel-head">
        <div>
          <p class="kicker">Rate this recommendation</p>
          <h2>${item.title}</h2>
          <p><strong>What it is:</strong> ${item.about}</p>
        </div>
        <button class="secondary-button" type="button" data-action="close-feedback">Back to recommendations</button>
      </div>

      <form class="feedback-form inline-feedback-form" data-feedback-form>
        <div class="question">
          <strong>How did you actually feel about it?</strong>
          <div class="option-row">
            ${reactionButton("loved", "Loved")}
            ${reactionButton("liked", "Liked")}
            ${reactionButton("meh", "Meh")}
            ${reactionButton("disliked", "Disliked")}
            ${reactionButton("not-tried", "Haven't tried")}
          </div>
        </div>

        ${untried ? `
          <div class="question">
            <strong>Interested in trying it?</strong>
            <p class="helper">Optional. This is only an interest signal, not evidence that you would actually like it.</p>
            <div class="option-row">
              ${interestButton("yes", "Yes")}
              ${interestButton("maybe", "Maybe")}
              ${interestButton("no", "No")}
            </div>
          </div>
        ` : `
          <div class="question">
            <strong>Was this a good recommendation for you?</strong>
            <div class="option-row">
              ${qualityButton("good", "Good recommendation")}
              ${qualityButton("maybe", "Maybe")}
              ${qualityButton("bad", "Not a good recommendation")}
            </div>
          </div>
        `}

        <div class="question">
          <label for="feedback-reason"><strong>Anything Tastemake should know?</strong></label>
          <p class="helper">Optional. This is most useful when it explains something the rating alone would miss.</p>
          <textarea id="feedback-reason" name="reason" placeholder="Optional reason">${escapeHtml(state.reason)}</textarea>
        </div>

        <div class="actions feedback-actions">
          <button class="primary-button" type="submit" ${complete ? "" : "disabled"}>Save rating</button>
          <button class="secondary-button" type="button" data-action="close-feedback">Cancel</button>
        </div>
      </form>
    </section>`;
}

function renderRecommendations() {
  const items = activeRecommendations();
  const rated = currentRoundRatedCount();
  const complete = currentRoundComplete();
  const roundTwo = state.recommendationRound === 2;
  const selected = items.find((item) => item.id === state.selectedRecommendation);

  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">${roundTwo ? "Updated recommendations · Round 2" : "Recommendations · Round 1"}</p>
        <h1>${roundTwo ? "The model changed. So did the list." : "Recommendations you can react to."}</h1>
        <p class="lede">${roundTwo ? "This set is re-ranked from your first round of feedback. Items you had not tried stayed unconfirmed instead of being treated as taste evidence." : "Rate these one at a time. After each rating, you come right back here. Once the round is complete, Tastemake shows what actually changed in your model."}</p>

        <div class="round-progress"><strong>${rated} of ${items.length} rated</strong><span>${complete ? "Round complete" : "Rate the set to give Tastemake enough evidence to revise the model."}</span></div>

        ${selected ? renderFeedbackPanel(selected) : ""}

        <div class="recommendation-grid">${items.map(recommendationCard).join("")}</div>

        <div class="actions">
          ${complete ? `<button class="primary-button" type="button" data-action="view-round-summary">See what changed</button>` : ""}
          <button class="secondary-button" type="button" data-action="back-model">View Taste Model</button>
        </div>
      </div>
    </section>`;
}

function prettyReaction(value) {
  return ({ loved: "Loved", liked: "Liked", meh: "Meh", disliked: "Disliked", "not-tried": "Haven't tried" })[value] || value;
}

function prettyQuality(value) {
  return ({ good: "Good recommendation", maybe: "Maybe", bad: "Not a good recommendation" })[value] || value;
}

function prettyInterest(value) {
  return ({ yes: "Interested", maybe: "Maybe interested", no: "Not interested" })[value] || value;
}

function renderChanged() {
  if (!currentRoundComplete()) {
    return `
      <section class="screen">
        <div class="screen-inner">
          <p class="kicker">What Changed</p>
          <h1>Finish the recommendation round first.</h1>
          <p class="lede">Tastemake waits for the full set so it can show patterns across your feedback instead of overreacting to one item.</p>
          <div class="actions"><button class="primary-button" type="button" data-action="back-recommendations">Back to recommendations</button></div>
        </div>
      </section>`;
  }

  const roundFeedback = activeRecommendations().map((item) => state.feedbackByRecommendation[item.id]).filter(Boolean);
  const experienced = roundFeedback.filter((item) => item.reaction !== "not-tried");
  const positive = experienced.filter((item) => ["loved", "liked"].includes(item.reaction)).length;
  const negative = experienced.filter((item) => ["meh", "disliked"].includes(item.reaction)).length;
  const untried = roundFeedback.length - experienced.length;
  const good = experienced.filter((item) => item.quality === "good").length;
  const bad = experienced.filter((item) => item.quality === "bad").length;
  const changes = hypotheses
    .map((item) => ({ item, update: modelUpdateFor(item), signal: Math.abs(hypothesisSignal(item.id)) }))
    .filter((entry) => entry.update.note)
    .sort((a, b) => b.signal - a.signal);
  const lead = changes[0];

  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">What Changed · Round ${state.recommendationRound}</p>
        <h1>Here is what your feedback actually changed.</h1>
        <p class="lede">Tastemake combines the whole round before revising its model. Things you have not tried stay unconfirmed instead of becoming evidence about your taste.</p>

        <div class="learning-grid">
          <article class="learning-card">
            <span class="label">Your feedback</span>
            <strong>${experienced.length} tried · ${untried} untried</strong>
            <p>${positive} positive reaction${positive === 1 ? "" : "s"} · ${negative} weak/negative. ${good} good recommendation${good === 1 ? "" : "s"}${bad ? ` · ${bad} poor recommendation${bad === 1 ? "" : "s"}` : ""}.</p>
          </article>
          <article class="learning-card highlight">
            <span class="label">What got clearer</span>
            <strong>${lead ? lead.item.title : "No strong model change yet"}</strong>
            <p>${lead?.update.note || "There was not enough experienced-item feedback in this round to justify changing a taste hypothesis."}</p>
          </article>
          <article class="learning-card">
            <span class="label">What happens next</span>
            <strong>Recommendations re-rank</strong>
            <p>Supported patterns move up. Weak patterns move down. Untried items remain open questions rather than being counted as likes or dislikes.</p>
          </article>
        </div>

        <div class="callout">
          <strong>The model changes only when your actual experience supports it.</strong>
          <p>Interest in an unfamiliar recommendation can help with discovery, but Tastemake keeps that separate from evidence about what you enjoy.</p>
        </div>

        <div class="actions">
          <button class="primary-button" type="button" data-action="view-model">See updated Taste Model</button>
          ${state.recommendationRound === 1 ? `<button class="secondary-button" type="button" data-action="next-round">Get new recommendations</button>` : `<button class="secondary-button" type="button" data-action="back-recommendations">Back to recommendations</button>`}
        </div>
      </div>
    </section>`;
}

function render() {
  const views = {
    favorites: renderFavorites,
    model: renderModel,
    recommendations: renderRecommendations,
    changed: renderChanged
  };
  app.innerHTML = views[state.screen]();
}

function resetFeedback() {
  state.reaction = null;
  state.recommendationQuality = null;
  state.interest = null;
  state.reason = "";
}

function saveCurrentFeedbackIfComplete() {
  if (!state.selectedRecommendation || !feedbackIsComplete()) return false;
  const item = activeRecommendations().find((rec) => rec.id === state.selectedRecommendation);
  if (!item) return false;

  const saved = {
    item,
    reaction: state.reaction,
    quality: state.reaction === "not-tried" ? null : state.recommendationQuality,
    interest: state.reaction === "not-tried" ? state.interest : null,
    reason: state.reason.trim()
  };

  state.feedbackByRecommendation[item.id] = saved;
  state.lastFeedback = saved;
  return true;
}

function syncFeedbackControls() {
  document.querySelectorAll("[data-reaction]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.reaction === state.reaction));
  });
  document.querySelectorAll("[data-quality]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.quality === state.recommendationQuality));
  });
  document.querySelectorAll("[data-interest]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.interest === state.interest));
  });

  const submit = document.querySelector('[data-feedback-form] button[type="submit"]');
  if (submit) submit.disabled = !feedbackIsComplete();
}

function closeFeedback({ save = true } = {}) {
  if (save) saveCurrentFeedbackIfComplete();
  state.selectedRecommendation = null;
  resetFeedback();
  updateStepper();
  render();
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

  const rate = event.target.closest("[data-rate]");
  if (rate) {
    startFeedback(rate.dataset.rate);
    return;
  }

  const reaction = event.target.closest("[data-reaction]");
  if (reaction) {
    state.reaction = reaction.dataset.reaction;
    if (state.reaction === "not-tried") state.recommendationQuality = null;
    else state.interest = null;
    saveCurrentFeedbackIfComplete();
    render();
    setTimeout(() => document.querySelector(".feedback-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    return;
  }

  const quality = event.target.closest("[data-quality]");
  if (quality) {
    state.recommendationQuality = quality.dataset.quality;
    saveCurrentFeedbackIfComplete();
    syncFeedbackControls();
    return;
  }

  const interest = event.target.closest("[data-interest]");
  if (interest) {
    state.interest = interest.dataset.interest;
    saveCurrentFeedbackIfComplete();
    syncFeedbackControls();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "go-home" || action === "back-favorites") setScreen("favorites");
  if (action === "build-model" && state.selectedFavorites.size >= 4) setScreen("model");
  if (action === "show-recs") setScreen("recommendations");
  if (action === "back-model" || action === "view-model") setScreen("model");
  if (action === "close-feedback") closeFeedback({ save: true });
  if (action === "back-recommendations") setScreen("recommendations");
  if (action === "view-round-summary" && currentRoundComplete()) setScreen("changed");
  if (action === "next-round") {
    state.recommendationRound = 2;
    state.selectedRecommendation = null;
    state.lastFeedback = null;
    resetFeedback();
    setScreen("recommendations");
  }
});

app.addEventListener("input", (event) => {
  if (!event.target.matches("#feedback-reason")) return;
  state.reason = event.target.value;
  saveCurrentFeedbackIfComplete();
});

app.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-feedback-form]")) return;
  event.preventDefault();
  if (!saveCurrentFeedbackIfComplete()) return;

  const roundComplete = currentRoundComplete();
  state.selectedRecommendation = null;
  resetFeedback();

  if (roundComplete) setScreen("changed");
  else {
    state.screen = "recommendations";
    updateStepper();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

document.addEventListener("click", (event) => {
  const jump = event.target.closest("[data-step-jump]")?.dataset.stepJump;
  if (!jump) return;
  if (jump === "favorites") setScreen("favorites");
  if (jump === "model" && state.selectedFavorites.size >= 4) setScreen("model");
  if (jump === "recommendations" && state.selectedFavorites.size >= 4) setScreen("recommendations");
  if (jump === "changed" && currentRoundComplete()) setScreen("changed");
});

app.addEventListener("keydown", (event) => {
  const card = event.target.closest(".recommendation-card[data-rate]");
  if (!card || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  startFeedback(card.dataset.rate);
});

updateStepper();
render();