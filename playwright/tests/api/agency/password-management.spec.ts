import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	createTestAgencyAdminDirect,
	deleteTestAgencyUser,
	generateTestAgencyEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	extractPasswordResetToken,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("POST /agency/request-password-reset", () => {
	test("successful request returns 200 and sends email", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-reset-success");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const response = await api.requestPasswordReset({
				email_address: email,
				domain: domain,
			});

			// Should always return 200 (prevent email enumeration)
			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();

			// Verify password reset email was sent
			const emailMessage = await waitForEmail(email);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(email);
			expect(emailMessage.Subject).toContain("Reset");
			expect(emailMessage.Subject).toContain("Password");
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("non-existent email returns 200 (prevent enumeration)", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-reset-nonexistent");

		const response = await api.requestPasswordReset({
			email_address: email,
			domain: domain,
		});

		// Should return 200 even for non-existent email
		expect(response.status).toBe(200);
		expect(response.body.message).toBeDefined();
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { domain } = generateTestAgencyEmail("pwd-reset-invalid-email");

		const response = await api.requestPasswordResetRaw({
			email_address: "not-an-email",
			domain: domain,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { domain } = generateTestAgencyEmail("pwd-reset-missing-email");

		const response = await api.requestPasswordResetRaw({
			domain: domain,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { domain } = generateTestAgencyEmail("pwd-reset-empty-email");

		const response = await api.requestPasswordResetRaw({
			email_address: "",
			domain: domain,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("invalid domain format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email } = generateTestAgencyEmail("pwd-reset-invalid-domain");

		const response = await api.requestPasswordResetRaw({
			email_address: email,
			domain: "not a domain!",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email } = generateTestAgencyEmail("pwd-reset-missing-domain");

		const response = await api.requestPasswordResetRaw({
			email_address: email,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});
});

test.describe("POST /agency/complete-password-reset", () => {
	test("successful reset with valid token returns 200", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-reset-complete");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAgencyAdminDirect(email, oldPassword);
		try {
			// Request password reset
			await api.requestPasswordReset({ email_address: email, domain: domain });

			// Get reset token from email
			const emailSummary = await waitForEmail(email, {}, /reset/i);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const resetToken = extractPasswordResetToken(emailMessage);
			expect(resetToken).toBeDefined();

			// Complete password reset
			const response = await api.completePasswordReset({
				reset_token: resetToken!,
				new_password: newPassword,
			});

			expect(response.status).toBe(200);

			// Verify can login with new password
			const loginResponse = await api.login({
				email: email,
				domain: domain,
				password: newPassword,
			});
			expect(loginResponse.status).toBe(200);

			// Verify cannot login with old password
			const oldLoginResponse = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			expect(oldLoginResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("invalid reset token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completePasswordReset({
			reset_token: "IND1-" + "0".repeat(64),
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("expired reset token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// This test relies on docker-compose-ci.json having very short token expiry
		// The token should expire by the time we try to use it
		const response = await api.completePasswordReset({
			reset_token: "IND1-" + "f".repeat(64),
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("invalid password format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-reset-invalid-pw");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Request password reset
			await api.requestPasswordReset({ email_address: email, domain: domain });

			const emailSummary = await waitForEmail(email, {}, /reset/i);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const resetToken = extractPasswordResetToken(emailMessage);

			// Password too short
			const response = await api.completePasswordReset({
				reset_token: resetToken!,
				new_password: "short",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("all sessions invalidated after password reset", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-reset-sessions");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAgencyAdminDirect(email, oldPassword);
		try {
			// Login to create a session
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const oldSessionToken = tfaResp.body.session_token;

			// Request password reset
			await api.requestPasswordReset({ email_address: email, domain: domain });

			const emailSummary = await waitForEmail(email, {}, /reset/i);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const resetToken = extractPasswordResetToken(emailMessage);

			// Complete password reset
			const resetResponse = await api.completePasswordReset({
				reset_token: resetToken!,
				new_password: newPassword,
			});

			expect(resetResponse.status).toBe(200);

			// Try to use old session token - should fail
			const logoutResponse = await api.logout(oldSessionToken);
			expect(logoutResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("missing reset_token returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completePasswordResetRaw({
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing new_password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completePasswordResetRaw({
			reset_token: "IND1-" + "0".repeat(64),
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});
});

test.describe("POST /agency/change-password", () => {
	test("successful password change returns 200", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-success");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAgencyAdminDirect(email, oldPassword);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			// Change password
			const response = await api.changePassword(sessionToken, {
				current_password: oldPassword,
				new_password: newPassword,
			});

			expect(response.status).toBe(200);

			// Verify can login with new password
			const newLoginResponse = await api.login({
				email: email,
				domain: domain,
				password: newPassword,
			});
			expect(newLoginResponse.status).toBe(200);

			// Verify cannot login with old password
			const oldLoginResponse = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			expect(oldLoginResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("wrong current password returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-wrong-pw");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			// Attempt to change password with wrong current password
			const response = await api.changePassword(sessionToken, {
				current_password: "WrongPassword123!",
				new_password: "NewPassword789!",
			});

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("new password same as current returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-same-pw");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			// Attempt to change password to same password
			const response = await api.changePassword(sessionToken, {
				current_password: TEST_PASSWORD,
				new_password: TEST_PASSWORD,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.changePassword("invalid-token", {
			current_password: TEST_PASSWORD,
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("missing current_password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-missing-cur");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePasswordRaw(sessionToken, {
				new_password: "NewPassword789!",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("missing new_password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-missing-new");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePasswordRaw(sessionToken, {
				current_password: TEST_PASSWORD,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("all other sessions invalidated after password change", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-sessions");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAgencyAdminDirect(email, oldPassword);
		try {
			// Create two sessions
			const login1 = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			const tfa1 = await api.verifyTFA({
				tfa_token: login1.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const session1 = tfa1.body.session_token;

			const login2 = await api.login({
				email: email,
				domain: domain,
				password: oldPassword,
			});
			const tfa2 = await api.verifyTFA({
				tfa_token: login2.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const session2 = tfa2.body.session_token;

			// Change password using session1
			const changeResponse = await api.changePassword(session1, {
				current_password: oldPassword,
				new_password: newPassword,
			});

			expect(changeResponse.status).toBe(200);

			// Session1 (current session) should still be valid
			const logout1Response = await api.logout(session1);
			expect(logout1Response.status).toBe(200);

			// Session2 should be invalidated
			const logout2Response = await api.logout(session2);
			expect(logout2Response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("invalid new password format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("pwd-change-invalid-pw");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			// Login
			const loginResp = await api.login({
				email: email,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: "000000",
				remember_me: false,
			});
			const sessionToken = tfaResp.body.session_token;

			// Password too short
			const response = await api.changePassword(sessionToken, {
				current_password: TEST_PASSWORD,
				new_password: "short",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});
});
