# Superpowers skills (vendored)

Agent methodology skills vendored from **obra/superpowers**.

- Upstream: https://github.com/obra/superpowers
- Commit pinned: `44c9b2d6e889982ac18c27d05a19fefe335194e1`
- License: MIT (see `./LICENSE`) — © 2025 Jesse Vincent

MIT is permissive: you may use, modify, distribute and sublicense these files,
including for commercial and private use. The only obligation is to keep the
copyright and license notice (`./LICENSE`) with the files. There is no copyleft
and no restriction on how the rest of this repository is licensed or used.

## Why these are here

This project is developed by **multiple coding agents** with a strict
"one independently reviewable capability per branch and PR" discipline. These
skills encode that same methodology and compose well with the project's own
rules in `AGENTS.md` and `docs/REQUEST_INTAKE.md`:

| Skill | Use when |
|---|---|
| `brainstorming` | Shaping a vague request before writing a spec |
| `writing-plans` / `executing-plans` | Turning a feature ticket into a reviewable plan |
| `subagent-driven-development` / `dispatching-parallel-agents` | Splitting independent work across agents |
| `test-driven-development` | Implementing any feature or bugfix (test first) |
| `systematic-debugging` | Diagnosing a failing test or flaky behaviour |
| `requesting-code-review` / `receiving-code-review` | Review handoffs between agents |
| `verification-before-completion` | Before claiming a ticket is done |
| `finishing-a-development-branch` / `using-git-worktrees` | Wrapping up a PR branch |
| `writing-skills` / `using-superpowers` | Authoring or discovering more skills |

## How agents use them

Read the relevant `SKILL.md` before acting. These are agent-agnostic Markdown
(they work under Copilot CLI, Claude, Codex, etc.) — no plugin marketplace is
required. Where a skill mentions slash commands or plugin hooks, treat those as
optional conveniences; the written methodology is what matters.

**Precedence:** if any skill conflicts with `AGENTS.md`, the project's
non-negotiable rules win (deterministic pass/fail, AI never decides pass/fail,
no automatic baseline updates, intake before implementation).

## Updating

Re-vendor from upstream and update the pinned commit above in the same chore PR;
never mix a skills refresh with feature work.
