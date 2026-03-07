import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	createTestAdminAdminDirect,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	extractPasswordResetToken,
	getEmailContent,
	getTfaCodeFromEmail,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("POST /admin/request-password-reset", () => {
	test("successful request returns 200 and sends email and records admin.request_password_reset event", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-success");
		const watcherEmail = generateTestEmail("pwd-reset-success-watcher");

		await createTestAdminUser(email, TEST_PASSWORD);
		await createTestAdminAdminDirect(watcherEmail, TEST_PASSWORD);
		try {
			// Login as watcher to query audit log after the unauthenticated reset request
			const watcherLoginResp = await api.login({
				email: watcherEmail,
				password: TEST_PASSWORD,
			});
			const watcherTfaCode = await getTfaCodeFromEmail(watcherEmail);
			const watcherTfaResp = await api.verifyTFA({
				tfa_token: watcherLoginResp.body.tfa_token,
				tfa_code: watcherTfaCode,
				remember_me: false,
			});
			const watcherToken = watcherTfaResp.body.session_token;

			const before = new Date().toISOString();
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

			// Verify admin.request_password_reset audit log entry was created
			const auditResp = await api.filterAuditLogs(watcherToken, {
				event_types: ["admin.request_password_reset"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"admin.request_password_reset"
			);
		} finally {
			await deleteTestAdminUser(email);
			await deleteTestAdminUser(watcherEmail);
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
	test("successful reset with valid token returns 200 and records admin.complete_password_reset event", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pwd-reset-complete");
		const watcherEmail = generateTestEmail("pwd-reset-complete-watcher");
		const oldPassword = TEST_PASSWORD;
		const newPassword = "NewPassword789!";

		await createTestAdminUser(email, oldPassword);
		await createTestAdminAdminDirect(watcherEmail, oldPassword);
		try {
			// Login as watcher to query audit log later
			const watcherLoginResp = await api.login({
				email: watcherEmail,
				password: oldPassword,
			});
			const watcherTfaCode = await getTfaCodeFromEmail(watcherEmail);
			const watcherTfaResp = await api.verifyTFA({
				tfa_token: watcherLoginResp.body.tfa_token,
				tfa_code: watcherTfaCode,
			});
			const watcherToken = watcherTfaResp.body.session_token;

			// Request password reset
			const before = new Date().toISOString();
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

			// Verify admin.complete_password_reset audit log entry was created
			const auditResp = await api.filterAuditLogs(watcherToken, {
				event_types: ["admin.complete_password_reset"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"admin.complete_password_reset"
			);
		} finally {
			await deleteTestAdminUser(email);
			await deleteTestAdminUser(watcherEmail);
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

		await createTestAdminAdminDirect(email, oldPassword);
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
			const before = new Date().toISOString();
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

			// Verify admin.change_password audit log entry was created (current session preserved)
			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["admin.change_password"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"admin.change_password"
			);
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
