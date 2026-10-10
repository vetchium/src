# T10 Development fixtures for Openings

Requirements: OPN-TST-003.

Guides: `go.md`, `org-subscriptions.md` (Audit and tests), `hub-profile.md`
(Fixtures: reserved hosts only), `verification.md`.

Exemplars: `backend/cmd/dev-seed/orgs.go` (`seededUsers`, the API-driven
seeding), `hub_profiles_fixture.go`.

## Steps

1. Add Recruiter (`org:manage_openings`) and Hiring approver
   (`org:approve_openings`) users to every seeded Org.
2. Through the Orgs API only (no SQL), give each seeded Org Openings in
   every state reachable without waiting: draft (one partial), discarded,
   published (one revised), paused, closed, and one pending request of each
   kind. Realistic content with Markdown descriptions, varied countries,
   arrangements, and salaries; links only to `example.com` hosts. Stay well
   inside the Free quota. Expired Openings are not seeded.
3. Seeding twice must not fail; follow how the Org seed handles re-runs.
4. Update the seed log line and `README.md` if it lists seeded users.

## Checks

`make test-go`, `make dev-seed` against `make dev` (if the stack cannot run
here, run `go vet` and the seed's tests and say so in Notes), then
`make test`.
