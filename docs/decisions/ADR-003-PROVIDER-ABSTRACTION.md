# ADR-003 AI provider abstraction

**Status:** Accepted.

All model integrations implement a small provider-neutral interface. Anthropic is the first adapter, not a dependency of domain or execution modules. The model name is configuration, never hard-coded into business logic.
