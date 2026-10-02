# Tastemake

Tastemake is an experimental recommendation product that helps people understand and refine their taste across books, movies, TV, and games.

Instead of only asking whether someone liked an item, Tastemake also builds a visible Taste Profile that explains the patterns it thinks are shaping those reactions. Users can correct those patterns, narrow them, or reject them, and those corrections influence what happens next.

## Current product loop

**Favorites -> Recommendations -> React -> Taste Profile learns -> Better recommendations**

The first-run flow stays intentionally light:
- add a few Favorites
- get recommendations
- react with Loved, Liked, Didn't like, Saved, or Not interested
- refine deeper taste details only when useful
- inspect what Tastemake learned in the Taste Profile

The product keeps experienced taste separate from future intent. Saving or browsing does not automatically become evidence that a user likes something.

## AI and product boundaries

Tastemake uses live AI in two places:
- **Recommendation ranking and explanation**
- **Taste Profile hypothesis generation**

The model does not control the whole system. Software still decides:
- what counts as taste evidence
- which catalog candidates are eligible
- whether model output passes validation
- what user corrections take priority

If a live recommendation call fails or is rejected, Tastemake can fall back to catalog-based recommendations rather than presenting weak model output as trustworthy.

## Catalog and data

Tastemake works with real catalog data across:
- books
- movies
- TV
- games

Provider data is normalized into Tastemake's own catalog shape, with a canonical store used to improve reuse and metadata consistency over time.

## Quality and testing

The repository includes automated coverage for:
- recommendation behavior and candidate quality
- AI output validation
- evidence and intent rules
- Taste Profile corrections
- persistence and export
- desktop and mobile layout
- accessibility
- end-to-end product flows
- recommendation evals

Run the main test suite with:

```bash
npm test
```

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

Some live AI and catalog features depend on server-side environment configuration, so the deployed Vercel app is the best way to try the full experience.

## Research and product notes

The `experiments/` folder contains taste-model and recommendation experiments that informed the product. The `notes/` and `docs/` folders capture product decisions, QA findings, and implementation context.

## Deployment

Vercel preview deployments are used for feature branches and pull requests. Production remains tied to `main` and is promoted separately after review.
