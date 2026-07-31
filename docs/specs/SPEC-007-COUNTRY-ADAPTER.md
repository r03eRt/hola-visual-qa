# SPEC-007 Country adapter

Changing locale, timezone or geolocation does not change IP country. Supported strategies must be explicit:

1. Internal staging header.
2. Internal staging cookie/query hook.
3. Approved proxy endpoint.
4. No override, with the scenario marked as local country.

The adapter applies and verifies the effective country through a platform-provided debug signal. Production-only bypasses are prohibited. Reports state the strategy used so results are not misrepresented as real geo-IP tests.
