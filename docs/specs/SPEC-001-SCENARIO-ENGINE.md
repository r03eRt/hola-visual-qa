# SPEC-001 Scenario engine

## Goal

Generate reproducible, filterable scenario instances from project dimensions.

## Dimensions

Page, browser, viewport/device, consent, ads, country, user fixture and optional feature flag set.

## Requirements

- Cartesian expansion with include/exclude rules.
- Stable human-readable IDs.
- Maximum-scenario guard.
- CLI filters by page, tag and dimension.
- Validation for impossible combinations.
- Dry-run command that prints the plan without launching a browser.

## Acceptance criteria

- Same config always produces the same ordered IDs.
- Excluded combinations never run.
- Invalid dimensions fail before browser launch.
- Unit tests cover expansion, filters, collisions and safety limits.
