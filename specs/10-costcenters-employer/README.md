Status: COMPLETED
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- Two new user roles for EmployerPortal users:
  - `employer:manage_costcenters` — full CRUD access to CostCenters
  - `employer:view_costcenters` — read-only access to CostCenters (list only)
- EmployerPortal users with `employer:manage_costcenters` or `employer:superadmin` role should be able to CRUD CostCenters for their Organization, using a Tile on the EmployerPortal Dashboard UI. Those who do not have these rights should not see that tile.
- There should be corresponding backend APIs which CRUD CostCenters for the Employer, with appropriate role checks via the middlewares

## Scope

### CostCenter Fields

A CostCenter has the following fields, all provided by the creating user:

| Field          | Type   | Required | Constraints                                                               |
| -------------- | ------ | -------- | ------------------------------------------------------------------------- |
| `id`           | string | Yes      | Free-form, 1–64 characters; unique per employer; immutable after creation |
| `display_name` | string | Yes      | Free-form, 1–64 characters                                                |
| `status`       | enum   | —        | `enabled` (default on creation) or `disabled`                             |
| `notes`        | string | No       | Optional, max 500 characters                                              |

- Only `id` must be unique per employer. `display_name` may repeat.
- Once created, `id` cannot be changed. `display_name`, `notes`, and `status` can be updated.
- A CostCenter cannot be deleted, only enabled or disabled.

### CostCenter is Optional

An Employer can choose to operate without adding any CostCenter.

### APIs

| Endpoint                       | Method | Required Role                                                                        |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------ |
| `/employer/add-cost-center`    | POST   | `employer:manage_costcenters` or `employer:superadmin`                               |
| `/employer/update-cost-center` | POST   | `employer:manage_costcenters` or `employer:superadmin`                               |
| `/employer/list-cost-centers`  | POST   | `employer:view_costcenters`, `employer:manage_costcenters`, or `employer:superadmin` |

#### List CostCenters

- Supports optional filtering by `status` (`enabled` / `disabled`). Omitting the filter returns all.
- Sorted by `created_at` ascending (oldest first), with keyset pagination on `(created_at, id)`.
- Page size: 20 per page.

### Dashboard Tile

- Visible only to users with `employer:manage_costcenters` or `employer:superadmin` role.
- Users with only `employer:view_costcenters` do not see the management tile (they may still call the list API directly).

### Future Use

These CostCenters may be used in future when creating an Opening, to map the Opening against a CostCenter.
