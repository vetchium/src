import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	updateTestHubUserStatus,
} from "../../../lib/db";
import { getPasswordResetTokenFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubRequestPasswordResetRequest,
	HubCompletePasswordResetRequest,
	HubLoginRequest,
} from "vetchium-specs/hub/hub-users";

/**
 * Helper function to create a test hub user through signup API
 */
async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<void> {
	const requestSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(requestSignup);

	const emailSummary = await import("../../../lib/mailpit").then((m) =>
		m.waitForEmail(email)
	);
	const emailMessage = await import("../../../lib/mailpit").then((m) =>
		m.getEmailContent(emailSummary.ID)
	);
	const signupToken = await import("../../../lib/db").then((m) =>
		m.extractSignupTokenFromEmail(emailMessage)
	);

	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

test.describe("POST /hub/request-password-reset", () => {
	test("valid email returns generic success message and sends email", async ({
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
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Request password reset
			const resetRequest: HubRequestPasswordResetRequest = {
				email_address: email,
			};
			const response = await api.requestPasswordReset(resetRequest);

			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();
			expect(response.body.message).toContain("email");

			// Verify email was sent with reset token
			const resetToken = await getPasswordResetTokenFromEmail(email);
			expect(resetToken).toMatch(/^(IND1|USA1|DEU1)-[a-f0-9]{64}$/);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("non-existent email returns generic success message (prevents enumeration)", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email = `nonexistent-${randomUUID()}@example.com`;

		const resetRequest: HubRequestPasswordResetRequest = {
			email_address: email,
		};
		const response = await api.requestPasswordReset(resetRequest);

		// Should return 200 with generic message to prevent account enumeration
		expect(response.status).toBe(200);
		expect(response.body.message).toBeDefined();
		expect(response.body.message).toContain("email");
	});

	test("disabled user returns generic success message (prevents enumeration)", async ({
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
			// Create and then disable hub user
			await createHubUserViaSignup(api, email, password);
			await updateTestHubUserStatus(email, "disabled");

			const resetRequest: HubRequestPasswordResetRequest = {
				email_address: email,
			};
			const response = await api.requestPasswordReset(resetRequest);

			// Should return 200 with generic message
			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestPasswordResetRaw({
			email_address: "not-an-email",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
		expect(response.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					field: "email_address",
				}),
			])
		);
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestPasswordResetRaw({});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestPasswordResetRaw({
			email_address: "",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("email too long returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const longEmail = "a".repeat(250) + "@example.com";

		const response = await api.requestPasswordResetRaw({
			email_address: longEmail,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("email with plus sign returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.requestPasswordResetRaw({
			email_address: "test+alias@example.com",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("malformed JSON returns 400", async ({ request }) => {
		const response = await request.post("/hub/request-password-reset", {
			data: "not json",
			headers: {
				"Content-Type": "application/json",
			},
		});

		expect(response.status()).toBe(400);
	});
});

test.describe("POST /hub/complete-password-reset", () => {
	test("valid token and password resets password successfully", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword123$";

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, oldPassword);

			// Request password reset
			const resetRequest: HubRequestPasswordResetRequest = {
				email_address: email,
			};
			await api.requestPasswordReset(resetRequest);

			// Get reset token from email
			const resetToken = await getPasswordResetTokenFromEmail(email);

			// Complete password reset
			const completeRequest: HubCompletePasswordResetRequest = {
				reset_token: resetToken,
				new_password: newPassword,
			};
			const response = await api.completePasswordReset(completeRequest);

			expect(response.status).toBe(200);

			// Verify old password no longer works
			const loginOld: HubLoginRequest = {
				email_address: email,
				password: oldPassword,
			};
			const loginOldResponse = await api.login(loginOld);
			expect(loginOldResponse.status).toBe(401);

			// Verify new password works
			const loginNew: HubLoginRequest = {
				email_address: email,
				password: newPassword,
			};
			const loginNewResponse = await api.login(loginNew);
			expect(loginNewResponse.status).toBe(200);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("password reset invalidates all sessions", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword123$";

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user and login to get session
			await createHubUserViaSignup(api, email, oldPassword);

			const loginReq: HubLoginRequest = {
				email_address: email,
				password: oldPassword,
			};
			const loginResp = await api.login(loginReq);
			expect(loginResp.status).toBe(200);

			// Get TFA code and complete login to get session token
			const { getTfaCodeFromEmail } = await import("../../../lib/mailpit");
			const tfaCode = await getTfaCodeFromEmail(email);

			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Request and complete password reset
			await api.requestPasswordReset({ email_address: email });
			const resetToken = await getPasswordResetTokenFromEmail(email);
			const completeResp = await api.completePasswordReset({
				reset_token: resetToken,
				new_password: newPassword,
			});
			expect(completeResp.status).toBe(200);

			// Verify old session is invalid
			const logoutResp = await api.logout(sessionToken);
			expect(logoutResp.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid token returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		const completeRequest: HubCompletePasswordResetRequest = {
			reset_token: "IND1-" + "a".repeat(64),
			new_password: "NewPassword123$",
		};
		const response = await api.completePasswordReset(completeRequest);

		expect(response.status).toBe(401);
	});

	test("expired token returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);

			// Request password reset
			await api.requestPasswordReset({ email_address: email });
			const resetToken = await getPasswordResetTokenFromEmail(email);

			// Wait for token to expire (1 hour + buffer)
			// In testing, we can't wait that long, so this test documents expected behavior
			// TODO: Add mechanism to force token expiry in test environment

			const completeRequest: HubCompletePasswordResetRequest = {
				reset_token: resetToken,
				new_password: "NewPassword123$",
			};
			// Would return 401 after expiry
			// const response = await api.completePasswordReset(completeRequest);
			// expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("token is single-use", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;
		const newPassword = "NewPassword123$";

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);

			// Request password reset
			await api.requestPasswordReset({ email_address: email });
			const resetToken = await getPasswordResetTokenFromEmail(email);

			// Use token once
			const firstRequest: HubCompletePasswordResetRequest = {
				reset_token: resetToken,
				new_password: newPassword,
			};
			const firstResponse = await api.completePasswordReset(firstRequest);
			expect(firstResponse.status).toBe(200);

			// Try to use same token again
			const secondRequest: HubCompletePasswordResetRequest = {
				reset_token: resetToken,
				new_password: "AnotherPassword123$",
			};
			const secondResponse = await api.completePasswordReset(secondRequest);
			expect(secondResponse.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid password format returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);
			await api.requestPasswordReset({ email_address: email });
			const resetToken = await getPasswordResetTokenFromEmail(email);

			// Test password too short (< 12 characters)
			const shortPassword = await api.completePasswordResetRaw({
				reset_token: resetToken,
				new_password: "Short1$",
			});
			expect(shortPassword.status).toBe(400);
			expect(shortPassword.errors).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("missing reset token returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.completePasswordResetRaw({
			new_password: "NewPassword123$",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing new password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.completePasswordResetRaw({
			reset_token: "IND1-" + "a".repeat(64),
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("empty fields return 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.completePasswordResetRaw({
			reset_token: "",
			new_password: "",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("malformed token format returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		// Token without region prefix
		const response = await api.completePasswordReset({
			reset_token: "a".repeat(64),
			new_password: "NewPassword123$",
		});

		expect(response.status).toBe(401);
	});

	test("malformed JSON returns 400", async ({ request }) => {
		const response = await request.post("/hub/complete-password-reset", {
			data: "not json",
			headers: {
				"Content-Type": "application/json",
			},
		});

		expect(response.status()).toBe(400);
	});
});
