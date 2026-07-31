# Local development

```bash
cp .env.example .env
npm ci
npx playwright install chromium
npm run typecheck
npm run test:visual
```

Until dependencies are pinned and a lockfile is committed, use `npm install`; locking is roadmap item 1.

Recommended workflow:

```bash
npm run feature:new -- <slug>
# complete docs/features/<slug>/SPEC.md
# implement and test
npm run typecheck
npm run test:visual -- --grep <relevant-pattern>
```

Never put the Anthropic key in committed files or shell history shared in logs.
