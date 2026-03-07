import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminAdminDirect,
	createTestAdminUserDirect,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper: login an admin user and return a session token.
 */
async function loginAdmin(api: AdminAPIClient, email: string): Promise<string> {
	const loginResp = await api.login({ email, password: TEST_PASSWORD });
	expect(loginResp.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaResp.status).toBe(200);
	return tfaResp.body.session_token;
}

test.describe("POST /admin/filter-audit-logs", () => {
	test("returns 200 with empty list when no events match", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-empty");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			// Use a future start_time so no events match
			const futureTime = new Date(Date.now() + 1_000_000).toISOString();
			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: futureTime,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs).toEqual([]);
			expect(resp.body.pagination_key).toBeNull();
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 200 with entries filtered by event_types", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-event-type");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAdmin(api, email);

			// After login we expect an admin.login entry; filter for it
			const resp = await api.filterAuditLogs(sessionToken, {
				event_types: ["admin.login"],
				start_time: before,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			for (const entry of resp.body.audit_logs) {
				expect(entry.event_type).toBe("admin.login");
			}
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 200 filtered by actor_user_id", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-actor");

		const { userId } = await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogs(sessionToken, {
				actor_user_id: userId,
				start_time: before,
			});

			expect(resp.status).toBe(200);
			// All returned entries should have this actor
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).toBe(userId);
			}
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 200 with limit applied", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-limit");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogs(sessionToken, {
				limit: 1,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeLessThanOrEqual(1);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("pagination_key returns next page", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-pagination");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAdmin(api, email);

			// Page 1 with limit=1
			const page1 = await api.filterAuditLogs(sessionToken, {
				start_time: before,
				limit: 1,
			});
			expect(page1.status).toBe(200);

			if (page1.body.pagination_key) {
				// Page 2
				const page2 = await api.filterAuditLogs(sessionToken, {
					start_time: before,
					limit: 1,
					pagination_key: page1.body.pagination_key,
				});
				expect(page2.status).toBe(200);
				// Entries on page 2 should not overlap with page 1
				if (
					page1.body.audit_logs.length > 0 &&
					page2.body.audit_logs.length > 0
				) {
					expect(page2.body.audit_logs[0].id).not.toBe(
						page1.body.audit_logs[0].id
					);
				}
			}
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 400 for invalid limit (0)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-bad-limit");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogsRaw(sessionToken, { limit: 0 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 400 for invalid limit (101)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-limit-overflow");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogsRaw(sessionToken, { limit: 101 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 400 for invalid start_time", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-bad-start");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogsRaw(sessionToken, {
				start_time: "not-a-timestamp",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 400 for invalid end_time", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-bad-end");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogsRaw(sessionToken, {
				end_time: "bad-date",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 401 without Authorization header", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const resp = await api.filterAuditLogsWithoutAuth({});
		expect(resp.status).toBe(401);
	});

	test("returns 403 for user without view_audit_logs role", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		// createTestAdminUserDirect creates a user with NO roles
		const email = generateTestEmail("filter-audit-logs-no-role");

		await createTestAdminUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogs(sessionToken, {});
			expect(resp.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("audit log entries have required fields", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("filter-audit-logs-fields");

		await createTestAdminAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAdmin(api, email);

			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["admin.login"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			const entry = resp.body.audit_logs[0];
			expect(entry.id).toBeDefined();
			expect(entry.event_type).toBe("admin.login");
			expect(entry.actor_user_id).toBeDefined();
			expect(entry.ip_address).toBeDefined();
			expect(entry.event_data).toBeDefined();
			expect(entry.created_at).toBeDefined();
			// Admin events have no org_id
			expect(entry.org_id).toBeNull();
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
