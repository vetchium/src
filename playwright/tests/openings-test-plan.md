# Openings Feature — Test Plan

This document describes all pending tests for the Openings feature. Tests are split across
multiple files so they can be implemented and run in parallel. Every test uses UUID-based
unique org domains/emails (`generateTestOrgEmail(prefix)`) so parallel runs never conflict.

All API tests go in `playwright/tests/api/org/`. All UI tests go in `playwright/tests/ui/org/`.

---

## File 1 — `playwright/tests/api/org/openings-state-transitions.spec.ts`

Tests invalid state transitions (422) and valid guard conditions.

### Imports needed
```ts
import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
  createTestOrgAdminDirect,
  createTestOrgUserDirect,
  deleteTestOrgUser,
  generateTestOrgEmail,
  assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { OrgLoginRequest, OrgTFARequest } from "vetchium-specs/org/org-users";
import type { CreateOpeningRequest, OpeningNumberRequest, RejectOpeningRequest } from "vetchium-specs/org/openings";
import type { CreateAddressRequest } from "vetchium-specs/org/company-addresses";
```

### Shared helpers
Copy the `loginOrgUser` helper from `openings.spec.ts` (same pattern: login → TFA → return session token).

### Helper: `createMinimalOpening`
A helper function that creates an org, logs in the admin, creates one address, and creates a
draft opening. Returns `{ token, openingNumber, adminEmail, recruiterEmail, domain, orgId }`.
This avoids repeating setup across every test.

```ts
async function createMinimalOpening(request, prefix: string) {
  const api = new OrgAPIClient(request);
  const { email: adminEmail, domain, orgId } = generateTestOrgEmail(prefix);
  await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
  const { email: recruiterEmail } = await createTestOrgUserDirect(
    `rec@${domain}`, TEST_PASSWORD, "ind1", { orgId, domain }
  );
  const token = await loginOrgUser(api, adminEmail, domain);
  const addrRes = await api.createAddress(token, {
    title: "HQ", address_line1: "1 St", city: "Chennai", country: "IN",
  });
  const req: CreateOpeningRequest = {
    title: "State Test Opening",
    description: "For state transition tests",
    is_internal: false,
    employment_type: "full_time",
    work_location_type: "remote",
    address_ids: [addrRes.body!.address_id],
    number_of_positions: 1,
    hiring_manager_email_address: adminEmail,
    recruiter_email_address: recruiterEmail,
  };
  const res = await api.createOpening(token, req);
  return { api, token, openingNumber: res.body!.opening_number, adminEmail, recruiterEmail, domain, orgId };
}
```

### Test: discard non-draft (published) opening → 422
Setup: create draft → superadmin submit → published.
Action: call `POST /org/discard-opening`.
Expect: 422.

### Test: discard pending_review opening → 422
Setup: create non-superadmin manager with `org:manage_openings`, have manager create + submit → pending_review.
Action: call `POST /org/discard-opening` (as manager or admin).
Expect: 422.

### Test: update published opening → 422
Setup: create draft → superadmin submit → published.
Action: call `POST /org/update-opening` with a valid update body.
Expect: 422.

### Test: update pending_review opening → 422
Setup: non-superadmin submit → pending_review.
Action: call `POST /org/update-opening`.
Expect: 422.

### Test: submit a published opening → 422
Setup: create draft → superadmin submit → published.
Action: call `POST /org/submit-opening` again.
Expect: 422.

### Test: submit a closed opening → 422
Setup: create draft → submit → published → close.
Action: call `POST /org/submit-opening`.
Expect: 422.

### Test: pause a draft opening → 422
Setup: create draft, do NOT submit.
Action: call `POST /org/pause-opening`.
Expect: 422.

### Test: pause a pending_review opening → 422
Setup: non-superadmin submit → pending_review.
Action: call `POST /org/pause-opening`.
Expect: 422.

### Test: pause a closed opening → 422
Setup: create draft → submit → published → close.
Action: call `POST /org/pause-opening`.
Expect: 422.

### Test: reopen a draft opening → 422
Setup: create draft.
Action: call `POST /org/reopen-opening`.
Expect: 422.

### Test: reopen a published opening → 422
Setup: create draft → submit → published.
Action: call `POST /org/reopen-opening`.
Expect: 422.

### Test: approve a draft opening → 422
Setup: create draft.
Action: call `POST /org/approve-opening` (as superadmin).
Expect: 422.

### Test: approve a published opening → 422
Setup: create draft → submit → published.
Action: call `POST /org/approve-opening`.
Expect: 422.

### Test: reject a draft opening → 422
Setup: create draft.
Action: call `POST /org/reject-opening` with a rejection_note.
Expect: 422.

### Test: reject a published opening → 422
Setup: create draft → submit → published.
Action: call `POST /org/reject-opening` with a rejection_note.
Expect: 422.

### Test: close a draft opening → 422
Setup: create draft.
Action: call `POST /org/close-opening`.
Expect: 422.

### Test: close a pending_review opening → 422
Setup: non-superadmin submit → pending_review.
Action: call `POST /org/close-opening`.
Expect: 422.

### Test: archive a draft opening → 422
Setup: create draft.
Action: call `POST /org/archive-opening`.
Expect: 422.

### Test: archive a published opening → 422
Setup: create draft → submit → published.
Action: call `POST /org/archive-opening`.
Expect: 422.

### Test: archive a pending_review opening → 422
Setup: non-superadmin submit → pending_review.
Action: call `POST /org/archive-opening`.
Expect: 422.

### Cleanup pattern
Each test that creates users must delete them in a `finally` block:
```ts
try {
  // test body
} finally {
  await deleteTestOrgUser(adminEmail);
  await deleteTestOrgUser(recruiterEmail);
  // add managerEmail etc. if created
}
```

---

## File 2 — `playwright/tests/api/org/openings-list-filters.spec.ts`

Tests all filter parameters for `POST /org/list-openings` and pagination.

### Imports
Same as File 1, plus:
```ts
import type { ListOpeningsRequest, ListOpeningsResponse } from "vetchium-specs/org/openings";
```

### Setup strategy
Use `test.describe.configure({ mode: "serial" })` at the top level because all filter tests
share one org with multiple openings created in `beforeAll`. This avoids re-creating
the same dataset per test.

Create the following in `beforeAll`:
- One org with superadmin (`adminEmail`/`domain`/`orgId`)
- A second user `rec@${domain}` who will be recruiter (with `org:manage_openings` role)
- One address
- **Opening A**: `title: "Frontend Engineer"`, `is_internal: false`, `employment_type: "full_time"`, HM=admin, recruiter=rec → superadmin submit → **published**
- **Opening B**: `title: "Frontend Designer"`, `is_internal: true`, `employment_type: "part_time"`, HM=admin, recruiter=rec → leave as **draft**
- **Opening C**: `title: "Backend Engineer"`, `is_internal: false`, `employment_type: "contract"`, HM=rec, recruiter=admin → leave as **draft**

### Test: filter_status=["published"] → only Opening A returned
```ts
const req: ListOpeningsRequest = { filter_status: ["published"] };
const res = await api.listOpenings(token, req);
expect(res.status).toBe(200);
expect(res.body!.openings.every(o => o.status === "published")).toBe(true);
// Opening A must appear; B and C must not
expect(res.body!.openings.some(o => o.title === "Frontend Engineer")).toBe(true);
expect(res.body!.openings.some(o => o.title === "Frontend Designer")).toBe(false);
expect(res.body!.openings.some(o => o.title === "Backend Engineer")).toBe(false);
```

### Test: filter_status=["draft"] → Opening B and C returned
```ts
const res = await api.listOpenings(token, { filter_status: ["draft"] });
expect(res.status).toBe(200);
const titles = res.body!.openings.map(o => o.title);
expect(titles).toContain("Frontend Designer");
expect(titles).toContain("Backend Engineer");
expect(titles).not.toContain("Frontend Engineer");
```

### Test: filter_is_internal=true → only Opening B returned
```ts
const res = await api.listOpenings(token, { filter_is_internal: true });
expect(res.status).toBe(200);
expect(res.body!.openings.every(o => o.is_internal === true)).toBe(true);
expect(res.body!.openings.some(o => o.title === "Frontend Designer")).toBe(true);
```

### Test: filter_is_internal=false → Opening A and C returned (both public)
```ts
const res = await api.listOpenings(token, { filter_is_internal: false });
expect(res.status).toBe(200);
expect(res.body!.openings.every(o => o.is_internal === false)).toBe(true);
```

### Test: filter_hiring_manager_email_address=recruiterEmail → only Opening C
Opening C has HM=rec. Filter by rec's email.
```ts
const res = await api.listOpenings(token, { filter_hiring_manager_email_address: recruiterEmail });
expect(res.status).toBe(200);
expect(res.body!.openings.some(o => o.title === "Backend Engineer")).toBe(true);
expect(res.body!.openings.some(o => o.title === "Frontend Engineer")).toBe(false);
```

### Test: filter_recruiter_email_address=adminEmail → only Opening C
Opening C has recruiter=admin.
```ts
const res = await api.listOpenings(token, { filter_recruiter_email_address: adminEmail });
expect(res.status).toBe(200);
expect(res.body!.openings.some(o => o.title === "Backend Engineer")).toBe(true);
```

### Test: filter_title_prefix="Frontend" → Opening A and B, not C
```ts
const res = await api.listOpenings(token, { filter_title_prefix: "Frontend" });
expect(res.status).toBe(200);
const titles = res.body!.openings.map(o => o.title);
expect(titles).toContain("Frontend Engineer");
expect(titles).toContain("Frontend Designer");
expect(titles).not.toContain("Backend Engineer");
```

### Test: filter_title_prefix="Backend" → only Opening C
```ts
const res = await api.listOpenings(token, { filter_title_prefix: "Backend" });
expect(res.status).toBe(200);
expect(res.body!.openings.length).toBe(1);
expect(res.body!.openings[0].title).toBe("Backend Engineer");
```

### Test: combined filters — filter_status=["draft"] + filter_is_internal=true → only B
```ts
const res = await api.listOpenings(token, { filter_status: ["draft"], filter_is_internal: true });
expect(res.status).toBe(200);
expect(res.body!.openings.length).toBe(1);
expect(res.body!.openings[0].title).toBe("Frontend Designer");
```

### Test: pagination with limit=1
```ts
const page1 = await api.listOpenings(token, { limit: 1 });
expect(page1.status).toBe(200);
expect(page1.body!.openings.length).toBe(1);
expect(page1.body!.next_pagination_key).toBeDefined();

const page2 = await api.listOpenings(token, { limit: 1, pagination_key: page1.body!.next_pagination_key });
expect(page2.status).toBe(200);
expect(page2.body!.openings.length).toBe(1);
// Both pages should have different openings
expect(page2.body!.openings[0].opening_number).not.toBe(page1.body!.openings[0].opening_number);
```

### Test: filter with tag_ids
This requires creating a tag via the `createTestTag` db helper first.
```ts
import { createTestTag, deleteTestTag, generateTestTagId } from "../../../lib/db";

// In beforeAll, create a tag and create one opening with that tag
const tagId = generateTestTagId("op-tag");
await createTestTag(tagId);
// Create opening D: { ..., tag_ids: [tagId] }

// In test:
const res = await api.listOpenings(token, { filter_tag_ids: [tagId] });
expect(res.status).toBe(200);
expect(res.body!.openings.some(o => o.title === "Tagged Opening")).toBe(true);
expect(res.body!.openings.some(o => o.title === "Frontend Engineer")).toBe(false);

// In afterAll:
await deleteTestTag(tagId);
```

### afterAll cleanup
```ts
await deleteTestOrgUser(adminEmail);
await deleteTestOrgUser(recruiterEmail);
```

---

## File 3 — `playwright/tests/api/org/openings-audit-logs.spec.ts`

Tests audit log entries for operations not yet covered in `openings.spec.ts`.
Already covered: `org.create_opening`, `org.publish_opening` (approve path), `org.publish_opening` (superadmin submit path).
Missing: update, submit→pending_review, reject, pause, reopen, close, archive, discard, duplicate.

### Pattern for each test
```ts
const before = new Date(Date.now() - 2000).toISOString();
// perform the action
const auditResp = await api.listAuditLogs(token, {
  event_types: ["org.XXXXX"],
  start_time: before,
});
expect(auditResp.status).toBe(200);
expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
expect(auditResp.body.audit_logs[0].event_type).toBe("org.XXXXX");
```

Each test is independent (own org, own users, own opening). All tests follow the same
setup: create org + two users + address + opening, then get into the required state.

### Test: org.update_opening audit log
State needed: draft.
Action: call update-opening.
Assert audit log event_type = "org.update_opening".

### Test: org.submit_opening audit log (non-superadmin path → pending_review)
State needed: draft opening owned by non-superadmin with `org:manage_openings`.
Action: manager calls submit-opening → returns pending_review.
Assert audit log event_type = "org.submit_opening".

### Test: org.reject_opening audit log
State needed: pending_review.
Setup: non-superadmin submit → pending_review.
Action: superadmin calls reject-opening.
Assert audit log event_type = "org.reject_opening".

### Test: org.pause_opening audit log
State needed: published.
Setup: superadmin submit → published.
Action: pause-opening.
Assert audit log event_type = "org.pause_opening".

### Test: org.reopen_opening audit log
State needed: paused.
Setup: submit → published → pause.
Action: reopen-opening.
Assert audit log event_type = "org.reopen_opening".

### Test: org.close_opening audit log
State needed: published.
Setup: submit → published.
Action: close-opening.
Assert audit log event_type = "org.close_opening".

### Test: org.archive_opening audit log
State needed: closed.
Setup: submit → published → close.
Action: archive-opening.
Assert audit log event_type = "org.archive_opening".

### Test: org.discard_opening audit log
State needed: draft.
Action: discard-opening.
Assert audit log event_type = "org.discard_opening".

### Test: org.duplicate_opening audit log
State needed: any state (draft works).
Action: duplicate-opening.
Assert audit log event_type = "org.duplicate_opening".

### Cleanup
Each test must delete all created users in a `finally` block.

---

## File 4 — `playwright/tests/api/org/openings-rbac-transitions.spec.ts`

RBAC tests for every transition and mutation endpoint that has not yet been individually RBAC-tested.
Each endpoint needs: (a) no-roles user → 403, (b) user with `org:manage_openings` → 2xx.

Currently RBAC-tested in openings.spec.ts: `create-opening`, `list-openings`.
Missing individual RBAC tests: `get-opening`, `update-opening`, `submit-opening`, `approve-opening`,
`reject-opening`, `pause-opening`, `reopen-opening`, `close-opening`, `archive-opening`,
`discard-opening`, `duplicate-opening`.

### Common setup for all tests
Each test needs:
- One superadmin org user (`adminEmail`, with `org:superadmin`)
- One no-roles user (`noroleEmail`)
- One user with `org:manage_openings` (`managerEmail`)
- One recruiter (any active user in the org, used as recruiter in opening creation)
- One address (created by admin token)

For tests that need an opening in a specific state, the admin (superadmin) creates and advances it.

### RBAC test structure (repeat for each endpoint)
```
describe("RBAC: <endpoint>") {
  test("no roles → 403")    { ... noroleToken calls endpoint ... expect 403 }
  test("manage_openings → 2xx") { ... managerToken calls endpoint ... expect 200/204 }
}
```

### Test group: get-opening RBAC
- no roles → 403
- `org:view_openings` → 200 (verify view role also allows get, not just manage)
- `org:manage_openings` → 200

### Test group: update-opening RBAC
State needed: draft opening.
- no roles → 403
- `org:manage_openings` → 200

### Test group: submit-opening RBAC
State needed: draft opening. Non-superadmin submit goes to pending_review.
- no roles → 403
- `org:manage_openings` → 200 (opening goes to pending_review)

### Test group: approve-opening RBAC
State needed: pending_review opening.
Setup: create draft as admin, then have a non-superadmin manager submit it → pending_review.
Then test approve with different users.
- no roles → 403
- `org:manage_openings` → 200

### Test group: reject-opening RBAC
State needed: pending_review opening (same setup as approve).
- no roles → 403
- `org:manage_openings` → 200

### Test group: pause-opening RBAC
State needed: published opening (admin creates + submits → published).
- no roles → 403
- `org:manage_openings` → 200

### Test group: reopen-opening RBAC
State needed: paused opening.
- no roles → 403
- `org:manage_openings` → 200

### Test group: close-opening RBAC
State needed: published opening.
- no roles → 403
- `org:manage_openings` → 200

### Test group: archive-opening RBAC
State needed: closed opening.
- no roles → 403
- `org:manage_openings` → 200

### Test group: discard-opening RBAC
State needed: draft opening.
- no roles → 403
- `org:manage_openings` → 204

### Test group: duplicate-opening RBAC
State needed: any state (draft works).
- no roles → 403
- `org:manage_openings` → 201

### Important note
Each test must use a freshly generated org (unique `generateTestOrgEmail(prefix)`) to avoid
state leakage between parallel tests. Do NOT share openings across RBAC test groups.

---

## File 5 — `playwright/tests/api/org/openings-optional-fields.spec.ts`

Tests that all optional fields in create-opening and update-opening are correctly stored
and returned by get-opening.

### Imports
Same as File 1, plus:
```ts
import { createTestTag, deleteTestTag, generateTestTagId } from "../../../lib/db";
import type {
  CreateOpeningRequest, UpdateOpeningRequest, Opening
} from "vetchium-specs/org/openings";
```

### Setup
Each test uses its own org to avoid interference. All tests use the `createMinimalOpening`
helper (defined in File 1 or duplicated locally).

For `tag_ids`, call `createTestTag(tagId)` in setup and `deleteTestTag(tagId)` in cleanup.
For `cost_center_id`, call `api.addCostCenter(token, { name: "Engineering" })` and use the returned ID.
For `hiring_team_member_email_addresses` and `watcher_email_addresses`, create additional users
in the same org (same `{ orgId, domain }` pattern).

### Test: min_yoe and max_yoe are stored and returned
```ts
const req: CreateOpeningRequest = {
  ...baseFields,
  min_yoe: 2,
  max_yoe: 8,
};
const createRes = await api.createOpening(token, req);
const getRes = await api.getOpening(token, { opening_number: createRes.body!.opening_number });
expect(getRes.body!.min_yoe).toBe(2);
expect(getRes.body!.max_yoe).toBe(8);
```

### Test: min_education_level is stored and returned
```ts
const req: CreateOpeningRequest = { ...baseFields, min_education_level: "bachelor" };
// ...get and verify: getRes.body!.min_education_level === "bachelor"
```

### Test: salary is stored and returned
```ts
const req: CreateOpeningRequest = {
  ...baseFields,
  salary: { min_amount: 50000, max_amount: 100000, currency: "USD" },
};
// verify: getRes.body!.salary.min_amount === 50000, etc.
```

### Test: internal_notes is stored and returned
```ts
const req: CreateOpeningRequest = { ...baseFields, internal_notes: "Only for internal use" };
// verify: getRes.body!.internal_notes === "Only for internal use"
```

### Test: hiring_team_member_email_addresses stored and returned
Create a third user `member@${domain}` in the same org.
```ts
const req: CreateOpeningRequest = {
  ...baseFields,
  hiring_team_member_email_addresses: [memberEmail],
};
const getRes = await api.getOpening(token, { opening_number: ... });
expect(getRes.body!.hiring_team_members.some(m => m.email_address === memberEmail)).toBe(true);
```

### Test: watcher_email_addresses stored and returned
Create a third user `watcher@${domain}` in the same org.
```ts
const req: CreateOpeningRequest = {
  ...baseFields,
  watcher_email_addresses: [watcherEmail],
};
// verify: getRes.body!.watchers.some(w => w.email_address === watcherEmail)
```

### Test: cost_center_id stored and returned
```ts
const ccRes = await api.addCostCenter(token, { name: "Engineering", notes: "Eng team" });
const req: CreateOpeningRequest = { ...baseFields, cost_center_id: ccRes.body!.cost_center_id };
// verify: getRes.body!.cost_center is present and has expected data
```

### Test: tag_ids stored and returned
```ts
const tagId = generateTestTagId("op-opt");
await createTestTag(tagId);
try {
  const req: CreateOpeningRequest = { ...baseFields, tag_ids: [tagId] };
  // verify: getRes.body!.tags.some(t => t.tag_id === tagId)
} finally {
  await deleteTestTag(tagId);
}
```

### Test: update-opening replaces optional fields
Create an opening without optional fields. Then update with min_yoe, max_yoe, salary, internal_notes set.
Verify get-opening returns all updated values.

### Test: update-opening clears optional fields (if supported)
Create an opening with min_yoe=3. Update with min_yoe=undefined/null.
Verify get-opening returns no min_yoe (omitted). If the API does not support clearing (returns the old value),
document this as known behavior.

### Test: invalid email in hiring_team_member_email_addresses → 400 (non-existent user)
```ts
const req: CreateOpeningRequest = {
  ...baseFields,
  hiring_team_member_email_addresses: ["nonexistent@example.com"],
};
const res = await api.createOpeningRaw(token, req);
expect(res.status).toBe(400);
```

### Cleanup
Delete all created users and tags in `finally` blocks.

---

## File 6 — `playwright/tests/api/org/openings-update-errors.spec.ts`

Error cases for `POST /org/update-opening`.

### Imports
Same as File 1.

### Test: update non-existent opening → 404
```ts
const res = await api.updateOpening(token, {
  opening_number: 99999,
  title: "X", description: "Y",
  employment_type: "full_time", work_location_type: "remote",
  address_ids: ["00000000-0000-0000-0000-000000000001"],
  number_of_positions: 1,
  hiring_manager_email_address: adminEmail,
  recruiter_email_address: recruiterEmail,
});
expect(res.status).toBe(404);
```

### Test: update-opening without token → 401
```ts
const response = await request.post("/org/update-opening", { data: { opening_number: 1 } });
expect(response.status()).toBe(401);
```

### Test: update-opening with HM == recruiter → 400
Create a draft opening. Then call update with `hiring_manager_email_address === recruiter_email_address`.
```ts
const res = await api.updateOpening(token, {
  opening_number: openingNumber,
  ...allRequiredFields,
  hiring_manager_email_address: adminEmail,
  recruiter_email_address: adminEmail,  // same as HM
});
expect(res.status).toBe(400);
```

### Test: update-opening with missing title → 400
```ts
const res = await api.updateOpening(token, {
  opening_number: openingNumber,
  title: "",  // empty
  ...otherFields,
});
expect(res.status).toBe(400);
```

### Test: update-opening with missing description → 400
```ts
const res = await api.updateOpening(token, {
  opening_number: openingNumber,
  description: "",  // empty
  ...otherFields,
});
expect(res.status).toBe(400);
```

### Test: update-opening with number_of_positions=0 → 400
```ts
const res = await api.updateOpening(token, {
  ...validFields,
  number_of_positions: 0,
});
expect(res.status).toBe(400);
```

### Test: update published opening → 422
(This overlaps with File 1 intent; include here with the update-specific context.)
Setup: draft → superadmin submit → published.
Action: update-opening with valid body.
Expect: 422.

---

## File 7 — `playwright/tests/ui/org/openings.spec.ts`

End-to-end UI tests for the Openings feature using Playwright's browser automation.
These tests go in `playwright/tests/ui/org/openings.spec.ts`.
Tests match the `chromium` project in playwright.config.ts (pattern: `/.*\/ui\/.*\.spec\.ts/`).

### Imports
```ts
import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import {
  createTestOrgAdminDirect,
  createTestOrgUserDirect,
  deleteTestOrgByDomain,
  generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
```

### Note on UI test isolation
Each `test.describe` block that uses `beforeAll` MUST use `test.describe.configure({ mode: "serial" })`.
Each independent test uses its own unique domain. Use `deleteTestOrgByDomain(domain)` in `afterAll` to
clean up org + users in one call.

---

### UI Test Group 1: Openings List Page

**Setup**: One org with superadmin. No openings initially.

#### Test: list page loads and shows empty state
```ts
await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
await page.goto(`${ORG_UI_URL}/openings`);
await expect(page.locator("h2")).toContainText("Openings");
await expect(page.locator("text=No openings yet")).toBeVisible();
await expect(page.locator('button:has-text("Create Opening")')).toBeVisible();
```

#### Test: back-to-dashboard button works
```ts
await page.goto(`${ORG_UI_URL}/openings`);
await page.click('button:has-text("Back to Dashboard")');  // or ArrowLeft button
await expect(page).toHaveURL(`${ORG_UI_URL}/`);
```

#### Test: clicking "Create Opening" navigates to create page
```ts
await page.goto(`${ORG_UI_URL}/openings`);
await page.click('button:has-text("Create Opening")');
await expect(page).toHaveURL(`${ORG_UI_URL}/openings/new`);
```

#### Test: user with view_openings role sees list but no "Create Opening" button
Setup: create a user with only `org:view_openings` role. Login as that user.
```ts
await expect(page.locator('button:has-text("Create Opening")')).not.toBeVisible();
await expect(page.locator("table")).toBeVisible();  // still sees the table
```

#### Test: opening appears in list after creation (serial describe)
```ts
test.describe.configure({ mode: "serial" });
// beforeAll: login as admin, create an address via API, create an opening via API
// test: navigate to /openings, verify the opening title appears in the table
await page.goto(`${ORG_UI_URL}/openings`);
await expect(page.locator(`text=${openingTitle}`)).toBeVisible();
```

#### Test: clicking "Actions" popover for draft shows Edit, Submit, Discard, Duplicate
```ts
await page.goto(`${ORG_UI_URL}/openings`);
await page.click('button:has-text("Actions")');
await expect(page.locator('button:has-text("Edit")')).toBeVisible();
await expect(page.locator('button:has-text("Submit")')).toBeVisible();
await expect(page.locator('button:has-text("Discard")')).toBeVisible();
await expect(page.locator('button:has-text("Duplicate")')).toBeVisible();
```

#### Test: clicking opening row navigates to detail page
Use the "View" action from the Actions popover.
```ts
await page.click('button:has-text("Actions")');
await page.click('button:has-text("View")');
await expect(page).toHaveURL(new RegExp(`${ORG_UI_URL}/openings/\\d+`));
```

---

### UI Test Group 2: Create Opening Page

**Setup**: One org with superadmin. One address created via API call before the test.

#### Test: create page renders all required fields
```ts
await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
await page.goto(`${ORG_UI_URL}/openings/new`);
await expect(page.locator("text=Create Opening")).toBeVisible();
// Check key form fields exist
await expect(page.locator('[name="title"]')).toBeVisible();
await expect(page.locator('label:has-text("Description")')).toBeVisible();
await expect(page.locator('label:has-text("Employment Type")')).toBeVisible();
await expect(page.locator('label:has-text("Work Location")')).toBeVisible();
await expect(page.locator('label:has-text("Hiring Manager")')).toBeVisible();
await expect(page.locator('label:has-text("Recruiter")')).toBeVisible();
```

#### Test: submit with empty title shows validation error
```ts
await page.goto(`${ORG_UI_URL}/openings/new`);
await page.click('button[type="submit"]');  // or "Save Draft" / "Create Opening"
await expect(page.locator("text=title is required")).toBeVisible();
```

#### Test: successful creation navigates to detail page
```ts
await page.goto(`${ORG_UI_URL}/openings/new`);
await page.fill('[name="title"]', "UI Test Opening");
await page.fill('[name="description"]', "A test description");
// Select employment type from dropdown
await page.click('label:has-text("Employment Type")').then(() => {});  // approach via Select component
// ... fill all required fields
await page.click('button:has-text("Save Draft")');  // or equivalent submit button
// After creation, should navigate to the opening detail page
await expect(page).toHaveURL(new RegExp(`${ORG_UI_URL}/openings/\\d+`));
await expect(page.locator("text=UI Test Opening")).toBeVisible();
```

Note to implementer: inspect the actual form field selectors by looking at
`org-ui/src/pages/Openings/CreateOpeningPage.tsx` before writing selectors.
The exact submit button text and field structure must match the TSX.

#### Test: back button returns to openings list
```ts
await page.goto(`${ORG_UI_URL}/openings/new`);
await page.click('button:has-text("Back to Openings")');  // or ArrowLeft icon button
await expect(page).toHaveURL(`${ORG_UI_URL}/openings`);
```

---

### UI Test Group 3: Opening Detail Page

**Setup**: Use `test.describe.configure({ mode: "serial" })`. Create one org and one
opening via API in `beforeAll`. Tests share `openingNumber` and `token`/`sessionToken`.

#### Test: detail page shows opening title, number, and status badge
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await expect(page.locator("h2")).toContainText("Lifecycle UI Opening");
await expect(page.locator(`text=#${openingNumber}`)).toBeVisible();
await expect(page.locator("text=draft")).toBeVisible();  // status tag
```

#### Test: draft status shows Edit, Submit, Duplicate action buttons
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await expect(page.locator('button:has-text("Edit")')).toBeVisible();
await expect(page.locator('button:has-text("Submit")')).toBeVisible();
await expect(page.locator('button:has-text("Duplicate")')).toBeVisible();
```

#### Test: "Edit" button navigates to edit page
```ts
await page.click('button:has-text("Edit")');
await expect(page).toHaveURL(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
```

#### Test: superadmin "Submit" goes directly to published and page updates
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await page.click('button:has-text("Submit")');
// After submit, the detail page should reload and show published status
await expect(page.locator("text=published")).toBeVisible({ timeout: 10000 });
// Action buttons should now be Pause, Close, Duplicate
await expect(page.locator('button:has-text("Pause")')).toBeVisible();
await expect(page.locator('button:has-text("Close")')).toBeVisible();
```

#### Test: "Duplicate" creates a new draft and navigates to its edit page
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await page.click('button:has-text("Duplicate")');
await expect(page).toHaveURL(new RegExp(`${ORG_UI_URL}/openings/\\d+/edit`));
// The duplicated opening's number should be different from the original
const newUrl = page.url();
const newNumber = parseInt(newUrl.match(/\/openings\/(\d+)\/edit/)![1]);
expect(newNumber).not.toBe(openingNumber);
```

#### Test: rejection note banner shown on draft with rejection_note
Setup: Create a second opening via API, submit (non-superadmin) to pending_review,
then superadmin reject with a note, then navigate to the detail page.
```ts
await page.goto(`${ORG_UI_URL}/openings/${rejectedOpeningNumber}`);
await expect(page.locator("text=Not enough detail")).toBeVisible();  // part of rejection note
```

#### Test: published banner shows expiry date
After superadmin submit → published:
```ts
await page.goto(`${ORG_UI_URL}/openings/${publishedOpeningNumber}`);
await expect(page.locator("text=expires")).toBeVisible({ timeout: 5000 });
```

#### Test: back to openings list button works
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await page.click('button:has-text("Back to Openings")');
await expect(page).toHaveURL(`${ORG_UI_URL}/openings`);
```

---

### UI Test Group 4: Edit Opening Page

**Setup**: Own org, own opening (draft). Use `test.describe.configure({ mode: "serial" })`.

#### Test: edit page pre-fills existing opening data
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
await expect(page.locator('[name="title"]')).toHaveValue("Original Title");
await expect(page.locator('[name="description"]')).toHaveValue("Original description");
```

Note to implementer: verify exact form field names and selectors from
`org-ui/src/pages/Openings/EditOpeningPage.tsx`.

#### Test: can change title and save → detail page shows new title
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
await page.fill('[name="title"]', "Updated UI Title");
await page.click('button:has-text("Save")');  // or equivalent button
// After save, should navigate away from edit page
await expect(page).not.toHaveURL(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
// Verify new title on detail page
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
await expect(page.locator("h2")).toContainText("Updated UI Title");
```

#### Test: empty title shows validation error on save attempt
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
await page.fill('[name="title"]', "");
await page.click('button:has-text("Save")');
await expect(page.locator("text=title is required")).toBeVisible();
```

#### Test: back button returns to detail page without saving
```ts
await page.goto(`${ORG_UI_URL}/openings/${openingNumber}/edit`);
await page.fill('[name="title"]', "Abandoned Change");
await page.click('button:has-text("Back")');  // or ArrowLeft icon
await expect(page).toHaveURL(`${ORG_UI_URL}/openings/${openingNumber}`);
// Title should still be the original
await expect(page.locator("h2")).not.toContainText("Abandoned Change");
```

---

## Implementation Notes for the Implementer

### Patterns to follow exactly
1. **Unique test isolation**: Always use `generateTestOrgEmail(prefix)` — never hard-code domains.
2. **Second user in same org**: `createTestOrgUserDirect(email, password, "ind1", { orgId, domain })`.
3. **RBAC setup**: `assignRoleToOrgUser(orgUserId, "org:manage_openings", orgId)`.
4. **Always clean up in `finally`**: `deleteTestOrgUser(email)` for API tests,
   `deleteTestOrgByDomain(domain)` for UI tests.
5. **Audit log pattern**: Capture `before` timestamp before the action, then filter audit logs by
   `event_types` and `start_time: before`.
6. **Serial describe**: Required when `beforeAll`/`afterAll` share mutable state (openingNumber, token).
7. **Type imports**: All request/response types from `vetchium-specs/org/openings` (never define locally).

### API event type reference (from handlers/org/openings.go)
- `org.create_opening`
- `org.update_opening`
- `org.discard_opening`
- `org.duplicate_opening`
- `org.submit_opening` (non-superadmin path: → pending_review)
- `org.publish_opening` (superadmin submit path OR approve path: → published)
- `org.reject_opening`
- `org.pause_opening`
- `org.reopen_opening`
- `org.close_opening`
- `org.archive_opening`

### Valid state transitions (for state-transition tests)
- draft → pending_review: submit (non-superadmin)
- draft → published: submit (superadmin)
- pending_review → published: approve
- pending_review → draft: reject
- published → paused: pause
- published → closed: close
- paused → published: reopen
- paused → closed: close
- closed → archived: archive
- expired → archived: archive
- draft → deleted: discard (204, then 404 on get)

### UI selector guidance
Before writing any selector in UI tests, read the corresponding TSX file to find exact button
text, input names, and element structure. Do not guess selectors. The key files are:
- `org-ui/src/pages/Openings/OpeningsListPage.tsx`
- `org-ui/src/pages/Openings/CreateOpeningPage.tsx`
- `org-ui/src/pages/Openings/EditOpeningPage.tsx`
- `org-ui/src/pages/Openings/OpeningDetailPage.tsx`
- `org-ui/src/pages/Openings/` (locale files for button text)

For i18n strings (button labels, headings), check `org-ui/src/locales/en-US/openings.json`
to find the exact English text rendered in the UI.

### addCostCenter API method
Available in OrgAPIClient as `api.addCostCenter(token, { name, notes })`.
The response body has `cost_center_id`.

### createTestTag / deleteTestTag
Both are in `playwright/lib/db.ts`. `generateTestTagId(prefix)` also available there.
Tags are global (not per-region), created in the global DB.
