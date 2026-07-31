# Artifact model

Proposed local structure:

```text
artifacts/<run-id>/
  manifest.json
  summary.json
  report/index.html
  scenarios/<scenario-id>/
    result.json
    expected.png
    actual.png
    diff.png
    console.json
    page-errors.json
    requests.json
    trace.zip
    video.webm
    ai-analysis.json
```

The manifest includes tool version, commit SHA when available, operating system, browser/version, configuration hash, baseline hash and scenario list. It must exclude API keys, authorization headers, cookie values and raw storage state.

Retention is configurable. Default local retention should keep failures and remove successful videos/traces.
