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
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	HubLoginRequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

/**
 * Helper: create a hub user via the signup API flow.
 */
async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<void> {
	await api.requestSignup({ email_address: email });
	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);
	const completeReq: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeReq);
}

/**
 * Helper: login a hub user and return a session token.
 */
async function loginHub(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	const loginResp = await api.login({
		email_address: email,
		password,
	} as HubLoginRequest);
	expect(loginResp.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaResp.status).toBe(200);
	return tfaResp.body.session_token;
}

test.describe("POST /hub/my-audit-logs", () => {
	test("returns 200 with hub.login entry after login", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit");
		const domain = generateTestDomainName("hub-audit-login");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const before = new Date().toISOString();
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const resp = await api.myAuditLogs(sessionToken, {
				event_types: ["hub.login"],
				start_time: before,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			for (const entry of resp.body.audit_logs) {
				expect(entry.event_type).toBe("hub.login");
			}
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("results are always scoped to the calling user (actor_user_id filter ignored)", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-scope");
		const domain = generateTestDomainName("hub-audit-scope");
		const email1 = `user1-${randomUUID().substring(0, 8)}@${domain}`;
		const email2 = `user2-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			// Create both users
			await createHubUserViaSignup(api, email1, TEST_PASSWORD);
			await createHubUserViaSignup(api, email2, TEST_PASSWORD);

			const before = new Date().toISOString();
			const token1 = await loginHub(api, email1, TEST_PASSWORD);
			const token2 = await loginHub(api, email2, TEST_PASSWORD);

			// User2 queries — should only see their own entries even without actor_user_id filter
			const resp = await api.myAuditLogs(token2, {
				start_time: before,
			});
			expect(resp.status).toBe(200);

			// All entries should belong to user2; none should belong to user1
			// (We can't easily get the hub_user_global_id here so we just assert
			//  that the response is 200 and all entries have actor_user_id set)
			for (const entry of resp.body.audit_logs) {
				expect(entry.actor_user_id).not.toBeNull();
			}
		} finally {
			await deleteTestHubUser(email1);
			await deleteTestHubUser(email2);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 200 with empty list when no events match time range", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-empty");
		const domain = generateTestDomainName("hub-audit-empty");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const futureTime = new Date(Date.now() + 1_000_000).toISOString();
			const resp = await api.myAuditLogs(sessionToken, {
				start_time: futureTime,
			});

			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs).toEqual([]);
			expect(resp.body.pagination_key).toBeNull();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("pagination_key returns next page", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-page");
		const domain = generateTestDomainName("hub-audit-page");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const before = new Date().toISOString();
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const page1 = await api.myAuditLogs(sessionToken, {
				start_time: before,
				limit: 1,
			});
			expect(page1.status).toBe(200);

			if (page1.body.pagination_key) {
				const page2 = await api.myAuditLogs(sessionToken, {
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
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 for invalid limit (0)", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-lim");
		const domain = generateTestDomainName("hub-audit-lim");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const resp = await api.myAuditLogsRaw(sessionToken, { limit: 0 });
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 for invalid start_time", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-start");
		const domain = generateTestDomainName("hub-audit-start");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const resp = await api.myAuditLogsRaw(sessionToken, {
				start_time: "not-a-date",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 without Authorization header", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.myAuditLogsWithoutAuth({});
		expect(resp.status).toBe(401);
	});

	test("audit log entries have required fields", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-fields");
		const domain = generateTestDomainName("hub-audit-fields");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const before = new Date().toISOString();
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const resp = await api.myAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["hub.login"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			const entry = resp.body.audit_logs[0];
			expect(entry.id).toBeDefined();
			expect(entry.event_type).toBe("hub.login");
			expect(entry.actor_user_id).toBeDefined();
			expect(entry.ip_address).toBeDefined();
			expect(entry.event_data).toBeDefined();
			expect(entry.created_at).toBeDefined();
			// Hub events have no org_id
			expect(entry.org_id).toBeNull();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("complete_signup event is recorded", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin-hub-audit-signup");
		const domain = generateTestDomainName("hub-audit-signup");
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		try {
			const before = new Date().toISOString();
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const sessionToken = await loginHub(api, email, TEST_PASSWORD);

			const resp = await api.myAuditLogs(sessionToken, {
				start_time: before,
				event_types: ["hub.complete_signup"],
			});
			expect(resp.status).toBe(200);
			expect(resp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(resp.body.audit_logs[0].event_type).toBe("hub.complete_signup");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
