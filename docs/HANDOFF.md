# Tastemake handoff: start here

Last refreshed **Oct 24, 2026**, against `main` at `30a3f33` (#285). If `main` has moved on, run `git log --oneline 30a3f33..origin/main` and read those PRs before trusting the "Current state" section. Where this file and the code disagree, the code wins; fix this file.

## What Tastemake is

A portfolio/learning product (not a commercial launch) that builds an inspectable, correctable **Taste Profile** from what someone has actually tried across Movies, TV, Books and Games, and uses it to recommend more.

Loop: **Favorites → Recommendations → react (Tried it: Loved / Liked / Didn't like; Not tried: Save / Not interested) → Taste Profile learns → better recommendations.** Library holds the ongoing relationship (Saved / Tried / Favorites). Product overview: [README.md](../README.md).

Authority model, in one line: **AI interprets, ranks and explains; the software owns evidence, state, eligibility and every change.** See [ai-contract.md](ai-contract.md).

## Where things live

| What | Where |
|---|---|
| Repo | https://github.com/pedringt/tastemake (PRs merge to `main` with merge commits since Oct 23; `main` has no branch protection) |
| Production | https://tastemake.vercel.app, Vercel project `tastemake`, team `cairn10`, Hobby plan. Every push to `main` deploys production (about 30 s). No PR previews (#264) |
| Front end | `index.html` + native ES modules in `src/` (no build step, no bundler). `src/screens/` (one file per screen), `src/model/` (evidence, taste, library rules), `src/actions/`, `src/components/`, `src/catalog/` (providers, search ranking, novelty and series rules), `src/ai/` (contract, validator, deterministic baseline, prompt context), `src/data/domains.js` (the one domain registry) |
| Serverless API (`api/`) | `recommendations.mjs` (picks), `hypotheses.mjs` (Taste Profile), `catalog.mjs` / `catalog-detail.mjs` (incl. where to watch) / `browse.mjs` / `resolve-item.mjs` (TMDb, Open Library, IGDB), `new-releases.mjs` (New this week, no model call), `ai-metrics.mjs` (read-only telemetry) |
| Outside data | TMDb, Open Library, IGDB, Wikidata (series positions and older books' years, by Open Library id), JustWatch via TMDb (where to watch; must be credited). Official APIs only, no scraping |
| Server helpers | `src/server/`: `anthropic.mjs` (live gate, Messages API call, `thinkingTypeFor`, JSON parsing), `ai-metrics.mjs` (per-model rates, telemetry), `db.mjs` (Neon Postgres via `TASTEMAKE_DATABASE_URL`), `request-state.mjs`, `cache.mjs`, `query.mjs` |
| User data | The browser's `localStorage` only (`src/persistence.js`). No accounts. The Neon database holds the canonical catalog store and AI-call telemetry, not user profiles |
| Tests | `scripts/qa/` (unit suites, headless-Chrome suites, `full-sweep.mjs`) |
| Evals | `scripts/evals/` (`run.mjs`, `fixtures.mjs`, `scorers.mjs`, `compare.mjs`, `reports/`); `scripts/evals/stress/` (#28 reasoning-at-scale harness) |
| CI | `.github/workflows/test.yml` (free gate on every push/PR), `.github/workflows/ai-eval.yml` and `stress-eval.yml` (paid, manual) |
| Background | `experiments/` (the original taste-model experiments), `notes/` (case-study notes) |

## Run, test, eval

- **Install:** `npm ci` (Node 24 in CI; the lockfile is committed, #233).
- **Run locally:** `python3 -m http.server 4173`, open http://localhost:4173. This serves the front end only; the `api/` functions and their keys run on Vercel, so try live AI on production or a preview.
- **`npm test`** is the required gate and what CI runs. It never calls a model. It runs:
  - `test:unit` (`scripts/qa/run-unit.mjs`: every no-browser suite, with a per-suite summary);
  - `test:model`, `test:flow`, `test:layout`, `test:a11y`, `test:browse-ui` (headless Chrome via `scripts/qa/headless.sh`);
  - `test:eval` (the free deterministic eval).
- **`npm run test:full`** is the slower manual sweep (every look and width). Run it before a risky change.
- **Evals:** [ai-evals.md](ai-evals.md). The free baseline runs inside `npm test`. `node scripts/evals/run.mjs --producer live --dry-run` shows the exact prompts, call count and cost estimate, and makes no call.

## AI setup and costs

- **Models (per Paige, Oct 12; the Vercel env values are not readable from the repo, and must never be read or printed):**
  - Recommendations: `claude-haiku-5-5` via `TASTEMAKE_RECOMMENDATIONS_MODEL`. Rollback: `claude-sonnet-5-5`. If the variable is unset, the code defaults to `claude-sonnet-5-5`.
  - Taste Profile: `claude-haiku-5-5` via `TASTEMAKE_AI_MODEL`. Rollback: `claude-sonnet-5`. Required; live AI is off without it.
  - Paige sets these in Vercel. Don't change Vercel settings yourself.
- **Thinking mode:** Sonnet 5.5 needs `thinking: between_tools` and rejects `disabled`. Haiku 5.5 (and every other model) needs `disabled` and rejects `between_tools`. `thinkingTypeFor` in `src/server/anthropic.mjs` maps this; keep it when changing models (#224, #226).
- **Live gate (fail-closed):** `liveConfig()` in `src/server/anthropic.mjs` needs all of these: `TASTEMAKE_AI_ENABLED`, the API key, the model, `TASTEMAKE_AI_RATE_LIMIT_CONFIRMED`, `TASTEMAKE_AI_SPEND_CAP_CONFIRMED`, and on production `TASTEMAKE_AI_PRODUCTION_APPROVED`. The Taste Profile also needs `TASTEMAKE_AI_HYPOTHESES_ENABLED`. Recommendations have a per-visitor rate limit (`DEFAULT_VISITOR_LIMIT` in `api/recommendations.mjs`). Any failure falls back to deterministic picks.
- **Live metrics:** https://tastemake.vercel.app/api/ai-metrics. Aggregate counts, latency, tokens and estimated cost by operation, over 30 days. No content and no model names. On Oct 12 it showed:
  - 98 calls, 91% success, about $2.16 estimated;
  - recommendations p50 about 6.5s;
  - Taste Profile p50 about 9s.
- **Two different API keys (Oct 23):** production uses the key in Vercel, and it works. The eval workflows use the `ANTHROPIC_API_KEY` GitHub repo secret, whose account was out of credits on Oct 23: every eval call came back "budget used up" (and cost $0). Paid evals stay blocked until that account has credits or the secret is changed. `node scripts/evals/run.mjs --producer endpoint --yes` uses production's key instead, but it can only measure what is deployed (no previews), so it works for a "before", not for a PR's "after".
- **Paid evals:** through the **ai-eval** and **stress-eval** GitHub workflows (Actions → Run workflow; `gh workflow run … --ref <branch>` runs a branch's code).
  - Inputs: `models`, `repeats`, `max_calls`. It checks the call budget first, then uses the `ANTHROPIC_API_KEY` repo secret.
  - About 21 calls per model per repeat (11 Taste Profile, 10 picks). Worst-case cost from the Oct 12 dry run: about $0.03 for Haiku 5.5 and about $0.54 for Sonnet 5.5 per model per repeat.
  - Every paid run needs Paige's OK, with the call count and cost stated first.
- **Analytics:** Vercel Web Analytics and Speed Insights load with plain script tags (`src/lib/vercel-insights.js`, #234). Both script URLs returned 200 on production on Oct 12. Click-to-first-pick is measured as a `performance.measure` plus one "Recommendations shown" event with no titles or ids (#235). Privacy notes: [ai-readiness.md](ai-readiness.md) sections 8 and 9.

## Release process

1. Branch from a freshly fetched `origin/main`. Batch related changes into **one branch and one PR**: the Hobby plan's deploy limit is shared with Paige's other projects.
2. Run `npm test` locally. CI (`test`) and the Vercel preview must pass.
3. Model, prompt or context changes are product changes. Do a free dry run, then (with Paige's OK) a paid before/after on the `ai-eval` workflow. Never loosen a scorer to pass ([ai-evals.md](ai-evals.md)).
4. **Merge only with Paige's explicit OK, each time.** Merging deploys production. When several PRs merge together, merge one at a time, wait for GitHub to recompute mergeability ("UNKNOWN" is not a conflict), and for a real conflict merge `main` into the branch, run `npm test`, push and wait for CI before merging.
5. After a merge, check production yourself (load the site; `/api/ai-metrics` for AI changes). Don't rely only on green checks.

## Product rules (do not break)

Full rulebook: [evidence-contract.md](evidence-contract.md). Validator rules: [ai-contract.md](ai-contract.md).

- **Untried items are never taste evidence.** Save, Not interested, searching, browsing and filters can only steer what comes next.
- **Favorites means tried only.** A Favorite is a strong positive layered on an experienced item.
- **One miss never weakens a pattern**; it takes two tried-and-disliked items.
- **Starter favorites are not tried evidence.** They can be cited, but they can't raise a pattern above "emerging" (#231).
- **Cross-domain patterns need tried evidence in both areas** (#229).
- User corrections ("Not really me", etc.) outrank model inference. Novelty, sequel and franchise suppression is deterministic and the model can't override it.
- No seeded or demo data.

## Current state and open work (Oct 24)

**Shipped Oct 20–24 (all on production):**
- **Recommendations and explanations:** #247 distinct explanations; #260 per-set repetition checks (stress eval); #268 no-AI picks name what they share with a favorite; #272 no raw catalog tags in reasons; #274 second-set headline; #282 (#250 PR 2) reasons with direction reach the picks prompt, candidate books carry approved themes, items with reasons win evidence ties, `--suite reasons` eval.
- **Books:** #251 (#250 PR 1) reasons with direction, content chips, "You said"; #258 series position, faithful reasons, English titles; #265 genre-first retrieval; #266 more later-in-series books caught, Tastebreak reachable again (#19); #269 Wikidata series positions; #276 + #280 + #285 study guides and legislature records filtered from search, Browse and recommendations (filter before the page limit); #280 lone mis-dated editions no longer set a modern book's year; this PR: older books' years from Wikidata.
- **New features:** #277 **Never recommend** (creator / series / genre; from a pick's "Don't recommend…" or My Tastemake; never taste evidence); #281 + #284 **Where to watch / read** in Library items (TMDb + JustWatch credit; one entry per service); #283 **New this week for you** (strip under the set; movies/TV/games, last and next 7 days, matched to experienced taste without AI; respects Never recommend); #275 Paige's Example Profile.
- **AI paused, honestly:** #263 calm budget message; #271 notice on Recommendations, "AI paused" header badge, honest empty Profile.
- **UI:** #253 one-click Favorites; #254, #259 popover design pass; #276 + #280 "More about why" opens below and closes reliably (click again or Escape); #280 counter says "reacted to"; "What changed" follows the direction of a confidence change; #273 favicon; this PR: Library sections show 30 with "Show all", only the open tab renders (#29).
- **Infrastructure:** #262 free fixes and Hardcover probe; #264 build only `main`; #270 browser tests start with empty storage and no HTTP cache.

**Open PRs (each waits for Paige's OK to merge):**
- **#261 #28 Stage 1** (per-pick anchor instead of banned phrases): needs the paid stress run (120 calls, about $0.03–0.09). Blocked on the GitHub eval key (above). Baseline to compare against: the Oct 20 `prompt/varied-pick-explanations` stress run.
- **#267 #252 part 1** ("Also true for" another area): needs a paid before/after with an eval case that actually uses "Also true for" (no fixture does yet; Paige chose to add one). About 42 calls, about $0.05. Same blocker.

**Open issues worth knowing:**
- **#250 PR 2** shipped (#282); its paid comparison (`--suite reasons`, 18 calls, about $0.022) is waiting on the eval key.
- **#252 part 2** bridge picks: designed in the issue, not started; it's the next big product step.
- **#278** eval: does each counter-example actually contradict its pattern? (paid grader). **#279** "up to date" next to Refresh (copy decision for Paige).
- **#29** Library growth: measurements posted on the issue (data size and speed fine at 500 items; length was the problem, now capped).
- **#6** New this week: books need a source of upcoming releases (#249 Hardcover, on hold); returning TV seasons aren't covered yet.
- **#10** Where to watch: Library only; recommendation cards don't fetch details.
- **#249** Hardcover: on hold by Paige. **#28** Stage 2 (regenerate only flagged picks) after Stage 1.
- **Parked by Paige:** #7, #9, #11, #14, #15, #17, #69.

## Gotchas

- **No `.env` in commits, ever** (`.gitignore` covers it). Never read or print key or model env values.
- **No model calls in `npm test`.** Paid runs only via `ai-eval`, with Paige's OK.
- **Browser suites in a worktree:** `scripts/qa/headless.sh` writes its harness pages and Chrome profile under `.git/`. In a worktree `.git` is a file, so run the browser suites from a plain copy of the tree (for example `rsync` without `.git`, then `git init`).
- **Browser suites "NO RESULT after 3 tries":** the reused Chrome profile `.git/tm-chrome-profile` can get stuck (seen Oct 21 after Chrome updated). Delete it; the harness rebuilds it. Leftover storage and cached files no longer leak between runs (#270).
- **No build step:** a bare npm import in `src/` (`import x from "pkg"`) breaks the whole app in the browser. Production went blank once this way (#162, fixed in #168). Analytics now loads by script tag for this reason.
- **`main` is unprotected,** and automated PRs (Vercel installers, bots) have merged unreviewed before. At the start of a session, check `git log origin/main` for commits nobody expected.
- **Payload size:** `/api/recommendations` caps the request body. If a 413 comes back, look for new fields added to pick or feedback objects. Don't just trim another field (#163, #165).
- **Slow requests:** a recommendation request can take 10–20s. Before blaming the logic for an "X doesn't work" report, check the real latency in the Vercel logs or `/api/ai-metrics` (the #172 filter-click bug).
- **Unverified:** the canonical-store batching (#159) has not been spot-checked against a real Neon database since it landed.
- **No PR previews** (#264, Oct 20): Vercel builds only `main`, so PRs get CI but no preview deploy, and every merge is the first time a change runs on Vercel. Before #264, previews also lacked the TMDb/IGDB and live-AI variables (Production only), so only books worked there. Check risky changes locally (`python3 -m http.server 4173`) and on production right after merging.
- **AI budget pause** (#263): when the Anthropic budget is used up, picks and the Taste Profile fall back with a calm "AI features are paused" message (`AI_BUDGET_MESSAGE` in `src/server/anthropic.mjs`). Fallback book picks are the raw catalog order, so retrieval quality matters most then (see `bookGenreFamilies` in `src/catalog/related.mjs`).
- **Merging from an agent session:** since Oct 23, `gh pr merge <n> --merge` works from Claude Code when Paige asks in chat. Before that the auto-mode check blocked it and Paige merged on GitHub.
- **Live checks cost money only on `/api/recommendations` and `/api/hypotheses`.** Catalog, detail, Browse and New this week make no model call. When AI is live, one recommendation request is one paid Haiku call.
- **Eval sample size:** wording metrics need about 200 explanations per variant to tell a 20% -> 10% change from noise; the 21-call `ai-eval` gives about 49. Use the stress eval for wording decisions.
- **Research notes and reports** live in `research_notes/` and `reports/` at the repo root, excluded locally via `.git/info/exclude` (not committed).
