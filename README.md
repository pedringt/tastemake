# Tastemake

An experimental recommendation product that builds an inspectable model of why someone likes what they like across books, movies, TV, games, and more.

## Prototype v1

The first interactive prototype validates the core loop:

**Favorites -> Taste Model -> Recommendations -> Feedback -> What Tastemake Learned**

It is intentionally deterministic and framework-free. There are no live model calls, user accounts, integrations, or production persistence yet.

### Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Research

The `experiments/` folder contains the blind taste-model, boundary, and recommendation-selection evals that informed this prototype. The `notes/` folder tracks reusable case-study and AI product lessons.
