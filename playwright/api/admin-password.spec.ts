import { randomBytes, randomUUID } from "node:crypto";
import { expectProblem, idempotencyKey } from "../lib/admin-api.ts";
import { ageSession, emailCredential } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test.describe("Admin password management", () => {
  test("password-reset requests are normalized and non-enumerating", async ({
    adminAPI,
    createAdmin,
    ownedEmail,
  }) => {
    const existing = await createAdmin();
    const existingResponse = await adminAPI.post("/request-password-reset", {
      email_address: `  ${existing.emailAddress.toUpperCase()}  `,
    });
    expect(existingResponse.status()).toBe(202);
    expect(existingResponse.headers()["cache-control"]).toBe("no-store");
    expect(
      emailCredential(existing.emailAddress, "password-reset", "reset_token"),
    ).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const unknownResponse = await adminAPI.post("/request-password-reset", {
      email_address: ownedEmail(),
    });
    expect(unknownResponse.status()).toBe(202);
    expect(await unknownResponse.body()).toHaveLength(0);
  });

  test("concurrent reset requests for one user serialize without uniqueness failures", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const responses = await Promise.all([
      adminAPI.post("/request-password-reset", {
        email_address: admin.emailAddress,
      }),
      adminAPI.post("/request-password-reset", {
        email_address: admin.emailAddress,
      }),
    ]);
    expect(responses.map((response) => response.status())).toEqual([202, 202]);

    const newestToken = emailCredential(
      admin.emailAddress,
      "password-reset",
      "reset_token",
    );
    expect(
      (
        await adminAPI.post(
          "/complete-password-reset",
          {
            reset_token: newestToken,
            new_password: `Concurrent!${randomUUID()}-password`,
          },
          { idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(204);
  });

  test("complete reset consumes its token, revokes sessions, and replays exactly", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    expect(
      (
        await adminAPI.post("/request-password-reset", {
          email_address: admin.emailAddress,
        })
      ).status(),
    ).toBe(202);
    const resetToken = emailCredential(
      admin.emailAddress,
      "password-reset",
      "reset_token",
    );
    const newPassword = `Reset!${randomUUID()}-password`;
    const key = idempotencyKey();
    const first = await adminAPI.post(
      "/complete-password-reset",
      { reset_token: resetToken, new_password: newPassword },
      { idempotencyKey: key },
    );
    expect(first.status()).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: resetToken, new_password: newPassword },
          { idempotencyKey: key },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.get("/my-info", admin.sessionToken),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    const replacement = await adminAPI.passwordSession(
      admin.emailAddress,
      newPassword,
    );
    expect(replacement.session_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const oldPassword = await adminAPI.post("/login", {
      email_address: admin.emailAddress,
      password: admin.password,
    });
    await expectProblem(
      oldPassword,
      401,
      "vetchium-problem-details/invalid-credentials",
    );
  });

  test("complete reset rejects invalid tokens and successful keys cannot be rebound", async ({
    adminAPI,
    createAdmin,
  }) => {
    const token = randomBytes(32).toString("base64url");
    await expectProblem(
      await adminAPI.post(
        "/complete-password-reset",
        { reset_token: token, new_password: `Valid!${randomUUID()}-password` },
        { idempotencyKey: idempotencyKey() },
      ),
      401,
      "vetchium-problem-details/invalid-password-reset-token",
    );

    const admin = await createAdmin();
    expect(
      (
        await adminAPI.post("/request-password-reset", {
          email_address: admin.emailAddress,
        })
      ).status(),
    ).toBe(202);
    const resetToken = emailCredential(
      admin.emailAddress,
      "password-reset",
      "reset_token",
    );
    const key = idempotencyKey();
    expect(
      (
        await adminAPI.post(
          "/complete-password-reset",
          {
            reset_token: resetToken,
            new_password: `First!${randomUUID()}-password`,
          },
          { idempotencyKey: key },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post(
        "/complete-password-reset",
        {
          reset_token: resetToken,
          new_password: `Different!${randomUUID()}-password`,
        },
        { idempotencyKey: key },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
  });

  test("new-password policy rejects short and prohibited values", async ({
    adminAPI,
  }) => {
    const token = randomBytes(32).toString("base64url");
    for (const new_password of ["too-short", "correct horse battery staple"]) {
      await expectProblem(
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: token, new_password },
          { idempotencyKey: idempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["new_password"],
      );
    }
  });

  test("change password preserves the current session and revokes other sessions", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const other = await adminAPI.passwordSession(
      admin.emailAddress,
      admin.password,
    );
    const newPassword = `Changed!${randomUUID()}-password`;
    expect(
      (
        await adminAPI.post(
          "/change-password",
          { new_password: newPassword },
          { token: admin.sessionToken },
        )
      ).status(),
    ).toBe(204);
    expect((await adminAPI.get("/my-info", admin.sessionToken)).status()).toBe(
      200,
    );
    await expectProblem(
      await adminAPI.get("/my-info", other.session_token),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    await adminAPI.passwordSession(admin.emailAddress, newPassword);
  });

  test("change password requires recent full authentication", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    ageSession(admin.sessionToken);
    const response = await adminAPI.post(
      "/change-password",
      { new_password: `Changed!${randomUUID()}-password` },
      { token: admin.sessionToken },
    );
    await expectProblem(
      response,
      401,
      "vetchium-problem-details/recent-authentication-required",
    );
    expect(response.headers()["www-authenticate"]).toBe('Bearer realm="admin"');
    expect((await adminAPI.get("/my-info", admin.sessionToken)).status()).toBe(
      200,
    );
  });
});
