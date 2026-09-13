import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { planRank, plans } from "../hub/subscriptions/plans.ts";

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
