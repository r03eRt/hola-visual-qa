# Model strategy for multi-agent work

Use the strongest reasoning model to **think**, and a fast, well-scoped model to
**execute**. This keeps quality high where ambiguity lives and cost/latency low
where the path is already clear.

## Rule of thumb

- **Opus** — planning and judgement: intake/triage, brainstorming, writing specs
  and plans, architecture and ADRs, decomposing the roadmap, code review,
  security review, and hard debugging.
- **Sonnet 5** — execution of an already-clear plan: implementing a feature whose
  acceptance criteria are defined, writing tests (TDD), routine edits, and
  scoped fixes.

> Opus plans and reviews; Sonnet executes the plan. If design ambiguity appears
> mid-implementation, escalate back to Opus to re-plan, then drop back to Sonnet.

## Recommended model per agent role

| Agent role | Model | Why |
|---|---|---|
| `intake` | Opus | Classifying and splitting requests needs judgement |
| `orchestrator` | Opus | Decomposition and sequencing |
| `architect` | Opus | Boundaries, contracts, ADR consistency |
| `reviewer` | Opus | Catching subtle scope/logic/flake issues |
| `security-reviewer` | Opus | High-stakes, high-precision review |
| `ads-specialist` | Opus | Defining observable placement contracts |
| `implementer` | Sonnet 5 | Executes a defined spec |
| `tester` | Sonnet 5 | Writes/asserts against defined criteria |
| `documentation` | Sonnet 5 | Applies changes to reflect reality |

## When to switch to Sonnet 5 (handoff checklist)

Switch once **all** of these are true:

- [ ] The ticket exists and its type/scope is agreed.
- [ ] `docs/features/<slug>/SPEC.md` is complete: goal, non-goals, interfaces,
      files, acceptance criteria and test plan.
- [ ] No open design questions or ADR decisions remain.
- [ ] Security/privacy impact is understood.

If any box is unchecked, stay on Opus. Escalate back to Opus if implementation
uncovers a new design decision.
