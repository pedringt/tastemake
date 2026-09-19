# Tastemake

An experimental recommendation product that builds an inspectable model of why someone likes what they like across books, movies, TV, games, and more.

## Prototype v1

The current interactive prototype validates a simpler core loop:

**Favorites -> Recommendations -> React -> Better recommendations**

The Taste Profile remains available for users who want to inspect the reasoning, but it is not a required stop in the recommendation flow.

Recommendation feedback is intentionally lightweight:
- **More like this**
- **Less like this**
- **Haven't tried**

One tap is enough. Optional context chips can add stronger or more specific signal without turning every recommendation into a survey.

The prototype is intentionally deterministic and framework-free. There are no live model calls, user accounts, integrations, or production persistence yet.

### Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Research

The `experiments/` folder contains the blind taste-model, boundary, and recommendation-selection evals that informed this prototype. The `notes/` folder tracks reusable case-study and AI product lessons.

## Deployment

Vercel preview deployments are used for feature branches and pull requests. Production remains tied to `main` and is promoted separately after review.
