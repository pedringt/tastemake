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

const state = {
  screen: "favorites",
  selectedFavorites: new Set(favorites.filter((item) => item.selected).map((item) => item.id)),
  selectedRecommendation: null,
  reaction: null,
  recommendationQuality: null,
  reason: "",
  lastFeedback: null
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

function updateStepper() {
  const order = ["favorites", "model", "recommendations", "feedback", "learned"];
  const activeIndex = order.indexOf(state.screen);
  document.querySelectorAll(".step").forEach((step, index) => {
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
  return `
    <article class="hypothesis-card">
      <div class="card-top">
        <span class="media-tag">Inferred · ${item.id}</span>
        <span class="status-pill ${item.status === "conditional" ? "conditional" : ""}">${item.strength}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.claim}</p>
      <p class="hypothesis-evidence"><strong>Evidence:</strong> ${item.evidence}</p>
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

        <div class="actions">
          <button class="secondary-button" type="button" data-action="back-favorites">Edit favorites</button>
          <button class="primary-button" type="button" data-action="show-recs">Show recommendations</button>
        </div>
      </div>
    </section>`;
}

function recommendationCard(item) {
  const heading = item.surprise ? "Surprise Me" : `#${item.rank}`;
  return `
    <article class="recommendation-card ${item.surprise ? "surprise" : ""}">
      <div class="card-top">
        <span class="media-tag">${heading} · ${item.medium}</span>
        <span class="fit-pill">${item.fit}</span>
      </div>
      <h3>${item.title}</h3>
      <p class="subtitle">Signals: ${item.hypotheses.join(" + ")}</p>
      <p class="reason">${item.reason}</p>
      <div class="rec-footer">
        <div class="prediction">Predicted reaction: <strong>${item.prediction}</strong></div>
        <button class="primary-button" type="button" data-rate="${item.id}">Rate this recommendation</button>
      </div>
    </article>`;
}

function renderRecommendations() {
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">Recommendations</p>
        <h1>Fit first. Favorite-level certainty later.</h1>
        <p class="lede">Experiment 003 showed that Tastemake was better at choosing good fits than predicting which fits would become favorites. So this view separates model fit from expected reaction.</p>

        <div class="recommendation-grid">${recommendations.map(recommendationCard).join("")}</div>

        <div class="actions">
          <button class="secondary-button" type="button" data-action="back-model">View Taste Model</button>
        </div>
      </div>
    </section>`;
}

function reactionButton(value, label) {
  return `<button class="option-button" type="button" data-reaction="${value}" aria-pressed="${state.reaction === value}">${label}</button>`;
}

function qualityButton(value, label) {
  return `<button class="option-button" type="button" data-quality="${value}" aria-pressed="${state.recommendationQuality === value}">${label}</button>`;
}

function renderFeedback() {
  const item = recommendations.find((rec) => rec.id === state.selectedRecommendation) || recommendations[0];
  const complete = state.reaction && state.recommendationQuality;
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">Feedback</p>
        <h1>Two questions teach Tastemake different things.</h1>
        <p class="lede">Your reaction tells it whether the taste prediction was right. Recommendation quality tells it whether this item was worth surfacing to you in the first place.</p>

        <div class="feedback-layout">
          <aside class="feedback-summary">
            ${recommendationCard({ ...item, rank: item.rank || "", surprise: item.surprise }).replace(/<button class="primary-button"[\s\S]*?<\/button>/, "")}
          </aside>
          <form class="feedback-form" data-feedback-form>
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

            <div class="question">
              <strong>Was this a good recommendation for you?</strong>
              <div class="option-row">
                ${qualityButton("good", "Good recommendation")}
                ${qualityButton("maybe", "Maybe")}
                ${qualityButton("bad", "Not a good recommendation")}
              </div>
            </div>

            <div class="question">
              <label for="feedback-reason"><strong>Anything Tastemake should know?</strong></label>
              <p class="helper">Optional. This is strongest when it explains a surprise, such as "I liked the story but hated the gameplay."</p>
              <textarea id="feedback-reason" name="reason" placeholder="Optional reason">${escapeHtml(state.reason)}</textarea>
            </div>

            <div class="actions">
              <button class="secondary-button" type="button" data-action="cancel-feedback">Back</button>
              <button class="primary-button" type="submit" ${complete ? "" : "disabled"}>Show what Tastemake learned</button>
            </div>
          </form>
        </div>
      </div>
    </section>`;
}

function learningCopy(feedback) {
  const positiveReaction = ["loved", "liked"].includes(feedback.reaction);
  const weakReaction = ["meh", "disliked"].includes(feedback.reaction);
  const goodRec = feedback.quality === "good";
  const badRec = feedback.quality === "bad";
  const leadHypothesis = feedback.item.hypotheses[0];

  if (positiveReaction && goodRec) {
    return {
      hypothesis: `${leadHypothesis} gets supporting evidence`,
      inference: `The fit signal behind ${feedback.item.title} held up, but Tastemake should still avoid assuming a good fit will become a favorite.`,
      change: "Keep this taste pattern active. Recommend adjacent items, but use conservative enjoyment language."
    };
  }

  if (badRec) {
    return {
      hypothesis: `${leadHypothesis} needs less weight for recommendations`,
      inference: `Even if some traits matched, surfacing ${feedback.item.title} did not feel useful. Recommendation quality should reduce this route's ranking weight.`,
      change: "Show fewer items whose fit depends mainly on this signal until more evidence supports it."
    };
  }

  if (weakReaction) {
    return {
      hypothesis: `${leadHypothesis} gets contradictory evidence`,
      inference: "The model found a plausible fit, but the actual reaction was weaker. That means the hypothesis may be conditional or missing an important counter-signal.",
      change: "Lower confidence on similar recommendations and look for a second supporting signal before ranking them highly."
    };
  }

  return {
    hypothesis: `${leadHypothesis} stays uncertain`,
    inference: "This feedback does not strongly support or reject the current hypothesis, but it adds a useful boundary case.",
    change: "Treat similar items as exploratory rather than safe recommendations until more feedback arrives."
  };
}

function prettyReaction(value) {
  return ({ loved: "Loved", liked: "Liked", meh: "Meh", disliked: "Disliked", "not-tried": "Haven't tried" })[value] || value;
}

function prettyQuality(value) {
  return ({ good: "Good recommendation", maybe: "Maybe", bad: "Not a good recommendation" })[value] || value;
}

function renderLearned() {
  const feedback = state.lastFeedback;
  if (!feedback) {
    setScreen("recommendations");
    return "";
  }
  const learned = learningCopy(feedback);
  return `
    <section class="screen">
      <div class="screen-inner">
        <p class="kicker">What Tastemake learned</p>
        <h1>Keep the evidence. Revise the theory.</h1>
        <p class="lede">Your explicit feedback is stored as what you said. Tastemake's interpretation is separate, so the inference can change later without rewriting your evidence.</p>

        <div class="learning-grid">
          <article class="learning-card">
            <span class="label">What you said</span>
            <strong>${prettyReaction(feedback.reaction)}</strong>
            <p>${prettyQuality(feedback.quality)}${feedback.reason ? ` · “${escapeHtml(feedback.reason)}”` : ""}</p>
          </article>
          <article class="learning-card highlight">
            <span class="label">Model update</span>
            <strong>${learned.hypothesis}</strong>
            <p>${learned.inference}</p>
          </article>
          <article class="learning-card">
            <span class="label">What changes next</span>
            <strong>Recommendation behavior</strong>
            <p>${learned.change}</p>
          </article>
        </div>

        <div class="callout">
          <strong>${feedback.item.title} is now evidence, not just a result.</strong>
          <p>The point of the loop is not to make every recommendation perfect. It is to make successes and failures improve the model in a way the user can inspect.</p>
        </div>

        <div class="actions">
          <button class="primary-button" type="button" data-action="rate-another">Rate another recommendation</button>
          <button class="secondary-button" type="button" data-action="view-model">View Taste Model</button>
        </div>
      </div>
    </section>`;
}

function render() {
  const views = {
    favorites: renderFavorites,
    model: renderModel,
    recommendations: renderRecommendations,
    feedback: renderFeedback,
    learned: renderLearned
  };
  app.innerHTML = views[state.screen]();
}

function resetFeedback() {
  state.reaction = null;
  state.recommendationQuality = null;
  state.reason = "";
}

app.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = favorite.dataset.favorite;
    if (state.selectedFavorites.has(id)) state.selectedFavorites.delete(id);
    else state.selectedFavorites.add(id);
    render();
    return;
  }

  const rate = event.target.closest("[data-rate]");
  if (rate) {
    state.selectedRecommendation = rate.dataset.rate;
    resetFeedback();
    setScreen("feedback");
    return;
  }

  const reaction = event.target.closest("[data-reaction]");
  if (reaction) {
    state.reaction = reaction.dataset.reaction;
    render();
    return;
  }

  const quality = event.target.closest("[data-quality]");
  if (quality) {
    state.recommendationQuality = quality.dataset.quality;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "go-home" || action === "back-favorites") setScreen("favorites");
  if (action === "build-model" && state.selectedFavorites.size >= 4) setScreen("model");
  if (action === "show-recs") setScreen("recommendations");
  if (action === "back-model" || action === "view-model") setScreen("model");
  if (action === "cancel-feedback" || action === "rate-another") setScreen("recommendations");
});

app.addEventListener("input", (event) => {
  if (event.target.matches("#feedback-reason")) state.reason = event.target.value;
});

app.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-feedback-form]")) return;
  event.preventDefault();
  if (!state.reaction || !state.recommendationQuality) return;
  const item = recommendations.find((rec) => rec.id === state.selectedRecommendation);
  state.lastFeedback = {
    item,
    reaction: state.reaction,
    quality: state.recommendationQuality,
    reason: state.reason.trim()
  };
  setScreen("learned");
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
