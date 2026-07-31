# SPEC-012 CLI

Proposed commands:

```text
visual-qa plan
visual-qa run
visual-qa run --page home --device mobile
visual-qa baseline update --scenario <id>
visual-qa report <run-id>
visual-qa doctor
```

Requirements include clear help, dry-run support, explicit destructive baseline command, machine-readable output option, predictable exit codes and safe secret handling.
