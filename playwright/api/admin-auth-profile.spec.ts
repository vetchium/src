import {
  AuthenticationStateAuthenticated,
  type LoginAuthenticatedResponse,
  type ReauthenticateResponse,
} from "typespec/admin/auth/login";
import type { MyInfoResponse } from "typespec/admin/users/profile";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { ageSession } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test.describe("Admin authentication", () => {
  test("password login returns a no-store authenticated session", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const response = await adminAPI.post("/login", {
      email_address: `  ${admin.emailAddress.toUpperCase()}  `,
      password: admin.password,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await responseJSON<LoginAuthenticatedResponse>(response);
    expect(body.authentication_state).toBe(AuthenticationStateAuthenticated);
    expect(body.session_token).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(body.session_expires_at)).toBeGreaterThan(Date.now());
    await adminAPI.post("/logout", undefined, { token: body.session_token });
  });

  test("wrong credentials are indistinguishable for known and unknown users", async ({
    adminAPI,
    createAdmin,
    ownedEmail,
  }) => {
    const admin = await createAdmin();
    for (const email_address of [admin.emailAddress, ownedEmail()]) {
      const response = await adminAPI.post("/login", {
        email_address,
        password: "wrong-password",
      });
      await expectProblem(
        response,
        401,
        "vetchium-problem-details/invalid-credentials",
      );
      expect(response.headers()["www-authenticate"]).toBe(
        'VetchiumLogin realm="admin"',
      );
    }
  });

  test("a disabled administrator receives the declared login response", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const admin = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/disable-user",
          { admin_user_id: admin.adminUserID },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post("/login", {
        email_address: admin.emailAddress,
        password: admin.password,
      }),
      403,
      "vetchium-problem-details/admin-user-disabled",
    );
  });

  test("login rejects malformed, unknown, trailing, and structurally invalid JSON", async ({
    request,
  }) => {
    const base = "/api/admin/login";
    const malformed = await request.post(base, {
      data: "{",
      headers: { "Content-Type": "application/json" },
    });
    await expectProblem(
      malformed,
      400,
      "vetchium-problem-details/invalid-json",
    );

    const unknown = await request.post(base, {
      data: {
        email_address: "e2e+unknown-json@example.test",
        password: "valid-shape-password",
        extra: true,
      },
    });
    await expectProblem(unknown, 400, "vetchium-problem-details/invalid-json");

    const invalid = await request.post(base, {
      data: { email_address: "not-an-email", password: "" },
    });
    await expectProblem(
      invalid,
      400,
      "vetchium-problem-details/validation-failed",
      ["email_address", "password"],
    );

    const trailing = await request.post(base, {
      data: Buffer.from(
        '{"email_address":"e2e+trailing@example.test","password":"valid-password"} {}',
      ),
      headers: { "Content-Type": "application/json" },
    });
    await expectProblem(trailing, 400, "vetchium-problem-details/invalid-json");
  });

  test("logout is anonymous, idempotent, and invalidates a supplied session", async ({
    adminAPI,
    managerToken,
  }) => {
    expect((await adminAPI.post("/logout")).status()).toBe(204);
    expect(
      (
        await adminAPI.post("/logout", undefined, { token: "not-a-token" })
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post("/logout", undefined, { token: managerToken })
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post("/logout", undefined, { token: managerToken })
      ).status(),
    ).toBe(204);
    const denied = await adminAPI.get("/my-info", managerToken);
    await expectProblem(
      denied,
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    expect(denied.headers()["www-authenticate"]).toBe('Bearer realm="admin"');
  });

  test("reauthentication refreshes the current session without replacing it", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    ageSession(admin.sessionToken);

    await expectProblem(
      await adminAPI.post(
        "/reauthenticate",
        { password: "incorrect-password" },
        { token: admin.sessionToken },
      ),
      422,
      "vetchium-problem-details/incorrect-password",
    );
    expect((await adminAPI.get("/my-info", admin.sessionToken)).status()).toBe(
      200,
    );

    const response = await adminAPI.post(
      "/reauthenticate",
      { password: admin.password },
      { token: admin.sessionToken },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const refreshed = await responseJSON<ReauthenticateResponse>(response);
    expect(refreshed.session_authenticated_at).toMatch(/Z$/);

    const info = await responseJSON<MyInfoResponse>(
      await adminAPI.get("/my-info", admin.sessionToken),
    );
    expect(info.session_authenticated_at).toBe(
      refreshed.session_authenticated_at,
    );
  });

  test("reauthentication rejects an empty password through the HTTP contract", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/reauthenticate",
        { password: "" },
        { token: admin.sessionToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["password"],
    );
  });

  test("reauthentication requires a live bearer session", async ({
    adminAPI,
    createAdmin,
  }) => {
    for (const token of [undefined, "unknown-session"]) {
      const response = await adminAPI.post(
        "/reauthenticate",
        { password: "password" },
        token === undefined ? {} : { token },
      );
      await expectProblem(
        response,
        401,
        "vetchium-problem-details/admin-authentication-required",
      );
      expect(response.headers()["www-authenticate"]).toBe(
        'Bearer realm="admin"',
      );
    }

    const admin = await createAdmin();
    expect(
      (
        await adminAPI.post("/logout", undefined, {
          token: admin.sessionToken,
        })
      ).status(),
    ).toBe(204);
    const revoked = await adminAPI.post(
      "/reauthenticate",
      { password: admin.password },
      { token: admin.sessionToken },
    );
    await expectProblem(
      revoked,
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    expect(revoked.headers()["www-authenticate"]).toBe('Bearer realm="admin"');
  });
});

test.describe("Admin profile", () => {
  test("my-info exposes identity, effective preferences, authorization, and session", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin({ displayName: "Profile Test" });
    const response = await adminAPI.get("/my-info", admin.sessionToken);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await responseJSON<MyInfoResponse>(response);
    expect(body).toMatchObject({
      admin_user_id: admin.adminUserID,
      email_address: admin.emailAddress,
      display_name: "Profile Test",
      state: "active",
      permissions: [],
      totp_enabled: false,
      recovery_codes_remaining: 0,
      preferred_language: "en-US",
      tenant_id: "sgp",
    });
    expect(body.created_at).toMatch(/Z$/);
    expect(body.session_authenticated_at).toMatch(/Z$/);
    expect(Date.parse(body.session_authenticated_at)).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(body.session_expires_at).toMatch(/Z$/);
  });

  test("the language setter persists every supported UI locale", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-preferred-language",
          { preferred_language: "de-DE" },
          { token: admin.sessionToken },
        )
      ).status(),
    ).toBe(204);
    const info = await responseJSON<MyInfoResponse>(
      await adminAPI.get("/my-info", admin.sessionToken),
    );
    expect(info.preferred_language).toBe("de-DE");
  });

  test("profile setters reject unsupported locale and invalid display name", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/set-preferred-language",
        { preferred_language: "fr-FR" },
        { token: admin.sessionToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["preferred_language"],
    );
    await expectProblem(
      await adminAPI.post(
        "/set-display-name",
        { display_name: " " },
        { token: admin.sessionToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["display_name"],
    );
  });

  test("display name is normalized and replaced", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const response = await adminAPI.post(
      "/set-display-name",
      { display_name: "  நிர்வாகி  " },
      { token: admin.sessionToken },
    );
    expect(response.status()).toBe(204);
    const info = await responseJSON<MyInfoResponse>(
      await adminAPI.get("/my-info", admin.sessionToken),
    );
    expect(info.display_name).toBe("நிர்வாகி");
  });
});
