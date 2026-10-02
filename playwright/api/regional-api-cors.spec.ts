import { type APIRequestContext, expect, test } from "@playwright/test";
import type { TestTenant } from "../lib/admin-db.ts";
import { apiOrigin, HUB_PORTAL, ORGS_PORTAL } from "../lib/portals.ts";

const tenants: TestTenant[] = ["sgp", "usa1", "deu", "ind1"];

// Each portal's API prefix admits only that portal's origin.
const prefixes = [
  { prefix: "/api/hub", allowed: HUB_PORTAL, otherPortal: ORGS_PORTAL },
  { prefix: "/api/orgs", allowed: ORGS_PORTAL, otherPortal: HUB_PORTAL },
] as const;

function preflight(request: APIRequestContext, url: string, origin: string) {
  return request.fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "authorization,content-type,idempotency-key",
    },
  });
}

function headerList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

for (const tenant of tenants) {
  for (const { prefix, allowed, otherPortal } of prefixes) {
    const url = `${apiOrigin(tenant)}${prefix}/login`;

    test(`${tenant} ${prefix} preflight admits its own portal`, async ({
      request,
    }) => {
      const response = await preflight(request, url, allowed);
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);
      const headers = response.headers();
      expect(headers["access-control-allow-origin"]).toBe(allowed);
      expect(headerList(headers["access-control-allow-methods"])).toEqual(
        expect.arrayContaining(["get", "post"]),
      );
      expect(headerList(headers["access-control-allow-methods"])).toHaveLength(
        2,
      );
      expect(headerList(headers["access-control-allow-headers"])).toEqual(
        expect.arrayContaining([
          "authorization",
          "content-type",
          "idempotency-key",
        ]),
      );
      expect(headers["access-control-max-age"]).toBe("86400");
      expect(headers).not.toHaveProperty("access-control-allow-credentials");
    });

    test(`${tenant} ${prefix} admits no foreign origin`, async ({
      request,
    }) => {
      for (const origin of [
        otherPortal,
        "http://evil.example",
        `http://${tenant}.api.vetchium.localhost`,
        `${allowed}.evil.example`,
      ]) {
        const response = await preflight(request, url, origin);
        expect(
          response.headers(),
          `preflight from ${origin}`,
        ).not.toHaveProperty("access-control-allow-origin");

        const actual = await request.post(url, {
          headers: { Origin: origin },
          data: {},
        });
        expect(actual.status()).toBe(400);
        expect(actual.headers(), `request from ${origin}`).not.toHaveProperty(
          "access-control-allow-origin",
        );
      }
    });

    test(`${tenant} ${prefix} response is readable by its own portal`, async ({
      request,
    }) => {
      const response = await request.post(url, {
        headers: { Origin: allowed },
        data: {},
      });
      expect(response.status()).toBe(400);
      expect(response.headers()["access-control-allow-origin"]).toBe(allowed);
      expect(headerList(response.headers().vary)).toContain("origin");
    });
  }
}
