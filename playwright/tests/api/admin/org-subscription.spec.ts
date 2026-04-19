import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUserDirect,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	setOrgTier,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminListOrgSubscriptionsRequest,
	AdminSetOrgTierRequest,
} from "vetchium-specs/org/tiers";

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

// ============================================================================
// POST /admin/org-subscriptions/list
// ============================================================================
test.describe("POST /admin/org-subscriptions/list", () => {
	test("Success: admin with view role can list org subscriptions (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-list-admin");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail, domain } = generateTestOrgEmail("sub-list-org");
		await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(adminUserId, "admin:view_org_subscriptions");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			const token = await loginAdmin(api, adminEmail);

			const req: AdminListOrgSubscriptionsRequest = {};
			const res = await api.listOrgSubscriptions(token, req);
			expect(res.status).toBe(200);
			expect(res.body!.items).toBeDefined();
			expect(Array.isArray(res.body!.items)).toBe(true);
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Success: filter by tier_id returns matching orgs (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-list-filter");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail } = generateTestOrgEmail("sub-list-filter-org");
		const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(adminUserId, "admin:view_org_subscriptions");
			// Upgrade this org to gold for filtering
			await setOrgTier(orgId, "gold");
			const token = await loginAdmin(api, adminEmail);

			const req: AdminListOrgSubscriptionsRequest = {
				filter_tier_id: "gold",
			};
			const res = await api.listOrgSubscriptions(token, req);
			expect(res.status).toBe(200);
			for (const item of res.body!.items) {
				expect(item.current_tier.tier_id).toBe("gold");
			}
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 with invalid filter_tier_id", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-list-bad");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		try {
			await assignRoleToAdminUser(adminUserId, "admin:view_org_subscriptions");
			const token = await loginAdmin(api, adminEmail);
			const res = await api.listOrgSubscriptionsRaw(token, {
				filter_tier_id: "invalid",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 without authentication", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const req: AdminListOrgSubscriptionsRequest = {};
		const res = await api.listOrgSubscriptions("invalid-token", req);
		expect(res.status).toBe(401);
	});

	test.describe("RBAC", () => {
		test("admin with view_org_subscriptions role can list (200)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("sub-list-rbac-view");
			const { userId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			try {
				await assignRoleToAdminUser(userId, "admin:view_org_subscriptions");
				const token = await loginAdmin(api, adminEmail);
				const res = await api.listOrgSubscriptions(token, {});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});

		test("admin with no roles cannot list org subscriptions (403)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("sub-list-rbac-none");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);
			try {
				const token = await loginAdmin(api, adminEmail);
				const res = await api.listOrgSubscriptions(token, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});
});

// ============================================================================
// POST /admin/org-subscriptions/set-tier
// ============================================================================
test.describe("POST /admin/org-subscriptions/set-tier", () => {
	test("Success: admin can upgrade an org to gold (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-set-admin");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail } = generateTestOrgEmail("sub-set-org");
		const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(
				adminUserId,
				"admin:manage_org_subscriptions"
			);
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			const before = new Date(Date.now() - 2000).toISOString();
			const token = await loginAdmin(api, adminEmail);

			const req: AdminSetOrgTierRequest = {
				org_id: orgId,
				tier_id: "gold",
				reason: "Test upgrade to gold",
			};
			const res = await api.setOrgTier(token, req);
			expect(res.status).toBe(200);
			expect(res.body!.current_tier.tier_id).toBe("gold");
			expect(res.body!.org_id).toBe(orgId);

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["admin.org_subscription_granted"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Success: admin can downgrade an org (200) when usage fits", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-downgrade-admin");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail } = generateTestOrgEmail("sub-downgrade-org");
		const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(
				adminUserId,
				"admin:manage_org_subscriptions"
			);
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			// Set to gold first
			await setOrgTier(orgId, "gold");
			const token = await loginAdmin(api, adminEmail);

			const req: AdminSetOrgTierRequest = {
				org_id: orgId,
				tier_id: "silver",
				reason: "Test downgrade to silver",
			};
			const res = await api.setOrgTier(token, req);
			expect(res.status).toBe(200);
			expect(res.body!.current_tier.tier_id).toBe("silver");
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 404 for non-existent org", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-set-notfound");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		try {
			await assignRoleToAdminUser(
				adminUserId,
				"admin:manage_org_subscriptions"
			);
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			const token = await loginAdmin(api, adminEmail);
			const req: AdminSetOrgTierRequest = {
				org_id: "00000000-0000-0000-0000-000000000000",
				tier_id: "gold",
				reason: "Test",
			};
			const res = await api.setOrgTier(token, req);
			expect(res.status).toBe(404);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 with invalid tier_id", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-set-bad-tier");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail } = generateTestOrgEmail("sub-set-bad-org");
		const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(
				adminUserId,
				"admin:manage_org_subscriptions"
			);
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			const token = await loginAdmin(api, adminEmail);
			const res = await api.setOrgTierRaw(token, {
				org_id: orgId,
				tier_id: "platinum",
				reason: "Test",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 400 with missing reason", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("sub-set-no-reason");
		const { userId: adminUserId } = await createTestAdminUserDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail } = generateTestOrgEmail("sub-set-no-reason-org");
		const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		try {
			await assignRoleToAdminUser(
				adminUserId,
				"admin:manage_org_subscriptions"
			);
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");
			const token = await loginAdmin(api, adminEmail);
			const res = await api.setOrgTierRaw(token, {
				org_id: orgId,
				tier_id: "gold",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(orgEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 without authentication", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const req: AdminSetOrgTierRequest = {
			org_id: "00000000-0000-0000-0000-000000000000",
			tier_id: "gold",
			reason: "Test",
		};
		const res = await api.setOrgTier("invalid-token", req);
		expect(res.status).toBe(401);
	});

	test.describe("RBAC", () => {
		test("admin with manage_org_subscriptions role can set tier (200)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("sub-set-rbac-manage");
			const { userId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: orgEmail } = generateTestOrgEmail("sub-set-rbac-org");
			const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			try {
				await assignRoleToAdminUser(userId, "admin:manage_org_subscriptions");
				const token = await loginAdmin(api, adminEmail);
				const req: AdminSetOrgTierRequest = {
					org_id: orgId,
					tier_id: "silver",
					reason: "RBAC test upgrade",
				};
				const res = await api.setOrgTier(token, req);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(orgEmail);
				await deleteTestAdminUser(adminEmail);
			}
		});

		test("admin with no roles cannot set tier (403)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("sub-set-rbac-none");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);
			const { email: orgEmail } = generateTestOrgEmail("sub-set-rbac-none-org");
			const { orgId } = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			try {
				const token = await loginAdmin(api, adminEmail);
				const req: AdminSetOrgTierRequest = {
					org_id: orgId,
					tier_id: "gold",
					reason: "Should fail",
				};
				const res = await api.setOrgTier(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(orgEmail);
				await deleteTestAdminUser(adminEmail);
			}
		});
	});
});
