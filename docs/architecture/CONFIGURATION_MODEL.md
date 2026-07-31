# Configuration model

Use a committed, non-secret `visual-qa.config.ts` for project behavior and `.env` only for secrets or machine-specific values.

Proposed top-level schema:

```ts
interface ProjectConfig {
  projectName: string;
  baseUrl: string;
  allowedHosts: string[];
  pages: PageDefinition[];
  dimensions: ScenarioDimensions;
  adapters: AdapterConfiguration;
  visual: VisualPolicy;
  diagnostics: DiagnosticsPolicy;
  artifacts: ArtifactPolicy;
  ai: AiPolicy;
  execution: ExecutionPolicy;
}
```

Requirements:

- Unknown properties fail validation.
- Configuration errors are reported together where practical.
- Secrets never appear in serialized config or reports.
- Every scenario has a stable ID derived from normalized dimensions, not array order.
- Environment variables may override only explicitly allowlisted fields.
