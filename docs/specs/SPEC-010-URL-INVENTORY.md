# SPEC-010 URL inventory and discovery

MVP URLs are explicit configuration entries with stable IDs and tags. Later discovery may consume a sitemap or approved internal endpoint.

Discovery must:

- stay within allowed hosts;
- normalize and deduplicate URLs;
- ignore logout, destructive and account-action routes;
- apply maximum limits;
- persist the resolved inventory in the run manifest.

A crawler is not required for the MVP and must be a separate PR.
