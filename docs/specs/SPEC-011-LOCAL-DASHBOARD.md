# SPEC-011 Local dashboard

Future local-only UI for selecting pages/scenarios, launching runs and reading reports.

Constraints:

- Binds to localhost by default.
- Reuses core orchestration services; no duplicate execution logic.
- Does not require a database for initial version.
- Cannot expose API keys or arbitrary filesystem paths.
- Must not be implemented until CLI, artifacts and reporting contracts are stable.
