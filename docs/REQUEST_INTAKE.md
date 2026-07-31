# Request intake and triage

This project runs with multiple agents and **one independently reviewable
capability per branch and PR**. To keep that discipline, every incoming request
goes through intake **before any code is written**.

## Default rule (unless the requester says otherwise)

> For every request, first **analyse it**, **classify its type**, and **create a
> ticket**. Do not start implementing until the ticket exists.

The requester can override this per request with an explicit instruction such as
"just do it, no ticket" or "answer only, do not open a ticket".

A "ticket" is:

- a **GitHub Issue** (the tracked unit of work), created with `gh`; **and**
- for `feature` requests, additionally a **local spec** at
  `docs/features/<slug>/SPEC.md` plus a line in
  `docs/roadmap/IMPLEMENTATION_PLAN.md`.

## Classification

Pick exactly one primary type. If a request bundles several capabilities, split
it into one ticket per capability (never one big ticket).

| Type | When | Ticket created | Labels |
|---|---|---|---|
| `feature` | A new, independently reviewable capability | GitHub Issue **+** `docs/features/<slug>/SPEC.md` **+** roadmap line | `type:feature`, `needs-spec` |
| `bug` | Defect in already‑implemented behaviour | GitHub Issue (attach failing evidence) | `type:bug` |
| `docs` | Documentation‑only change | GitHub Issue | `type:docs` |
| `chore` | Tooling, dependencies, CI, config | GitHub Issue | `type:chore` |
| `spike` | Research / decision; may yield an ADR | GitHub Issue | `type:spike` |
| `security` | Security or privacy concern | GitHub Issue, route to security‑reviewer | `type:security` |

Rules of thumb:

- "Add / support / build X that users can run" → `feature`.
- "X is broken / wrong / flaky" on something already in `docs/STATUS.md` as
  `partial`/`implemented`/`verified` → `bug`. If the capability is `scaffold`
  or `not implemented`, it is a `feature`, not a `bug`.
- "Explain / document / clarify" → `docs`.
- "Pin deps / fix CI / lint / config" → `chore`.
- "Should we… / investigate / compare" → `spike`.
- Anything touching secrets, redirects, host allowlisting, auth fixtures,
  redaction or artifact exposure → also add `type:security`.

## How to open the ticket

Use the helper (recommended):

```bash
npm run ticket:new -- --type <feature|bug|docs|chore|spike|security> \
  --title "Short imperative title" [--slug <slug>] [--body "..."]
```

For `feature`, the helper also scaffolds `docs/features/<slug>/SPEC.md` and
creates the `feature/<slug>` branch. See `scripts/new-ticket.mjs`.

Or do it manually:

```bash
gh issue create --title "..." --label "type:bug" --body "..."
```

## After the ticket exists

1. `feature`: complete the SPEC, then follow `docs/PR_WORKFLOW.md`.
2. `bug`/`chore`/`docs`: fix on a short branch, keep scope to that one ticket.
3. `spike`: record the outcome (and an ADR under `docs/decisions/` if a decision
   was made); open follow‑up `feature` tickets for any work it unblocks.
4. Reference the issue in the PR (`Closes #<n>`), update `docs/STATUS.md`, and
   respect every rule in `AGENTS.md`.

Never combine unrelated types in one ticket or one PR.
