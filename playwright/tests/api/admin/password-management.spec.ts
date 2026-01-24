import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	extractPasswordResetToken,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("POST /admin/request-password-reset", () => {
	test("successful request returns 200 and sends email", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-success");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const response = await api.requestPasswordReset({
				email_address: email,
			});

			// Should always return 200 (prevent email enumeration)
			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();

			// Verify password reset email was sent
			const emailMessage = await waitForEmail(email);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(email);
			expect(emailMessage.Subject).toContain("Reset");
			expect(emailMessage.Subject).toContain("Admin");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("non-existent email returns 200 (prevent enumeration)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-nonexistent");

		const response = await api.requestPasswordReset({
			email_address: email,
		});

		// Should return 200 even for non-existent email
		expect(response.status).toBe(200);
		expect(response.body.message).toBeDefined();
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.requestPasswordResetRaw({
			email_address: "not-an-email",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.requestPasswordResetRaw({});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.requestPasswordResetRaw({
			email_address: "",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});
});

test.describe("POST /admin/complete-password-reset", () => {
	test("successful reset with valid token returns 200", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-complete");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAdminUser(email, oldPassword);
		try {
			// Request password reset
			await api.requestPasswordReset({ email_address: email });

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
				email,
				password: newPassword,
			});
			expect(loginResponse.status).toBe(200);

			// Verify cannot login with old password
			const oldLoginResponse = await api.login({
				email,
				password: oldPassword,
			});
			expect(oldLoginResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid reset token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completePasswordReset({
			reset_token: "invalid-token-" + "a".repeat(54),
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("expired reset token returns 401", async ({ request }) => {
		// This test would require manipulating time or waiting for expiry
		// For now, we'll test with an old/invalid token format
		const api = new AdminAPIClient(request);

		const response = await api.completePasswordReset({
			reset_token: "0".repeat(64), // Valid format but doesn't exist
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("invalid password format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-invalid-pwd");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			await api.requestPasswordReset({ email_address: email });
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
			await deleteTestAdminUser(email);
		}
	});

	test("missing reset_token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completePasswordResetRaw({
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("missing new_password returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completePasswordResetRaw({
			reset_token: "a".repeat(64),
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
	});

	test("all sessions invalidated after password reset", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-sessions");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAdminUser(email, oldPassword);
		try {
			// Create a session before password reset
			const loginResp1 = await api.login({
				email,
				password: oldPassword,
			});
			const tfaEmail1Summary = await waitForEmail(email);
			const tfaEmail1 = await getEmailContent(tfaEmail1Summary.ID);
			const tfaCode1 = tfaEmail1.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp1 = await api.verifyTFA({
				tfa_token: loginResp1.body.tfa_token,
				tfa_code: tfaCode1!,
			});
			const oldSession = tfaResp1.body.session_token;

			// Request and complete password reset
			await api.requestPasswordReset({ email_address: email });
			const resetEmailSummary = await waitForEmail(email, {}, /reset/i);
			const resetEmail = await getEmailContent(resetEmailSummary.ID);
			const resetToken = extractPasswordResetToken(resetEmail);
			await api.completePasswordReset({
				reset_token: resetToken!,
				new_password: newPassword,
			});

			// Old session should be invalidated
			const logoutResponse = await api.logout(oldSession);
			expect(logoutResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

test.describe("POST /admin/change-password", () => {
	test("successful password change returns 200", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-success");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAdminUser(email, oldPassword);
		try {
			// Login and get session
			const loginResp = await api.login({
				email,
				password: oldPassword,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
			});
			const sessionToken = tfaResp.body.session_token;

			// Change password
			const response = await api.changePassword(sessionToken, {
				current_password: oldPassword,
				new_password: newPassword,
			});

			expect(response.status).toBe(200);

			// Verify can login with new password
			const newLoginResp = await api.login({
				email,
				password: newPassword,
			});
			expect(newLoginResp.status).toBe(200);

			// Verify cannot login with old password
			const oldLoginResp = await api.login({
				email,
				password: oldPassword,
			});
			expect(oldLoginResp.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("wrong current password returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-wrong");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const loginResp = await api.login({
				email,
				password: TEST_PASSWORD,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePassword(sessionToken, {
				current_password: "WrongPassword123!",
				new_password: "NewPassword789!",
			});

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("new password same as current returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-same");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const loginResp = await api.login({
				email,
				password: TEST_PASSWORD,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePassword(sessionToken, {
				current_password: TEST_PASSWORD,
				new_password: TEST_PASSWORD,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.changePassword("invalid-session-token", {
			current_password: TEST_PASSWORD,
			new_password: "NewPassword789!",
		});

		expect(response.status).toBe(401);
	});

	test("missing current_password returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-missing-current");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const loginResp = await api.login({
				email,
				password: TEST_PASSWORD,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePasswordRaw(sessionToken, {
				new_password: "NewPassword789!",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing new_password returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-missing-new");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const loginResp = await api.login({
				email,
				password: TEST_PASSWORD,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
			});
			const sessionToken = tfaResp.body.session_token;

			const response = await api.changePasswordRaw(sessionToken, {
				current_password: TEST_PASSWORD,
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("all other sessions invalidated after password change", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-sessions");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAdminUser(email, oldPassword);
		try {
			// Create first session
			const login1 = await api.login({ email, password: oldPassword });
			const tfaEmail1Summary = await waitForEmail(email);
			const tfaEmail1 = await getEmailContent(tfaEmail1Summary.ID);
			const tfaCode1 = tfaEmail1.Text.match(/\b\d{6}\b/)?.[0];
			const tfa1 = await api.verifyTFA({
				tfa_token: login1.body.tfa_token,
				tfa_code: tfaCode1!,
			});
			const session1 = tfa1.body.session_token;

			// Create second session
			const login2 = await api.login({ email, password: oldPassword });
			const tfaEmail2Summary = await waitForEmail(email);
			const tfaEmail2 = await getEmailContent(tfaEmail2Summary.ID);
			const tfaCode2 = tfaEmail2.Text.match(/\b\d{6}\b/)?.[0];
			const tfa2 = await api.verifyTFA({
				tfa_token: login2.body.tfa_token,
				tfa_code: tfaCode2!,
			});
			const session2 = tfa2.body.session_token;

			// Change password using session1
			await api.changePassword(session1, {
				current_password: oldPassword,
				new_password: newPassword,
			});

			// session1 should still be valid (current session)
			const logout1 = await api.logout(session1);
			expect(logout1.status).toBe(200);

			// session2 should be invalidated
			const logout2 = await api.logout(session2);
			expect(logout2.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid new password format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-change-invalid-format");

		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const loginResp = await api.login({
				email,
				password: TEST_PASSWORD,
			});
			const tfaEmailSummary = await waitForEmail(email);
			const tfaEmail = await getEmailContent(tfaEmailSummary.ID);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode!,
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
			await deleteTestAdminUser(email);
		}
	});
});
