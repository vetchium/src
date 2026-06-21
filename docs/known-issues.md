# Issues — exploratory UI test run (2026-06-20)

Outstanding issues found during a scripted manual-tester-style sweep of the **Hub** and
**Org** portals against `docker-compose-full.json` + the `seed-users` Harry-Potter
dataset. The harness that produced these (and that can reproduce the run) lives in
[`playwright/exploratory/`](../playwright/exploratory/README.md).

Each issue lists where it was seen, the suspected root cause with file references, and
a suggested fix. Severities: **High** (security / data-integrity), **Medium**
(broken or missing functionality), **Low** (UI / code-quality / polish).

Legend for status codes seen in the console: a red `Failed to load resource … 4xx/5xx`
in the browser console maps to an API call the page fired that the server rejected.

> **Already resolved (removed from this doc; see commit `9c41cab`):** M1 (read-only
> users no longer see application write buttons), M3 (opening-agencies 403 gated),
> L1 (Descriptions span), L2 (Audit Logs row key), L3 (deprecated Timeline/Steps APIs),
> U-C7 (`name (domain)` dedup), and part of U-C4 (de/ta dashboard title + the en
> "OrgUsers" jargon). **By-design (no change):** H1 (silver+gold self-upgrade is
> intentional; code honors `self_upgradeable`) and M4 ("no draft → 404" is a tested
> contract; the console line is cosmetic).

---

## M2 — Offer flow is a dead-end for the candidate (no accept / decline) · Medium · DEFERRED

> **Status (2026-06-20): deferred** — left as-is for now pending a product decision on
> whether to build in-platform accept/decline or treat acceptance as out-of-band.

**Where:** Hub portal → My Candidacies → candidacy detail
(`hub-ui/src/pages/Candidacies/MyCandidacyDetailPage.tsx`, offer panel ~line 294).

**Observed:** Once an org extends an offer, the candidacy shows state **"Offer Extended"**
and the candidate sees only **Preview offer letter / Download offer letter / Send message**.
There is no Accept or Decline action, so the candidate cannot move the candidacy forward,
and the org side stays at "Offered".

**Root cause:** there is **no accept/decline-offer endpoint anywhere**. Hub routes expose
only `GET /hub/offer-letter/{candidacyId}` (`api-server/internal/routes/hub-routes.go`);
there is no `accept-offer` / `decline-offer` in hub or org routes or in
`api-schema/`.

**Decide + fix:** either (a) this is intentional and acceptance is out-of-band — then say
so in the UI (e.g. "Respond to this offer outside the platform") so it doesn't read as a
missing button; or (b) add the missing capability: a `hub:respond-offer` (accept/decline)
endpoint + TypeSpec types + hub UI buttons, with the org candidacy moving to a terminal
`hired` / `offer_declined` state. See [`design/hiring-lifecycle.md`](./design/hiring-lifecycle.md) for the candidacy state machine.

---

## L4 — Static `message` / `Modal` used without App context · Low

Pervasive `Warning: [antd: message] Static function can not consume context like dynamic
theme.` (also for `Modal.confirm`). Components call `message.*` / `Modal.confirm` imported
from `antd` instead of `App.useApp()`'s instances, so toasts/confirms don't pick up the
dynamic (dark) theme. Switch call sites to `const { message, modal } = App.useApp();`
(several already do — e.g. `UserDetailDrawer.tsx`). Affected: apply page, plan page,
schedule-interview, extend-offer, feedback, complete-setup, invite, etc. (dozens of files).

---

## Usability / consistency (Low)

- **U-C1 — Hub "My Applications" shows the opening _number_, not the title.** The _Role_
  column on `hub-ui/src/pages/applications/…` renders `#1`; "My Candidacies" correctly
  shows the job title. Show the title (the API row should carry `opening_title`). Needs a
  small backend/contract change to expose the title on the applications list row.
- **U-C2 — Hub dashboard greets by handle, not display name.** `HomePage` shows
  "Welcome, @harry-111a2b39" instead of "Harry Potter"; the profile page shows the display
  name correctly. The hub `myinfo` response (`HubMyInfoResponse`) carries no display-name
  field — add `display_name` to the contract + handler and greet by it.
- **U-C3 — Offer-state wording differs across portals:** org says **"Offered"**, hub says
  **"Offer Extended"** for the same candidacy state. Pick one label.
- **U-C4 (remaining) — broader de-DE / ta-IN "Employer → Org" terminology sweep.** The
  dashboard title is fixed, but the rest of the non-English strings still say "Employer"
  (e.g. `common.json` `appName` "Vetchium Arbeitgeber" / "வெட்சியம் முதலாளி", and several
  `auth.json` titles). Needs a native-speaker terminology pass across `org-ui/src/locales/`.
- **U-C5 — Consumer org sees agency-only page text.** A consumer org (gryffindor) can open
  `/referrals` and sees the agency-side empty state **"No openings assigned to your agency
  yet"**. Either hide `/referrals` for orgs that are not acting as an agency, or word the
  empty state neutrally.
- **U-C6 — Free plan "Description: -" is empty** on `/settings/plan` (no description text
  for the free tier — add a translated description for `free` in the plan seed data).
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
