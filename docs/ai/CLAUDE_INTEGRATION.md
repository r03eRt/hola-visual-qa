# Claude integration design

Claude is an optional analysis provider invoked only after deterministic results exist.

## Runtime configuration

- `ENABLE_AI_ANALYSIS`
- `AI_PROVIDER=anthropic`
- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL`
- request timeout, maximum image bytes and per-run analysis limit

## Cost controls

Analyze only failed scenarios selected by policy, deduplicate equivalent failures, resize images when sufficient, cap text evidence and cache analysis by evidence hash locally.

## Reliability

Use structured output validation, bounded retries for transient errors and an explicit `ai_provider_error` warning. Do not expose raw SDK exceptions in reports.

## Subscription note

Do not assume Claude web, desktop, Pro or enterprise access provides API credits. The API key and API account must be provisioned separately according to the organization’s policy.
