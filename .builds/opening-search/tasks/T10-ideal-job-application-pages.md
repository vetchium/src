# T10 Portals: Ideal job on apply and application pages

## Requirements

HP-APP-002, MKT-ACC-001, PROF-JOB-008.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md`, `orgs-ui/AGENTS.md`,
`agent-guides/hiring-pipeline.md`.

## Exemplars

The "will see" `Descriptions` in `hub-ui/src/pages/ApplyPage.tsx`
(`apply.summary.biography`); `hub-ui/src/pages/ApplicationDetailPage.tsx`;
`orgs-ui/src/features/applications/SnapshotCard.tsx`;
`orgs-ui/src/pages/ApplicationDetailPage.tsx`; the candidate snapshot card in
`orgs-ui/src/pages/WorkItemDetailPage.tsx`; `playwright/ui/hub-applications.spec.ts`.

## Steps

1. hub-ui apply page: an "Ideal job" item in the "will see" list, showing
   "Included" or "None" from my-info, with an edit link to
   `/settings/preferences`.
2. hub-ui application detail: when `ideal_job` is present, a section "Ideal
   job you shared" with the text as plain text, keeping line breaks.
3. orgs-ui: an "Ideal job" block in `SnapshotCard.tsx` outside
   `ProfileDescriptions` (Contacts reuse that and never show it), and the same
   in the `WorkItemDetailPage.tsx` snapshot card; plain text with line
   breaks; absent when none.
4. Strings in `hub-ui` and `orgs-ui` `en.ts`, `de.ts`, and `ta.ts`.
5. Playwright UI: in `playwright/ui/hub-applications.spec.ts`, the apply page
   lists the ideal job as included (and "None" without one) and the detail
   shows it; add Org application detail and provider work item cases to the
   existing orgs-ui specs that open those pages (find them with
   `git grep -ln "applications/" playwright/ui` and
   `git grep -ln "workQueue\|work item" playwright/ui`).

## Tests

`playwright/ui/hub-applications.spec.ts` and the orgs-ui specs named in step 5.

## Checks

`make hub-ui-check`, `make orgs-ui-check`, `make playwright-check`, the
specs against `make test-environment`, then `make test`. `ux.md` screenshot
check of the apply page and both detail pages at phone and desktop widths.

## Acceptance

- The applicant sees the ideal job will be shared and was shared; the Org and
  the stage provider see it on the candidate.

## Carried over
From T09: `ApplicantSnapshot.ideal_job` (`typespec/hub/profile/snapshot.ts`) and `MyApplicationDetail.ideal_job` (`typespec/hub/applications/applications.ts`) exist, absent when none. Playwright helpers: `setJobSearch(applicant, idealJob, lookingForJob)` in `playwright/lib/hub-applicant.ts`; `idealJob` / `lookingForJob` in `ApplicationOptions` (`playwright/lib/hiring-seed.ts`); `candidate(world, stage, name, referralAgencyDomain, idealJob)` in `playwright/lib/orgs-routing.ts`.
