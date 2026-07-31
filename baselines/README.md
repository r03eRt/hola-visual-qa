# Baselines

Every file in this directory is a reviewed visual-regression baseline. It is
committed on purpose so that any change to a baseline image is visible in a
pull request diff.

Baselines are never updated automatically after a failed run. Changes require
a written reason and human review, and must be produced by
`npm run baseline:update` (`src/baseline/cli.ts`), which appends an audit
entry to `UPDATE_LOG.jsonl` for every applied update.

Layout: `baselines/<project>/<baselineName>.png`, where `<project>` is
`desktop-chromium` or `mobile-chromium`.
