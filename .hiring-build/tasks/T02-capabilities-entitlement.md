# T02 Capability catalog and the listings entitlement

Requirements: MKT-CAP-001, MKT-PLN-001, MKT-LST-003 (the entitlement only),
the stage kinds of `hiring-pipeline.md` Pipelines, the check types of
HP-WRK-006.

Guides: `typespec.md` (Closed vocabularies), `org-subscriptions.md`,
`database.md`, `ui.md`.

Exemplars: `typespec/common/language_catalog.*` and `currency_catalog.*`
(seeded catalogs with Go and TS companions); `typespec/orgs/subscriptions/`
and `backend/internal/orgs/entitlements/plans.go` (plan entitlements);
`orgs-ui/src/pages/PlansPage.tsx`.

## Steps

1. Add the Capability catalog (`sourcing`, `interviewing`, `assessment`,
   `background_check`) with OIDs identical in every tenant, the way existing
   seeded OIDs are declared and seeded. Map each stage Capability to the
   stage kind it performs.
2. Declare the vocabularies stage kind (`review`, `assessment`, `interview`,
   `background_check`) and check type (`identity`, `education`,
   `employment`, `criminal`, `address`, `credit`, `drug`) as extensible on
   responses.
3. Add `allows_listings` to the Org plan entitlements: false on Free, true
   on Silver and Gold, in the contract, Go, TS, and wherever entitlements
   are read. Show it on the Plans page in all locales.

## Tests

Catalog tests beside the existing ones (Go and TS agree, OIDs stable);
entitlement tests per plan; Plans page shows the new entitlement.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make orgs-ui-check`, `make playwright-check`, changed specs against
`make test-environment`.

## Acceptance

Later tasks can import the Capability, stage kind, and check type
vocabularies, and read `allows_listings` from the plan.
