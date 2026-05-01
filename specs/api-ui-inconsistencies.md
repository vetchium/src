# API & UI Inconsistencies

Canonical standards are defined in CLAUDE.md under "API Endpoints Convention" and "Frontend Architecture → UI Route Structure".
This file lists genuine violations — inconsistencies _within_ the established patterns — to be fixed in a future cleanup pass.

---

## 1. `add-*` vs `create-*` for top-level resource creation

Standard: `add-*` for adding to a parent collection; `create-*` for standalone top-level entities.

| Current endpoint                  | Should be                            | Reason                                                           |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `POST /org/add-cost-center`       | `POST /org/create-cost-center`       | Cost center is a standalone entity, not a member of a collection |
| `POST /admin/add-approved-domain` | `POST /admin/create-approved-domain` | Same — approved domain is a standalone entity                    |
| `POST /admin/add-tag`             | `POST /admin/create-tag`             | Same                                                             |

(Suborg members, role assignments remain `add-*` / `remove-*` — those are genuine collection membership.)

---

## 2. `filter-*` verb — all should be `list-*`

Standard: `list-*` for all paginated endpoints regardless of what filter fields they have.

| Current endpoint                | Should be                     |
| ------------------------------- | ----------------------------- |
| `POST /org/filter-users`        | `POST /org/list-users`        |
| `POST /admin/filter-users`      | `POST /admin/list-users`      |
| `POST /org/filter-tags`         | `POST /org/list-tags`         |
| `POST /admin/filter-tags`       | `POST /admin/list-tags`       |
| `POST /hub/filter-tags`         | `POST /hub/list-tags`         |
| `POST /org/filter-audit-logs`   | `POST /org/list-audit-logs`   |
| `POST /admin/filter-audit-logs` | `POST /admin/list-audit-logs` |
| `POST /hub/my-audit-logs`       | `POST /hub/list-audit-logs`   |

---

## 3. HTTP method violation

| Current                     | Should be                 | Issue                                                                           |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `DELETE /org/delete-domain` | `POST /org/delete-domain` | Only DELETE in the entire API; inconsistent with the POST-everywhere convention |

---

## 4. Bare `id` field in request/response bodies

Standard: always `{resource}_id`, never bare `id`.

| TypeSpec model            | Current field | Should be                |
| ------------------------- | ------------- | ------------------------ |
| `AddCostCenterRequest`    | `id: string`  | `cost_center_id: string` |
| `UpdateCostCenterRequest` | `id: string`  | `cost_center_id: string` |
| `CostCenter` (response)   | `id: string`  | `cost_center_id: string` |

---

## 5. Missing `limit` field in list requests

Standard: all paginated list requests must have `limit?: int32`.

| Missing from               |
| -------------------------- |
| `ListCostCentersRequest`   |
| `ListSubOrgMembersRequest` |
| Hub `FilterTagsRequest`    |
| Org `FilterTagsRequest`    |
| Admin `FilterTagsRequest`  |

---

## 6. `items` instead of plural resource name in list responses

Standard: `{resources}: ResourceType[]` — never `items`.

| TypeSpec model              | Current key        | Should be          |
| --------------------------- | ------------------ | ------------------ |
| `AdminListOrgPlansResponse` | `items: OrgPlan[]` | `plans: OrgPlan[]` |

---

## 7. Nested `{resource}/{action}` style where `{verb}-{resource}` should be used

The marketplace and org-plan routes were written with an extra nesting level that isn't needed. The correct form is `/{namespace}/{verb}-{resource}`.

| Current endpoint                                  | Should be                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /org/marketplace/listing/create`            | `POST /org/marketplace/create-listing`                                      |
| `POST /org/marketplace/listing/update`            | `POST /org/marketplace/update-listing`                                      |
| `POST /org/marketplace/listing/publish`           | `POST /org/marketplace/publish-listing`                                     |
| `POST /org/marketplace/listing/approve`           | `POST /org/marketplace/approve-listing`                                     |
| `POST /org/marketplace/listing/reject`            | `POST /org/marketplace/reject-listing`                                      |
| `POST /org/marketplace/listing/archive`           | `POST /org/marketplace/archive-listing`                                     |
| `POST /org/marketplace/listing/reopen`            | `POST /org/marketplace/reopen-listing`                                      |
| `POST /org/marketplace/listing/add-capability`    | `POST /org/marketplace/add-listing-capability`                              |
| `POST /org/marketplace/listing/remove-capability` | `POST /org/marketplace/remove-listing-capability`                           |
| `POST /org/marketplace/listing/list`              | `POST /org/marketplace/list-listings`                                       |
| `POST /org/marketplace/listing/get`               | `POST /org/marketplace/get-listing`                                         |
| `POST /org/marketplace/subscription/subscribe`    | `POST /org/marketplace/create-subscription`                                 |
| `POST /org/marketplace/subscription/cancel`       | `POST /org/marketplace/cancel-subscription`                                 |
| `POST /org/marketplace/subscription/list`         | `POST /org/marketplace/list-subscriptions`                                  |
| `POST /org/marketplace/subscription/get`          | `POST /org/marketplace/get-subscription`                                    |
| `POST /org/marketplace/clients/list`              | `POST /org/marketplace/list-clients`                                        |
| `POST /admin/marketplace/capability/create`       | `POST /admin/marketplace/create-capability`                                 |
| `POST /admin/marketplace/capability/update`       | `POST /admin/marketplace/update-capability`                                 |
| `POST /admin/marketplace/capability/list`         | `POST /admin/marketplace/list-capabilities`                                 |
| `POST /admin/marketplace/listing/list`            | `POST /admin/marketplace/list-listings`                                     |
| `POST /admin/marketplace/listing/suspend`         | `POST /admin/marketplace/suspend-listing`                                   |
| `POST /admin/marketplace/listing/reinstate`       | `POST /admin/marketplace/reinstate-listing`                                 |
| `POST /admin/marketplace/subscription/list`       | `POST /admin/marketplace/list-subscriptions`                                |
| `POST /admin/marketplace/subscription/cancel`     | `POST /admin/marketplace/cancel-subscription`                               |
| `POST /org/org-plan/list-plans`                   | `POST /org/list-plans` (drop the `org-` namespace — no ambiguity at `/org`) |
| `POST /org/org-plan/get`                          | `POST /org/get-plan`                                                        |
| `POST /org/org-plan/upgrade`                      | `POST /org/upgrade-plan`                                                    |
| `POST /admin/org-plan/list`                       | `POST /admin/list-org-plans`                                                |
| `POST /admin/org-plan/set`                        | `POST /admin/set-org-plan`                                                  |

---

## 8. `status: string` instead of typed enum in TypeSpec

Affects: `CostCenter.status`, `SubOrg.status`, `MarketplaceListing.status`, `MarketplaceCapability.status`. These should use a typed enum (matching the pattern now enforced for new features) so TypeScript catches wrong literals. See the `"pending_approval"` bug in CLAUDE.md.

---

## 9. UI route naming violations

Standard: plural kebab-case noun for list pages (e.g. `/users`, `/domains`).

| Portal   | Current route        | Should be  | Issue                |
| -------- | -------------------- | ---------- | -------------------- |
| org-ui   | `/user-management`   | `/users`   | `-management` suffix |
| org-ui   | `/domain-management` | `/domains` | `-management` suffix |
| admin-ui | `/user-management`   | `/users`   | `-management` suffix |
| admin-ui | `/manage-tags`       | `/tags`    | `manage-` prefix     |

---

## 10. New specs written in nested style — should use flat style

`job-openings` and `company-addresses` were written before the single flat-style rule was established. Their API endpoints need updating before Stage 2 implementation:

| Current (in spec)              | Should be                     |
| ------------------------------ | ----------------------------- |
| `POST /org/openings/create`    | `POST /org/create-opening`    |
| `POST /org/openings/list`      | `POST /org/list-openings`     |
| `POST /org/openings/get`       | `POST /org/get-opening`       |
| `POST /org/openings/update`    | `POST /org/update-opening`    |
| `POST /org/openings/duplicate` | `POST /org/duplicate-opening` |
| `POST /org/openings/submit`    | `POST /org/submit-opening`    |
| `POST /org/openings/approve`   | `POST /org/approve-opening`   |
| `POST /org/openings/reject`    | `POST /org/reject-opening`    |
| `POST /org/openings/pause`     | `POST /org/pause-opening`     |
| `POST /org/openings/reopen`    | `POST /org/reopen-opening`    |
| `POST /org/openings/close`     | `POST /org/close-opening`     |
| `POST /org/openings/archive`   | `POST /org/archive-opening`   |
| `POST /org/addresses/create`   | `POST /org/create-address`    |
| `POST /org/addresses/update`   | `POST /org/update-address`    |
| `POST /org/addresses/disable`  | `POST /org/disable-address`   |
| `POST /org/addresses/enable`   | `POST /org/enable-address`    |
| `POST /org/addresses/list`     | `POST /org/list-addresses`    |
| `POST /org/addresses/get`      | `POST /org/get-address`       |
