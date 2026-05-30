/**
 * Tests for org watcher endpoints:
 * - POST /org/add-watcher
 * - POST /org/remove-watcher
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestOpeningDirect,
	createTestOrgUserDirect,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import { generateOrgUserEmail } from "../../../lib/db";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
	const loginRes = await api.login(loginReq);
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	} as OrgTFARequest);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

test.describe("Org Watchers", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("org-watchers");
	const watcherEmail = generateOrgUserEmail("watcher-user", orgDomain);
	const noRoleEmail = generateOrgUserEmail("norole-watcher", orgDomain);

	let adminToken: string;
	let watcherToken: string;
	let noRoleToken: string;
	let orgId: string;
	let orgUserId: string;
	let watcherUserId: string;
	let openingId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		orgUserId = adminResult.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		// Watcher user: has org:manage_openings role
		const watcherResult = await createTestOrgUserDirect(
			watcherEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain: orgDomain }
		);
		watcherUserId = watcherResult.orgUserId;
		await assignRoleToOrgUser(watcherUserId, "org:manage_openings");
		watcherToken = await loginOrgUser(orgApi, watcherEmail, orgDomain);

		// No-role user
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, orgDomain);

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Watcher Test Opening"
		);
		openingId = opening.openingId;
	});

	test.afterAll(async () => {
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── add-watcher ─────────────────────────────────────────────────────────────

	test("add-watcher: org:manage_openings user can add a watcher — audit log written", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const res = await api.addWatcher(adminToken, {
			opening_id: openingId,
			watcher_email_address: watcherEmail,
		});
		expect(res.status).toBe(200);

		// Audit log
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.add_watcher"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.add_watcher"
		);
		expect(entry).toBeDefined();
	});

	test("add-watcher: no-role user gets 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.addWatcher(noRoleToken, {
			opening_id: openingId,
			watcher_email_address: watcherEmail,
		});
		expect(res.status).toBe(403);
	});

	test("add-watcher: 400 when watcher org user not found", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.addWatcher(adminToken, {
			opening_id: openingId,
			watcher_email_address: "nonexistent@" + orgDomain,
		});
		expect(res.status).toBe(400);
	});

	test("add-watcher: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/add-watcher", {
			data: {
				opening_id: openingId,
				watcher_email_address: watcherEmail,
			},
		});
		expect(res.status()).toBe(401);
	});

	// ─── remove-watcher ───────────────────────────────────────────────────────────

	test("remove-watcher: org:manage_openings user can remove a watcher — audit log written", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		// Add first (idempotent)
		await api.addWatcher(adminToken, {
			opening_id: openingId,
			watcher_email_address: watcherEmail,
		});

		const res = await api.removeWatcher(adminToken, {
			opening_id: openingId,
			org_user_id: watcherUserId,
		});
		expect(res.status).toBe(200);

		// Audit log
		const auditRes = await api.listAuditLogs(adminToken, {
			event_types: ["org.remove_watcher"],
		});
		const entry = auditRes.body!.audit_logs.find(
			(e: { event_type: string }) => e.event_type === "org.remove_watcher"
		);
		expect(entry).toBeDefined();
	});

	test("remove-watcher: no-role user gets 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.removeWatcher(noRoleToken, {
			opening_id: openingId,
			org_user_id: watcherUserId,
		});
		expect(res.status).toBe(403);
	});

	test("remove-watcher: 401 when unauthenticated", async ({ request }) => {
		const res = await request.post("/org/remove-watcher", {
			data: { opening_id: openingId, org_user_id: watcherUserId },
		});
		expect(res.status()).toBe(401);
	});
});
