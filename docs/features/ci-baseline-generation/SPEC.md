# Feature: ci-baseline-generation

## Goal

Provide a safe, reviewable mechanism to (re)generate visual baselines for ALL
browser projects (chromium, webkit, firefox) on the CI platform (linux) — which
the local macOS 13 environment cannot install — and route every regeneration
through a human-reviewed PR. Never pushes to main; never auto-approves.

## Context and linked canonical specs

- `docs/features/e2e-visual-baseline/SPEC.md` (#77),
  `docs/features/scenario-baseline-partition/SPEC.md` (#79) — the committed
  chromium/darwin baselines this mechanism extends to all browsers on linux.
- `.github/workflows/ci.yml` (the gated `visual` job) and `docs/DEMO.md` — the
  assert-only visual run that goes green once these baselines land.
- `baselines/README.md`, `docs/features/baseline-update-command/SPEC.md` — the
  reviewed-baseline + audit-log convention.
- `AGENTS.md` — "a snapshot change requires a written reason and human review";
  "baselines are never updated automatically after a failure".

## Non-goals

- Running the workflow in this environment (linux/webkit/firefox unavailable) —
  the ticket lands the mechanism; the maintainer runs it once `QA_BASE_URL` is set.
- Making the `visual` job a required check (a later step, after baselines land).
- Auto-merging baseline PRs (explicitly forbidden).

## Proposed interfaces and files

- `.github/workflows/update-baselines.yml` — `workflow_dispatch` only, with a
  REQUIRED `reason` input and optional `scenarios`/`projects` filters. Steps:
  fail fast if `QA_BASE_URL` is unset; `npm ci`; install chromium+webkit+firefox
  with deps; run `test:update` (or a project-filtered `--update-snapshots`)
  against `QA_BASE_URL`; append a reasoned audit line via the script below;
  upload baselines + HTML report as artifacts; if baselines changed, commit to a
  fresh `baselines/update-<run-id>` branch and open a **draft**, labeled PR for
  review. Least-privilege `permissions: { contents: write, pull-requests: write }`.
- `scripts/log-baseline-update.mjs` — appends ONE secret-free line to
  `baselines/UPDATE_LOG.jsonl` for the changed baseline PNGs (derived from
  `git status --porcelain -- baselines`), recording only file paths, the reason,
  tool version and `GITHUB_SHA`. Exits 2 on a missing/empty `--reason`, 0 with a
  no-op when nothing changed.
- Docs: DEMO.md "Generating baselines in CI (all browsers)"; STATUS/roadmap note.

## Acceptance criteria

- [x] `.github/workflows/update-baselines.yml` is valid, `workflow_dispatch`-only,
  requires a `reason`, fails fast without `QA_BASE_URL`, installs all three
  browsers, and NEVER pushes to main / auto-merges (opens a draft PR instead).
- [x] `scripts/log-baseline-update.mjs` appends a reasoned, secret-free audit
  line for changed baseline PNGs; rejects an empty reason (exit 2); no-ops when
  nothing changed (exit 0).
- [x] The workflow uses least-privilege permissions and reads `QA_BASE_URL` as a
  secret without echoing it.
- [x] `npm run lint` passes (the new script is linted); YAML validates.
- [x] DEMO.md documents how to run it and the review requirement.

## Test plan

- Local: `scripts/log-baseline-update.mjs` exercised against a simulated baseline
  change (records the file) and with no `--reason` (exit 2) and no changes
  (exit 0). YAML validated.
- CI (maintainer, once `QA_BASE_URL` is set): dispatch the workflow with a reason,
  confirm it installs all browsers, opens a draft PR with the regenerated
  baselines + audit line, and uploads artifacts. The subsequent gated `visual`
  job then asserts green against the merged baselines.

## Security/privacy impact

`type:security`. Surfaces: a workflow with write permissions, a repo secret, and
an automated PR. Mitigations: `workflow_dispatch`-only (no untrusted PR trigger,
so no `pull_request_target` secret-exfiltration surface); least-privilege
`permissions`; `QA_BASE_URL` is never echoed; the branch/PR is created with the
default `github.token`; the job NEVER pushes to a protected branch and NEVER
auto-merges — a human reviews every image. The audit log records only file paths
(no page content, no target URL, no secret). A `security-review` pass is required
before merge.

## Baseline impact

Adds no baselines itself. It is the tool by which future all-browser baselines
are produced and reviewed. Existing baselines are untouched.

## Dependencies and risks

- Depends on #77/#79 (merged) and on the maintainer setting the `QA_BASE_URL`
  secret before first use.
- Risk: cross-run flakiness on a dynamic QA target — mitigated by the reason-gated
  review PR (a human inspects diffs) and `visual.maskSelectors` for dynamic zones.
- Risk: the `baselines` label may not exist — the workflow creates it idempotently
  (`gh label create ... --force || true`).
