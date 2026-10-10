# T06 Hub and mesh reads of published Openings

Requirements: OPN-HUB-001 to OPN-HUB-007, OPN-GEN-001, OPN-CNT-004, the Hub
rows of the Problem types table.

Guides: `federation.md` (Trust, Reads and privacy), `mesh-topology.md`,
`hub-profile.md` (Federated reads and commands, the pattern to copy),
`object-storage.md` (signed media), `typespec.md`, `go.md`, `backend.md`,
`database.md`, `playwright.md`.

Exemplars: the profile read end to end:
`backend/handlers/hub/profile/read.go`, `backend/handlers/mesh/profile.go`
(`RelayReadProfile`, `PeerReadProfile`, signed picture URL),
`backend/internal/profileclient/`, `backend/internal/routes/mesh_routes.go`
and `hub_routes.go`, `typespec/hub/profile/public.*`; Org domain resolution
`mesh.ResolveOrgDomain` and `typespec/directory/`; Org logo signing
`logoReadURL` in `backend/handlers/orgs/account/account.go`;
`playwright/api/hub-profile-read-alias.spec.ts`, `mesh.spec.ts`,
`org-directory.spec.ts`.

## Contract

`typespec/hub/openings/` with companions, problems in
`typespec/problem/hub/openings.*`:

- `PublicOrg`: `domain`, `display_name`, `logo_url?` (only when the plan
  allows logos).
- `PublicOpeningSummary`: number, live title, employing country, work
  arrangement, employment type, `first_published_at`.
- `PublicOpening`: number, `state` (`published`, or `not_accepting` for
  `paused`, `closed`, `expired`), and for `published` only the live
  `OpeningContent`, `first_published_at`, `last_revised_at?`. A
  not-accepting Opening carries only number, state, and title
  (OPN-HUB-005).
- `POST /api/hub/list-org-openings`: `domain`, filters
  (`employing_country`, `work_arrangement`, `employment_type`,
  `title_query` ≥2), `pagination_key`, `limit` (≤50) → `{org: PublicOrg,
  openings, next_pagination_key?}`, newest first publication first.
- `POST /api/hub/get-org-opening`: `domain`, `opening_number` →
  `{org: PublicOrg, opening: PublicOpening}`.
- Problems `hub-org-not-found` 404, `hub-opening-not-found` 404,
  `hub-org-unavailable` 503.
- Mesh: relay `POST /mesh/org-openings/list` and `/mesh/org-openings/get`,
  peer `POST /api/mesh/org-openings/list` and `/get`, with the same bodies.
  No viewer identity anywhere in them (OPN-HUB-006).

## Backend

1. One package (for example `backend/internal/orgs/publicopenings`) owns
   the read: queries select the Org by domain only when the Org is
   `active` and the domain is `verified`, `failing`, or `releasing`, then
   published Openings (live content only) or one Opening. It returns the
   contract types and signs the logo. Both the hub-api local path and the
   mesh peer handler call it, so the representation is produced once.
2. hub-api handlers (Hub auth required): normalize the domain
   (`OrgDomain`); if this tenant holds the domain, read locally; otherwise
   call the local mesh relay. Map relay transport failures and directory
   errors to `hub-org-unavailable`, a not-found to the Hub problem; never
   forward other upstream problems (PROF-FED-006 pattern).
3. mesh-api relay: authenticate the relay credential, resolve the domain
   through the directory (`resolve-org-domain`), call the home tenant's
   peer with mTLS and a deadline. Peer: certificate-derived caller identity
   middleware as for profiles, then the shared read. A domain owned by no
   one is not-found.
4. Client package like `profileclient` with response size limit and
   timeout.

## Tests

Playwright API: an Org in the viewer's tenant and in another tenant
(viewer `sgp`, Org `usa1`) for list and get; filters and pagination;
published vs not-accepting vs draft or discarded vs unknown number;
suspended Org and released domain → `hub-org-not-found`; `ind1` viewer
reaching a remote Org → `hub-org-unavailable` (fails closed); signed-out →
auth problem; logo only on plans with logos; assert no internal field
(team, notes, version, emails, working copy, pending request) in Hub or
mesh responses; mesh peer refuses calls without a valid certificate as the
profile peer does. Go tests for the client and mapping branches.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, then `make test`.
