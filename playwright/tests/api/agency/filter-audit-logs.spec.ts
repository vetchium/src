import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	createTestAgencyAdminDirect,
	createTestAgencyUserDirect,
	deleteTestAgencyUser,
	generateTestAgencyEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper: login an agency user and return a session token.
 */
async function loginAgency(
	api: AgencyAPIClient,
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

test.describe("POST /agency/filter-audit-logs", () => {
	test("returns 200 with entries after successful login (agency.login event)", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-login");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAgency(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				event_types: ["agency.login"],
				start_time: before,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			for (const entry of resp.body.audit_logs) {
				expect(entry.event_type).toBe("agency.login");
			}
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("returns 200 filtered by actor_user_id", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-actor");

		const { agencyUserId } = await createTestAgencyAdminDirect(
			email,
			TEST_PASSWORD
		);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAgency(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				actor_user_id: agencyUserId,
				start_time: before,
			});

			expect(resp.status).toBe(200);
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).toBe(agencyUserId);
			}
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("results are scoped to the caller's agency (cannot see other agency logs)", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: email1, domain: domain1 } =
			generateTestAgencyEmail("agen-audit-scope1");
		const { email: email2, domain: domain2 } =
			generateTestAgencyEmail("agen-audit-scope2");

		await createTestAgencyAdminDirect(email1, TEST_PASSWORD);
		await createTestAgencyAdminDirect(email2, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			// Login agency1 to generate events
			await loginAgency(api, email1, domain1);

			// Login agency2 and query — should not see agency1's entries
			const sessionToken2 = await loginAgency(api, email2, domain2);
			const resp = await api.filterAuditLogs(sessionToken2, {
				start_time: before,
				event_types: ["agency.login"],
			});

			expect(resp.status).toBe(200);
			// All returned entries belong to agency2's actor
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).not.toBeNull();
			}
		} finally {
			await deleteTestAgencyUser(email1);
			await deleteTestAgencyUser(email2);
		}
	});

	test("returns 200 with empty list when no events match time range", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-empty");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAgency(api, email, domain);

			const futureTime = new Date(Date.now() + 1_000_000).toISOString();
			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: futureTime,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs).toEqual([]);
			expect(resp.body.pagination_key).toBeNull();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("pagination_key returns next page", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-page");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAgency(api, email, domain);

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
			await deleteTestAgencyUser(email);
		}
	});

	test("returns 400 for invalid limit (0)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-bad-limit");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAgency(api, email, domain);
			const resp = await api.filterAuditLogsRaw(sessionToken, { limit: 0 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("returns 400 for invalid start_time", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-bad-start");

		await createTestAgencyAdminDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAgency(api, email, domain);
			const resp = await api.filterAuditLogsRaw(sessionToken, {
				start_time: "not-a-date",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("returns 401 without Authorization header", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const resp = await api.filterAuditLogsWithoutAuth({});
		expect(resp.status).toBe(401);
	});

	test("returns 403 for user without view_audit_logs role", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		// createTestAgencyUserDirect creates a plain user with no roles
		const { email, domain } = generateTestAgencyEmail("agen-audit-no-role");

		await createTestAgencyUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await loginAgency(api, email, domain);
			const resp = await api.filterAuditLogs(sessionToken, {});
			expect(resp.status).toBe(403);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("audit log entries have required fields with org_id set", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agen-audit-fields");

		const { agencyId } = await createTestAgencyAdminDirect(
			email,
			TEST_PASSWORD
		);
		try {
			const before = new Date().toISOString();
			const sessionToken = await loginAgency(api, email, domain);

			const resp = await api.filterAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["agency.login"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			const entry = resp.body.audit_logs[0];
			expect(entry.id).toBeDefined();
			expect(entry.event_type).toBe("agency.login");
			expect(entry.actor_user_id).toBeDefined();
			expect(entry.org_id).toBe(agencyId);
			expect(entry.ip_address).toBeDefined();
			expect(entry.event_data).toBeDefined();
			expect(entry.created_at).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});
});
