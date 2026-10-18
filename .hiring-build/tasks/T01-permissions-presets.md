# T01 Candidacy and marketplace permissions and presets

Requirements: HP-AUTH-001, MKT-AUTH-001, MKT-AUTH-003.

Guides: `authorization.md`, `orgs.md`, `org-subscriptions.md` (Delegation),
`typespec.md`, `database.md`, `ui.md`, `playwright.md`.

Exemplars: commit `ea15035` (how the three Openings permissions entered the
catalog, implications, and delegation) and `19dae16` (presets in
`orgs-ui/src/features/users/roles.ts` and the locales).

## Steps

1. Add `org:manage_candidacies`, `org:manage_providers`,
   `org:manage_listings`, and `org:fulfil_engagements` to the Org permission
   catalog everywhere the Openings permissions appear (`git grep -n
   manage_openings`): TypeSpec vocabulary and companions, the schema seed,
   one-hop implications from `org:superadmin`, and delegation (an
   `org:manage_users` holder grants or revokes all four).
2. Presets in `orgs-ui`: Recruiter also ticks `org:manage_candidacies`; add
   Vendor manager (`org:manage_providers`) and Provider staff
   (`org:fulfil_engagements`). Label each permission in the invite and edit
   dialogs (mockup `orgs-20-invite-permissions.png`). Every string in `en`,
   `de`, and `ta`.
3. Update the catalog list in `orgs.md` and the preset list in
   `authorization.md`.

## Tests

Extend the existing permission and delegation tests (`git grep -n
manage_openings playwright typespec backend`) so each new permission is
granted, revoked, implied by superadmin, and delegable by a user manager;
UI test that each new preset ticks its permissions.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make orgs-ui-check`, `make playwright-check`, and the
changed specs against `make test-environment`.

## Acceptance

The four permissions behave like the Openings ones in every layer; presets
and labels ship in all three locales.
