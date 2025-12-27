import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/api-client";
import {
  createTestApprovedDomain,
  createTestAdminUser,
  deleteTestAdminUser,
  permanentlyDeleteTestApprovedDomain,
  deleteTestHubUser,
  generateTestEmail,
  generateTestDomainName,
  extractSignupTokenFromEmail,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";

test.describe("POST /hub/get-regions", () => {
  test("returns active regions", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.getRegions();

    expect(response.status).toBe(200);
    expect(response.body.regions).toBeDefined();
    expect(Array.isArray(response.body.regions)).toBe(true);
    // At least 3 active regions (ind1, usa1, deu1)
    expect(response.body.regions.length).toBeGreaterThanOrEqual(3);
    // Verify structure
    response.body.regions.forEach((region: any) => {
      expect(region.region_code).toBeDefined();
      expect(region.region_name).toBeDefined();
    });
  });
});

test.describe("POST /hub/get-supported-languages", () => {
  test("returns supported languages with default flag", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.getSupportedLanguages();

    expect(response.status).toBe(200);
    expect(response.body.languages).toBeDefined();
    expect(Array.isArray(response.body.languages)).toBe(true);
    // At least 3 languages (en-US, de-DE, ta-IN)
    expect(response.body.languages.length).toBeGreaterThanOrEqual(3);

    // Verify one language is marked as default
    const defaultLangs = response.body.languages.filter((lang: any) => lang.is_default);
    expect(defaultLangs.length).toBe(1);
    expect(defaultLangs[0].language_code).toBe("en-US");
  });
});

test.describe("POST /hub/check-domain", () => {
  test("returns true for approved domain", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName("approved");

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      const response = await api.checkDomain(domain);

      expect(response.status).toBe(200);
      expect(response.body.is_approved).toBe(true);
    } finally {
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns false for unapproved domain", async ({ request }) => {
    const api = new HubAPIClient(request);
    const domain = "unapproved-" + Date.now() + ".com";

    const response = await api.checkDomain(domain);

    expect(response.status).toBe(200);
    expect(response.body.is_approved).toBe(false);
  });

  test("returns 400 for invalid domain format", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.checkDomainRaw({ domain: "not a domain" });

    expect(response.status).toBe(400);
  });

  test("returns 400 for missing domain", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.checkDomainRaw({});

    expect(response.status).toBe(400);
  });
});

test.describe("POST /hub/request-signup", () => {
  test("sends verification email for approved domain", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      const response = await api.requestSignup(email);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();

      // Verify email was sent
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      expect(emailMessage).toBeDefined();
      expect(emailMessage.To[0].Address).toBe(email);

      // Verify token is in email
      const token = extractSignupTokenFromEmail(emailMessage);
      expect(token).toBeDefined();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 403 for unapproved domain", async ({ request }) => {
    const api = new HubAPIClient(request);
    const email = `user-${Date.now()}@unapproved-domain.com`;

    const response = await api.requestSignup(email);

    expect(response.status).toBe(403);
  });

  test("returns 409 if email already registered", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Create user through signup API
      await api.requestSignup(email);
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);
      await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Existing User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      // Now try to signup again with same email
      const response = await api.requestSignup(email);
      expect(response.status).toBe(409);
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 400 for invalid email format", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.requestSignupRaw({ email_address: "not-an-email" });

    expect(response.status).toBe(400);
  });

  test("returns 400 for missing email", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.requestSignupRaw({});

    expect(response.status).toBe(400);
  });
});

test.describe("POST /hub/complete-signup", () => {
  test("complete signup flow returns session and handle", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Request signup
      await api.requestSignup(email);

      // Get token from email
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);
      expect(signupToken).toBeDefined();

      // Complete signup
      const response = await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Test User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      expect(response.status).toBe(201);
      expect(response.body.session_token).toBeDefined();
      expect(response.body.session_token).toMatch(/^[a-f0-9]{64}$/);
      expect(response.body.handle).toBeDefined();
      expect(response.body.handle).toMatch(/^[a-z0-9-]+$/);

      // Verify can login with created account
      const loginResponse = await api.login(email, password);
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.session_token).toBeDefined();
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("complete signup with multiple display names", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      await api.requestSignup(email);
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);

      const response = await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Test User",
        other_display_names: [
          { language_code: "de-DE", display_name: "Testbenutzer" },
          { language_code: "ta-IN", display_name: "சோதனை பயனர்" },
        ],
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      expect(response.status).toBe(201);
      expect(response.body.session_token).toBeDefined();
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 401 for invalid signup token", async ({ request }) => {
    const api = new HubAPIClient(request);
    const email = "test@example.com";

    const response = await api.completeSignup({
      signup_token: "0".repeat(64), // Invalid token
      password: "Password123$",
      preferred_display_name: "Test User",
      home_region: "ind1",
      preferred_language: "en-US",
      resident_country_code: "US",
    });

    expect(response.status).toBe(401);
  });

  test("returns 409 if user already exists", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Create user through first signup
      await api.requestSignup(email);
      const firstEmailSummary = await waitForEmail(email);
      const firstEmailMessage = await getEmailContent(firstEmailSummary.ID);
      const firstSignupToken = extractSignupTokenFromEmail(firstEmailMessage);
      await api.completeSignup({
        signup_token: firstSignupToken!,
        password,
        preferred_display_name: "First User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      // Request signup again with same email
      await api.requestSignup(email);
      const secondEmailSummary = await waitForEmail(email);
      const secondEmailMessage = await getEmailContent(secondEmailSummary.ID);
      const secondSignupToken = extractSignupTokenFromEmail(secondEmailMessage);

      // Try to complete signup again - should return 409
      const response = await api.completeSignup({
        signup_token: secondSignupToken!,
        password,
        preferred_display_name: "Test User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      expect(response.status).toBe(409);
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 400 for missing required fields", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.completeSignupRaw({
      signup_token: "a".repeat(64),
      // Missing all other required fields
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for invalid password format", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.completeSignupRaw({
      signup_token: "a".repeat(64),
      password: "weak", // Too short
      preferred_display_name: "Test User",
      home_region: "ind1",
      preferred_language: "en-US",
      resident_country_code: "US",
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for invalid country code", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.completeSignupRaw({
      signup_token: "a".repeat(64),
      password: "Password123$",
      preferred_display_name: "Test User",
      home_region: "ind1",
      preferred_language: "en-US",
      resident_country_code: "USA", // Should be 2 chars
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for empty display name", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.completeSignupRaw({
      signup_token: "a".repeat(64),
      password: "Password123$",
      preferred_display_name: "", // Empty
      home_region: "ind1",
      preferred_language: "en-US",
      resident_country_code: "US",
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for display name too long", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.completeSignupRaw({
      signup_token: "a".repeat(64),
      password: "Password123$",
      preferred_display_name: "a".repeat(101), // Max 100
      home_region: "ind1",
      preferred_language: "en-US",
      resident_country_code: "US",
    });

    expect(response.status).toBe(400);
  });
});

test.describe("POST /hub/login", () => {
  test("successful login returns session token", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Create user through signup
      await api.requestSignup(email);
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);
      await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Test User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      // Now test login
      const response = await api.login(email, password);

      expect(response.status).toBe(200);
      expect(response.body.session_token).toBeDefined();
      expect(response.body.session_token).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 401 for wrong password", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Create user through signup
      await api.requestSignup(email);
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);
      await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Test User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      // Try login with wrong password
      const response = await api.login(email, "WrongPassword456!");

      expect(response.status).toBe(401);
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 401 for non-existent user", async ({ request }) => {
    const api = new HubAPIClient(request);
    const email = "nonexistent@example.com";

    const response = await api.login(email, "Password123$");

    expect(response.status).toBe(401);
  });

  test("returns 400 for invalid email format", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.loginRaw({
      email_address: "not-an-email",
      password: "Password123$",
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for missing email", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.loginRaw({ password: "Password123$" });

    expect(response.status).toBe(400);
  });

  test("returns 400 for missing password", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.loginRaw({ email_address: "test@example.com" });

    expect(response.status).toBe(400);
  });
});

test.describe("POST /hub/logout", () => {
  test("successfully logs out with valid session", async ({ request }) => {
    const api = new HubAPIClient(request);
    const adminEmail = generateTestEmail("admin");
    const domain = generateTestDomainName();
    const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
    const password = "Password123$";

    await createTestAdminUser(adminEmail, "Password123$");
    await createTestApprovedDomain(domain, adminEmail);

    try {
      // Create user through signup
      await api.requestSignup(email);
      const emailSummary = await waitForEmail(email);
      const emailMessage = await getEmailContent(emailSummary.ID);
      const signupToken = extractSignupTokenFromEmail(emailMessage);
      await api.completeSignup({
        signup_token: signupToken!,
        password,
        preferred_display_name: "Logout Test User",
        home_region: "ind1",
        preferred_language: "en-US",
        resident_country_code: "US",
      });

      // Login
      const loginResponse = await api.login(email, password);
      expect(loginResponse.status).toBe(200);
      const sessionToken = loginResponse.body.session_token;

      // Logout
      const response = await api.logout(sessionToken);
      expect(response.status).toBe(200);

      // Verify session is invalidated (logout again should fail)
      const secondLogout = await api.logout(sessionToken);
      expect(secondLogout.status).toBe(401);
    } finally {
      await deleteTestHubUser(email);
      await permanentlyDeleteTestApprovedDomain(domain);
      await deleteTestAdminUser(adminEmail);
    }
  });

  test("returns 401 for invalid session token", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.logout("0".repeat(64));

    expect(response.status).toBe(401);
  });

  test("returns 401 for invalid auth header", async ({ request }) => {
    const api = new HubAPIClient(request);

    const response = await api.logoutRaw("fakesession", {});

    expect(response.status).toBe(401);
  });
});
