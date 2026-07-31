# Hola Visual QA

Documentation-rich, local-first starter for deterministic web visual QA with optional Claude-assisted failure explanations.

> This repository is **not a completed application**. It contains partial example code plus the product, architecture, specifications, decisions, roadmap, agent instructions and handover material required for another coding agent to continue safely.

## Start here

1. `AGENTS.md`
2. `docs/CONTEXT.md`
3. `docs/STATUS.md`
4. `docs/product/PRODUCT_VISION.md`
5. `docs/architecture/SYSTEM_ARCHITECTURE.md`
6. `docs/roadmap/IMPLEMENTATION_PLAN.md`

## Local bootstrap

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run typecheck
npm run test:visual
```

## Optional Claude API

Set `ENABLE_AI_ANALYSIS=true`, `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`. The deterministic system works without AI. A Claude application subscription should not be treated as API billing or API access.

## Working method

Use one feature per branch and PR. Complete `docs/features/<slug>/SPEC.md`, implement its acceptance criteria, add tests, update `docs/STATUS.md` and include a handover. Baselines require explicit human review.
