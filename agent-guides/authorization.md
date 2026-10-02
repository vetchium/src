# Authorization

Applies to permissions, the checks that enforce them, and the screens that
present them, for administrators and Org users alike. A Hub model must follow
the same shape rather than invent a second one.

## The model

| Part | Admin | Org |
| --- | --- | --- |
| Catalog | `admin_permission_catalog` | `org_permission_catalog` |
| Implications | `admin_permission_implications` | `org_permission_implications` |
| Effective view | `admin_effective_permissions` | `org_effective_permissions` |
| Vocabulary | `typespec/admin/authorization/` | `typespec/orgs/authorization/` |

- The catalog is the set of permissions the database accepts. Grants reference
  it, so an undefined permission cannot be stored.
- An implication confers one permission through another. Store only the
  granted permission; resolve the implied one on read.
- Read effective permissions from the view, which resolves one hop. Never
  re-derive them in a query or store an implied permission as its own grant. A
  chained implication needs a recursive view and a matching contract helper.
- The contract vocabulary is the single source for Go and TypeScript (admin:
  `AdminPermissions`, `Implies`, `EffectivePermissions`, `DirectPermissions`;
  Org: `OrgPermissions`, `Holds`).
- Adding a permission is a catalog row in `db/migrations/`, the same value in
  the contract vocabulary across `.tsp`, `.go`, and `.ts`, and a name and
  description in every locale of the portal that presents permissions. If a
  query, handler, or component must change too, it enumerates permissions;
  generalize it.

## Using permissions

- Never write a permission literal in a handler, component, route table, or
  query; use the typed constants. The exception is a database predicate
  enforcing a named invariant, where the literal is the invariant.
- Requests carry the open permission ID (`AdminPermissionID`), never the closed
  enum, and the server validates each value against the catalog. Do not narrow
  these fields — a portal older than its API must return an unknown permission,
  not silently revoke it.
- A portal presents every permission it receives, including ones it cannot
  name, and sends them back unchanged unless the operator turned them off.
- Send grants, not effective permissions: reduce a selection with
  `DirectPermissions` before writing.
- Build screens from the catalog, never a fixed list of access levels — a tier
  such as "manager" or "viewer" stops meaning anything once a second unrelated
  permission exists.
- Label a defined permission with its translated name, as uppercase
  underscore-separated jargon such as `MANAGE_ADMINISTRATORS` wherever the
  language has uppercase forms. Label an undefined one with its raw identifier.

## Lockout invariant

- A tenant must always keep an active administrator holding
  `admin:manage_users`; an active Org must always keep an active Org user
  holding `org:superadmin`. Nothing outside the database can restore either.
- Enforce it as a predicate inside the statement that removes a grant or
  disables a user, never as a handler pre-check. `SetAdminPermissions` and
  `DisableAdminUser` in `backend/internal/db/queries/` are the examples; both
  report the refusal through the same problem type. No Org statement can remove
  the grant yet; the first one must enforce it.
- Concurrent demotions of different users each see the other still qualifying,
  so the predicate does not close that race; closing it needs a deferred
  constraint trigger or a serializable transaction.
- Enforce a refusal no caller can provoke anyway, since direct database access
  can reach the state: declare the response in the contract, unit-test the
  handler branch, and record in the operation's documentation why Playwright
  cannot exercise it.

## Step-up authentication

- Require recent authentication to change a password, enroll or disable a
  second factor, regenerate recovery codes, or change what a user may do.
- Do not require it for ordinary administration (inviting or disabling a user,
  reading a list) — the permission check is the control, and routine prompts
  train users to re-enter credentials without reading.
- Surface the refusal as an offer to sign in again that keeps the session,
  never as a sign-out.
