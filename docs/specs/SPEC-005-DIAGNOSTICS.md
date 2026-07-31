# SPEC-005 Failure diagnostics

Capture:

- console messages by severity;
- uncaught page errors;
- failed requests;
- selected non-success responses;
- navigation and adapter phases;
- trace and optional video;
- key timing milestones;
- screenshot metadata.

Diagnostics are attached to each scenario and normalized as JSON. A policy controls ignored domains/messages to avoid third-party noise, but ignores must be explicit and reviewable.

Acceptance requires deterministic fixture tests proving each event type is captured and no authorization/cookie headers are stored.
