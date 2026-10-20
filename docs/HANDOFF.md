# Tastemake handoff: start here

Last refreshed **Oct 20, 2026**, against `main` at `304d4d0` (#254). If `main` has moved on, run `git log --oneline 304d4d0..origin/main` and read those PRs before trusting the "Current state" section. Where this file and the code disagree, the code wins; fix this file.

## What Tastemake is

A portfolio/learning product (not a commercial launch) that builds an inspectable, correctable **Taste Profile** from what someone has actually tried across Movies, TV, Books and Games, and uses it to recommend more.

Loop: **Favorites → Recommendations → react (Tried it: Loved / Liked / Didn't like; Not tried: Save / Not interested) → Taste Profile learns → better recommendations.** Library holds the ongoing relationship (Saved / Tried / Favorites). Product overview: [README.md](../README.md).

Authority model, in one line: **AI interprets, ranks and explains; the software owns evidence, state, eligibility and every change.** See [ai-contract.md](ai-contract.md).

## Where things live

| What | Where |
|---|---|
| Repo | https://github.com/pedringt/tastemake (squash merges to `main`; `main` has no branch protection) |
| Production | https://tastemake.vercel.app, Vercel project `tastemake`, team `cairn10`, Hobby plan. Every push to `main` deploys production; PR branches get Vercel previews |
| Front end | `index.html` + native ES modules in `src/` (no build step, no bundler). `src/screens/` (one file per screen), `src/model/` (evidence, taste, library rules), `src/actions/`, `src/components/`, `src/catalog/` (providers, search ranking, novelty and series rules), `src/ai/` (contract, validator, deterministic baseline, prompt context), `src/data/domains.js` (the one domain registry) |
| Serverless API (`api/`) | `recommendations.mjs` (picks), `hypotheses.mjs` (Taste Profile), `catalog.mjs` / `catalog-detail.mjs` / `browse.mjs` / `resolve-item.mjs` (TMDb, Open Library, IGDB), `ai-metrics.mjs` (read-only telemetry) |
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
- **Paid evals:** only through the **ai-eval** GitHub workflow (Actions → ai-eval → Run workflow).
  - Inputs: `models`, `repeats`, `max_calls`. It checks the call budget first, then uses the `ANTHROPIC_API_KEY` repo secret.
  - About 21 calls per model per repeat (11 Taste Profile, 10 picks). Worst-case cost from the Oct 12 dry run: about $0.03 for Haiku 5.5 and about $0.54 for Sonnet 5.5 per model per repeat.
  - Every paid run needs Paige's OK, with the call count and cost stated first.
- **Analytics:** Vercel Web Analytics and Speed Insights load with plain script tags (`src/lib/vercel-insights.js`, #234). Both script URLs returned 200 on production on Oct 12. Click-to-first-pick is measured as a `performance.measure` plus one "Recommendations shown" event with no titles or ids (#235). Privacy notes: [ai-readiness.md](ai-readiness.md) sections 8 and 9.

## Release process

1. Branch from a freshly fetched `origin/main`. Batch related changes into **one branch and one PR**: the Hobby plan's deploy limit is shared with Paige's other projects.
2. Run `npm test` locally. CI (`test`) and the Vercel preview must pass.
3. Model, prompt or context changes are product changes. Do a free dry run, then (with Paige's OK) a paid before/after on the `ai-eval` workflow. Never loosen a scorer to pass ([ai-evals.md](ai-evals.md)).
4. **Merge only with Paige's explicit OK, each time.** Squash merge. Merging deploys production.
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

## Current state and open work (Oct 20)

**Recently shipped (all on production):**
- #245: #28 stress-test harness (`scripts/evals/stress/`).
- #246: structured outputs (JSON schemas) for picks and the Taste Profile.
- #247: picks prompt asks for the specific link to the cited item and bans five stock phrases. Net gain on Haiku: vague hedges 31% -> 8% of explanations; "echo"-family words rose, but conspicuous repetition only went 4% -> 7% of sets (#260, calibrated against Paige's marks).
- #251 (#250 PR 1): reasons on tried reactions get directions for books ("Pacing: too slow"), content chips from a book's own subjects ("Romance took over the story"), a limit of 5, the Taste Profile's "You said" line, and anonymous usage counts.
- #253: one-click Favorites while picking (click a result to add or remove it); a ☆ on each search row after setup.
- #254: Library search button no longer 360px tall on phones; `stretchedControls` layout check.

**Open PRs (each waits for Paige's OK to merge):**
- **#258 book-review fixes** (closes #255, #256, #257): series position from Open Library (later books in a series are held back), the Taste Profile validator keeps a user's reasons with their own item and dimension, English edition titles, narrators dropped from authors, `genre:` tags for content chips, adult-tagged curveballs only if tried. Paid before/after on Haiku done (Oct 20, about $0.0125): rule checks pass; prompt wording change reverted.
- **#259 popover design pass:** one summary line, neutral chips that fill with ✓ when chosen, directions under their chip, and "This pick was: Too obvious · A great discovery" replacing "More feedback". Markup and CSS only.
- **#260 #28 Stage 0:** per-set repetition checks in the stress report (stock-word families, the "you … in <title>" frame, shared openings and phrases, would-trigger rate, 200-explanation minimum). Thresholds calibrated Oct 20 from 24 reference sets Paige marked (`scripts/evals/stress/reference-sets.json`); she kept 10/10 post-#247 sets and 1/14 pre-#247 ones. Vagueness, not stock words, is what she dropped sets for, so the report also measures a vague-hedge share.
- **#261 #28 Stage 1** (judge its paid run on hedge share and named titles, not only stock words; see the comment on #261): a required per-pick `anchor` (setting/character/structure/tone/theme/pacing/voice) before `why`, a positive rule, four varied examples, no banned list; the validator rejects a third same-anchor pick. **Needs a paid stress run before merging** (120 calls, about $0.03–0.09; or 372 to match Oct 20). Blocked on API credits as of Oct 20.
- **This PR's free fixes:** #243 ("The Making of …" no longer outranks a game's DLC) and swipe tests for #248.

**Open issues worth knowing:**
- **#250** (book reasons): PR 1 shipped; PR 2 (prompt labels with direction, candidate themes, tie-break for items with reasons) not started.
- **#249** (Hardcover): research done. Report: `reports/Hardcover as book metadata source.md` (local, git-excluded). Verdict: legitimate and useful for romance-central vs minor via tag counts, but beta and sparse; six questions for Hardcover listed there. `scripts/dev/hardcover-probe.mjs` checks the real schema once a free read-only token exists.
- **#252** cross-media "bridge picks" and "applies to … too": designed, not started.
- **#28** repetition: research report `reports/Reducing repetitive AI explanations.md`. Stage 0 (#260), Stage 1 (#261); Stage 2 is a runtime check that regenerates only flagged picks.
- **#248:** swipe already shipped (0077572); its wording half is superseded by #259. Close after #259 merges.
- **#19 Tastebreak:** v1 is offered only when a pick's `ai.tests` matches a pattern, and the picks prompt never sets `tests`, so it is unreachable for live picks. See the comment on #19.
- **Backlog:** #29, #37. **Parked by Paige:** #6, #7, #9, #10, #11, #14, #15, #17, #48, #69.

## Gotchas

- **No `.env` in commits, ever** (`.gitignore` covers it). Never read or print key or model env values.
- **No model calls in `npm test`.** Paid runs only via `ai-eval`, with Paige's OK.
- **Browser suites in a worktree:** `scripts/qa/headless.sh` writes its harness pages and Chrome profile under `.git/`. In a worktree `.git` is a file, so run the browser suites from a plain copy of the tree (for example `rsync` without `.git`, then `git init`).
- **Flow suite fails on leftover onboarded state:** delete the reused Chrome profile `.git/tm-chrome-profile` and re-run.
- **No build step:** a bare npm import in `src/` (`import x from "pkg"`) breaks the whole app in the browser. Production went blank once this way (#162, fixed in #168). Analytics now loads by script tag for this reason.
- **`main` is unprotected,** and automated PRs (Vercel installers, bots) have merged unreviewed before. At the start of a session, check `git log origin/main` for commits nobody expected.
- **Payload size:** `/api/recommendations` caps the request body. If a 413 comes back, look for new fields added to pick or feedback objects. Don't just trim another field (#163, #165).
- **Slow requests:** a recommendation request can take 10–20s. Before blaming the logic for an "X doesn't work" report, check the real latency in the Vercel logs or `/api/ai-metrics` (the #172 filter-click bug).
- **Unverified:** the canonical-store batching (#159) has not been spot-checked against a real Neon database since it landed.
- **Vercel previews lack catalog and AI keys** (checked Oct 20): `TASTEMAKE_TMDB_TOKEN`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` and the live-AI variables are set for Production only, so on a PR preview only books (Open Library) work and picks are the plain catalog fallback. Test movies/TV/games and live AI on production, or ask Paige to enable those variables for Preview.
- **Merging from an agent session:** Claude Code's auto-mode check blocks `gh pr merge` even with Paige's OK in chat. Paige merges on GitHub (Squash and merge, then Confirm), or allows `Bash(gh pr merge:*)` in her own settings.
- **Eval sample size:** wording metrics need about 200 explanations per variant to tell a 20% -> 10% change from noise; the 21-call `ai-eval` gives about 49. Use the stress eval for wording decisions.
- **Research notes and reports** live in `research_notes/` and `reports/` at the repo root, excluded locally via `.git/info/exclude` (not committed).
