# T13 Orgs portal pipeline templates and Pipeline tab

Requirements: HP-PIP-001 to HP-PIP-004, HP-ORG-003, MKT "Orgs portal"
navigation (the Hiring group only).

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`playwright.md`.

Mockups: `orgs-04-opening-pipeline`, `orgs-13-pipeline-templates`,
`orgs-14-pipeline-template-editor`, `orgs-15-new-opening-pipeline`.

Exemplars: commit `f2ee56a` (Openings list, editor, detail, queries,
locales); `orgs-ui/src/pages/OpeningDetailPage.tsx`,
`orgs-ui/src/features/openings/`; `playwright/ui/orgs-openings.spec.ts`.

## Steps

1. Navigation: a Hiring group holding Openings, Pipeline templates, and (from
   T26) Find providers; keep the other existing items, grouped as the
   mockups show.
2. Opening detail becomes tabbed: Overview (today's content), Applicants,
   Candidates (T14), Pipeline, Providers (T26). Keep the tab in the URL.
3. Pipeline tab: ordered stages with name, kind, reorder, add, remove; the
   stage-in-use refusal explained beside the stage; Save and Discard only
   after a change with the unsaved-changes guard.
4. Pipeline templates page (list, create, edit, delete) and the template
   choice in the Opening editor.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: create and edit a template, start an Opening from it, edit
the pipeline, stage-in-use message, unsaved-changes guard, URL-kept tab.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

Users manage templates and pipelines from the portal in every locale.
