# Tastemake handoff — Sept 28, 2026

This is the current continuation guide for Tastemake. If older notes conflict with this file, issue #16, newer issue-specific acceptance criteria, or current `main`, trust the newer material.

## Current repo / production

- Repo: https://github.com/pedringt/tastemake
- Production: https://tastemake.vercel.app
- Current `main`: **d2f12c907296cae6cc6304ed92efa4fa7c9fbaf8**
- Vercel production deployment for that commit is Ready, confirmed directly (not just via GitHub's own status).
- Required CI was green on every PR before merge this session.
- Draft PR #101 ("Refresh Claude Code handoff") is unrelated/stale from an earlier session — inspect before touching, don't assume it's still relevant.
- Old draft PR #104 (metadata/Profile/Library/Favorites) was reconciled and closed in an earlier session — its useful pieces shipped as #116/#118/#119. Nothing outstanding there.

## Product north star

Tastemake helps people understand patterns in what they are drawn to, then uses those patterns to discover and test more things they may like.

> Most recommenders let you react to items. Tastemake also lets you react to the model it builds from those reactions.

Core authority model (unchanged, do not re-litigate without new evidence):
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
- **Library = ongoing relationship management** (Saved / Tried / Favorite / Disliked)
- **Favorite = strongest explicit experienced-positive signal** — as of this session, Library is the *single* durable source of truth for this (see "Post-onboarding IA" below). There is no longer a second parallel Favorite representation.
- **Taste Profile = inspectable/correctable working model of taste**

## Post-onboarding IA — done (#117, closed)

Implemented and verified live across three PRs (#118, #119, #116):
- Root-path routing bug fixed: a returning (onboarded) user hitting `/` lands on Recommendations, not the Look picker. A fresh visitor still starts at Look.
- Favorites/Browse hidden from the persistent top nav once onboarding completes (still directly reachable by URL, from Library, or from the new in-Recommendations link). Reuses the existing `.is-onboarding` CSS class — no new state.
- "Browse by genre instead" added inside Recommendations as Browse's permanent post-onboarding home.
- **Library is now the durable source of truth for Favorites.** Onboarding's `selectedFavorites` is migrated into the real Library model (a `loved-before` reaction + `libraryFavorites` flag) the instant onboarding completes, then cleared. `app.js`'s `hasEnoughFavorites()` and `browse.js`'s equivalent now also accept `state.onboarded` since the Set they used to check gets cleared. A former starter Favorite is now a normal, fully correctable Library item (reaction-correction UI, "Remove from Favorites" keeps the Tried record) — verified live end-to-end.
- Per-media-type metadata (director/cast, creator/cast, developer/publisher/platforms) added via a lazy on-demand detail fetch (`api/catalog-detail.mjs`), plus the "Storm Riders" expanded-Library-card wrap/overflow fix.

Related follow-ups already closed this session: #106/#107/#108/#109 (search ranking, recommendation style, Saved-removal cleanup, cross-media dedup — all merged as #110, confirmed live for #106 specifically), #111 (Browse v1 + its post-onboarding role), #121 (card clipping/status-chip alignment), #122 (state-aware Library search), #92 (franchise-continuation regression, root cause: the novelty guard's comparison set was narrowed to only a candidate's direct `relatedTo` anchor instead of the full accumulated evidence set).

## Recommendation latency (#120) — instrumented, root cause found, still open

Real production timing data (Vercel runtime logs, not guessed):
- Median total request time was ~11.7s, with the **live Anthropic call itself consistently 85–95% of total time** (11.8s of 13.3s in one fully-instrumented sample). Candidate retrieval/validation/novelty guard were all under 2s combined — never the bottleneck.
- Confirmed: prompt size was genuinely large before optimization — 25,163 chars / 10,840 input tokens on one real request.
- **Fixed in #130** (by a prior ChatGPT-assisted session, verified with a real before/after paid eval): capped model-visible evidence at 18 records (full history still kept for deterministic use), stripped unneeded fields. Measured: 25,163→5,468 prompt chars (−78%), 10,840→2,265 input tokens (−79%), ~10.31s→~8.25s median live-call time (−20%), 2/3→3/3 validation pass rate. Honest caveat: candidate pool sizes differed between the before/after test runs, so the full latency gain isn't purely attributable to context-shrinking.
- Also fixed in #130: internal `ev:...` evidence refs were leaking into user-facing recommendation text (#129, closed).
- **Remaining ~8–9.5s is flagged as likely inherent model generation time**, not something context-trimming alone will fix further. #120 stays open — the next real step (per the issue itself) is measuring whether shorter output requirements, a different model/task split, or progressive UI reveal helps, not another round of prompt-shrinking. Token/prompt-size logging (`[tastemake-recommendations-timing]` with `promptSize`/`evidenceChars`/`candidatesChars` breakdown) is already live for whoever picks this up next.
- No paid-model verification should happen without stating call count + cost and getting Paige's explicit approval first — this was followed carefully throughout (every real call this session was approved individually before running).

## Canonical item store (#135) — foundation built, two real bugs found and fixed, one algorithm improvement shipped

A dedicated Neon Postgres project ("Tastemake", id `icy-scene-02345609`) now exists, fully isolated from the separate "State" projects on the same account. Connection string lives only in Vercel's `TASTEMAKE_DATABASE_URL` env var (production/preview/development) — never in code or git.

Schema (do not recreate, do not change without a clear reason):
- `items` — canonical identity + media-specific `factual` JSONB + separate `traits` JSONB (AI-inferred, never merged into `factual`) + `metadata_completeness` score
- `item_identifiers` — multi-provider-ID resolution, namespaced by media type inside `canonical-store.mjs` (e.g. `"tmdb:movie"` vs `"tmdb:tv"`) since TMDb movie/TV ids can collide numerically
- `item_field_provenance` — source/timestamp/trust per field

Built (`src/server/db.mjs`, `src/catalog/canonical-store.mjs`): an injectable Neon client and `normalizeCanonicalItem()`/`upsertCanonicalItem()`, wired into `searchCatalog()` and `retrieveCatalogCandidates()` as a fire-and-forget write-behind — **not yet a read path**. Candidate retrieval still hits live provider APIs every time; nothing reads from this store yet. That swap is explicitly deferred to a future PR once the store has accumulated real coverage.

**Two real bugs shipped with the first version and were only caught by verifying against production directly, not by trusting green tests:**
1. (#139) Write-behind promises were never awaited by design (to avoid response latency), but Vercel can freeze a serverless function's execution environment the instant its response is sent — so they had no guarantee of ever completing. Fixed with `waitUntil` from `@vercel/functions` (already a dependency, already used for the runtime cache), which safely no-ops outside a real Vercel request context.
2. (#140) `db.mjs` called `sql.query(text, params)`, but `neon()`'s returned client is itself the callable query function with no `.query()` method — every real write was throwing, silently swallowed by the write-behind's own catch handler. One-line fix, plus a new test seam (`sqlImpl` param) and a regression test shaped exactly like the real driver, since the existing tests all mocked one level too high to catch this class of bug.

Verified live after both fixes: triggered a real request, confirmed no error in runtime logs, queried Neon directly, confirmed real rows landing (8 books from one query, correct `metadata_completeness` scores).

**One real production call surfaced two more findings while verifying #131's fix:**
- Confirmed #131 fixed for real: 19 candidates vs. the documented collapse to 4, live Anthropic call succeeded cleanly.
- Also surfaced #142 (new): the direct sequel to a loved book could still occupy a primary recommendation slot, because `openLibraryItem()` never carried a `providerMeta` relationship signal at all (unlike movies/TV/games). Investigated directly against Open Library's real API before writing a fix — confirmed it does support `series_key` (works for e.g. Harry Potter) but genuinely lacks it for the exact book pair that surfaced this (Way of Kings / Words of Radiance). Partial fix shipped (#143): wired `series_key` into the novelty guard wherever Open Library actually has it. Left open — the residual gap (books Open Library has no series data for) is real and documented as an accepted test case, not silently claimed as fixed.

### Candidate-generation quality (#131) — fixed

`openLibraryRelated()` redesigned: was one query against `sourceSubjects[0]` with a hard pass/fail overlap gate; now queries the top 2-3 meaningful subjects concurrently, merges/dedupes by Open Library work key, and grades overlap strength (2+ overlaps = strong, exactly 1 against a richer source = weak-but-kept, 0 = rejected) instead of a single gate. Real before/after (live Open Library network call, no mocks): 4 → 19 candidates for the exact regression scenario, while the original Atomic-Habits-style false positive stays correctly excluded.

Movies/TV (`tmdbRelated()`) and games (`igdbRelated()`) were audited for the same brittle-single-query failure mode and found already healthy — no change made to either, reported honestly rather than forcing an unnecessary change.

Also added: `lookupMetadataCompleteness()` in `canonical-store.mjs` — a best-effort, 250ms-timeout, fail-silent batch read used to prefer richer-metadata anchors within the existing domain-balancing scheme. Scoped down deliberately; does not change which domains are represented, never blocks retrieval.

## What's genuinely still open, in rough priority order

1. **#120** — recommendation latency. Instrumentation and one real context-shrinking round done; remaining ~8-9.5s needs a different kind of investigation (inherent model generation time vs. further prompt work vs. perceived-loading UX). See above for exactly what's already measured.
2. **#135** — canonical store foundation is live and writing real data; the actual "read candidates from the store instead of live provider calls" swap, and the web-enrichment fallback for thin metadata, are both still unbuilt. Don't start either without re-reading the full issue — there are real constraints (no AI-invented facts, lazy growth only, provenance required).
3. **#142** — book sequel-suppression residual gap (Open Library has no series data for some real books). No further action planned without new direction; flagged as a known limitation.
4. **#103** — broader metadata/Profile/Library/post-onboarding cleanup umbrella. Its post-onboarding pieces are done (see above); it's intentionally kept open as a pointer to #135 for the remaining database/enrichment/retrieval pieces. Don't treat it as separately actionable — work through #135 instead.
5. **#100** — enable Vercel Web Analytics/Speed Insights, establish a latency baseline using the new timing logs. Not started.
6. **#29** — Library IA validation at larger real history sizes. Not urgent; revisit if Paige's own real usage grows enough to matter.
7. **#115** — exact-match search ranking (from #106's fix) can promote an obscure title over a well-known one with a longer official title (e.g. a companion web series over a flagship film). Two real reproductions on file. Not started.
8. Long-tail future/idea issues, parked, no new signal to revisit: #6, #7, #9, #10, #11, #14, #15, #17, #19, #28, #37, #48, #69.

## Standing workflow rules (all followed carefully this session, keep following them)

- Feedback/QA requests are read-only unless Paige separately authorizes fixes.
- Only merge to `main` on Paige's explicit instruction, every time — passing CI is never permission.
- Before any *intentional* paid Anthropic call: state expected call count + cost estimate, get explicit approval, every time. Ordinary user testing in the production UI is not authorization for an agent-initiated paid call.
- Do not weaken validation/grounding/novelty-suppression to make a metric look better.
- No seeded/demo data, ever, in any of this work.
- When background agents are used for parallel work, expect real merge conflicts when their branches land close together (happened this session between #116/#118/#119, and independently between #92's/#120's/#131's PRs touching `related.mjs`/`novelty.mjs`) — rebase and resolve carefully rather than force-picking one side; these were all genuinely additive, non-overlapping changes that just needed a clean rebase.
- **When something claims to fix a backend/infra bug, verify it against the real deployed system before believing it — not just green tests.** This session's clearest lesson: the canonical-store foundation had 33/33 passing tests and shipped with two bugs that only a real production check (trigger a request, then query the database directly) revealed. Do this same discipline for any future infra/persistence work.

## Suggested next sequence

1. Sync with current `main` at `d2f12c907296cae6cc6304ed92efa4fa7c9fbaf8`.
2. Read this file, then issue #16, then whichever of #120/#135/#142/#115 you're picking up.
3. If continuing #135's read-path swap: audit exactly how much real coverage the canonical store has accumulated so far (query `select media_type, count(*) from items group by media_type`) before deciding whether reading from it is viable yet, or whether it needs more write-behind traffic first.
4. If continuing #120: this needs a different kind of investigation now (model generation time, output-length experiments, perceived-loading UX), not another prompt-shrinking pass.
5. Any paid-model verification: state count + cost, wait for explicit approval, exactly like every call this session.
