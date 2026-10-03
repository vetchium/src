import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { planRank, plans } from "../hub/subscriptions/plans.ts";
import {
  impliedPermissions,
  orgPermissions,
} from "../orgs/authorization/types.ts";
import {
  entitlements,
  planRank as orgPlanRank,
  plans as orgPlans,
} from "../orgs/subscriptions/plans.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the compiled OpenAPI document carries the Hub plan extensions", async () => {
  const document = JSON.parse(
    await readFile(
      path.join(root, "tsp-output", "schema", "openapi.json"),
      "utf8",
    ),
  );
  const schema = document.components.schemas["Hub.HubPlanOID"];
  assert.ok(schema, "components.schemas['Hub.HubPlanOID'] is missing");
  assert.deepEqual(schema["x-vetchium-known-values"], plans);
  const wantRanks: Record<string, number> = {};
  for (const plan of plans) wantRanks[plan] = planRank(plan);
  assert.deepEqual(schema["x-vetchium-plan-ranks"], wantRanks);
});

async function orgSchema(name: string) {
  const document = JSON.parse(
    await readFile(
      path.join(root, "tsp-output", "schema", "openapi.json"),
      "utf8",
    ),
  );
  const schema = document.components.schemas[`Orgs.${name}`];
  assert.ok(schema, `components.schemas['Orgs.${name}'] is missing`);
  return schema;
}

test("the compiled OpenAPI document carries the Org plan extensions", async () => {
  const schema = await orgSchema("OrgPlanOID");
  assert.deepEqual(schema["x-vetchium-known-values"], orgPlans);
  const wantRanks: Record<string, number> = {};
  const wantEntitlements: Record<string, unknown> = {};
  for (const plan of orgPlans) {
    wantRanks[plan] = orgPlanRank(plan);
    const held = entitlements[plan];
    wantEntitlements[plan] = {
      max_users: held.maxUsers,
      max_users_with_google_sign_in: held.maxUsersWithGoogleSignIn,
      openings_per_year: held.openingsPerYear,
      allows_logo: held.allowsLogo,
      allows_google_sign_in: held.allowsGoogleSignIn,
      includes_ticket_support: held.includesTicketSupport,
    };
  }
  assert.deepEqual(schema["x-vetchium-plan-ranks"], wantRanks);
  assert.deepEqual(schema["x-vetchium-plan-entitlements"], wantEntitlements);
});

test("the compiled OpenAPI document carries the Org permission extensions", async () => {
  const schema = await orgSchema("OrgPermissionID");
  assert.deepEqual(
    [...schema["x-vetchium-known-values"]].sort(),
    [...orgPermissions].sort(),
  );
  const wantImplications: Record<string, string[]> = {};
  for (const permission of orgPermissions) {
    const implied = impliedPermissions(permission);
    if (implied.length > 0) wantImplications[permission] = [...implied];
  }
  assert.deepEqual(
    schema["x-vetchium-permission-implications"],
    wantImplications,
  );
});
