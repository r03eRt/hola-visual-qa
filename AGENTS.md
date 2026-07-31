# AGENTS.md — Mandatory project context

This repository is a **documentation-rich starter**, not a completed production application.

Before changing code, read in this order:

1. `docs/CONTEXT.md`
2. `docs/STATUS.md`
3. `docs/REQUEST_INTAKE.md`
4. `docs/product/PRODUCT_VISION.md`
5. `docs/architecture/SYSTEM_ARCHITECTURE.md`
6. The relevant file under `docs/specs/`
7. `docs/roadmap/IMPLEMENTATION_PLAN.md`
8. `docs/PR_WORKFLOW.md`

## Non-negotiable rules

- Every request is triaged first: analyse it, classify its type and open a
  ticket per `docs/REQUEST_INTAKE.md` **before** writing code, unless the
  requester explicitly opts out for that request.
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

## Skills

- Domain skills for this project live in `skills/` (`visual-qa`, `playwright`, `consent`, `ads`, `ai-analysis`, `reporting`, `pr-workflow`, `architecture`).
- Methodology skills are vendored (MIT) in `skills/superpowers/` — read the relevant `SKILL.md` before acting (e.g. `test-driven-development`, `writing-plans`, `systematic-debugging`, `subagent-driven-development`, `verification-before-completion`).
- If any skill conflicts with these non-negotiable rules, the rules above win.
