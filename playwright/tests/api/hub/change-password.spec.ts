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
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
	HubChangePasswordRequest,
} from "vetchium-specs/hub/hub-users";

/**
 * Helper function to create a test hub user through signup API and return session token
 */
async function createHubUserViaSignupAndLogin(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
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

	// Login to get session token
	const loginReq: HubLoginRequest = {
		email_address: email,
		password: password,
	};
	const loginResp = await api.login(loginReq);

	const { getTfaCodeFromEmail } = await import("../../../lib/mailpit");
	const tfaCode = await getTfaCodeFromEmail(email);

	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	});

	return tfaResp.body.session_token;
}

test.describe("POST /hub/change-password", () => {
	test("valid current password changes password successfully", async ({
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
			// Create hub user and login
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				oldPassword
			);

			// Change password
			const changeRequest: HubChangePasswordRequest = {
				current_password: oldPassword,
				new_password: newPassword,
			};
			const response = await api.changePassword(sessionToken, changeRequest);

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

	test("password change keeps current session active", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword123$";

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user and login
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				oldPassword
			);

			// Change password
			const changeRequest: HubChangePasswordRequest = {
				current_password: oldPassword,
				new_password: newPassword,
			};
			const changeResp = await api.changePassword(sessionToken, changeRequest);
			expect(changeResp.status).toBe(200);

			// Verify current session still works
			const setLangResp = await api.setLanguage(sessionToken, {
				language: "de-DE",
			});
			expect(setLangResp.status).toBe(200);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("password change invalidates other sessions", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword123$";

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user and get first session
			const session1 = await createHubUserViaSignupAndLogin(
				api,
				email,
				oldPassword
			);

			// Create second session
			const loginReq: HubLoginRequest = {
				email_address: email,
				password: oldPassword,
			};
			const loginResp = await api.login(loginReq);
			const { getTfaCodeFromEmail } = await import("../../../lib/mailpit");
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const session2 = tfaResp.body.session_token;

			// Change password using session1
			const changeRequest: HubChangePasswordRequest = {
				current_password: oldPassword,
				new_password: newPassword,
			};
			const changeResp = await api.changePassword(session1, changeRequest);
			expect(changeResp.status).toBe(200);

			// Verify session1 still works (current session)
			const setLang1 = await api.setLanguage(session1, { language: "de-DE" });
			expect(setLang1.status).toBe(200);

			// Verify session2 is invalidated
			const setLang2 = await api.setLanguage(session2, { language: "de-DE" });
			expect(setLang2.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("wrong current password returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const changeRequest: HubChangePasswordRequest = {
				current_password: "WrongPassword123$",
				new_password: "NewPassword123$",
			};
			const response = await api.changePassword(sessionToken, changeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("same current and new password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const response = await api.changePasswordRaw(sessionToken, {
				current_password: password,
				new_password: password,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						field: "new_password",
						message: "must be different from current password",
					}),
				])
			);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid new password format returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			// Test password too short
			const shortPassword = await api.changePasswordRaw(sessionToken, {
				current_password: password,
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

	test("missing current_password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const response = await api.changePasswordRaw(sessionToken, {
				new_password: "NewPassword123$",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("missing new_password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const response = await api.changePasswordRaw(sessionToken, {
				current_password: password,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("empty passwords return 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const response = await api.changePasswordRaw(sessionToken, {
				current_password: "",
				new_password: "",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.changePasswordRaw("invalid-token", {
			current_password: TEST_PASSWORD,
			new_password: "NewPassword123$",
		});

		expect(response.status).toBe(401);
	});

	test("malformed JSON returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const sessionToken = await createHubUserViaSignupAndLogin(
				api,
				email,
				password
			);

			const response = await request.post("/hub/change-password", {
				data: "not json",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
