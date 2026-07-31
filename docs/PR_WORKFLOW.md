# One feature per PR workflow

1. Select one item from `docs/roadmap/IMPLEMENTATION_PLAN.md`.
2. Run `npm run feature:new -- <slug>` or create `feature/<slug>` manually.
3. Complete `docs/features/<slug>/SPEC.md` before implementation.
4. Identify relevant ADRs and update them only when a decision changes.
5. Implement only that specification.
6. Add unit/integration/e2e tests as appropriate.
7. Run typecheck and the smallest relevant test set.
8. Update `docs/STATUS.md` honestly.
9. Open the PR with evidence and baseline disclosure.
10. Require human review for any expected screenshot change.
11. Squash merge and delete the branch.

Do not mix feature work, broad refactors, dependency upgrades and baseline churn. A prerequisite discovered during work becomes a separate earlier PR.
