# Product vision

## Problem

Visual and advertising regressions are difficult to reproduce because behavior varies with viewport, consent, country, user state, ad availability and asynchronous third-party code. Manual checking is slow, inconsistent and produces weak evidence.

## Product promise

Run reproducible scenarios locally and convert failures into evidence that is immediately actionable.

## Primary users

- Front-end developers validating releases.
- Advertising engineers diagnosing missing or malformed placements.
- QA engineers maintaining regression coverage.
- Product/release owners reviewing intended visual changes.

## Core jobs to be done

1. Verify that a page still renders as expected in important scenarios.
2. Detect layout shifts, missing containers and broken responsive behavior.
3. Reproduce consent/ad combinations reliably.
4. Understand why a test failed without manually rebuilding the full browser session.
5. Review intentional baseline changes safely.

## Product principles

- Deterministic before intelligent.
- Evidence before explanation.
- Local-first and low-cost.
- Explicit configuration over hidden magic.
- Narrow masks and waits over blanket suppression.
- Human approval for expected visual change.
