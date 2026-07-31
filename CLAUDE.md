# Claude project instructions

Read `AGENTS.md` first. Use `docs/CONTEXT.md` as the canonical context packet.

When asked to implement work:

1. Identify exactly one roadmap item or create one feature specification.
2. Work on a `feature/<slug>` branch.
3. Do not implement adjacent roadmap items opportunistically.
4. Keep AI provider code isolated from deterministic test execution.
5. Never infer that a visual change is correct; surface evidence for human approval.
6. Finish by listing changed files, tests run, acceptance criteria status and known limitations.
