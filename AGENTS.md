# AGENTS.md — Mandatory project context

This repository is a **documentation-rich starter**, not a completed production application.

Before changing code, read in this order:

1. `docs/CONTEXT.md`
2. `docs/STATUS.md`
3. `docs/product/PRODUCT_VISION.md`
4. `docs/architecture/SYSTEM_ARCHITECTURE.md`
5. The relevant file under `docs/specs/`
6. `docs/roadmap/IMPLEMENTATION_PLAN.md`
7. `docs/PR_WORKFLOW.md`

## Non-negotiable rules

- One independently reviewable capability per branch and PR.
- Playwright and explicit rules decide pass/fail; an LLM never does.
- AI is optional, disabled by default and behind `AiProvider`.
- Baselines are never updated automatically after a failure.
- A snapshot change requires a written reason and human review.
- No production credentials, auth state, cookies, traces or screenshots are committed.
- Do not claim a feature is implemented because its specification exists.
- Update `docs/STATUS.md` and the relevant feature spec in every implementation PR.

## Definition of done

A feature is done only when its acceptance criteria pass, tests exist, documentation reflects reality, security implications are reviewed, and the PR stays within scope.
