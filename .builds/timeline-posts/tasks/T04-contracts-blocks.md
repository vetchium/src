# T04 Contracts: Add Hub blocks and mutes

## Requirements

PST-BLK-001, PST-BLK-006, PST-BLK-007, PST-BLK-008, PST-RPL-004 (mesh check),
PST-RD-003

## Guides

`agent-guides/typespec.md`, `agent-guides/posts.md`, `agent-guides/go.md`,
`agent-guides/typescript.md`, `typespec/AGENTS.md`

## Exemplars

- `typespec/hub/messages/` (Hub interface, `.tsp` with `.go` and `.ts`
  companions, pagination)
- `typespec/hub/profile/` (`@route("/mesh/profile")` relay and
  `@route("/api/mesh/profile")` peer interfaces)
- `typespec/hub/hub.tsp` and `typespec/main.tsp` (imports)
- `typespec/package.json` `exports` map

## Steps

1. Create `typespec/hub/blocks/blocks.tsp`, `blocks.go`, `blocks.ts`.
2. Models:
   - `BlockUserRequest { user: Vetchium.Hub.ProfileAddress }` (reuse the
     existing address scalar for a handle or alias; find it in
     `typespec/hub/profile`). Use the same request for unblock, mute, unmute,
     and state.
   - `ListBlockedUsersRequest { pagination_key?: Vetchium.PaginationKey; limit?: int32 }`
     (default 20, maximum 50; validation refuses outside 1–50).
   - `BlockedUser { handle: Vetchium.Hub.Handle; created_at: utcDateTime }`.
   - `ListBlockedUsersResponse { users: BlockedUser[]; next_pagination_key?: Vetchium.PaginationKey }`.
   - `BlockState { blocked: boolean; muted: boolean }`.
3. Interface `@route("/api/hub/blocks")`: `/block`, `/unblock`, `/list`,
   `/state`. Interface `@route("/api/hub/mutes")`: `/mute`, `/unmute`,
   `/list` (the same list shapes, named `MutedUser` and
   `ListMutedUsersResponse`). Success: `204` for block, unblock, mute,
   unmute; `200` with `Cache-Control: no-store` for list and state.
   Problems: `InvalidJSON`, `ValidationFailed`, `HubAuthenticationRequired`,
   `HubProfileNotFound` (block, unblock, mute, unmute, state),
   `InvalidPaginationKey` (lists), `HubProfileUnavailable` (remote address
   resolution failed), `InternalServerError`.
4. Mesh check: `@route("/mesh/blocks")` relay and `@route("/api/mesh/blocks")`
   peer, each `/check`, mutually authenticated like `/mesh/profile/read`.
   Request `CheckBlockRequest { blocker_hub_user_did; blocked_hub_user_did; viewer_handle }`.
   The viewer is the blocked user. Response `CheckBlockResponse { blocked: boolean }`.
   Reuse the profile mesh problems for not-homed and misdirected.
5. Go companions: `Normalize` and `Validate` for every request. Validate the
   address with the existing address validator. TS companions with the same
   names. Add every new `.ts` file to `typespec/package.json` `exports`.
6. Import the new file from `typespec/hub/hub.tsp` (or `main.tsp`, as the
   exemplar does). Run `npx tsp format` on changed `.tsp` files.

## Tests

- `typespec/hub/blocks/blocks_test.go`: normalization on a copy; every
  validation rule (missing user, bad address, limit 0, 51, and 1 and 50
  accepted).
- `typespec/hub/blocks/blocks.test.ts`: the same rules where the TS companion
  validates.

## Checks

- In `typespec/`: `npm run check:contract-files`, `npm run compile`,
  `npm run typecheck`, `npm run test:ts`
- `make typespec-check`, `make test-go GOTESTFLAGS='-p 2'`
- `make fmt`, `git diff --check`, then `make test` once (missing API coverage
  is listed, not failed)

## Acceptance

- Contracts compile; companions match the `.tsp` names and optionality.

## Carried over
