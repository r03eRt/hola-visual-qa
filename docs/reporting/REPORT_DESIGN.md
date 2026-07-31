# Report design

The report opens with run status, commit/configuration metadata and scenario counts. Each failure shows:

1. Deterministic failed checks.
2. Scenario dimensions.
3. Expected, actual and diff images.
4. Consent/country/ad verification state.
5. Placement state timeline.
6. Console/page/network evidence.
7. Trace/video links.
8. Optional AI explanation clearly labelled “assisted analysis”.

The HTML report is static and portable inside its artifact directory. Avoid external analytics or CDN dependencies.
