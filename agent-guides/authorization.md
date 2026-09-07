# Authorization

Applies to permissions, the checks that enforce them, and the screens that
present them. Read it with the guide for the layer being changed. The admin
portal has the only permission model today; a hub or org model must follow the
same shape rather than invent a second one.

## The catalog

- `vetchium.admin_permission_catalog` is the set of permissions the database
  accepts. Grants reference it, so an undefined permission cannot be stored.
- `vetchium.admin_permission_implications` records that holding one permission
  confers another. Only the granted permission is stored; the implied one is
  resolved on read.
- `vetchium.admin_effective_permissions` resolves one hop of implication. Read
  effective permissions from that view; do not re-derive them in a query and do
  not store an implied permission as its own grant. A chained implication would
  need a recursive expansion in the view and a matching change in the contract
  helper.
- `typespec/admin/authorization/` owns the same vocabulary for Go and
  TypeScript callers: `AdminPermissions`, `Implies`, `EffectivePermissions`,
  `DirectPermissions`.

Adding a permission is a catalog row in `db/migrations/`, the same value in the
contract's `AdminPermission` vocabulary across `.tsp`, `.go`, and `.ts`, and a
name and description in every `admin-ui/src/i18n/locales/` file. Nothing else
should need to change. If a query, handler, or component must be edited to
accommodate it, that code is enumerating permissions and should be generalized.

## Using permissions

- Never write a permission literal in a handler, component, route table, or
  query; take it from the contract's typed constants. The exception is a
  database predicate enforcing a named invariant, where the literal is the
  invariant.
- Requests carry the open `AdminPermissionID`, never the closed enum. The
  server validates every value against the catalog, and that is what keeps an
  unknown permission out of storage. This lets a portal older than its API
  return a permission it does not recognize instead of silently revoking it, so
  do not narrow those request fields to the closed vocabulary.
- A portal presents every permission it receives, including ones it cannot
  name, and sends them back unchanged unless the operator turned them off.
- Send grants, not effective permissions. Reduce a selection with
  `DirectPermissions` before writing so an implied permission is not stored
  twice.
- Build screens from the catalog, never from a fixed list of access levels. A
  named tier such as "manager" or "viewer" stops describing anything the moment
  a second unrelated permission exists.
- Label a defined permission with its translated name, in uppercase
  underscore-separated jargon such as `MANAGE_ADMINISTRATORS` wherever the
  language has uppercase forms. Label a permission this portal does not define
  with its complete raw identifier so it stays visible and unambiguous.

## Lockout invariant

A permission or state change must never leave a tenant with no active
administrator holding `admin:manage_users`. Nothing outside the database can
restore that state, so enforce it as a predicate inside the writing statement,
never as a check the handler runs first. `SetAdminPermissions` and
`DisableAdminUser` in `backend/internal/db/queries/` are the working examples;
both report the refusal through the same problem type.

Two consequences. Concurrent demotions of different administrators each read a
snapshot in which the other still qualifies, so the invariant holds on every
sequential path but not that race; closing it needs a deferred constraint
trigger or a serializable transaction. And a refusal no caller can provoke is
still worth enforcing, because direct database access can reach the state it
protects: declare the response in the contract, cover the handler branch with a
unit test, and record in the operation's documentation why Playwright cannot
exercise it.

## Step-up authentication

Recent authentication protects credentials, not administration. Require it to
change a password, enroll or disable a second factor, regenerate recovery
codes, or change what an administrator may do. Do not require it for ordinary
administration such as inviting a user, disabling an account, or reading a
list: the permission check is the control there, and a step-up prompt in front
of routine work trains operators to re-enter credentials without reading the
prompt.

Where an endpoint does require it, the portal surfaces the refusal as an offer
to sign in again that preserves the session, never as a sign-out.
