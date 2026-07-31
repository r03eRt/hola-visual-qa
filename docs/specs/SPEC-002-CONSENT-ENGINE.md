# SPEC-002 Consent engine

## Goal

Apply and verify deterministic consent states without coupling tests to one CMP implementation.

## Strategies

- Cookie/localStorage fixture before navigation.
- CMP UI interaction for end-to-end verification.
- Internal test hook in a non-production environment.

## Contract

Each adapter implements `apply(context)`, `verify(page)` and `describeRedacted()`.

## States

At minimum: `accepted` and `rejected`. Future states may include `unset`, `necessary-only`, `personalized` and `non-personalized` if they map to real platform behavior.

## Acceptance criteria

- The effective state is verified, not assumed.
- Cookie domains and secure flags work for configured hosts.
- Raw consent strings are redacted in logs.
- UI fallback uses resilient role/test-id selectors.
