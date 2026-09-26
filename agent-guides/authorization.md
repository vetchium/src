# Authorization

Applies to permissions, the checks that enforce them, and the screens that
present them. The admin portal has the only permission model today; a hub or org
model must follow the same shape rather than invent a second one.

## The catalog

- `vetchium.admin_permission_catalog` is the set of permissions the database
  accepts. Grants reference it, so an undefined permission cannot be stored.
- `vetchium.admin_permission_implications` records that holding one permission
  confers another. Only the granted permission is stored; the implied one is
  resolved on read.
- `vetchium.admin_effective_permissions` resolves one hop of implication. Read
  effective permissions from that view; never re-derive them in a query or store
  an implied permission as its own grant. A chained implication would need a
  recursive expansion in the view and a matching change in the contract helper.
- `typespec/admin/authorization/` owns the vocabulary for Go and TypeScript:
  `AdminPermissions`, `Implies`, `EffectivePermissions`, `DirectPermissions`.

Adding a permission is a catalog row in `db/migrations/`, the same value in the
contract's `AdminPermission` vocabulary across `.tsp`, `.go`, and `.ts`, and a
name and description in every `admin-ui/src/i18n/locales/` file. Nothing else
should change; if a query, handler, or component must be edited, that code is
enumerating permissions and should be generalized.

## Using permissions

- Never write a permission literal in a handler, component, route table, or
  query; use the contract's typed constants. The exception is a database
  predicate enforcing a named invariant, where the literal is the invariant.
- Requests carry the open `AdminPermissionID`, never the closed enum. The server
  validates every value against the catalog, which keeps unknown permissions out
  of storage. This lets a portal older than its API return an unrecognized
  permission instead of silently revoking it, so do not narrow those request
  fields to the closed vocabulary.
- A portal presents every permission it receives, including ones it cannot name,
  and sends them back unchanged unless the operator turned them off.
- Send grants, not effective permissions: reduce a selection with
  `DirectPermissions` before writing so an implied permission is not stored
  twice.
- Build screens from the catalog, never a fixed list of access levels; a named
  tier such as "manager" or "viewer" stops describing anything once a second
  unrelated permission exists.
- Label a defined permission with its translated name, in uppercase
  underscore-separated jargon such as `MANAGE_ADMINISTRATORS` wherever the
  language has uppercase forms. Label a permission this portal does not define
  with its complete raw identifier.

## Lockout invariant

A permission or state change must never leave a tenant with no active
administrator holding `admin:manage_users`. Nothing outside the database can
restore that state, so enforce it as a predicate inside the writing statement,
never a check the handler runs first. `SetAdminPermissions` and
`DisableAdminUser` in `backend/internal/db/queries/` are the working examples;
both report the refusal through the same problem type.

- Concurrent demotions of different administrators each read a snapshot where
  the other still qualifies, so the invariant holds on every sequential path but
  not that race; closing it needs a deferred constraint trigger or a
  serializable transaction.
- Enforce a refusal no caller can provoke anyway, since direct database access
  can reach the state it protects: declare the response in the contract, cover
  the handler branch with a unit test, and record in the operation's
  documentation why Playwright cannot exercise it.

## Step-up authentication

Recent authentication protects credentials, not administration. Require it to
change a password, enroll or disable a second factor, regenerate recovery codes,
or change what an administrator may do. Do not require it for ordinary
administration (inviting or disabling a user, reading a list): the permission
check is the control there, and a step-up prompt before routine work trains
operators to re-enter credentials without reading it.

Where an endpoint requires it, the portal surfaces the refusal as an offer to
sign in again that preserves the session, never as a sign-out.
