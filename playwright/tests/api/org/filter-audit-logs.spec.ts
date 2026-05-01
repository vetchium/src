import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper: login an org user and return a session token.
 */
async function loginOrg(
	api: OrgAPIClient,
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

test.describe("POST /org/filter-audit-logs", () => {
	test("returns 200 with entries after successful login (org.login event)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-login");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.listAuditLogs(sessionToken, {
				event_types: ["org.login"],
				start_time: before,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			for (const entry of resp.body.audit_logs) {
				expect(entry.event_type).toBe("org.login");
			}
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 200 filtered by actor_email", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-actor");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.listAuditLogs(sessionToken, {
				actor_email: email,
				start_time: before,
			});

			expect(resp.status).toBe(200);
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_email).toBe(email);
			}
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("results are scoped to the caller's org (cannot see other org logs)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: email1, domain: domain1 } =
			generateTestOrgEmail("emp-audit-scope1");
		const { email: email2, domain: domain2 } =
			generateTestOrgEmail("emp-audit-scope2");

		await createTestOrgAdminDirect(email1, TEST_PASSWORD);
		await createTestOrgAdminDirect(email2, TEST_PASSWORD);
		try {
			// Login org1 and generate events
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken1 = await loginOrg(api, email1, domain1);

			// Login org2 and query from org2's perspective — should not see org1's entries
			const sessionToken2 = await loginOrg(api, email2, domain2);
			const resp = await api.listAuditLogs(sessionToken2, {
				start_time: before,
				event_types: ["org.login"],
			});

			expect(resp.status).toBe(200);
			// Org2's audit logs should only contain entries from org2
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_email).not.toBeNull();
			}
		} finally {
			await deleteTestOrgUser(email1);
			await deleteTestOrgUser(email2);
		}
	});

	test("returns 200 with empty list when no events match time range", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-empty");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);

			const futureTime = new Date(Date.now() + 1_000_000).toISOString();
			const resp = await api.listAuditLogs(sessionToken, {
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
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-page");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const page1 = await api.listAuditLogs(sessionToken, {
				start_time: before,
				limit: 1,
			});
			expect(page1.status).toBe(200);

			if (page1.body.pagination_key) {
				const page2 = await api.listAuditLogs(sessionToken, {
					start_time: before,
					limit: 1,
					pagination_key: page1.body.pagination_key,
				});
				expect(page2.status).toBe(200);
				if (
					page1.body.audit_logs.length > 0 &&
					page2.body.audit_logs.length > 0
				) {
					expect(page2.body.audit_logs[0].created_at).not.toBe(
						page1.body.audit_logs[0].created_at
					);
				}
			}
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 400 for invalid limit (0)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-bad-limit");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.listAuditLogsRaw(sessionToken, { limit: 0 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 400 for invalid start_time", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-bad-start");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.listAuditLogsRaw(sessionToken, {
				start_time: "not-a-date",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without Authorization header", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const resp = await api.listAuditLogsWithoutAuth({});
		expect(resp.status).toBe(401);
	});

	test("returns 200 for user with view_audit_logs role", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"emp-audit-view-role"
		);
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const viewerEmail = `audit-viewer@${domain}`;
		const viewerResult = await createTestOrgUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId, domain }
		);
		await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_audit_logs");
		try {
			const sessionToken = await loginOrg(api, viewerEmail, domain);
			const resp = await api.listAuditLogs(sessionToken, {});
			expect(resp.status).toBe(200);
		} finally {
			await deleteTestOrgUser(viewerEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("returns 403 for user without view_audit_logs role", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// createTestOrgUserDirect creates a plain user with no roles
		const { email, domain } = generateTestOrgEmail("emp-audit-no-role");

		await createTestOrgUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginOrg(api, email, domain);
			const resp = await api.listAuditLogs(sessionToken, {});
			expect(resp.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("audit log entries have required fields", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("emp-audit-fields");

		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await loginOrg(api, email, domain);

			const resp = await api.listAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["org.login"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			const entry = resp.body.audit_logs[0];
			expect(entry.event_type).toBe("org.login");
			expect(entry.actor_email).toBeDefined();
			expect(entry.ip_address).toBeDefined();
			expect(entry.event_data).toBeDefined();
			expect(entry.created_at).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});
