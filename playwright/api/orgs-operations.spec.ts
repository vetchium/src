import { randomUUID } from "node:crypto";
import type { OperationStatus } from "typespec/orgs/operations/operations";
import { expectProblem } from "../lib/admin-api.ts";
import { sqlLiteral } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgDID,
  orgSQL,
  orgUserID,
  signupOrg,
} from "../lib/orgs-api.ts";

// No command kind is registered yet, so the operation is seeded as the
// sender would commit it before contacting the authority tenant, and kept
// out of the workers' recovery for the test's lifetime.
function seedOperation(
  ownerType: "org_user" | "hub_user",
  ownerID: string,
  authorityDID: string,
  state: "pending" | "succeeded",
): string {
  const operationID = randomUUID();
  const resolved =
    state === "succeeded"
      ? `'succeeded', 201, convert_to('sealed', 'UTF8'), now()`
      : `'pending', NULL, NULL, NULL`;
  orgSQL(`INSERT INTO vetchium.federation_operations (
      operation_id, command_id, kind, target_authority, aggregate_id,
      owner_principal_type, owner_principal_id, idempotency_key,
      request_digest, payload_bytes, state, response_status,
      response_ciphertext, completed_at, next_attempt_at, expires_at,
      authority_principal_type, authority_principal_did
    ) VALUES (
      ${sqlLiteral(operationID)}, gen_random_uuid(), 'e2e-operation-status',
      'tenant', ${sqlLiteral(operationID)}, ${sqlLiteral(ownerType)},
      ${sqlLiteral(ownerID)}, ${sqlLiteral(operationID)},
      sha256(convert_to(${sqlLiteral(operationID)}, 'UTF8')),
      convert_to('{}', 'UTF8'), ${resolved}, now() + interval '1 hour',
      now() + interval '1 hour', 'org', ${sqlLiteral(authorityDID)}
    )`);
  return operationID;
}

function cleanupOperations(operationIDs: string[]): void {
  if (operationIDs.length === 0) return;
  orgSQL(`DELETE FROM vetchium.federation_operations
    WHERE operation_id IN (${operationIDs.map(sqlLiteral).join(", ")})`);
}

test("Org operation status is visible only to the Org user who started it", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  const operations: string[] = [];
  try {
    const owner = await loginOrg(api, org);
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      [],
    );
    const ownerID = orgUserID(org.emailAddress);
    const did = orgDID(org.domain);
    const pending = seedOperation("org_user", ownerID, did, "pending");
    const succeeded = seedOperation("org_user", ownerID, did, "succeeded");
    const hubOwned = seedOperation("hub_user", ownerID, did, "pending");
    operations.push(pending, succeeded, hubOwned);

    for (const [operationID, state] of [
      [pending, "pending"],
      [succeeded, "succeeded"],
    ] as const) {
      const response = await api.operationStatus(owner, {
        operation_id: operationID,
      });
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const body = (await response.json()) as OperationStatus;
      expect(body).toEqual({ operation_id: operationID, state });
    }

    // Another user of the same Org, a Hub-owned operation with the same
    // owner id, and an unknown id are all indistinguishable from absent.
    for (const [token, operationID] of [
      [member.token, pending],
      [owner, hubOwned],
      [owner, randomUUID()],
    ] as const) {
      await expectProblem(
        await api.operationStatus(token, { operation_id: operationID }),
        404,
        "vetchium-problem-details/org-operation-not-found",
      );
    }
  } finally {
    cleanupOperations(operations);
    cleanupOrg(org.domain);
  }
});

test("Org operation status rejects bad requests, missing sessions, and suspended Orgs", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  const operations: string[] = [];
  try {
    const owner = await loginOrg(api, org);
    const operationID = seedOperation(
      "org_user",
      orgUserID(org.emailAddress),
      orgDID(org.domain),
      "pending",
    );
    operations.push(operationID);

    const unauthenticated = await api.operationStatus(undefined, {
      operation_id: operationID,
    });
    await expectProblem(
      unauthenticated,
      401,
      "vetchium-problem-details/org-authentication-required",
    );
    expect(unauthenticated.headers()["www-authenticate"]).toContain("Bearer");
    await expectProblem(
      await api.operationStatus(owner, { operation_id: "not-a-uuid" }),
      400,
      "vetchium-problem-details/validation-failed",
      ["operation_id"],
    );
    await expectProblem(
      await api.postRaw("/operations/status", "{not json", { token: owner }),
      400,
      "vetchium-problem-details/invalid-json",
    );

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended',
      suspended_at = now()
      WHERE org_did = ${sqlLiteral(orgDID(org.domain))}`);
    await expectProblem(
      await api.operationStatus(owner, { operation_id: operationID }),
      403,
      "vetchium-problem-details/org-suspended",
    );
  } finally {
    cleanupOperations(operations);
    cleanupOrg(org.domain);
  }
});
