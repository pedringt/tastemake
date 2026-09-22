# Agent Prompt: Continue Tastemake live AI rollout

You are continuing Tastemake from the prepared repository handoff. Read docs/HANDOFF.md first and continue from the documented state rather than restarting the architecture discussion.

## Task

Resume work in pedringt/tastemake / ~/code/tastemake after the live recommendation producer was promoted to main.

Start by verifying the exact local and production state. Do not make a paid Anthropic call or enable public production live AI until the fail-closed path is verified.

## Current anchor

Expected main commit:

25ae748f65717a5092b34eff672616c0a064bada

pre-ai-foundations remains at:

d868fdaeeabbdbf5ae0f4ec2885a8769460d23f3

## First actions

1. Inspect git status, current branch, and recent commits. Preserve unrelated local work.
2. Read:
   - docs/HANDOFF.md
   - docs/ai-readiness.md
   - docs/ai-contract.md
   - docs/ai-evals.md
   - docs/evidence-contract.md
3. Inspect:
   - api/recommendations.mjs
   - src/ai/live-client.js
   - src/ai/validate.js
   - src/app.js
   - src/screens/recommendations.js
   - vercel.json
4. Confirm the Vercel production deployment for current main is Ready.
5. Smoke-test the app while live production AI is still disabled by the production gate.
6. Verify that /api/recommendations safely returns deterministic behavior while TASTEMAKE_AI_PRODUCTION_APPROVED is absent.
7. Report findings before changing the production gate.

## Requirements

- Keep AI interpretation separate from product authority.
- Do not let intent become taste evidence.
- Only choose from eligible candidate IDs.
- Keep deterministic fallback intact.
- Preserve user-confirmed not-me authority in both hypothesis and recommendation validation.
- Do not represent the current in-function rate limiter as globally reliable.
- Do not represent TASTEMAKE_AI_SPEND_CAP_CONFIRMED=1 as a real spend-cap implementation.

## Production gate

Production paid calls require:

TASTEMAKE_AI_PRODUCTION_APPROVED=1

Do not add or enable that variable until the fail-closed production smoke test is complete and Paige explicitly approves turning on public live production traffic.

## Credential and authority rules

Do not ask for raw credentials, tokens, cookies, API keys, session values, private keys, or .env contents.

Use existing platform/local authentication. The Anthropic key already exists server-side in Vercel Production.

Do not push additional changes to main, mutate production environment variables, or make any new externally visible production change without Paige's explicit current approval.

Paid model calls were previously approved only for the planned 10-call eval, with a rough maximum around $0.17. Treat public production enablement as a separate approval gate.

## Do not

- Do not re-litigate the settled evidence model.
- Do not broaden this into agentic/autonomous recommendation behavior.
- Do not move the backend to Render.
- Do not replace the curated candidate pool with model-invented titles.
- Do not disable deterministic fallback.
- Do not make unrelated refactors while verifying the rollout.

## Expected output

First return a concise verification report covering:

- local branch / commit state
- Vercel deployment state
- production smoke-test result
- /api/recommendations fail-closed behavior
- any regressions or runtime errors
- whether the system is ready for the controlled paid live-AI test
- any exact change required before that test
