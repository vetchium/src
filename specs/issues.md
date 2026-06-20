# Issues — exploratory UI test run (2026-06-20)

Issues found during a scripted manual-tester-style sweep of the **Hub** and **Org**
portals against `docker-compose-full.json` + the `seed-users` Harry-Potter dataset.
The harness that produced these (and that can reproduce the run) lives in
[`playwright/exploratory/`](../playwright/exploratory/README.md).

Each issue lists where it was seen, the suspected root cause with file references, and
a suggested fix. Severities: **High** (security / data-integrity), **Medium**
(broken or missing functionality), **Low** (UI / code-quality / polish).

Legend for status codes seen in the console: a red `Failed to load resource … 4xx/5xx`
in the browser console maps to an API call the page fired that the server rejected.

---

## H1 — Org can self-upgrade to **Gold** (privilege / billing escalation) · High

**Where:** Org portal → `/settings/plan` → "Upgrade to Gold".

**Observed:** As `admin@gryffindor.example` (a normal org superadmin, not a Vetchium
admin) the page shows **Upgrade to Silver** _and_ **Upgrade to Gold** buttons. Clicking
_Upgrade to Gold_ → confirm dialog → backend succeeds: toast **"Successfully upgraded to
Gold"** and the plan becomes Gold (usage caps jump to Users 100, unlimited domains, etc.).

**Why it's wrong:** Per the tier model (`specs/16-org-tiers/`, `MEMORY.md`), only
**free → silver** is self-serviceable (`self_upgradeable = true` on the silver tier).
Gold / Enterprise are meant to be set by a Vetchium admin via `POST /admin/org/set-tier`
(with a required `reason`). Here an org grants itself Gold quotas for free.

**Two defects, fix both:**

1. **Backend (authoritative):** `POST /org/upgrade-plan` accepts `plan_id: "gold"`.
   It must reject any target tier whose `self_upgradeable` flag is not set (return 403
   or 422). Look at the org upgrade-plan handler in `api-server/handlers/org/` (the one
   backing `/org/upgrade-plan`) and gate on the tier's `self_upgradeable` column rather
   than allowing any tier id.
2. **Frontend:** `org-ui/src/pages/Plan/` (the `/settings/plan` page) renders an
   "Upgrade to {tier}" button for every tier above the current one. It should only render
   the action for tiers where `self_upgradeable` is true (i.e. Silver from Free); other
   tiers should read "Contact us"/admin-managed, like Enterprise already does.

**Repro:** phase `16`/manual — log in as `admin@gryffindor.example`, open
`/settings/plan`, click _Upgrade to Gold_ → _Upgrade_.

---

## M1 — Write actions shown to read-only users on the application detail · Medium (RBAC defence-in-depth)

**Where:** Org portal → opening → Applications → an application →
`org-ui/src/pages/applications/ApplicationDetailPage.tsx`.

**Observed:** `ron@gryffindor.example`, who has only `org:view_openings` +
`org:view_applications` (read-only), sees the **Shortlist**, **Reject** and **Label**
(Green/Yellow/Red) buttons on any application in the `applied` state.

**Root cause:** the action gate ignores the user's role entirely:

```ts
// ApplicationDetailPage.tsx (~line 171)
const canAct = application?.state === "applied";
```

`canAct` is derived purely from the application state. The shortlist/reject card
(`{canAct && (…)}`, ~line 381) and the label buttons (`disabled={actioning || !canAct}`,
~line 344) therefore appear for view-only users.

**Why it matters:** CLAUDE.md → RBAC checklist item 4: "Hide write actions for read-only
roles within feature pages (UI is defence-in-depth; backend MUST enforce independently →
403)." The backend _does_ enforce `org:manage_applications` on
`shortlist/reject/label-application` (so the action would 403), but the UI must not offer
it. Fix: AND `canAct` with a role check from `useMyInfo()` —
`roles.includes("org:superadmin") || roles.includes("org:manage_applications")` — the same
pattern already used in `UserDetailDrawer.tsx` (`canManageUsers`).

---

## M2 — Offer flow is a dead-end for the candidate (no accept / decline) · Medium

**Where:** Hub portal → My Candidacies → candidacy detail
(`hub-ui/src/pages/Candidacies/MyCandidacyDetailPage.tsx`, offer panel ~line 294).

**Observed:** Once an org extends an offer, the candidacy shows state **"Offer Extended"**
and the candidate sees only **Preview offer letter / Download offer letter / Send message**.
There is no Accept or Decline action, so the candidate cannot move the candidacy forward,
and the org side stays at "Offered".

**Root cause:** there is **no accept/decline-offer endpoint anywhere**. Hub routes expose
only `GET /hub/offer-letter/{candidacyId}` (`api-server/internal/routes/hub-routes.go`);
there is no `accept-offer` / `decline-offer` in hub or org routes or in
`specs/typespec/`.

**Decide + fix:** either (a) this is intentional and acceptance is out-of-band — then say
so in the UI (e.g. "Respond to this offer outside the platform") so it doesn't read as a
missing button; or (b) add the missing capability: a `hub:respond-offer` (accept/decline)
endpoint + TypeSpec types + hub UI buttons, with the org candidacy moving to a terminal
`hired` / `offer_declined` state. See `specs/hiring.md` for the candidacy state machine.

---

## M3 — `POST /org/list-opening-agencies` → 403 on every opening-detail view · Medium (RBAC/UI mismatch)

**Where:** Org portal → opening detail (`/openings/:n`) → the "Assign Agency" section
(`org-ui/src/pages/Openings/OpeningAgenciesSection.tsx`).

**Observed:** Opening any opening as `harry@gryffindor.example` (has `org:manage_openings`
but **not** `org:view_opening_agencies`) fires `POST /org/list-opening-agencies` which
returns **403**, logging a red console error on every visit (24 occurrences across the
run). The section/buttons still render to a user who can't use them.

**Root cause:** the route requires `org:view_opening_agencies`
(`api-server/internal/routes/org-routes.go:165`), but `OpeningAgenciesSection` is rendered
on the opening detail for anyone with opening access and calls `list-opening-agencies`
unconditionally on mount.

**Fix:** gate the section on the viewer's roles
(`view_opening_agencies` / `manage_opening_agencies` / `superadmin`) before rendering /
fetching — or, if recruiters who manage openings are expected to assign agencies, include
`view_opening_agencies` in that role bundle. At minimum, don't fire the call (and don't
surface a console 403) for users without the role.

---

## M4 — `POST /org/get-my-interview-feedback` → 404 console error on first feedback-page load · Medium

**Where:** Org portal → candidacy → "View interview" →
`/candidacies/:id/interviews/:interviewId/feedback`
(`org-ui/src/pages/Interviews/SubmitFeedbackPage.tsx`).

**Observed:** Opening the feedback editor before any draft has been saved fires
`POST /org/get-my-interview-feedback` which returns **404** (no draft yet) and logs a
console error.

**Fix:** treat "no draft yet" as an empty form rather than an error — either have the
handler return `200` with an empty/absent feedback body, or have the page swallow the 404
and initialise blank fields. Don't surface it as a console error.

---

## L1 — AntD `Descriptions` "span" warning on opening detail · Low

`Warning: [antd: Descriptions] Sum of column 'span' in a line not match 'column' of
Descriptions` on `/openings/:n`. A `<Descriptions.Item span=…>` set doesn't add up to the
container's `column`. Audit the `Descriptions` block on the org opening-detail page
(`org-ui/src/pages/Openings/…`) and fix the spans.

## L2 — Missing React `key` on the Audit Logs table · Low

`Warning: Each child in a list should have a unique "key" prop. … Check the render method
of 'tbody'.` on `/audit-logs`. The audit-logs table (`org-ui/src/pages/AuditLogsPage.tsx`)
needs a stable `rowKey` (e.g. the audit-log id) on its `<Table>` / row mapping.

## L3 — Deprecated AntD v6 APIs in use (violates the no-deprecated-APIs rule) · Low

CLAUDE.md forbids deprecated library APIs. Observed deprecation warnings:

- `[antd: Timeline] 'items.children' is deprecated. Please use 'items.content' instead.`
  — org `CandidacyDetailPage` and hub `MyCandidacyDetailPage` comment timelines.
- `[antd: Steps] 'items.description' is deprecated. Please use 'items.content' …` — the
  create-opening wizard (`org-ui/src/pages/Openings/…/new`).

Migrate these `Timeline`/`Steps` `items` props to the v6 replacements; `bun run lint`
should flag them.

## L4 — Static `message` / `Modal` used without App context · Low

Pervasive `Warning: [antd: message] Static function can not consume context like dynamic
theme.` (also for `Modal.confirm`). Components call `message.*` / `Modal.confirm` imported
from `antd` instead of `App.useApp()`'s instances, so toasts/confirms don't pick up the
dynamic (dark) theme. Switch call sites to `const { message, modal } = App.useApp();`
(several already do — e.g. `UserDetailDrawer.tsx`). Affected: apply page, plan page,
schedule-interview, extend-offer, feedback, complete-setup, invite, etc.

---

## Usability / consistency (Low)

- **U-C1 — Hub "My Applications" shows the opening _number_, not the title.** The _Role_
  column on `hub-ui/src/pages/applications/…` renders `#1`; "My Candidacies" correctly
  shows the job title. Show the title (the API row should carry `opening_title`).
- **U-C2 — Hub dashboard greets by handle, not display name.** `HomePage` shows
  "Welcome, @harry-111a2b39" instead of "Harry Potter"; the profile page shows the display
  name correctly. Use `preferred_display_name` in the greeting.
- **U-C3 — Offer-state wording differs across portals:** org says **"Offered"**, hub says
  **"Offer Extended"** for the same candidacy state. Pick one label.
- **U-C4 — de-DE / ta-IN still say "Employer Dashboard".** The dashboard title renders
  _"Arbeitgeber-Dashboard"_ / _"முதலாளி டாஷ்போர்டு"_ while en-US was renamed to **"Org
  Dashboard"** — the employer→org rename never reached the `de-DE` / `ta-IN` locale files
  (`org-ui/src/locales/`). Also "Internal opening (only visible to **OrgUsers**)" leaks the
  internal term in a user-facing label.
- **U-C5 — Consumer org sees agency-only page text.** A consumer org (gryffindor) can open
  `/referrals` and sees the agency-side empty state **"No openings assigned to your agency
  yet"**. Either hide `/referrals` for orgs that are not acting as an agency, or word the
  empty state neutrally.
- **U-C6 — Free plan "Description: -" is empty** on `/settings/plan` (no description text
  for the free tier).
- **U-C7 — Agency name renders as "floonetwork.example (floonetwork.example)"** (domain
  printed twice) in the hub referral inbox, because the org's display name was never set
  and falls back to the domain. Either capture an org display name at signup or don't
  render `name (domain)` when `name === domain`.
- **U-C8 — Founding admin has a blank Name** in the org Users table — `org/init-signup`
  never captures a `full_name` for the first superadmin.
- **U-C9 — Agency sees its own listing in "Discover Marketplace Listings".** Self-listings
  aren't filtered out of discovery (subscribing to self correctly 422s, per the model, but
  the card shouldn't be offered).

---

## Things that worked well (no action needed)

Full hiring funnel (apply → shortlist/reject/label → candidacy → schedule interview with a
panel → RSVP → feedback → extend offer → candidate views offer); the agency-referral loop
end-to-end with correct _Source = agency_ attribution on the resulting application;
marketplace discover/subscribe; i18n de-DE/ta-IN (complete, no untranslated keys, layout
intact); login field validation + wrong-credentials handling; logout clearing the session
and protected routes redirecting to `/login`; the route guard redirecting a role-less user
away from `/users`; opening pause/reopen; the 404 page and empty states.
