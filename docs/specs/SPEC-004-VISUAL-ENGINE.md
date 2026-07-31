# SPEC-004 Visual engine

## Targets

- Full page.
- Viewport.
- Named component region.
- Named ad-placement region.

## Rules

- Playwright screenshot assertion is authoritative for MVP.
- Thresholds are configured centrally and may be overridden narrowly with justification.
- Baselines are partitioned by browser/platform policy to avoid accidental cross-platform comparison.
- Expected, actual and diff artifacts are preserved on failure.
- Updating baselines requires an explicit command and review.

## Acceptance criteria

- A one-pixel fixture change can be detected under a strict profile.
- Expected changes generate reviewable baseline diffs.
- Threshold and mask metadata appear in scenario results.
