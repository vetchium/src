import { expect } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgsIdempotencyKey,
  signupOrg,
} from "../lib/orgs-api.ts";

const completeContent: OpeningContent = {
  title: "Engineer",
  description: "Build reliable services",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
};

test("a manager requests publication and an approver decides it", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const requestKey = orgsIdempotencyKey();
    const requestedResponse = await api.requestOpeningChange(
      manager.token,
      {
        opening_number: created.opening_number,
        version: created.version,
        kind: "publish",
      },
      requestKey,
    );
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const requested = (await requestedResponse.json()) as OrgOpening;
    expect(requested.pending_request).toMatchObject({
      kind: "publish",
      requested_by_email: manager.emailAddress,
    });
    expect(requested.state).toBe("draft");
    const staleRequest = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(staleRequest.status(), await staleRequest.text()).toBe(409);
    expect((await staleRequest.json()).type).toContain(
      "org-opening-version-conflict",
    );
    const requestKeyConflict = await api.requestOpeningChange(
      manager.token,
      {
        opening_number: created.opening_number,
        version: created.version,
        kind: "pause",
      },
      requestKey,
    );
    expect(requestKeyConflict.status(), await requestKeyConflict.text()).toBe(
      409,
    );
    expect((await requestKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );
    const awaiting = await api.listOpenings(owner, {
      pending_request_kinds: ["publish"],
      awaiting_my_approval: true,
    });
    expect(awaiting.status(), await awaiting.text()).toBe(200);
    expect((await awaiting.json()).openings).toMatchObject([
      {
        opening_number: created.opening_number,
        pending_request_kind: "publish",
      },
    ]);
    const managerAwaiting = await api.listOpenings(manager.token, {
      awaiting_my_approval: true,
    });
    expect(managerAwaiting.status(), await managerAwaiting.text()).toBe(200);
    expect((await managerAwaiting.json()).openings).toEqual([]);
    const decisionKey = orgsIdempotencyKey();
    const decidedResponse = await api.decideOpeningRequest(
      owner,
      {
        opening_number: created.opening_number,
        version: requested.version,
        decision: "approve",
      },
      decisionKey,
    );
    expect(decidedResponse.status(), await decidedResponse.text()).toBe(200);
    const decided = (await decidedResponse.json()) as OrgOpening;
    expect(decided.state).toBe("published");
    expect(decided.live_content).toMatchObject({
      title: completeContent.title,
      description: completeContent.description,
    });
    expect(decided.working_content).toBeUndefined();
    expect(decided.pending_request).toBeUndefined();
    const decisionKeyConflict = await api.decideOpeningRequest(
      owner,
      {
        opening_number: created.opening_number,
        version: requested.version,
        decision: "reject",
        note: "Changed decision",
      },
      decisionKey,
    );
    expect(decisionKeyConflict.status(), await decisionKeyConflict.text()).toBe(
      409,
    );
    expect((await decisionKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );
    const noDecision = await api.decideOpeningRequest(owner, {
      opening_number: created.opening_number,
      version: decided.version,
      decision: "approve",
    });
    expect(noDecision.status(), await noDecision.text()).toBe(409);
    expect((await noDecision.json()).type).toContain(
      "org-opening-state-conflict",
    );
    const noWithdrawal = await api.withdrawOpeningRequest(manager.token, {
      opening_number: created.opening_number,
      version: decided.version,
    });
    expect(noWithdrawal.status(), await noWithdrawal.text()).toBe(409);
    expect((await noWithdrawal.json()).type).toContain(
      "org-opening-state-conflict",
    );

    let current = decided;
    const revision = await api.saveOpeningWorkingCopy(manager.token, {
      opening_number: current.opening_number,
      version: current.version,
      content: { title: "Senior Engineer" },
    });
    expect(revision.status(), await revision.text()).toBe(200);
    current = (await revision.json()) as OrgOpening;
    for (const [kind, state] of [
      ["revise", "published"],
      ["pause", "paused"],
      ["reopen", "published"],
      ["close", "closed"],
    ] as const) {
      const submitted = await api.requestOpeningChange(manager.token, {
        opening_number: current.opening_number,
        version: current.version,
        kind,
      });
      expect(submitted.status(), `${kind}: ${await submitted.text()}`).toBe(
        200,
      );
      const pending = (await submitted.json()) as OrgOpening;
      expect(pending.pending_request?.kind).toBe(kind);
      const decision = await api.decideOpeningRequest(owner, {
        opening_number: pending.opening_number,
        version: pending.version,
        decision: "approve",
      });
      expect(decision.status(), `${kind}: ${await decision.text()}`).toBe(200);
      current = (await decision.json()) as OrgOpening;
      expect(current.state).toBe(state);
      expect(current.pending_request).toBeUndefined();
    }
    expect(current.live_content?.title).toBe("Senior Engineer");
    expect(current.revision).toBe(1);
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("an approver applies every request kind at once", async ({ request }) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const createdResponse = await api.createOpening(owner, {
      content: completeContent,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    let opening = (await createdResponse.json()) as OrgOpening;
    const publish = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(publish.status(), await publish.text()).toBe(200);
    opening = (await publish.json()) as OrgOpening;
    expect(opening.state).toBe("published");
    expect(opening.pending_request).toBeUndefined();
    expect(opening.first_published_at).toBeDefined();
    expect(opening.expires_at).toBeDefined();

    const revision = await api.saveOpeningWorkingCopy(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      content: { title: "Senior Engineer" },
    });
    expect(revision.status(), await revision.text()).toBe(200);
    opening = (await revision.json()) as OrgOpening;
    const revise = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "revise",
    });
    expect(revise.status(), await revise.text()).toBe(200);
    opening = (await revise.json()) as OrgOpening;
    expect(opening.state).toBe("published");
    expect(opening.revision).toBe(1);
    expect(opening.live_content?.title).toBe("Senior Engineer");
    expect(opening.working_content).toBeUndefined();
    expect(opening.last_revised_at).toBeDefined();

    for (const [kind, state] of [
      ["pause", "paused"],
      ["reopen", "published"],
      ["close", "closed"],
    ] as const) {
      const response = await api.requestOpeningChange(owner, {
        opening_number: opening.opening_number,
        version: opening.version,
        kind,
      });
      expect(response.status(), `${kind}: ${await response.text()}`).toBe(200);
      opening = (await response.json()) as OrgOpening;
      expect(opening.state).toBe(state);
      expect(opening.pending_request).toBeUndefined();
    }
    expect(opening.ended_at).toBeDefined();
    const terminal = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "reopen",
    });
    expect(terminal.status(), await terminal.text()).toBe(409);
    expect((await terminal.json()).type).toContain(
      "org-opening-state-conflict",
    );
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("an approver closes over a pending request and records supersession", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(owner, {
      content: completeContent,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const publishedResponse = await api.requestOpeningChange(owner, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(publishedResponse.status(), await publishedResponse.text()).toBe(
      200,
    );
    const published = (await publishedResponse.json()) as OrgOpening;
    const revisionResponse = await api.saveOpeningWorkingCopy(owner, {
      opening_number: published.opening_number,
      version: published.version,
      content: { title: "Future revision" },
    });
    expect(revisionResponse.status(), await revisionResponse.text()).toBe(200);
    const revision = (await revisionResponse.json()) as OrgOpening;
    const pauseResponse = await api.requestOpeningChange(manager.token, {
      opening_number: revision.opening_number,
      version: revision.version,
      kind: "pause",
    });
    expect(pauseResponse.status(), await pauseResponse.text()).toBe(200);
    const pause = (await pauseResponse.json()) as OrgOpening;
    const denied = await api.requestOpeningChange(manager.token, {
      opening_number: pause.opening_number,
      version: pause.version,
      kind: "close",
    });
    expect(denied.status(), await denied.text()).toBe(409);
    expect((await denied.json()).type).toContain("org-opening-request-pending");
    const closedResponse = await api.requestOpeningChange(owner, {
      opening_number: pause.opening_number,
      version: pause.version,
      kind: "close",
    });
    expect(closedResponse.status(), await closedResponse.text()).toBe(200);
    const closed = (await closedResponse.json()) as OrgOpening;
    expect(closed.state).toBe("closed");
    expect(closed.pending_request).toBeUndefined();
    expect(closed.working_content).toBeUndefined();
    expect(closed.live_content?.title).toBe("Engineer");
    const historyResponse = await api.listOpeningHistory(owner, {
      opening_number: closed.opening_number,
    });
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    const history = (await historyResponse.json()).entries as {
      action: string;
      request_kind?: string;
    }[];
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "superseded",
          request_kind: "pause",
        }),
        expect.objectContaining({
          action: "self_approved",
          request_kind: "close",
        }),
      ]),
    );
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("every kind can be rejected or withdrawn without applying it", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(owner, {
      content: completeContent,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    let opening = (await createdResponse.json()) as OrgOpening;
    const checkRefusals = async (
      kind: "publish" | "revise" | "pause" | "reopen" | "close",
    ) => {
      const originalState = opening.state;
      const first = await api.requestOpeningChange(manager.token, {
        opening_number: opening.opening_number,
        version: opening.version,
        kind,
        note: `Please ${kind}`,
      });
      expect(first.status(), `${kind}: ${await first.text()}`).toBe(200);
      const pending = (await first.json()) as OrgOpening;
      const noNote = await api.decideOpeningRequest(owner, {
        opening_number: opening.opening_number,
        version: pending.version,
        decision: "reject",
      });
      expect(noNote.status(), await noNote.text()).toBe(400);
      const rejectedResponse = await api.decideOpeningRequest(owner, {
        opening_number: opening.opening_number,
        version: pending.version,
        decision: "reject",
        note: `Not yet ${kind}`,
      });
      expect(
        rejectedResponse.status(),
        `${kind}: ${await rejectedResponse.text()}`,
      ).toBe(200);
      opening = (await rejectedResponse.json()) as OrgOpening;
      expect(opening.state).toBe(originalState);
      expect(opening.pending_request).toBeUndefined();

      const second = await api.requestOpeningChange(manager.token, {
        opening_number: opening.opening_number,
        version: opening.version,
        kind,
      });
      expect(second.status(), `${kind}: ${await second.text()}`).toBe(200);
      const secondPending = (await second.json()) as OrgOpening;
      const staleWithdrawal = await api.withdrawOpeningRequest(manager.token, {
        opening_number: opening.opening_number,
        version: opening.version,
      });
      expect(staleWithdrawal.status(), await staleWithdrawal.text()).toBe(409);
      expect((await staleWithdrawal.json()).type).toContain(
        "org-opening-version-conflict",
      );
      const withdrawalKey = orgsIdempotencyKey();
      const withdrawnResponse = await api.withdrawOpeningRequest(
        manager.token,
        {
          opening_number: opening.opening_number,
          version: secondPending.version,
        },
        withdrawalKey,
      );
      expect(
        withdrawnResponse.status(),
        `${kind}: ${await withdrawnResponse.text()}`,
      ).toBe(200);
      opening = (await withdrawnResponse.json()) as OrgOpening;
      expect(opening.state).toBe(originalState);
      expect(opening.pending_request).toBeUndefined();
      const withdrawalKeyConflict = await api.withdrawOpeningRequest(
        manager.token,
        {
          opening_number: opening.opening_number,
          version: opening.version,
        },
        withdrawalKey,
      );
      expect(
        withdrawalKeyConflict.status(),
        await withdrawalKeyConflict.text(),
      ).toBe(409);
      expect((await withdrawalKeyConflict.json()).type).toContain(
        "idempotency-key-conflict",
      );
    };

    await checkRefusals("publish");
    expect(opening.working_content).toBeDefined();
    const published = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(published.status(), await published.text()).toBe(200);
    opening = (await published.json()) as OrgOpening;
    const saved = await api.saveOpeningWorkingCopy(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      content: { title: "Revised title" },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    opening = (await saved.json()) as OrgOpening;
    await checkRefusals("revise");
    expect(opening.working_content?.title).toBe("Revised title");
    const revised = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "revise",
    });
    expect(revised.status(), await revised.text()).toBe(200);
    opening = (await revised.json()) as OrgOpening;
    await checkRefusals("pause");
    const paused = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "pause",
    });
    expect(paused.status(), await paused.text()).toBe(200);
    opening = (await paused.json()) as OrgOpening;
    await checkRefusals("reopen");
    const reopened = await api.requestOpeningChange(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "reopen",
    });
    expect(reopened.status(), await reopened.text()).toBe(200);
    opening = (await reopened.json()) as OrgOpening;
    await checkRefusals("close");
    const historyResponse = await api.listOpeningHistory(owner, {
      opening_number: opening.opening_number,
    });
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    const history = (await historyResponse.json()).entries as {
      action: string;
      request_kind?: string;
      request_note?: string;
      decision_note?: string;
    }[];
    for (const kind of ["publish", "revise", "pause", "reopen", "close"]) {
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "rejected",
            request_kind: kind,
            request_note: `Please ${kind}`,
            decision_note: `Not yet ${kind}`,
          }),
          expect.objectContaining({ action: "withdrawn", request_kind: kind }),
        ]),
      );
    }
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("publication checks completeness and active hiring team at request and approval", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const hirer = await addOrgMember(
      api,
      owner,
      org.domain,
      `hirer@${org.domain}`,
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: { title: "Incomplete" },
      hiring_manager_email: hirer.emailAddress,
      recruiter_email: hirer.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    let opening = (await createdResponse.json()) as OrgOpening;
    const incomplete = await api.requestOpeningChange(manager.token, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(incomplete.status(), await incomplete.text()).toBe(422);
    expect((await incomplete.json()).fields).toEqual(
      expect.arrayContaining([
        "content.description",
        "content.employing_country",
      ]),
    );
    const saved = await api.saveOpeningWorkingCopy(manager.token, {
      opening_number: opening.opening_number,
      version: opening.version,
      content: completeContent,
    });
    expect(saved.status(), await saved.text()).toBe(200);
    opening = (await saved.json()) as OrgOpening;
    const disabled = await api.disableUser(owner, {
      email_address: hirer.emailAddress,
    });
    expect(disabled.status(), await disabled.text()).toBe(204);
    const invalid = await api.requestOpeningChange(manager.token, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(invalid.status(), await invalid.text()).toBe(422);
    expect((await invalid.json()).email_addresses).toEqual([
      hirer.emailAddress,
    ]);
    const enabled = await api.enableUser(owner, {
      email_address: hirer.emailAddress,
    });
    expect(enabled.status(), await enabled.text()).toBe(204);
    const requested = await api.requestOpeningChange(manager.token, {
      opening_number: opening.opening_number,
      version: opening.version,
      kind: "publish",
    });
    expect(requested.status(), await requested.text()).toBe(200);
    opening = (await requested.json()) as OrgOpening;
    const disabledAgain = await api.disableUser(owner, {
      email_address: hirer.emailAddress,
    });
    expect(disabledAgain.status(), await disabledAgain.text()).toBe(204);
    const blocked = await api.decideOpeningRequest(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      decision: "approve",
    });
    expect(blocked.status(), await blocked.text()).toBe(422);
    expect((await blocked.json()).email_addresses).toEqual([
      hirer.emailAddress,
    ]);
    const stillPending = await api.getOpening(owner, {
      opening_number: opening.opening_number,
    });
    expect(stillPending.status(), await stillPending.text()).toBe(200);
    expect((await stillPending.json()).pending_request?.kind).toBe("publish");
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("a revoked approver cannot decide and a newly granted requester can", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const approver = await addOrgMember(
      api,
      owner,
      org.domain,
      `approver@${org.domain}`,
      ["org:approve_openings"],
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const requestedResponse = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const requested = (await requestedResponse.json()) as OrgOpening;
    const revoked = await api.setUserPermissions(owner, {
      email_address: approver.emailAddress,
      permissions: [],
    });
    expect(revoked.status(), await revoked.text()).toBe(204);
    const denied = await api.decideOpeningRequest(approver.token, {
      opening_number: requested.opening_number,
      version: requested.version,
      decision: "approve",
    });
    expect(denied.status(), await denied.text()).toBe(403);
    const stillPending = await api.getOpening(owner, {
      opening_number: requested.opening_number,
    });
    expect(stillPending.status(), await stillPending.text()).toBe(200);
    expect((await stillPending.json()).pending_request?.kind).toBe("publish");
    const granted = await api.setUserPermissions(owner, {
      email_address: manager.emailAddress,
      permissions: ["org:manage_openings", "org:approve_openings"],
    });
    expect(granted.status(), await granted.text()).toBe(204);
    const decided = await api.decideOpeningRequest(manager.token, {
      opening_number: requested.opening_number,
      version: requested.version,
      decision: "approve",
    });
    expect(decided.status(), await decided.text()).toBe(200);
    expect((await decided.json()).state).toBe("published");
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("the original requester can withdraw after losing manage permission", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const requestedResponse = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const requested = (await requestedResponse.json()) as OrgOpening;
    const revoked = await api.setUserPermissions(owner, {
      email_address: manager.emailAddress,
      permissions: [],
    });
    expect(revoked.status(), await revoked.text()).toBe(204);
    const hidden = await api.getOpening(manager.token, {
      opening_number: created.opening_number,
    });
    expect(hidden.status(), await hidden.text()).toBe(404);
    const withdrawn = await api.withdrawOpeningRequest(manager.token, {
      opening_number: created.opening_number,
      version: requested.version,
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    expect((await withdrawn.json()).pending_request).toBeUndefined();
    const stillHidden = await api.getOpening(manager.token, {
      opening_number: created.opening_number,
    });
    expect(stillHidden.status(), await stillHidden.text()).toBe(404);
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("a hiring-team reader cannot request, decide, or withdraw another person's request", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const reader = await addOrgMember(
      api,
      owner,
      org.domain,
      `reader@${org.domain}`,
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [reader.emailAddress],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const deniedRequest = await api.requestOpeningChange(reader.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(deniedRequest.status(), await deniedRequest.text()).toBe(403);
    const requestedResponse = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const pending = (await requestedResponse.json()) as OrgOpening;
    const deniedDecision = await api.decideOpeningRequest(reader.token, {
      opening_number: pending.opening_number,
      version: pending.version,
      decision: "approve",
    });
    expect(deniedDecision.status(), await deniedDecision.text()).toBe(403);
    const deniedWithdrawal = await api.withdrawOpeningRequest(reader.token, {
      opening_number: pending.opening_number,
      version: pending.version,
    });
    expect(deniedWithdrawal.status(), await deniedWithdrawal.text()).toBe(403);
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("a publish decision reports missing hiring roles after a team edit", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const requestedResponse = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const pending = (await requestedResponse.json()) as OrgOpening;
    const editedTeam = await api.setOpeningTeam(manager.token, {
      opening_number: pending.opening_number,
      version: pending.version,
      team_member_emails: [],
    });
    expect(editedTeam.status(), await editedTeam.text()).toBe(200);
    const edited = (await editedTeam.json()) as OrgOpening;
    const stale = await api.decideOpeningRequest(owner, {
      opening_number: edited.opening_number,
      version: pending.version,
      decision: "approve",
    });
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).type).toContain("org-opening-version-conflict");
    const incomplete = await api.decideOpeningRequest(owner, {
      opening_number: edited.opening_number,
      version: edited.version,
      decision: "approve",
    });
    expect(incomplete.status(), await incomplete.text()).toBe(422);
    expect((await incomplete.json()).fields).toEqual(
      expect.arrayContaining(["hiring_manager_email", "recruiter_email"]),
    );
    const detail = await api.getOpening(owner, {
      opening_number: edited.opening_number,
    });
    expect(detail.status(), await detail.text()).toBe(200);
    expect((await detail.json()).pending_request?.kind).toBe("publish");
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});

test("concurrent decisions allow one winner and replay its audit-free result", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const approver = await addOrgMember(
      api,
      owner,
      org.domain,
      `approver@${org.domain}`,
      ["org:approve_openings"],
    );
    const createdResponse = await api.createOpening(manager.token, {
      content: completeContent,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const requestKey = orgsIdempotencyKey();
    const requestedResponse = await api.requestOpeningChange(
      manager.token,
      {
        opening_number: created.opening_number,
        version: created.version,
        kind: "publish",
      },
      requestKey,
    );
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const pending = (await requestedResponse.json()) as OrgOpening;
    const firstKey = orgsIdempotencyKey();
    const secondKey = orgsIdempotencyKey();
    const body = {
      opening_number: pending.opening_number,
      version: pending.version,
      decision: "approve" as const,
    };
    const [first, second] = await Promise.all([
      api.decideOpeningRequest(owner, body, firstKey),
      api.decideOpeningRequest(approver.token, body, secondKey),
    ]);
    expect([first.status(), second.status()].sort()).toEqual([200, 409]);
    const winner =
      first.status() === 200
        ? { token: owner, key: firstKey, response: first }
        : { token: approver.token, key: secondKey, response: second };
    const replay = await api.decideOpeningRequest(
      winner.token,
      body,
      winner.key,
    );
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toEqual(await winner.response.json());
    expect(orgAuditEventsByKey(requestKey)).toHaveLength(1);
    expect(orgAuditEventsByKey(winner.key)).toHaveLength(1);
    expect(
      orgAuditEventsByKey(first.status() === 200 ? secondKey : firstKey),
    ).toHaveLength(0);
    expect(JSON.stringify(orgAuditEventsByKey(winner.key))).not.toContain(
      completeContent.description,
    );
    const historyResponse = await api.listOpeningHistory(owner, {
      opening_number: created.opening_number,
    });
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    const history = (await historyResponse.json()).entries as {
      action: string;
    }[];
    expect(history.filter((entry) => entry.action === "approved")).toHaveLength(
      1,
    );
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});
