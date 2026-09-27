# Tastemake handoff — Sept. 27, 2026

This is the current continuation guide for Tastemake. If older notes conflict with this file, issue #16, newer issue-specific acceptance criteria, or current `main`, trust the newer material.

## Current repo / production

- Repo: https://github.com/pedringt/tastemake
- Production: https://tastemake.vercel.app
- Current `main`: **3826a96558741b7c15f1388895040d1e35eddbcb**
- PR #130 is merged and deployed to production.
- PR #130 title: **Shrink recommendation context and hide internal evidence refs (#120 #129)**.
- Vercel production deployment for that merge completed successfully.
- PR #130 required CI was green before merge.
- Temporary eval PRs #132, #133 and #134 were closed and must not be merged.
- Old draft PR #104 predates several later changes. Do not merge it blindly. Rebuild/cherry-pick only still-relevant pieces against current main.

## Product north star

Tastemake helps people understand patterns in what they are drawn to, then uses those patterns to discover and test more things they may like.

The strongest product idea is not merely “better recommendations.”

> **Most recommenders let you react to items. Tastemake also lets you react to the model it builds from those reactions.**

Core authority model:

- software owns evidence, state, eligibility and mutation;
- AI interprets, ranks and explains;
- only experienced items become taste evidence;
- Saved / intent does not become experience;
- user-confirmed correction outranks model inference;
- Taste Profile patterns are working hypotheses, not personality labels;
- search/browse/opening an item is never taste evidence;
- model output must remain grounded in real evidence;
- novelty / repeat / franchise suppression is deterministic and cannot be overridden by the model.

## Current product model

- **Recommendations = discovery**
- **Library = ongoing relationship management**
- **Saved = might try / intent**
- **Tried = experienced history**
- **Favorite = strongest explicit experienced-positive signal**
- **Disliked / Not for me = experienced negative evidence**
- **Taste Profile = inspectable/correctable working model of taste**

Post-onboarding IA direction is tracked in #117.

Expected first-run:
1. choose Look;
2. pick at least 4 Favorites through Search/Browse;
3. brief “enough to start” transition;
4. Recommendations.

Expected returning use:
- onboarding screens should no longer dominate;
- chosen Look persists;
- Favorites setup is not a permanent primary surface;
- Library is where ongoing item relationships are managed;
- Browse remains available as alternate discovery;
- likely primary nav trends toward Recommendations / Taste Profile / Library / Look or Settings.

## Real catalog

Current providers:

- TMDb: movies + TV
- Open Library: books
- IGDB: games

Current related-candidate behavior in `src/catalog/related.mjs`:

### Movies / TV
For each usable TMDb-backed evidence item:
- call TMDb's recommendations endpoint;
- request up to 12 candidates.

This is currently the strongest retrieval path because TMDb provides provider-generated recommendations rather than Tastemake inferring relation from one genre.

### Games
For each usable IGDB-backed item:
- take up to 3 genre IDs;
- query IGDB for up to 12 games;
- order by popularity/ratings in the provider query.

This is workable but coarse.

### Books
For each usable Open Library-backed item:
- choose a meaningful subject;
- query Open Library for up to 12 rows;
- filter candidates using meaningful-subject overlap.

The conservative filter shipped in #130 prevents broad/noisy labels such as “New York Times bestseller” from creating absurd relationships.

However, it is now known to be **too narrow in some cases**. The post-merge large-history test reduced a 12-row book candidate pool to 4. #131 now owns balancing precision vs pool health.

### Multiple anchors

Overall retrieval can use up to 6 provider-backed evidence items:
- first 4 are loaded concurrently;
- the remaining 2 are only used if the first wave cannot produce a healthy pool.

Important limitation:

> a user can have a rich taste history while candidate retrieval still revolves around only the few items that have strong provider metadata.

That limitation is now a first-class architecture concern in #135.

## New architecture direction: canonical metadata + enrichment

Issue **#135** is the source of truth for the next recommendation-data architecture.

Desired flow:

> external providers / authoritative web sources → Tastemake canonical item store → deterministic candidate retrieval/scoring → AI ranking/explanation

### Persistence

Use **Neon Postgres** as the preferred persistent item/catalog store.

Reuse the infrastructure pattern already familiar from State, but keep products isolated:
- Tastemake gets its own database/project/schema and credentials;
- do not share State's application tables/data;
- Vercel remains the Tastemake app/serverless layer;
- Render is not needed merely to add a database.

### Canonical item data

The database should grow lazily around items users actually encounter. Do not attempt to pre-load every work in every medium.

Useful stored data includes:

- canonical Tastemake item ID;
- provider IDs / stable external IDs;
- media type/domain;
- title;
- creator/author/director/developer;
- year;
- series/franchise/collection;
- genres/subjects/themes where factual/provider-supplied;
- description;
- media-specific fields such as platforms, publisher, selected cast, page count, runtime;
- metadata provenance;
- retrieval/update timestamps;
- metadata completeness.

Keep **AI-inferred traits** separate from factual catalog metadata.

Examples of inferred traits:
- atmospheric
- melancholy
- slow-burn
- visually stylized
- politically intricate

Those can support taste reasoning, but they must never silently overwrite product truth.

### Enrichment

When an item is important and its metadata is thin:

1. normalize what the current provider already supplies;
2. detect missing high-value fields;
3. prefer structured/authoritative sources first;
4. use targeted web search only as fallback for specific missing facts;
5. store provenance with the enriched field;
6. cache/reuse it rather than repeating the same lookup every recommendation request.

Do not ask the model to simply “fill in” factual catalog metadata from memory.

## Candidate-generation direction

The target candidate pipeline is:

> several strong anchors → several meaningful retrieval queries → union/dedupe → deterministic relevance/quality scoring → novelty guard → AI shortlist ranking/explanation

Key design goals:

- prefer strong/rich anchors, not simply the first provider-backed item;
- enrich thin anchors when useful;
- use multiple meaningful retrieval traits where possible;
- treat relationship strength as graded, not always a brittle exact-match gate;
- reject candidates whose only relation is generic/noisy metadata;
- aim for roughly 10–20 credible candidates when providers can support it;
- do not force-fill garbage to hit a number;
- keep franchise/sequel suppression deterministic and downstream;
- keep full taste history available to software even when the model receives only a compact working set.

Do **not** solve candidate quality by stuffing huge metadata blobs into the model prompt.

Embeddings/vector search may be useful later, but are not required for the first version of this architecture.

## PR #130: recommendation context + internal-ref cleanup

PR #130 shipped three important changes.

### 1. Compact recommendation evidence

The server keeps full evidence for deterministic software/validation but sends the model a curated working set.

Current cap:
- maximum **18** experienced evidence records in the model prompt.

Selection:
- only experienced evidence;
- prioritizes strong positive, negative and positive signals;
- attempts to represent candidate domains;
- Saved/intent-only rows are not model taste evidence.

Compact prompt evidence sends only fields the model needs rather than full stored records.

### 2. Never expose internal evidence refs

Internal refs such as:

`ev:openlibrary-book-...`
`ev:tmdb-movie-...`
`ev:igdb-game-...`

remain available for structured grounding/citation validation but must never appear in user-facing prose.

Defense in depth:
- prompt instruction;
- server-side sanitizer;
- UI/render-boundary sanitizer;
- regression coverage.

Issue #129 is closed as completed.

### 3. Initial Open Library false-positive guard

The first #131 fix filters generic/noisy subjects and requires stronger subject overlap for rich book metadata.

That prevented the original Atomic-Habits-from-Way-of-Kings class of error, but the filter is now known to be too aggressive for candidate-pool health. Do not treat the current exact-overlap rule as the final book architecture.

## Performance measurements from #120 / #130

A controlled large-history production test used **59 total evidence records**.

### Before #130

- prompt: **25,163 chars**
- evidence payload: **18,756 chars**
- Anthropic input: **10,840 tokens**
- live model time: roughly **10.18–10.62s**
- median live call: roughly **10.31s**
- 2/3 model responses passed validation
- 1/3 made the paid call but was rejected and fell back

### After #130 on production

- prompt: **5,468 chars**
- evidence payload: **2,359 chars**
- model prompt evidence: **18 of 59** full-history rows
- Anthropic input: **2,265 tokens**
- live model calls: **8.25s, 8.12s, 9.47s**
- median live call: roughly **8.25s**
- 3/3 model responses passed validation
- no internal `ev:...` refs leaked into user-facing reasons

Observed reductions:
- prompt chars: about **78%**
- actual model input tokens: about **79%**
- median live-model latency: about **20%** in this small sample

### Important caveat

The after run had only 4 eligible book candidates because of the current #131 filter, while the before run had a larger candidate pool.

Therefore:
- the **token reduction is directly demonstrated**;
- the latency improvement is real for that run;
- do **not** attribute the full latency gain solely to context compaction.

The remaining ~8–9.5s model call means giant context was wasteful but not the whole latency problem.

## Current performance question

#120 remains open.

The next useful performance investigation is:

- how much of the remaining latency is inherent model generation latency;
- whether shorter output requirements materially help;
- whether recommendation rationales can be generated differently;
- whether a different model/task split is justified;
- whether the UI can reveal useful progress/results progressively;
- whether candidate retrieval and model ranking can be staged without weakening quality.

Measure before redesigning.

## Current issues Claude should read

### Highest relevance

- **#135** canonical metadata/enrichment layer + healthier candidate generation
- **#131** improve Open Library quality without collapsing the candidate pool
- **#120** recommendation latency/context measurement
- **#117** post-onboarding IA / returning-user behavior
- **#103** metadata / Taste Profile / Library state cleanup

### Related completed work

- **#129** internal evidence refs: closed, completed by #130
- **#121** recommendation card clipping/status alignment: closed
- **#122** Library search/state-aware add flow: closed
- **#92** deterministic sequel/franchise suppression: closed

### Stale overlapping PR warning

Draft PR **#104** predates several later changes to main. It contains some potentially useful work around metadata/Profile/Library, but assumptions about permanent Favorites management were superseded by #117.

Do not raw-merge #104.

## Recommended next sequence for Claude

1. Sync with current `main` at **3826a96558741b7c15f1388895040d1e35eddbcb**.
2. Read:
   - this file;
   - issue #16;
   - #135;
   - #131;
   - #120;
   - #117;
   - #103.
3. Inspect the current item/provider normalization before designing database tables.
4. Audit which useful TMDb/Open Library/IGDB fields are already fetched but discarded.
5. Propose the smallest coherent canonical-item schema in Neon.
6. Keep Tastemake persistence isolated from State.
7. Design lazy metadata enrichment with field-level provenance.
8. Redesign book retrieval so Atomic-Habits-like weak matches remain blocked without collapsing the candidate pool.
9. Audit movies/TV and games for equivalent small-pool or coarse-metadata failure modes.
10. Add deterministic retrieval tests before any paid model eval.
11. If paid Anthropic verification is useful, state the expected call count/cost and get Paige's explicit approval first.
12. Do not merge to main or production without Paige explicitly naming that destination in the current instruction.

## QA / eval policy

Default release check:
1. green required CI;
2. focused automated tests for changed behavior;
3. short live smoke of the affected flow;
4. desktop + representative mobile for UI work;
5. alternate Look only when the change is theme-sensitive.

The full every-Look/every-width sweep is optional unless a broad CSS/system change or a concrete regression justifies it.

Commands:

```bash
npm install
npm test
npm run test:full
node scripts/evals/run.mjs
node scripts/evals/run.mjs --producer endpoint --dry-run
node scripts/evals/run.mjs --producer endpoint --yes
```

Paid-model rule:
- state expected calls;
- estimate cost;
- get Paige's explicit approval;
- do not infer authorization from ordinary product testing.

## Workflow protection

- feedback/review is read-only until Paige closes the feedback round;
- implement only accepted scope;
- preserve unrelated work;
- no opportunistic refactors;
- never merge/push to `main`, production, staging or another shared environment unless Paige explicitly names that destination in the current instruction.
