# Tastemake Product Architecture Notes

## Current app structure

Tastemake should stay simple, but it should no longer grow as one large app file.

The prototype is organized around:

- `src/data/` for catalog and domain metadata
- `src/model/` for taste and recommendation calculations
- `src/components/` for reusable UI such as domain filters
- `src/screens/` for Favorites, Taste Profile, and Recommendations
- `styles/` for shared and screen-specific presentation
- browser routes for `/favorites`, `/taste-profile`, and `/recommendations`

Routing and product state are separate. Browser navigation changes the current screen; filters are browsing context only and are not taste evidence.

## Domain model

Items can belong to one or more domains. The current prototype only exposes:

- Watch
- Read
- Play

The data model should be able to add domains later without rebuilding the recommendation model or navigation. Likely future domains include:

- Listen
- Wear
- Home
- Art / Design
- Beauty
- Spaces / Visit
- Architecture
- Objects
- Outdoors
- Events
- Food aesthetics
- Travel vibe
- Fragrance
- Digital style
- Collectibles

These are planning constraints, not a commitment to add every category to the UI.

## Taste model principles

Tastemake should not assume a person has one aesthetic.

A person may have:

- several distinct aesthetic clusters
- overlapping clusters that share only some traits
- preferences that appear to conflict across domains
- many small aesthetic modes rather than a few neat categories
- isolated preferences that never become a broader pattern
- different preferences depending on context or domain

The model should therefore represent taste as a set of weighted, revisable patterns rather than a single style label.

Cross-domain similarities begin as hypotheses. A preference in one domain should not automatically become a global preference. For example, liking maximalist clothing is not evidence that someone wants a maximalist home.

The product should be comfortable saying that a person is eclectic or that there is not enough evidence to connect two preferences.

A useful framing is:

> What patterns show up in the things you like, and when do they matter?

## Evidence rules

- Explicit Tastemake reactions are stronger evidence than browsing behavior.
- External favorites or ratings can be strong evidence when available.
- Repeated behavior can provide supporting evidence.
- Mere consumption is weak evidence.
- Filtering a view is not preference evidence.
- "Haven't tried" without additional context is not taste evidence.
- Domain-specific evidence should remain domain-specific until repeated evidence supports a cross-domain pattern.