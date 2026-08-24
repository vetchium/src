import type { GenerateShortIDResponse } from "typespec/global-coordinator/global-coordinator";
import { isShortID } from "typespec/global-coordinator/global-coordinator";
import { expect, test } from "../lib/admin-fixtures.ts";

const coordinatorURL =
  process.env.GLOBAL_COORDINATOR_TEST_URL ??
  `http://127.0.0.1:${process.env.GLOBAL_COORDINATOR_PORT ?? "18080"}`;
const credential =
  process.env.GLOBAL_COORDINATOR_CREDENTIAL ??
  "dev_global_coordinator_credential_32_bytes";
const path = "/api/global-coordinator/generate-short-id";

test("global coordinator generates unique fixed-width short IDs", async ({
  request,
}) => {
  const headers = { Authorization: `Bearer ${credential}` };
  const first = await request.post(`${coordinatorURL}${path}`, { headers });
  expect(first.status()).toBe(201);
  expect(first.headers()["cache-control"]).toBe("no-store");
  const firstBody = (await first.json()) as GenerateShortIDResponse;
  expect(isShortID(firstBody.short_id)).toBe(true);

  const second = await request.post(`${coordinatorURL}${path}`, { headers });
  expect(second.status()).toBe(201);
  const secondBody = (await second.json()) as GenerateShortIDResponse;
  expect(isShortID(secondBody.short_id)).toBe(true);
  expect(secondBody.short_id).not.toBe(firstBody.short_id);
});

test("global coordinator rejects missing authentication", async ({
  request,
}) => {
  const response = await request.post(`${coordinatorURL}${path}`);
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe(
    'Bearer realm="global-coordinator"',
  );
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  await expect(response.json()).resolves.toMatchObject({
    type: "vetchium-problem-details/global-coordinator-authentication-required",
    status: 401,
  });
});
