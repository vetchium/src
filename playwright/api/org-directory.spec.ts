import { randomUUID } from "node:crypto";
import type { APIRequest } from "@playwright/test";
import type {
  OrgPrincipalCommandResponse,
  ResolveOrgDomainResponse,
} from "typespec/directory/directory";
import { globalSQLScalar, type TestTenant } from "../lib/admin-db.ts";
import { type APIObservation, expect, test } from "../lib/admin-fixtures.ts";
import { coordinator, coordinatorContext } from "../lib/coordinator.ts";
import { uniqueOrgDomain } from "../lib/dev-dns.ts";
import { meshRelayRequest } from "../lib/mesh.ts";

const ROUTES = [
  "resolve-org-domain",
  "reserve-org-principal",
  "activate-org-principal",
  "release-org-domain",
  "claim-org-domain",
] as const;
type Route = (typeof ROUTES)[number];

interface Result {
  status: number;
  body: unknown;
}

/** One way to reach the directory as a tenant: the coordinator over mTLS,
 * or the tenant's own mesh relay, which forwards over mTLS. */
type Call = (
  tenant: TestTenant,
  route: Route,
  body: unknown,
) => Promise<Result>;

function viaCoordinator(
  apiRequest: APIRequest,
  observations: APIObservation[],
): Call {
  return async (tenant, route, body) => {
    const context = await coordinatorContext(apiRequest, tenant, observations);
    try {
      const response = await context.post(
        `${coordinator}/api/global-coordinator/directory/${route}`,
        { data: body },
      );
      return { status: response.status(), body: await response.json() };
    } finally {
      await context.dispose();
    }
  };
}

function viaMesh(observations: APIObservation[]): Call {
  return async (tenant, route, body) =>
    meshRelayRequest(tenant, `/mesh/directory/${route}`, body, observations);
}

function orgDID(): string {
  return `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function reservation(tenant: string, domain: string, did = orgDID()) {
  return {
    command_id: randomUUID(),
    org_did: did,
    domain,
    home_tenant_id: tenant,
    provisioning_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function cleanup(dids: string[]): void {
  if (dids.length === 0) return;
  const list = dids.map((did) => `'${did}'`).join(",");
  globalSQLScalar(`
    DELETE FROM vetchium.org_domains WHERE org_did IN (${list});
    DELETE FROM vetchium.global_audit_events
    WHERE entity_type = 'org_principal' AND entity_id IN (${list});
    DELETE FROM vetchium.global_outbox_events
    WHERE aggregate_type = 'org_principal' AND aggregate_id IN (${list});
    DELETE FROM vetchium.org_principals WHERE org_did IN (${list});
  `);
}

function expectProblem(result: Result, status: number, type: string): void {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(result.body).toMatchObject({ type, status });
}

function expectOrg(
  result: Result,
  state: "provisioning" | "active",
  domain: string | null,
): OrgPrincipalCommandResponse {
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const body = result.body as OrgPrincipalCommandResponse;
  expect(body.state).toBe(state);
  expect(body.domain).toBe(domain);
  return body;
}

async function activeOrg(call: Call, tenant: TestTenant, domain: string) {
  const reserve = reservation(tenant, domain);
  expectOrg(
    await call(tenant, "reserve-org-principal", reserve),
    "provisioning",
    domain,
  );
  expectOrg(
    await call(tenant, "activate-org-principal", {
      command_id: randomUUID(),
      org_did: reserve.org_did,
    }),
    "active",
    domain,
  );
  return reserve.org_did;
}

function invalidBody(route: Route): unknown {
  switch (route) {
    case "resolve-org-domain":
      return { domain: "localhost" };
    case "activate-org-principal":
      return { command_id: "not-a-uuid", org_did: orgDID() };
    case "reserve-org-principal":
      return { ...reservation("sgp", "example.com"), command_id: "not-a-uuid" };
    default:
      return { command_id: "not-a-uuid", org_did: orgDID(), domain: "a.b" };
  }
}

const transports = [
  {
    name: "coordinator",
    make: (apiRequest: APIRequest, observations: APIObservation[]) =>
      viaCoordinator(apiRequest, observations),
  },
  {
    name: "mesh relay",
    make: (_: APIRequest, observations: APIObservation[]) =>
      viaMesh(observations),
  },
] as const;

for (const transport of transports) {
  test.describe(`Org directory via ${transport.name}`, () => {
    test("rejects malformed and invalid requests", async ({
      apiCoverage,
      playwright,
    }) => {
      const call = transport.make(playwright.request, apiCoverage);
      for (const route of ROUTES) {
        expectProblem(
          await call("sgp", route, { unexpected: true }),
          400,
          "vetchium-problem-details/invalid-json",
        );
        expectProblem(
          await call("sgp", route, invalidBody(route)),
          400,
          "vetchium-problem-details/validation-failed",
        );
      }
    });

    test("reserves, activates, resolves, releases and re-claims", async ({
      apiCoverage,
      playwright,
    }) => {
      const call = transport.make(playwright.request, apiCoverage);
      const domain = uniqueOrgDomain();
      const dids: string[] = [];
      try {
        const reserve = reservation("sgp", domain);
        dids.push(reserve.org_did);
        expectOrg(
          await call("sgp", "reserve-org-principal", reserve),
          "provisioning",
          domain,
        );
        expectOrg(
          await call("sgp", "reserve-org-principal", reserve),
          "provisioning",
          domain,
        );
        expectProblem(
          await call("sgp", "reserve-org-principal", {
            ...reserve,
            domain: uniqueOrgDomain(),
          }),
          409,
          "vetchium-problem-details/idempotency-key-conflict",
        );
        expectProblem(
          await call("sgp", "resolve-org-domain", { domain }),
          404,
          "vetchium-problem-details/directory-entry-not-found",
        );
        expectProblem(
          await call("usa1", "activate-org-principal", {
            command_id: randomUUID(),
            org_did: reserve.org_did,
          }),
          403,
          "vetchium-problem-details/directory-caller-tenant-mismatch",
        );
        expectOrg(
          await call("sgp", "activate-org-principal", {
            command_id: randomUUID(),
            org_did: reserve.org_did,
          }),
          "active",
          domain,
        );
        const resolved = await call("usa1", "resolve-org-domain", { domain });
        expect(resolved.status).toBe(200);
        expect(resolved.body as ResolveOrgDomainResponse).toMatchObject({
          org_did: reserve.org_did,
          domain,
          home_tenant_id: "sgp",
        });

        const release = {
          command_id: randomUUID(),
          org_did: reserve.org_did,
          domain,
        };
        expectProblem(
          await call("deu", "release-org-domain", {
            ...release,
            command_id: randomUUID(),
          }),
          403,
          "vetchium-problem-details/directory-caller-tenant-mismatch",
        );
        expectOrg(
          await call("sgp", "release-org-domain", release),
          "active",
          null,
        );
        expectOrg(
          await call("sgp", "release-org-domain", {
            ...release,
            command_id: randomUUID(),
          }),
          "active",
          null,
        );
        const claim = {
          command_id: randomUUID(),
          org_did: reserve.org_did,
          domain,
        };
        expectOrg(
          await call("sgp", "claim-org-domain", claim),
          "active",
          domain,
        );

        // A command id replayed with a different body is refused on every
        // command, whatever its first outcome was.
        for (const [route, first] of [
          ["claim-org-domain", claim],
          ["release-org-domain", release],
          [
            "activate-org-principal",
            { command_id: randomUUID(), org_did: reserve.org_did },
          ],
        ] as const) {
          if (route === "activate-org-principal") {
            await call("sgp", route, first);
          }
          expectProblem(
            await call("sgp", route, { ...first, org_did: orgDID() }),
            409,
            "vetchium-problem-details/idempotency-key-conflict",
          );
        }
      } finally {
        cleanup(dids);
      }
    });

    test("refuses competing claims and wrong lifecycle states", async ({
      apiCoverage,
      playwright,
    }) => {
      const call = transport.make(playwright.request, apiCoverage);
      const domain = uniqueOrgDomain();
      const other = uniqueOrgDomain();
      const dids: string[] = [];
      try {
        const owner = await activeOrg(call, "sgp", domain);
        dids.push(owner);
        const rival = reservation("deu", domain);
        dids.push(rival.org_did);
        expectProblem(
          await call("deu", "reserve-org-principal", rival),
          409,
          "vetchium-problem-details/directory-claim-conflict",
        );
        expectProblem(
          await call("deu", "reserve-org-principal", {
            ...reservation("sgp", other),
          }),
          403,
          "vetchium-problem-details/directory-caller-tenant-mismatch",
        );
        const expired = {
          ...reservation("deu", other),
          provisioning_expires_at: new Date(Date.now() - 60_000).toISOString(),
        };
        dids.push(expired.org_did);
        expectProblem(
          await call("deu", "reserve-org-principal", expired),
          409,
          "vetchium-problem-details/directory-state-conflict",
        );
        expectProblem(
          await call("sgp", "activate-org-principal", {
            command_id: randomUUID(),
            org_did: orgDID(),
          }),
          409,
          "vetchium-problem-details/directory-state-conflict",
        );
        expectProblem(
          await call("sgp", "release-org-domain", {
            command_id: randomUUID(),
            org_did: orgDID(),
            domain,
          }),
          409,
          "vetchium-problem-details/directory-state-conflict",
        );

        const second = await activeOrg(call, "deu", other);
        dids.push(second);
        expectProblem(
          await call("deu", "claim-org-domain", {
            command_id: randomUUID(),
            org_did: second,
            domain,
          }),
          409,
          "vetchium-problem-details/directory-state-conflict",
        );
        expectOrg(
          await call("deu", "release-org-domain", {
            command_id: randomUUID(),
            org_did: second,
            domain: other,
          }),
          "active",
          null,
        );
        expectProblem(
          await call("deu", "claim-org-domain", {
            command_id: randomUUID(),
            org_did: second,
            domain,
          }),
          409,
          "vetchium-problem-details/directory-claim-conflict",
        );
        expectProblem(
          await call("sgp", "claim-org-domain", {
            command_id: randomUUID(),
            org_did: second,
            domain: other,
          }),
          403,
          "vetchium-problem-details/directory-caller-tenant-mismatch",
        );
      } finally {
        cleanup(dids);
      }
    });
  });
}

test("the coordinator refuses a non-tenant certificate on every Org route", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "health",
    apiCoverage,
  );
  try {
    for (const route of ROUTES) {
      const response = await context.post(
        `${coordinator}/api/global-coordinator/directory/${route}`,
        { data: {} },
      );
      expect(response.status()).toBe(401);
      expect(response.headers()["www-authenticate"]).toBe(
        'MutualTLS realm="global-coordinator"',
      );
    }
  } finally {
    await context.dispose();
  }
});

test("the mesh relay refuses a missing or wrong credential on every Org route", async ({
  apiCoverage,
}) => {
  for (const route of ROUTES) {
    for (const authorization of [null, "wrong-credential"]) {
      const result = meshRelayRequest(
        "sgp",
        `/mesh/directory/${route}`,
        {},
        apiCoverage,
        { authorization },
      );
      expectProblem(
        result,
        401,
        "vetchium-problem-details/mesh-relay-authentication-required",
      );
    }
  }
});
