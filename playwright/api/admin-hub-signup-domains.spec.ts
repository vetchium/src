import { randomBytes, randomUUID } from "node:crypto";
import type {
  Domain,
  ListResponse,
} from "typespec/admin/hub-signup-domains/domains";
import {
  HubSignupDomainAlreadyExistsError,
  HubSignupDomainNotFoundError,
} from "typespec/problem/admin/hub-signup-domains";
import { AdminAPI, expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  createSeededManagerSession,
  ISOLATED_TENANT,
  isolatedTenantBaseURL,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

async function createDomain(
  adminAPI: AdminAPI,
  managerToken: string,
  domain: string,
  state: "active" | "disabled" = "active",
  disabledComment = state === "disabled"
    ? "Created disabled for testing"
    : undefined,
): Promise<Domain> {
  const response = await adminAPI.post(
    "/create-hub-signup-domain",
    { domain, state, disabled_comment: disabledComment },
    { token: managerToken },
  );
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return responseJSON<Domain>(response);
}

test.describe("Admin Hub signup domain allowlist", () => {
  test("a manager can create, list, edit, disable, and reactivate a domain", async ({
    adminAPI,
    managerToken,
    ownedDomain,
  }) => {
    const original = ownedDomain("crud");
    const replacement = ownedDomain("replacement");
    const createdResponse = await adminAPI.post(
      "/create-hub-signup-domain",
      { domain: `  ${original.toUpperCase()}.  ` },
      { token: managerToken },
    );
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    expect(createdResponse.headers()["cache-control"]).toBe("no-store");
    const created = await responseJSON<Domain>(createdResponse);
    expect(created).toMatchObject({ domain: original, state: "active" });
    expect(created.hub_signup_domain_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(created.created_at))).toBe(false);
    expect(Number.isNaN(Date.parse(created.updated_at))).toBe(false);
    expect(created.created_at.endsWith("Z")).toBe(true);
    expect(created.updated_at.endsWith("Z")).toBe(true);

    const listedResponse = await adminAPI.post(
      "/list-hub-signup-domains",
      { filter_search: original.toUpperCase() },
      { token: managerToken },
    );
    expect(listedResponse.status(), await listedResponse.text()).toBe(200);
    expect(listedResponse.headers()["cache-control"]).toBe("no-store");
    expect((await responseJSON<ListResponse>(listedResponse)).domains).toEqual([
      created,
    ]);

    const updatedResponse = await adminAPI.post(
      "/update-hub-signup-domain",
      {
        hub_signup_domain_id: created.hub_signup_domain_id,
        domain: replacement.toUpperCase(),
        state: "disabled",
        disabled_comment: "  Corporate access was suspended  ",
      },
      { token: managerToken },
    );
    expect(updatedResponse.status(), await updatedResponse.text()).toBe(200);
    const updated = await responseJSON<Domain>(updatedResponse);
    expect(updated).toMatchObject({
      hub_signup_domain_id: created.hub_signup_domain_id,
      domain: replacement,
      state: "disabled",
      disabled_comment: "Corporate access was suspended",
      created_at: created.created_at,
    });
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(created.updated_at),
    );

    const oldName = await responseJSON<ListResponse>(
      await adminAPI.post(
        "/list-hub-signup-domains",
        { filter_search: original },
        { token: managerToken },
      ),
    );
    expect(oldName.domains).toEqual([]);
    const disabled = await responseJSON<ListResponse>(
      await adminAPI.post(
        "/list-hub-signup-domains",
        { filter_search: replacement, filter_state: "disabled" },
        { token: managerToken },
      ),
    );
    expect(disabled.domains).toMatchObject([
      {
        hub_signup_domain_id: created.hub_signup_domain_id,
        disabled_comment: "Corporate access was suspended",
      },
    ]);
    await expectProblem(
      await adminAPI.post(
        "/create-hub-signup-domain",
        { domain: replacement },
        { token: managerToken },
      ),
      409,
      HubSignupDomainAlreadyExistsError.type,
    );

    const reactivatedResponse = await adminAPI.post(
      "/update-hub-signup-domain",
      {
        hub_signup_domain_id: created.hub_signup_domain_id,
        domain: replacement,
        state: "active",
      },
      { token: managerToken },
    );
    expect(reactivatedResponse.status(), await reactivatedResponse.text()).toBe(
      200,
    );
    const reactivated = await responseJSON<Domain>(reactivatedResponse);
    expect(reactivated).toMatchObject({
      hub_signup_domain_id: created.hub_signup_domain_id,
      state: "active",
    });
    expect(reactivated.disabled_comment).toBeUndefined();
  });

  test("list filtering and pagination are stable and filter-bound", async ({
    adminAPI,
    managerToken,
    ownedDomain,
  }) => {
    const marker = randomBytes(6).toString("hex");
    const domains = [
      ownedDomain(marker),
      ownedDomain(marker),
      ownedDomain(marker),
    ];
    await Promise.all([
      createDomain(adminAPI, managerToken, domains[0] ?? "", "active"),
      createDomain(adminAPI, managerToken, domains[1] ?? "", "disabled"),
      createDomain(adminAPI, managerToken, domains[2] ?? "", "active"),
    ]);

    const firstResponse = await adminAPI.post(
      "/list-hub-signup-domains",
      { limit: 1, filter_search: marker, filter_state: "active" },
      { token: managerToken },
    );
    const first = await responseJSON<ListResponse>(firstResponse);
    expect(first.domains).toHaveLength(1);
    expect(first.next_pagination_key).toBeDefined();
    const second = await responseJSON<ListResponse>(
      await adminAPI.post(
        "/list-hub-signup-domains",
        {
          limit: 1,
          pagination_key: first.next_pagination_key,
          filter_search: marker,
          filter_state: "active",
        },
        { token: managerToken },
      ),
    );
    expect(second.domains).toHaveLength(1);
    expect(second.next_pagination_key).toBeUndefined();
    const activeNames = [...first.domains, ...second.domains].map(
      (entry) => entry.domain,
    );
    expect(new Set(activeNames).size).toBe(2);

    await expectProblem(
      await adminAPI.post(
        "/list-hub-signup-domains",
        {
          limit: 1,
          pagination_key: first.next_pagination_key,
          filter_search: marker,
          filter_state: "disabled",
        },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
    await expectProblem(
      await adminAPI.post(
        "/list-hub-signup-domains",
        { pagination_key: "tampered" },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
  });

  test("normalized duplicates and write conflicts have stable responses", async ({
    adminAPI,
    managerToken,
    ownedDomain,
  }) => {
    const firstName = ownedDomain("conflict-a");
    const secondName = ownedDomain("conflict-b");
    const first = await createDomain(adminAPI, managerToken, firstName);
    const second = await createDomain(adminAPI, managerToken, secondName);

    await expectProblem(
      await adminAPI.post(
        "/create-hub-signup-domain",
        { domain: ` ${firstName.toUpperCase()}. ` },
        { token: managerToken },
      ),
      409,
      HubSignupDomainAlreadyExistsError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/update-hub-signup-domain",
        {
          hub_signup_domain_id: first.hub_signup_domain_id,
          domain: secondName,
          state: "active",
        },
        { token: managerToken },
      ),
      409,
      HubSignupDomainAlreadyExistsError.type,
    );
    const unchanged = await responseJSON<ListResponse>(
      await adminAPI.post(
        "/list-hub-signup-domains",
        { filter_search: firstName },
        { token: managerToken },
      ),
    );
    expect(unchanged.domains).toMatchObject([
      { hub_signup_domain_id: first.hub_signup_domain_id, domain: firstName },
    ]);

    const concurrentName = ownedDomain("conflict-race");
    const concurrentResponses = await Promise.all(
      [first, second].map((entry) =>
        adminAPI.post(
          "/update-hub-signup-domain",
          {
            hub_signup_domain_id: entry.hub_signup_domain_id,
            domain: concurrentName,
            state: "active",
          },
          { token: managerToken },
        ),
      ),
    );
    expect(
      concurrentResponses.map((response) => response.status()).sort(),
    ).toEqual([200, 409]);
    const concurrentConflict = concurrentResponses.find(
      (response) => response.status() === 409,
    );
    if (concurrentConflict === undefined) {
      throw new Error("concurrent update did not return a conflict");
    }
    await expectProblem(
      concurrentConflict,
      409,
      HubSignupDomainAlreadyExistsError.type,
    );

    const missingID = randomUUID();
    await expectProblem(
      await adminAPI.post(
        "/update-hub-signup-domain",
        {
          hub_signup_domain_id: missingID,
          domain: ownedDomain("missing-update"),
          state: "active",
        },
        { token: managerToken },
      ),
      404,
      HubSignupDomainNotFoundError.type,
    );
    expect(second.domain).toBe(secondName);
  });

  test("domain, state, identifier, and list bounds reject edge cases", async ({
    adminAPI,
    managerToken,
  }) => {
    const invalidDomains = [
      "",
      "localhost",
      "*.example.com",
      "user@example.com",
      "https://example.com",
      "example.com:443",
      "127.0.0.1",
      "example.123",
      "example..com",
      "-example.com",
      "example-.com",
      "bücher.example",
      `${"a".repeat(64)}.example`,
      `${"a".repeat(246)}.example`,
    ];
    for (const domain of invalidDomains) {
      await expectProblem(
        await adminAPI.post(
          "/create-hub-signup-domain",
          { domain },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["domain"],
      );
    }
    await expectProblem(
      await adminAPI.post(
        "/create-hub-signup-domain",
        { domain: "valid.example", state: "retired" },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["state"],
    );
    for (const body of [
      { domain: "missing-comment.example", state: "disabled" },
      {
        domain: "blank-comment.example",
        state: "disabled",
        disabled_comment: "   ",
      },
      {
        domain: "active-comment.example",
        state: "active",
        disabled_comment: "This should not be accepted",
      },
      {
        domain: "long-comment.example",
        state: "disabled",
        disabled_comment: "界".repeat(501),
      },
    ]) {
      await expectProblem(
        await adminAPI.post("/create-hub-signup-domain", body, {
          token: managerToken,
        }),
        400,
        "vetchium-problem-details/validation-failed",
        ["disabled_comment"],
      );
    }
    await expectProblem(
      await adminAPI.post(
        "/update-hub-signup-domain",
        {
          hub_signup_domain_id: "not-a-uuid",
          domain: "bad",
          state: "retired",
        },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["hub_signup_domain_id", "domain", "state"],
    );
    await expectProblem(
      await adminAPI.post(
        "/list-hub-signup-domains",
        {
          limit: 101,
          pagination_key: "",
          filter_search: "%",
          filter_state: "retired",
        },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["limit", "pagination_key", "filter_search", "filter_state"],
    );
  });

  test("view and manage permissions enforce separate security boundaries", async ({
    adminAPI,
    createAdmin,
    managerToken,
    ownedDomain,
  }) => {
    const viewer = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: viewer.adminUserID,
            permissions: ["admin:view_hub_signup_domains"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/list-hub-signup-domains",
          {},
          { token: viewer.sessionToken },
        )
      ).status(),
    ).toBe(200);
    await expectProblem(
      await adminAPI.post(
        "/create-hub-signup-domain",
        { domain: ownedDomain("viewer") },
        { token: viewer.sessionToken },
      ),
      403,
      "vetchium-problem-details/admin-permission-required",
    );

    const manager = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: manager.adminUserID,
            permissions: ["admin:manage_hub_signup_domains"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/list-hub-signup-domains",
          {},
          { token: manager.sessionToken },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await adminAPI.post(
          "/create-hub-signup-domain",
          { domain: ownedDomain("manager") },
          { token: manager.sessionToken },
        )
      ).status(),
    ).toBe(201);

    const unassigned = await createAdmin();
    for (const path of [
      "/list-hub-signup-domains",
      "/create-hub-signup-domain",
      "/update-hub-signup-domain",
    ]) {
      await expectProblem(
        await adminAPI.post(path, {}, { token: unassigned.sessionToken }),
        403,
        "vetchium-problem-details/admin-permission-required",
      );
    }
  });

  test("an allowlist entry is isolated to its tenant", async ({
    adminAPI,
    managerToken,
    ownedDomain,
    playwright,
  }) => {
    const domain = ownedDomain("tenant");
    await createDomain(adminAPI, managerToken, domain);

    const context = await playwright.request.newContext({
      baseURL: isolatedTenantBaseURL(),
    });
    const isolatedAPI = new AdminAPI(context);
    const token = createSeededManagerSession(ISOLATED_TENANT);
    try {
      const response = await isolatedAPI.post(
        "/list-hub-signup-domains",
        { filter_search: domain },
        { token },
      );
      expect(response.status(), await response.text()).toBe(200);
      expect((await responseJSON<ListResponse>(response)).domains).toEqual([]);
    } finally {
      await isolatedAPI.post("/logout", undefined, { token });
      await context.dispose();
    }
  });
});
