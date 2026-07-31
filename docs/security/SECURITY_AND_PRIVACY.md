# Security and privacy

## Threats

Secret leakage, sending private page content to an API, SSRF-like navigation to unapproved hosts, committing auth state, malicious page downloads, oversized artifacts and sensitive headers in network logs.

## Required controls

- Host allowlist and protocol validation.
- Block `file:`, local metadata endpoints and arbitrary redirects outside policy.
- Redact cookies, authorization, API keys, tokens and configured sensitive query parameters.
- Store authentication fixtures outside Git with restrictive permissions.
- AI off by default; explicit evidence policy and size limits.
- Do not include full response bodies unless explicitly approved.
- Bind a future dashboard to localhost and protect command execution.
