# Experiment 003 feedback template

After the recommendation model commits its top five, Surprise Me choice, and four alternates, record feedback only for the committed items.

For every committed item, use one of:

- `not_experienced`
- `strong_positive`
- `positive`
- `mixed`
- `negative`
- `strong_negative`

For experienced items, also record:

- **Good recommendation?** `yes`, `maybe`, or `no`
- **Optional reason:** a short note only when it adds useful information.

The two labels answer different questions:

- **Reaction:** Did I like the thing?
- **Recommendation quality:** Was it reasonable/useful for Tastemake to recommend it to me?

Do not rerank or replace items after seeing the feedback. Use committed alternates only as pre-declared backup evidence.
