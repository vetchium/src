# T12 Orgs UI: Send and answer chat requests on Contacts and Jobs

## Requirements

MKT-UI-006, MKT-UI-007, MKT-UI-008, MKT-UI-010, MKT-UI-012, MKT-PRF-005,
MKT-CNV-010, MKT-REQ-003, MKT-REQ-007, MKT-CON-003.

## Guides

`ui.md`, `ux.md`, `typescript.md`, `marketplace.md`.

## Exemplars

- `orgs-ui/src/features/marketplace/SuggestToContactModal.tsx`,
  `SuggestionSelect.tsx`, `queries.ts`, `problems.ts`.
- `orgs-ui/src/pages/ContactsPage.tsx`, `ContactDetailPage.tsx`,
  `NewContactPage.tsx`, `JobDetailPage.tsx`.
- `orgs-ui/src/app/workspaces.ts` (navigation counts), `orgs-ui/src/api/orgs.ts`.

## Steps

1. API client and React Query hooks for the five Orgs request operations
   in `orgs-ui/src/api/orgs.ts` and `features/marketplace/queries.ts`;
   invalidate contacts, the conversation, and the pending count on each
   write.
2. New `features/marketplace/SendChatRequestModal.tsx` per MKT-UI-012:
   person fixed or by handle/alias, Opening fixed or chosen with
   `SuggestionSelect`, note with a live code-point count (1,000), the
   applicable refusal shown before sending, Accept in place of Request when
   the person has a request pending to the agency. Problem mapping in
   `problems.ts` for every new `org-*` type.
3. `SuggestToContactModal`: when the agency may write
   (`agency_may_write_until` in the future) post a suggestion; otherwise
   open `SendChatRequestModal` with the Opening fixed. Job detail and the
   profile view's "Send first message"/"Message" buttons open
   `SendChatRequestModal`.
4. `ContactsPage`: Requests tab (to the agency, then sent), request state
   column; navigation count = unread + pending to the agency (call
   `count-pending-chat-requests` where the unread count is read).
5. `ContactDetailPage`: request banner with Accept, "Not this Opening",
   "Not for <N> days" (N from the request's window in whole days); sent
   request state (pending, declined with scope and lift date via
   `useDateTimeFormat`, expired); closed composer notice per MKT-CNV-010;
   `request` messages render as an Opening card with the note.
6. Every new string in every `orgs-ui` locale (`en`, `de`, `ta`).

## Tests

Component tests where the portal has them for modals (follow the nearest
`*.test.tsx`); Playwright UI in T16.

## Checks

`make orgs-ui-check`.

## Acceptance

An agency user sends, answers, and sees the state of requests from
Contacts, Contact detail, Job detail, and the profile view; nothing calls
`start-conversation` any more.

## Carried over
