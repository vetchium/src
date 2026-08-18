# Authorization Guide

This guide applies to permissions, the checks that enforce them, and the
screens that present them. Use it together with the guide for whichever layer
is being changed. The admin portal is the only portal with a permission model
today; a hub or org model must follow the same rules rather than invent a
second shape.

## The permission catalog

- `vetchium.admin_permission_catalog` is the set of permissions the database
  accepts. Grants reference it, so an undefined permission cannot be stored.
- `vetchium.admin_permission_implications` records that holding one permission
  confers another. Only the granted permission is stored; the implied one is
  resolved on read.
- `vetchium.admin_effective_permissions` resolves one hop of implication. Read
  effective permissions from that view. Do not re-derive them in a query, and
  do not store an implied permission as a grant of its own. A chained
  implication would need a recursive expansion in the view and a matching
  change in the contract helper.
- The contract package under `typespec/admin/authorization/` owns the same
  vocabulary for Go and TypeScript callers, with `AdminPermissions`, `Implies`,
  `EffectivePermissions`, and `DirectPermissions`.

Adding a permission is a catalog row in `db/migrations/`, the same value in the
contract's `AdminPermission` vocabulary across its `.tsp`, `.go`, and `.ts`
files, and a name and description in every `admin-ui/src/i18n/locales/` file.
Nothing else may need to change; if a query, handler, or component has to be
edited to accommodate it, that code is enumerating permissions and should be
generalized instead.

## Using permissions in code

- Do not write a permission literal in a handler, component, route table, or
  query. Take the value from the contract's typed constants. The one exception
  is a database predicate that enforces a named invariant, where the literal
  is the invariant.
- Requests carry the open `AdminPermissionID`, never the closed enum. The
  server validates every value against the catalog, which is what keeps an
  unknown permission out of storage. This lets a portal older than its API
  return a permission it does not recognize instead of silently revoking it, so
  do not narrow those request fields to the closed vocabulary.
- A portal must present the permissions it receives, including ones it cannot
  name, and must send them back unchanged unless the operator turned them off.
- Send grants, not effective permissions. Reduce a selection with
  `DirectPermissions` before writing it so an implied permission is not stored
  twice.
- Screens are built from the catalog, not from a fixed list of access levels.
  A named tier such as "manager" or "viewer" stops describing anything once a
  second unrelated permission exists.

## Lockout invariants

A permission change or state change must never leave a tenant with no active
administrator holding `admin:manage_users`. Nothing outside the database can
restore that state, so enforce it as a predicate inside the writing statement,
never as a check the handler performs first. `SetAdminPermissions` and
`DisableAdminUser` in `backend/internal/db/queries/` are the working examples,
and both report the refusal through the same problem type.

Two consequences worth knowing. Concurrent demotions of different
administrators each read a snapshot in which the other still qualifies, so the
invariant holds for every sequential path but not for that race; closing it
needs a deferred constraint trigger or a serializable transaction. And a
refusal a caller cannot provoke is still worth enforcing, because the state it
protects can be reached by direct database access; declare the response in the
contract, cover the handler branch with a unit test, and record in the
operation's documentation why Playwright cannot exercise it.

## Step-up authentication

Recent authentication protects credentials, not administration. Require it for
changing a password, for enrolling or disabling a second factor, for
regenerating recovery codes, and for changing what an administrator is allowed
to do. Do not require it for ordinary administration such as inviting a user,
disabling an account, or reading a list: the permission check is the control
there, and a step-up prompt in front of routine work trains operators to
re-enter credentials without reading the prompt.

When an endpoint does require it, the portal must surface the refusal as an
offer to sign in again that preserves the session, never as a sign-out.
