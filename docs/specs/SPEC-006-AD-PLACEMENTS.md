# SPEC-006 Ad placement validation

## Goal

Explain whether each expected placement progressed through container, request and render stages.

## Checks

- Expected container exists and is visible when applicable.
- Dimensions match allowed sizes.
- Request event is observed through an approved integration signal.
- Render/completion event is observed.
- Empty/error/timeout state is classified.
- Placement does not overlap protected content.
- Layout shift attributable to the placement is measured where feasible.

## Integration preference

Use stable application test hooks or emitted events rather than reverse-engineering vendor internals. The tool must not assert revenue or fill solely from DOM appearance.
