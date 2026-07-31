# Advertising placement model

A placement definition should contain:

- stable placement ID;
- page applicability;
- container selector/test ID;
- allowed sizes;
- visibility expectations per device;
- request/render debug events;
- timeout;
- expected empty behavior;
- protected neighboring regions;
- screenshot target configuration.

State machine:

```text
not_expected -> skipped
expected -> container_missing | container_ready
container_ready -> request_missing | requested
requested -> rendered | empty | provider_error | timeout
```

This model separates “no container”, “no request”, “empty response” and “rendering failure”, which are visually similar but operationally different.
