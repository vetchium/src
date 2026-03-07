import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	createTestAdminAdminDirect,
	deleteTestAdminUser,
	generateTestEmail,
	updateTestAdminUserStatus,
} from "../../../lib/db";
import { getTfaCodeFromEmail, waitForEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("POST /admin/login", () => {
	test("successful login returns TFA token and sends email", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("login-success");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const response = await api.login({ email, password });

			expect(response.status).toBe(200);
			expect(response.body.tfa_token).toBeDefined();
			// TFA token should be 64-character hex string (32 bytes hex-encoded)
			expect(response.body.tfa_token).toMatch(/^[a-f0-9]{64}$/);

			// Verify TFA email was sent (uses exponential backoff)
			const emailMessage = await waitForEmail(email);
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
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("non-existent email returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("nonexistent");

		const response = await api.login({ email, password: TEST_PASSWORD });

		expect(response.status).toBe(401);
	});

	test("wrong password returns 401 and records admin.login_failed audit log", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("wrong-password");
		const watcherEmail = generateTestEmail("login-failed-watcher");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		// Watcher user with view_audit_logs role to verify the audit log entry
		await createTestAdminAdminDirect(watcherEmail, password);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const response = await api.login({
				email,
				password: "WrongPassword456!",
			});
			expect(response.status).toBe(401);

			// Login as watcher to query audit logs
			const watcherLoginResp = await api.login({
				email: watcherEmail,
				password,
			});
			const watcherTfaCode = await getTfaCodeFromEmail(watcherEmail);
			const watcherTfaResp = await api.verifyTFA({
				tfa_token: watcherLoginResp.body.tfa_token,
				tfa_code: watcherTfaCode,
			});
			const watcherToken = watcherTfaResp.body.session_token;

			// login_failed should be recorded even though login returned 401
			const auditResp = await api.filterAuditLogs(watcherToken, {
				event_types: ["admin.login_failed"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"admin.login_failed"
			);
			// login_failed events have no actor (unauthenticated)
			expect(auditResp.body.audit_logs[0].actor_user_id).toBeNull();
		} finally {
			await deleteTestAdminUser(email);
			await deleteTestAdminUser(watcherEmail);
		}
	});

	test("disabled admin returns 422", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disabled-admin");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password, "disabled");
		try {
			const response = await api.login({ email, password });

			expect(response.status).toBe(422);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.loginRaw({
			password: TEST_PASSWORD,
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
			password: TEST_PASSWORD,
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
