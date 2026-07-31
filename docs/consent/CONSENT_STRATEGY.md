# Consent strategy

The first production adapter must be designed after inspecting Hola's actual CMP and test environment.

Preferred implementation order:

1. Obtain a documented test fixture or internal hook.
2. Encode accepted/rejected state before navigation.
3. Verify through CMP/platform debug state.
4. Add one separate UI-flow test proving the banner interaction still works.

Do not duplicate opaque consent strings across tests. Centralize fixture generation/versioning and include only a redacted state description in reports.
