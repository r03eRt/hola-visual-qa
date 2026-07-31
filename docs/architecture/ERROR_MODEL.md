# Error model

Errors are normalized into categories:

- `configuration_error`
- `environment_setup_error`
- `navigation_error`
- `state_verification_error`
- `readiness_timeout`
- `visual_regression`
- `placement_failure`
- `console_error`
- `network_failure`
- `artifact_error`
- `ai_provider_error`
- `internal_error`

Every error includes a stable code, message safe for reports, scenario ID, phase, timestamp and optional evidence references. Provider exceptions and raw secrets must not be exposed verbatim.

AI provider errors are warnings unless the user explicitly runs an AI-only command. They never convert a passing deterministic test into failure.
