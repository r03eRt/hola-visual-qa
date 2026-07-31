# SPEC-003 Page stability

## Goal

Reduce false positives without hiding genuine regressions.

## Policies

- Wait for DOM readiness and configured application-ready signal.
- Wait for fonts.
- Disable animations via Playwright and narrow CSS injection.
- Trigger controlled lazy loading by scrolling according to policy.
- Freeze time only for pages that explicitly support it.
- Mask only declared dynamic selectors, with the mask list included in reports.
- Never use arbitrary long sleeps as the primary readiness mechanism.

## Acceptance criteria

- Repeated runs against a deterministic fixture produce identical screenshots.
- A fixture with a true layout change still fails.
- Readiness timeout reports which condition did not complete.
