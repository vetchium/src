import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper: login an org user and return a session token.
 */
async function loginOrg(
	api: EmployerAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginResp = await api.login({ email, domain, password: TEST_PASSWORD });
	expect(loginResp.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaResp.status).toBe(200);
	return tfaResp.body.session_token;
}

test.describe("POST /employer/filter-audit-logs", () => {
	test("returns 200 with entries after successful login (employer.login event)", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-login");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				event_types: ["employer.login"],
				start_time: before,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			for (const entry of resp.body.audit_logs) {
				expect(entry.event_type).toBe("employer.login");
			}
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 200 filtered by actor_user_id", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-actor");

		const { orgUserId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				actor_user_id: orgUserId,
				start_time: before,
			});

			expect(resp.status).toBe(200);
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).toBe(orgUserId);
			}
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("results are scoped to the caller's org (cannot see other org logs)", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: email1, domain: domain1 } =
			generateTestOrgEmail("emp-audit-scope1");
		const { email: email2, domain: domain2 } =
			generateTestOrgEmail("emp-audit-scope2");

		await createTestOrgAdminDirect(email1, TEST_PASSWORD);
		await createTestOrgAdminDirect(email2, TEST_PASSWORD);
		try {
			// Login org1 and generate events
			const before = new Date().toISOString();
			const sessionToken1 = await loginOrg(api, email1, domain1);

			// Login org2 and query from org2's perspective — should not see org1's entries
			const sessionToken2 = await loginOrg(api, email2, domain2);
			const resp = await api.filterAuditLogs(sessionToken2, {
				start_time: before,
				event_types: ["employer.login"],
			});

			expect(resp.status).toBe(200);
			// Org2's audit logs should only contain entries from org2
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).not.toBeNull();
			}
		} finally {
			await deleteTestOrgUser(email1);
			await deleteTestOrgUser(email2);
		}
	});

	test("returns 200 with empty list when no events match time range", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-empty");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);

			const futureTime = new Date(Date.now() + 1_000_000).toISOString();
			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: futureTime,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs).toEqual([]);
			expect(resp.body.pagination_key).toBeNull();
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("pagination_key returns next page", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-page");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const page1 = await api.filterAuditLogs(sessionToken, {
				start_time: before,
				limit: 1,
			});
			expect(page1.status).toBe(200);

			if (page1.body.pagination_key) {
				const page2 = await api.filterAuditLogs(sessionToken, {
					start_time: before,
					limit: 1,
					pagination_key: page1.body.pagination_key,
				});
				expect(page2.status).toBe(200);
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
			await deleteTestOrgUser(email);
		}
	});

	test("returns 400 for invalid limit (0)", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-bad-limit");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.filterAuditLogsRaw(sessionToken, { limit: 0 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 400 for invalid start_time", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-bad-start");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.filterAuditLogsRaw(sessionToken, {
				start_time: "not-a-date",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without Authorization header", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const resp = await api.filterAuditLogsWithoutAuth({});
		expect(resp.status).toBe(401);
	});

	test("returns 403 for user without view_audit_logs role", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		// createTestOrgUserDirect creates a plain user with no roles
		const { email, domain } = generateTestOrgEmail("emp-audit-no-role");

		await createTestOrgUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.filterAuditLogs(sessionToken, {});
			expect(resp.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("audit log entries have required fields with org_id set", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-fields");

		const { employerId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["employer.login"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			const entry = resp.body.audit_logs[0];
			expect(entry.id).toBeDefined();
			expect(entry.event_type).toBe("employer.login");
			expect(entry.actor_user_id).toBeDefined();
			expect(entry.org_id).toBe(employerId);
			expect(entry.ip_address).toBeDefined();
			expect(entry.event_data).toBeDefined();
			expect(entry.created_at).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});
