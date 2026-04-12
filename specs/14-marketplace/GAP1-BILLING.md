# Gap 1: Admin Billing Management (Spec Section 8.4)

Status: Not implemented  
Discovered: 2026-04-12

---

## What the spec requires

Section 8.4 of SPEC.md states:

> Admins view billing records per org per Capability, manually record payments, and waive fees.

Section 3 says:

> The specific fee schedule per Capability is set by Vetchium admins. A Listing that is
> suspended or archived does not accrue a fee.

Payment processing itself is deferred ("Payment processing is a future feature"), but admin
visibility into billing records is a current requirement.

---

## What exists today

| Layer                                                                           | Status                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| DB schema (`marketplace_billing_records` in global DB)                          | ✅ Exists                                                                                                 |
| SQL queries (`InsertMarketplaceBillingRecord`, `ListMarketplaceBillingRecords`) | ✅ Exist in `api-server/db/queries/global.sql`                                                            |
| Admin UI page (`admin-ui/src/pages/Marketplace/BillingPage.tsx`)                | ✅ Exists (calls an endpoint that doesn't exist yet)                                                      |
| Backend handler                                                                 | ❌ Missing                                                                                                |
| Route registration                                                              | ❌ Missing (`/admin/marketplace/billing/list` not in `api-server/internal/routes/admin-global-routes.go`) |
| Logic to insert billing records when a listing goes `active`                    | ❌ Missing                                                                                                |
| Playwright tests                                                                | ❌ Missing                                                                                                |

---

## What needs to be built

### 1. Billing record insertion (triggered by listing state changes)

When a listing transitions to `active` (from either `PublishListing` or `ApproveListing`
or `AdminReinstateListing`), a billing record should be inserted into
`marketplace_billing_records`. When a listing leaves `active` (suspended or archived),
the billing period ends.

The exact billing record schema needs to be confirmed with the product team. Based on the
DB migration, `marketplace_billing_records` has the following fields (check the migration
for the authoritative column list):

- `id` UUID PK
- `org_id` (provider org)
- `listing_id`
- `capability_id`
- `created_at`

The spec says "the fee depends on which Capabilities are active, how many Listings are live,
and potentially the volume of Subscriptions" — the fee schedule per Capability is set by
admins. The billing records table likely needs a `period_start`, `period_end`, `amount`, and
`status` (pending / paid / waived). Confirm the schema before implementing.

### 2. Admin API endpoint: list billing records

Endpoint: `POST /admin/marketplace/billing/list`

Required roles: `admin:view_marketplace` (read) or `admin:manage_marketplace` (read+write)

Request (suggested):

```json
{
	"org_domain": "optional filter",
	"capability_id": "optional filter",
	"pagination_key": "optional",
	"limit": 20
}
```

Response:

```json
{
  "billing_records": [...],
  "next_pagination_key": "optional"
}
```

### 3. Admin API endpoints: record payment and waive fee

Endpoint: `POST /admin/marketplace/billing/record-payment`  
Endpoint: `POST /admin/marketplace/billing/waive`

Required role: `admin:manage_marketplace`

These mutate the billing record status. Exact fields TBD based on schema.

### 4. TypeSpec

Add the billing request/response types to `specs/typespec/admin/marketplace.tsp` and
regenerate `admin/marketplace.ts` and `admin/marketplace.go`.

### 5. Admin UI

`BillingPage.tsx` already exists. It needs to be wired up to the real API endpoint once
it exists. Verify the component calls the correct URL and handles the response shape.

### 6. Route registration

Register the new endpoints in `api-server/internal/routes/admin-global-routes.go` with
the appropriate role middleware (same pattern as other admin marketplace routes).

### 7. Audit logging

Every billing write (record-payment, waive) must emit an `InsertAdminAuditLog` inside
the transaction:

- `admin.marketplace_billing_payment_recorded`
- `admin.marketplace_billing_fee_waived`

### 8. Tests

Add to `playwright/tests/api/admin/marketplace.spec.ts`:

- List billing records (200) with view and manage roles
- Record payment (200) with manage role
- Waive fee (200) with manage role
- 401/403 for all write endpoints
- Audit log assertions for record-payment and waive

---

## Files to touch

| File                                                                | Change                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `api-server/db/migrations/global/00000000000001_initial_schema.sql` | Verify/extend `marketplace_billing_records` schema                           |
| `api-server/db/queries/global.sql`                                  | Add `RecordBillingPayment`, `WaiveBillingFee`, `UpdateBillingRecord` queries |
| `api-server/db/` (sqlc generated)                                   | Run `sqlc generate` after SQL changes                                        |
| `specs/typespec/admin/marketplace.tsp`                              | Add billing request/response types and endpoints                             |
| `specs/typespec/admin/marketplace.ts`                               | Regenerate                                                                   |
| `specs/typespec/admin/marketplace.go`                               | Regenerate                                                                   |
| `api-server/handlers/admin/marketplace-billing.go`                  | New file: ListBillingRecords, RecordPayment, WaiveFee handlers               |
| `api-server/internal/routes/admin-global-routes.go`                 | Register new routes                                                          |
| `admin-ui/src/pages/Marketplace/BillingPage.tsx`                    | Wire up to real API                                                          |
| `playwright/tests/api/admin/marketplace.spec.ts`                    | Add billing test describe block                                              |

---

## Open questions before starting

1. What columns does `marketplace_billing_records` currently have? (Read the migration.)
2. Should billing records be created automatically (event-driven on listing activation), or
   manually by admins? The spec says "Vetchium charges Provider Orgs for active Listings"
   suggesting automatic, but "manually record payments" in 8.4 suggests manual reconciliation.
3. What is the fee schedule data model? Is it stored per-capability in
   `marketplace_capabilities`? The spec mentions "The specific fee schedule per Capability
   is set by Vetchium admins" but no `fee` field exists in the current schema.
4. Is the billing period monthly, per-event, or something else?
