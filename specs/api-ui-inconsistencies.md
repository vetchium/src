# API and UI Inconsistencies

This file documents legacy violations of project conventions and architectural mandates that are being phased out.

## Naming Conventions

### "-management" Suffix and "manage-" Prefix

**Rule**: Never use `-management` suffix or `manage-` prefix for list pages, translation namespaces, or test files. Use the plural resource name instead.

**Status**: Fixed on 2026-05-15.

**Resolved Violations**:
- `user-management.json` renamed to `users.json`
- `userManagement` namespace renamed to `users`
- `UserManagementRoute` renamed to `UsersRoute`
- `DomainManagementRoute` renamed to `DomainsRoute`
- `user-management.spec.ts` renamed to `users.spec.ts`
- `password-management.spec.ts` renamed to `passwords.spec.ts`
- `role-management.spec.ts` renamed to `roles.spec.ts`

### Route Patterns

**Rule**: All new feature routes must follow `/{resource}` for lists, `/{resource}/new` for creation, etc.

**Legacy Violations**:
- None currently identified.
