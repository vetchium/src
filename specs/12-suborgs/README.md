Status: DRAFT
Authors: @psankar
Dependencies:

## Overview

Large multinational employers may operate legally distinct entities across different countries (e.g., Acme Corp Inc., Acme Corp North America LLC, Acme Corp UK LLC) while being a single logical company on Vetchium. The SubOrgs feature lets an employer model this structure by creating Sub-Organisations (SubOrgs), each pinned to a specific Vetchium geographic region. Job Openings, Applications, and related data are then stored in the region of the SubOrg rather than always in the employer's home region.

An org that does not need this structure can continue operating without any SubOrgs and all data continues to reside in its home region, exactly as before.

## Definitions

- **Org (Parent Org)**: The top-level employer account on Vetchium. Has a home region assigned at signup.
- **SubOrg**: A named sub-entity of a parent Org, pinned to exactly one Vetchium region. Visible to job seekers. Examples: "Acme Corp North America LLC" (usa1), "Acme Corp Europe LLC" (deu1).
- **Home region**: The Vetchium region where the Org's account data (users, domains, etc.) lives.
- **Pinned region**: The Vetchium region a SubOrg is assigned to. All Openings created under a SubOrg are stored in the pinned region.

## Acceptance Criteria

### SubOrg Lifecycle

- An org superadmin (or a user with `employer:manage_suborgs` role) can create a SubOrg by providing:
  - A display name (shown to job seekers, e.g., "Acme Corp North America LLC", "Acme Corp GmbH")
  - A Vetchium region to pin it to (ind1, usa1, deu1, etc.)
- A SubOrg's display name can be updated after creation by a user with `employer:manage_suborgs`. The pinned region is immutable — it cannot be changed after creation.
- A SubOrg can be disabled (not deleted). Disabling a SubOrg:
  - Prevents new Openings from being created under it
  - Does not remove org user assignments to that SubOrg
  - What happens to Openings and Applications already in an open state under a disabled SubOrg is defined in the Opening lifecycle spec (a subsequent spec that depends on this one)
- A disabled SubOrg can be re-enabled.
- There is no hard delete of a SubOrg.
- SubOrgs are one level deep only: a SubOrg cannot itself have child SubOrgs.
- An org may have zero SubOrgs (the default state). Zero-SubOrg orgs are unaffected by this feature.
- An org may have SubOrgs in the same region as its home region (e.g., a US company can create a "Acme Corp North America" SubOrg also in usa1).
- Multiple SubOrgs may be pinned to the same region (e.g., two European legal entities both in deu1).

### SubOrg Visibility to Job Seekers

- When a hub user browses or searches for Openings, the SubOrg name is displayed alongside the parent org name for Openings created under a SubOrg.
- For Openings created directly under the parent org (no SubOrg), only the parent org name is shown — same as today.

### Domains

- SubOrgs do not have their own domains. All domain ownership and verification remains at the parent org level.
- Org users who belong to a SubOrg must have email addresses under one of the parent org's verified domains, same as today.

### Billing

- Billing and subscription tiers are managed at the parent org level only. SubOrgs have no separate billing.

### Org User — SubOrg Assignment

- An org user can be assigned to one or more SubOrgs by an org superadmin or a user with the `employer:manage_suborgs` role.
- An org user can be unassigned from a SubOrg (revoke membership).
- When an org user is **disabled**, all their SubOrg assignments are automatically revoked. If the user is later re-enabled, their SubOrg memberships are not automatically restored — an admin must reassign them explicitly.
- An org user's SubOrg assignments determine the scope of their actions:
  - They can create or manage Openings under the parent org directly (home region), or under any SubOrg they are assigned to.
  - They cannot see or act on SubOrgs they are not assigned to.
- Org superadmins are implicitly members of all SubOrgs and bypass SubOrg-scoping restrictions.
- An org user may hold the same role (e.g., `employer:manage_openings`) across multiple SubOrgs simultaneously.
- SubOrg assignment does not change any existing role assignments; roles remain at the org level and apply within the SubOrg scope.

### Openings and Region Assignment

- When creating an Opening, the creator selects a target: either the **parent org** (Opening stored in the home region) or one of the **SubOrgs** they are assigned to (Opening stored in that SubOrg's pinned region). Both are valid choices regardless of whether the org has SubOrgs.
- When an org has no SubOrgs, the only valid target is the parent org — behaviour is unchanged from today.
- The target (and thus the region) of an Opening is immutable once created. If the data needs to be in a different region, a new Opening must be created.
- The person creating an Opening cannot target a SubOrg they are not assigned to.
- A job Opening that is relevant to multiple countries is still stored in exactly one region — the creator selects the most appropriate region at creation time based on data residency requirements or the primary hiring location.

### SubOrg Limits

- An org may create at most **256 SubOrgs** (active and disabled combined). Attempting to create a 257th SubOrg is rejected with an error.

### Discoverability

- Hub users primarily see Openings stored in their home region.
- Openings in other regions are also visible but are deprioritised in search and browse results.
- The region of an Opening (and therefore its SubOrg) influences both data residency and which hub users most readily discover it.

### SubOrg Naming

- SubOrg names are purely display labels. Uniqueness within an org is **not enforced** — two SubOrgs of the same org may share the same name. Each SubOrg is identified by an internal UUID.
- SubOrg names are visible to job seekers, so employers are responsible for choosing meaningful and unambiguous names.

### Notifications

- When a SubOrg is disabled, all org users currently assigned to that SubOrg are notified by **email** using the existing DB-backed email worker.
- The notification email informs them that the SubOrg has been disabled and they can no longer create Openings under it.
- Emails are enqueued inside the same transaction that disables the SubOrg, so if the transaction rolls back no spurious emails are sent.

### Data Storage

- SubOrg definitions (name, pinned region, status) are stored in the org's **home regional DB**.
- SubOrg user-assignment records are also stored in the org's **home regional DB**, co-located with `org_user_roles`.
- All audit log entries for SubOrg operations are written to the `audit_logs` table in the org's **home regional DB**.

### Audit Log Events

Every write operation must record an entry in `audit_logs` (home regional DB) inside the same transaction as the primary write. Fields follow the established pattern: `actor_user_id` = the authenticated org user performing the action; `org_id` = the employer's org ID; `ip_address` from `X-Forwarded-For` / `r.RemoteAddr`; raw email addresses are never stored — SHA-256 hashes only.

| Operation        | `event_type`                    | `target_user_id`   | `event_data`                                |
| ---------------- | ------------------------------- | ------------------ | ------------------------------------------- |
| Create SubOrg    | `employer.create_suborg`        | null               | `{ suborg_id, suborg_name, pinned_region }` |
| Rename SubOrg    | `employer.rename_suborg`        | null               | `{ suborg_id, old_name, new_name }`         |
| Disable SubOrg   | `employer.disable_suborg`       | null               | `{ suborg_id, suborg_name }`                |
| Re-enable SubOrg | `employer.enable_suborg`        | null               | `{ suborg_id, suborg_name }`                |
| Assign member    | `employer.add_suborg_member`    | assigned user's ID | `{ suborg_id }`                             |
| Remove member    | `employer.remove_suborg_member` | removed user's ID  | `{ suborg_id }`                             |

**Automatic revocation on user disable**: When a user is disabled their SubOrg assignments are revoked as part of the `employer.disable_user` transaction. No separate `employer.remove_suborg_member` entries are written — the `employer.disable_user` audit entry is considered sufficient.

### Cross-Region Constraint

- A regional API server can only write directly to its own regional DB. It cannot open a transaction on a different region's DB.
- All SubOrg management operations (create, rename, disable, enable, assign/unassign members) execute entirely within the org's home regional DB — no cross-region writes are required.
- Opening creation targeting a SubOrg whose pinned region differs from the org's home region **requires the home-region API server to proxy the write to the target region's internal endpoint** (`ProxyToRegion`). The full data-flow for this is defined in the Opening creation spec.

### Roles

- Two new roles govern SubOrg management:
  - `employer:manage_suborgs` — create, disable, re-enable, and rename SubOrgs; assign/unassign org users to SubOrgs.
  - `employer:view_suborgs` — view all SubOrgs and their membership details; no write access.
- `employer:superadmin` implicitly has `employer:manage_suborgs`.
- **Any authenticated org user** (regardless of roles) can list all SubOrgs of their org. No special role is required for read-only listing. This allows any org user to see the available SubOrgs when selecting a target for an Opening.
- These roles follow the same RBAC patterns as all existing employer roles.

## Scope

- **In scope**:
  - SubOrg creation, listing, disable, re-enable, rename (no delete)
  - Assigning / unassigning org users to SubOrgs
  - Opening target selection: parent org (home region) or a SubOrg (pinned region)
  - Storing Opening data in the target's region
  - Displaying SubOrg name to job seekers on Opening listings
  - `employer:manage_suborgs` and `employer:view_suborgs` roles
  - Zero-SubOrg orgs are fully backward compatible — no behaviour change

- **To be addressed in subsequent specs**:
  - Full Opening creation API and UI (this spec is a prerequisite for that)
  - Applications, interview scheduling, and any post-Opening workflow scoped to SubOrgs
  - SubOrg-level analytics or dashboards

- **Explicitly not supported by design**:
  - Nested SubOrgs — one level (Org → SubOrgs) only, by deliberate choice
  - SubOrg-specific domains — domain ownership and verification is always at the parent org level
  - Per-SubOrg billing — billing is always at the parent org level
  - Cross-region Opening replication — an Opening lives in exactly one region
