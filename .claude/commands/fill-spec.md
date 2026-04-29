Fill in Stage 2 (Implementation Plan) of an existing spec whose Stage 1 is APPROVED.

## Identify the spec file

If $ARGUMENTS names a path or feature, find the matching `specs/{feature}/README.md`.

If $ARGUMENTS is empty, look for spec files where Stage 1 `Status: APPROVED` and Stage 2 `Status: DRAFT`. If exactly one exists, use it. If multiple exist, list them and ask the user which one to fill.

## Before filling Stage 2

Read the spec file. Verify Stage 1 `Status` is `APPROVED`. If it is not, stop and tell the user to approve Stage 1 first.

## Fill Stage 2

Using `specs/spec-template-README.md` as the structural guide, fill in the implementation plan:

1. **API Contract** — write TypeSpec models and ops for every endpoint listed in Stage 1's API Surface. File path: `specs/typespec/{portal}/{feature}.tsp`
2. **Database Schema** — table and column definitions in SQL for the correct DB (global or regional). Edit `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql` directly — no new migration files
3. **SQL Queries** — sqlc-annotated queries covering every DB operation the handlers will need
4. **Backend** — endpoint table (method, path, handler file, auth middleware, role), handler notes, audit log event table
5. **Frontend** — new route table, implementation notes specific to this feature
6. **RBAC** — new roles (if any) with the three files that must stay in sync; existing roles reused
7. **i18n** — en-US keys for every user-visible string; note that de-DE and ta-IN need matching keys
8. **Test Matrix** — full scenario table including RBAC positive/negative and audit log assertions

Set Stage 2 `Status: DRAFT` when done.

## Quality rules

- TypeSpec must use snake_case for all JSON field names
- All list endpoints must use keyset pagination (never OFFSET)
- Every write endpoint needs an audit log event row in the table
- RBAC: always include both a positive test (non-superadmin with the role → success) and a negative test (no roles → 403)
- Do not invent requirements not present in Stage 1 — if something is ambiguous, note it as an open question in the spec
- Be concise — no filler, no restating what is already obvious from the code conventions in CLAUDE.md
