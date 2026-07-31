# ADR-001 Local-first architecture

**Status:** Accepted.

The MVP runs on a developer machine or existing CI and stores artifacts on the local filesystem. This minimizes cost, security surface and operational dependencies. A hosted control plane may be evaluated only after local contracts are stable.
