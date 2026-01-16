import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { GlobalAPIClient } from "../../../lib/global-api-client";
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
import {
	waitForEmail,
	getEmailContent,
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	CompleteSignupRequest,
	HubLoginRequest,
	HubTFARequest,
	RequestSignupRequest,
} from "vetchium-specs/hub/hub-users";
import type { CheckDomainRequest } from "vetchium-specs/global/global";

/**
 * Helper function to get TFA code from the most recent TFA email.
 * For hub users, there may be multiple emails (signup, TFA, etc.)
 * so we need to search for the one containing a 6-digit code.
 * Uses exponential backoff to handle delays under parallel test load.
 */
async function getTfaCodeForHubUser(email: string): Promise<string> {
	const maxRetries = 15;
	let delay = 1000; // Start with 1 second
	const maxDelay = 5000; // Cap at 5 seconds
	const backoffMultiplier = 1.5;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const messages = await searchEmails(email);

		// Check messages from most recent to oldest
		for (const msgSummary of messages) {
			const fullMessage = await getEmailContent(msgSummary.ID);
			try {
				const code = extractTfaCode(fullMessage.Text);
				return code;
			} catch (e) {
				// This email doesn't contain a TFA code, try next one
			}
		}

		if (attempt < maxRetries) {
			// Wait before retrying with exponential backoff
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}
	throw new Error(
		`No TFA code found in any emails for ${email} after ${maxRetries} attempts`
	);
}

test.describe("POST /global/check-domain", () => {
	test("returns true for approved domain", async ({ request }) => {
		const api = new GlobalAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName("approved");

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const checkRequest: CheckDomainRequest = { domain };
			const response = await api.checkDomain(checkRequest);

			expect(response.status).toBe(200);
			expect(response.body.is_approved).toBe(true);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns false for unapproved domain", async ({ request }) => {
		const api = new GlobalAPIClient(request);
		const domain = "unapproved-" + Date.now() + ".com";

		const checkRequest: CheckDomainRequest = { domain };
		const response = await api.checkDomain(checkRequest);

		expect(response.status).toBe(200);
		expect(response.body.is_approved).toBe(false);
	});

	test("returns 400 for invalid domain format", async ({ request }) => {
		const api = new GlobalAPIClient(request);

		const response = await api.checkDomainRaw({ domain: "not a domain" });

		expect(response.status).toBe(400);
	});

	test("returns 400 for missing domain", async ({ request }) => {
		const api = new GlobalAPIClient(request);

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

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const signupRequest: RequestSignupRequest = { email_address: email };
			const response = await api.requestSignup(signupRequest);

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

		const signupRequest: RequestSignupRequest = { email_address: email };
		const response = await api.requestSignup(signupRequest);

		expect(response.status).toBe(403);
	});

	test("returns 409 if email already registered", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create user through signup API
			const initialSignupRequest: RequestSignupRequest = {
				email_address: email,
			};
			await api.requestSignup(initialSignupRequest);
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			const completeRequest: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Existing User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			await api.completeSignup(completeRequest);

			// Now try to signup again with same email
			const retrySignupRequest: RequestSignupRequest = { email_address: email };
			const response = await api.requestSignup(retrySignupRequest);
			expect(response.status).toBe(409);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 for invalid email format", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestSignupRaw({
			email_address: "not-an-email",
		});

		expect(response.status).toBe(400);
	});

	test("returns 400 for missing email", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestSignupRaw({});

		expect(response.status).toBe(400);
	});
});

test.describe("POST /hub/complete-signup", () => {
	test("complete signup flow returns session and handle", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Request signup
			const requestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(requestSignup);

			// Get token from email
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			expect(signupToken).toBeDefined();

			// Complete signup
			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			const response = await api.completeSignup(completeSignup);

			expect(response.status).toBe(201);
			expect(response.body.session_token).toBeDefined();
			expect(response.body.session_token).toMatch(
				/^(IND1|USA1|DEU1)-[a-f0-9]{64}$/
			);
			expect(response.body.handle).toBeDefined();
			expect(response.body.handle).toMatch(/^[a-z0-9-]+$/);

			// Verify can login with created account (login returns TFA token)
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			expect(loginResponse.body.tfa_token).toBeDefined();
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
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const requestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(requestSignup);
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);

			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test User",
				other_display_names: [
					{
						language_code: "de-DE",
						display_name: "Testbenutzer",
						is_preferred: false,
					},
					{
						language_code: "ta-IN",
						display_name: "சோதனை பயனர்",
						is_preferred: false,
					},
				],
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			const response = await api.completeSignup(completeSignup);

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

		const signupRequest: CompleteSignupRequest = {
			signup_token: "0".repeat(64), // Invalid token
			password: "Password123$",
			preferred_display_name: "Test User",
			home_region: "ind1",
			preferred_language: "en-US",
			resident_country_code: "US",
		};
		const response = await api.completeSignup(signupRequest);

		expect(response.status).toBe(401);
	});

	test("returns 409 if user already exists", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create user through first signup
			const firstRequestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(firstRequestSignup);
			const firstEmailSummary = await waitForEmail(email);
			const firstEmailMessage = await getEmailContent(firstEmailSummary.ID);
			const firstSignupToken = extractSignupTokenFromEmail(firstEmailMessage);
			const firstCompleteSignup: CompleteSignupRequest = {
				signup_token: firstSignupToken!,
				password,
				preferred_display_name: "First User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			await api.completeSignup(firstCompleteSignup);

			// Request signup again with same email
			const secondRequestSignup: RequestSignupRequest = {
				email_address: email,
			};
			await api.requestSignup(secondRequestSignup);
			const secondEmailSummary = await waitForEmail(email);
			const secondEmailMessage = await getEmailContent(secondEmailSummary.ID);
			const secondSignupToken = extractSignupTokenFromEmail(secondEmailMessage);

			// Try to complete signup again - should return 409
			const secondCompleteSignup: CompleteSignupRequest = {
				signup_token: secondSignupToken!,
				password,
				preferred_display_name: "Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			const response = await api.completeSignup(secondCompleteSignup);

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
	test("successful login returns TFA token and sends email", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create user through signup
			const requestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(requestSignup);
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			await api.completeSignup(completeSignup);

			// Now test login
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(200);
			expect(response.body.tfa_token).toBeDefined();
			// TFA token should be region-prefixed: e.g., IND1-{64-char-hex}
			expect(response.body.tfa_token).toMatch(
				/^(IND1|USA1|DEU1)-[a-f0-9]{64}$/
			);

			// Verify TFA email was sent - wait for it with exponential backoff
			let messages: Awaited<ReturnType<typeof searchEmails>> = [];
			const maxRetries = 15;
			let delay = 1000;
			const maxDelay = 5000;
			const backoffMultiplier = 1.5;

			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				messages = await searchEmails(email);
				if (messages.length >= 2) break; // Found both signup and TFA emails
				if (attempt < maxRetries) {
					await new Promise((resolve) => setTimeout(resolve, delay));
					delay = Math.min(delay * backoffMultiplier, maxDelay);
				}
			}
			expect(messages.length).toBeGreaterThanOrEqual(2); // Signup + TFA emails
			// Most recent email should be the TFA email
			expect(messages[0].To[0].Address).toBe(email);
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
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create user through signup
			const requestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(requestSignup);
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			await api.completeSignup(completeSignup);

			// Try login with wrong password
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password: "WrongPassword456!",
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 for non-existent user", async ({ request }) => {
		const api = new HubAPIClient(request);
		const loginRequest: HubLoginRequest = {
			email_address: "nonexistent@example.com",
			password: TEST_PASSWORD,
		};

		const response = await api.login(loginRequest);

		expect(response.status).toBe(401);
	});

	test("returns 400 for invalid email format", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "not-an-email",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("returns 400 for missing email", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({ password: TEST_PASSWORD });

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
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create user through signup
			const requestSignup: RequestSignupRequest = { email_address: email };
			await api.requestSignup(requestSignup);
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Logout Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			await api.completeSignup(completeSignup);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Verify TFA to get session token
			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

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

	test("returns 401 for missing auth header", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.logoutWithoutAuth({});

		expect(response.status).toBe(401);
	});
});
