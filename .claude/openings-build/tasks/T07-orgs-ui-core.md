# T07 Orgs portal Openings list, editor, and detail

Requirements: OPN-CNT-003, OPN-CNT-004, OPN-ORG-001 to OPN-ORG-004,
OPN-ORG-006, OPN-QTA-004, OPN-WC-001 to OPN-WC-006, OPN-TEAM-001 to
OPN-TEAM-004, OPN-AUTH-002, OPN-AUTH-003.

Guides: `ui.md`, `typescript.md`, `authorization.md`, `orgs.md` (Portal),
`playwright.md`, `verification.md`.

Exemplars: `orgs-ui/src/pages/MembersPage.tsx`,
`orgs-ui/src/features/users/` (server-side table, filters, drawer, queries,
idempotency, problem handling), `orgs-ui/src/app/App.tsx` and `paths.ts`,
`orgs-ui/src/i18n/locales/*.ts`, `portal-ui/src/` exports and
`portal-ui/package.json` `exports`; `playwright/ui/orgs-users.spec.ts`.

## Steps

1. The user approved `react-markdown`. Add it to `portal-ui` (and wherever
   the portals' dependency rules require), and record the approval in the
   Stack bullet of `agent-guides/ui.md`.
2. `portal-ui/src/openings/`: `OpeningDescription` renders the Markdown
   subset of OPN-CNT-003 with react-markdown: `allowedElements` limited to
   paragraphs, breaks, headings, emphasis, strong, lists, list items, and
   links; `skipHtml`; `unwrapDisallowed`; links only when the URL passes
   the shared website validator, with `rel="noopener noreferrer nofollow
   ugc"` and no referrer, otherwise plain text. `OpeningContentView`
   presents an `OpeningContent` (plain text for every other field) taking
   labels and formatters as parameters, never translation keys or portal
   names (portal-ui rules). Unit tests for the allowlist, HTML, images, and
   unsafe links.
3. orgs-ui `features/openings/`: API calls and TanStack Query hooks for the
   T03 operations; idempotency keys per user action; problem mapping
   (version conflict reloads and tells the user, quota exceeded shows quota
   and count, hiring-team-invalid marks the addresses).
4. Routes `/openings`, `/openings/new`, `/openings/:number`,
   `/openings/:number/edit` in `paths.ts`; an Openings navigation item.
5. List page: summary strip with state counts and quota usage; server-side
   table with every T03 filter, keyset pagination, and a state filter that
   includes `discarded` only on request. Users without view access see only
   what the API returns and an empty state that says so.
6. Editor: an Ant Design form for every content field (country and
   currency selectors from the catalogs, language selector, remote
   eligibility shown only for remote), the hiring team (member search by
   email), and internal notes. Saving a draft accepts partial content;
   field errors from the API are shown inline. A live preview uses
   `OpeningContentView`.
7. Detail page: live content, working copy, state, expiry, team and notes,
   public Hub URL `https://vetchium.com/org/<domain>/openings/<number>` with
   copy, history list, and actions allowed by the caller's effective
   permissions and state: edit, discard working copy, discard draft,
   duplicate, edit team. (Request and approval actions are T08.)
8. Every string in every orgs-ui locale.
9. Playwright UI tests: create a draft with partial content, edit, preview,
   discard, duplicate, team edit with an invalid address, quota-exceeded
   message, list filters and pagination, a hiring-team-only reader, a user
   with no access, a suspended Org; keyboard use and loading and error
   states as `review.md` requires.

## Checks

`make portal-ui-check`, `make orgs-ui-check`, `make hub-ui-check`,
`make admin-ui-check`, `make playwright-check`, then `make test`.
