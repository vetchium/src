import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type {
  ListOpeningTagsResponse,
  OpeningTag,
} from "typespec/common/opening_tags";
import { expectProblem } from "../lib/admin-api.ts";
import {
  cleanupHubUser,
  seedActiveHubUser,
  sqlScalarForTenant,
} from "../lib/admin-db.ts";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI } from "../lib/hub-api.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  signupOrg,
} from "../lib/orgs-api.ts";

function hubEmail(): string {
  return `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
}

async function expectCatalog(
  response: Awaited<ReturnType<HubAPI["listOpeningTags"]>>,
  endpoint: string,
): Promise<OpeningTag[]> {
  expect(response.status(), `${endpoint}: ${await response.text()}`).toBe(200);
  expect(response.headers()["cache-control"], endpoint).toBe("no-store");
  const { tags } = (await response.json()) as ListOpeningTagsResponse;
  expect(tags.length, endpoint).toBeLessThanOrEqual(500);
  const oids = tags.map((tag) => tag.tag_oid);
  expect(oids, endpoint).toEqual([...oids].sort());
  expect(
    tags.find((tag) => tag.tag_oid === "golang"),
    endpoint,
  ).toEqual({
    tag_oid: "golang",
    display_name: "Go",
    localized_names: {},
    deprecated: false,
  });
  expect(
    tags.find((tag) => tag.tag_oid === "artificial-intelligence"),
    endpoint,
  ).toMatchObject({
    deprecated: false,
    localized_names: {
      de: "Künstliche Intelligenz",
      ta: "செயற்கை நுண்ணறிவு",
    },
  });
  return tags;
}

test("list-opening-tags on orgs-api and hub-api returns the seeded catalog", async ({
  request,
}) => {
  const orgsAPI = new OrgsAPI(request, "sgp");
  const hub = new HubAPI(request, "sgp");
  const email = hubEmail();
  const org = await signupOrg(orgsAPI);
  try {
    const owner = await loginOrg(orgsAPI, org);
    const viewer = seedActiveHubUser("sgp", email, "Tag Reader");
    await expectCatalog(
      await orgsAPI.listOpeningTags(owner),
      "orgs list-opening-tags",
    );
    await expectCatalog(
      await hub.listOpeningTags(viewer.sessionToken),
      "hub list-opening-tags",
    );
  } finally {
    cleanupHubUser(email, "sgp");
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("list-opening-tags on orgs-api and hub-api includes deprecated tags", async ({
  request,
}) => {
  const orgsAPI = new OrgsAPI(request, "sgp");
  const hub = new HubAPI(request, "sgp");
  const email = hubEmail();
  const oid = `test-${randomUUID()}`;
  const org = await signupOrg(orgsAPI);
  try {
    const owner = await loginOrg(orgsAPI, org);
    const viewer = seedActiveHubUser("sgp", email, "Tag Reader");
    sqlScalarForTenant(
      "sgp",
      `INSERT INTO vetchium.opening_tags (tag_oid, display_name, deprecated)
        VALUES ('${oid}', 'Retired test tag', true)`,
    );
    const expected = {
      tag_oid: oid,
      display_name: "Retired test tag",
      localized_names: {},
      deprecated: true,
    };
    for (const [endpoint, response] of [
      ["orgs list-opening-tags", await orgsAPI.listOpeningTags(owner)],
      ["hub list-opening-tags", await hub.listOpeningTags(viewer.sessionToken)],
    ] as const) {
      const tags = await expectCatalog(response, endpoint);
      expect(
        tags.find((tag) => tag.tag_oid === oid),
        endpoint,
      ).toEqual(expected);
    }
  } finally {
    sqlScalarForTenant(
      "sgp",
      `DELETE FROM vetchium.opening_tags WHERE tag_oid = '${oid}'`,
    );
    cleanupHubUser(email, "sgp");
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("list-opening-tags on hub-api refuses malformed and unauthenticated requests", async ({
  request,
}) => {
  const hub = new HubAPI(request, "sgp");
  const email = hubEmail();
  try {
    const viewer = seedActiveHubUser("sgp", email, "Tag Reader");
    await expectProblem(
      await hub.postRaw("/list-opening-tags", "{", {
        token: viewer.sessionToken,
      }),
      400,
      "vetchium-problem-details/invalid-json",
    );
    await expectProblem(
      await hub.post("/list-opening-tags", {}),
      401,
      "vetchium-problem-details/hub-authentication-required",
    );
  } finally {
    cleanupHubUser(email, "sgp");
  }
});

test("list-opening-tags on orgs-api refuses malformed, unauthenticated, and suspended-Org requests", async ({
  request,
}) => {
  const api = new OrgsAPI(request, "sgp");
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await expectProblem(
      await api.postRaw("/list-opening-tags", "{", { token: owner }),
      400,
      "vetchium-problem-details/invalid-json",
    );
    await expectProblem(
      await api.post("/list-opening-tags", {}),
      401,
      "vetchium-problem-details/org-authentication-required",
    );
    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')`);
    await expectProblem(
      await api.listOpeningTags(owner),
      403,
      "vetchium-problem-details/org-suspended",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
