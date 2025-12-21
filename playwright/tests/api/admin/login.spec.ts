import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/api-client";
import {
  createTestAdminUser,
  deleteTestAdminUser,
  generateTestEmail,
  updateTestAdminUserStatus,
} from "../../../lib/db";
import { waitForEmail } from "../../../lib/mailpit";

test.describe("POST /admin/login", () => {
  test("successful login returns TFA token and sends email", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("login-success");
    const password = "ValidPassword123$";

    await createTestAdminUser(email, password);
    try {
      const response = await api.login(email, password);

      expect(response.status).toBe(200);
      expect(response.body.tfa_token).toBeDefined();
      // TFA token should be 64-character hex string (32 bytes hex-encoded)
      expect(response.body.tfa_token).toMatch(/^[a-f0-9]{64}$/);

      // Verify TFA email was sent
      const emailMessage = await waitForEmail(email, 5000);
      expect(emailMessage).toBeDefined();
      expect(emailMessage.To[0].Address).toBe(email);
    } finally {
      await deleteTestAdminUser(email);
    }
  });

  test("invalid email format returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);

    const response = await api.loginRaw({
      email: "not-an-email",
      password: "ValidPassword123$",
    });

    expect(response.status).toBe(400);
  });

  test("non-existent email returns 401", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("nonexistent");

    const response = await api.login(email, "ValidPassword123$");

    expect(response.status).toBe(401);
  });

  test("wrong password returns 401", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("wrong-password");
    const password = "ValidPassword123$";

    await createTestAdminUser(email, password);
    try {
      const response = await api.login(email, "WrongPassword456!");

      expect(response.status).toBe(401);
    } finally {
      await deleteTestAdminUser(email);
    }
  });

  test("disabled admin returns 422", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("disabled-admin");
    const password = "ValidPassword123$";

    await createTestAdminUser(email, password, "disabled");
    try {
      const response = await api.login(email, password);

      expect(response.status).toBe(422);
    } finally {
      await deleteTestAdminUser(email);
    }
  });

  test("missing email returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);

    const response = await api.loginRaw({
      password: "ValidPassword123$",
    });

    expect(response.status).toBe(400);
  });

  test("missing password returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("missing-password");

    const response = await api.loginRaw({
      email: email,
    });

    expect(response.status).toBe(400);
  });

  test("empty email returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);

    const response = await api.loginRaw({
      email: "",
      password: "ValidPassword123$",
    });

    expect(response.status).toBe(400);
  });

  test("empty password returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("empty-password");

    const response = await api.loginRaw({
      email: email,
      password: "",
    });

    expect(response.status).toBe(400);
  });

  test("password too short returns 400", async ({ request }) => {
    const api = new AdminAPIClient(request);
    const email = generateTestEmail("short-password");

    // Password must be at least 12 characters
    const response = await api.loginRaw({
      email: email,
      password: "Short1$",
    });

    expect(response.status).toBe(400);
  });
});
