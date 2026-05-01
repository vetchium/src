import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgPlan,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { UpgradeOrgPlanRequest } from "vetchium-specs/org/tiers";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginRes = await api.login(loginReq);
	expect(loginRes.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaRes = await api.verifyTFA(tfaReq);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

// ============================================================================
// POST /org/org-plan/list-plans
// ============================================================================
test.describe("POST /org/org-plan/list-plans", () => {
	test("Success: returns list of plans for authenticated user (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-list-tiers");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const token = await loginOrgUser(api, email, domain);
			const res = await api.listPlans(token);
			expect(res.status).toBe(200);
			expect(res.body!.plans).toBeDefined();
			expect(res.body!.plans.length).toBeGreaterThanOrEqual(1);
			// verify free plan exists
			const freePlan = res.body!.plans.find((t) => t.plan_id === "free");
			expect(freePlan).toBeDefined();
			expect(freePlan!.self_upgradeable).toBe(false);
			// verify silver plan is self-upgradeable
			const silverPlan = res.body!.plans.find((t) => t.plan_id === "silver");
			expect(silverPlan).toBeDefined();
			expect(silverPlan!.self_upgradeable).toBe(true);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without authentication", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listPlans("invalid-token");
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// POST /org/org-plan/get
// ============================================================================
test.describe("POST /org/org-plan/get", () => {
	test("Success: superadmin can get own plan (200)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-get");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const token = await loginOrgUser(api, email, domain);
			const res = await api.getMyOrgPlan(token);
			expect(res.status).toBe(200);
			expect(res.body!.org_id).toBe(orgId);
			expect(res.body!.current_plan).toBeDefined();
			expect(res.body!.current_plan.plan_id).toBe("free");
			expect(res.body!.usage).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without authentication", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getMyOrgPlan("invalid-token");
		expect(res.status).toBe(401);
	});

	test.describe("RBAC", () => {
		test("user with org:view_plan role can get plan (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("sub-get-rbac-view");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const viewerEmail = `viewer@${domain}`;
			const { orgUserId } = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);
			try {
				await assignRoleToOrgUser(orgUserId, "org:view_plan");
				const token = await loginOrgUser(api, viewerEmail, domain);
				const res = await api.getMyOrgPlan(token);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(viewerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("user with no roles cannot get plan (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("sub-get-rbac-none");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});
			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.getMyOrgPlan(token);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});
});

// ============================================================================
// POST /org/org-plan/upgrade
// ============================================================================
test.describe("POST /org/org-plan/upgrade", () => {
	test("Success: superadmin can self-upgrade from free to silver (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-upgrade");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const token = await loginOrgUser(api, email, domain);
			const req: UpgradeOrgPlanRequest = { plan_id: "silver" };
			const res = await api.upgradeOrgPlan(token, req);
			expect(res.status).toBe(200);

			// Verify plan updated via the returned body
			expect(res.body).toBeDefined();

			// Verify with explicit get
			const getRes = await api.getMyOrgPlan(token);
			expect(getRes.status).toBe(200);
			expect(getRes.body!.current_plan.plan_id).toBe("silver");

			// Audit log assertion
			const auditRes = await api.listAuditLogs(token, {
				event_types: ["org.plan_upgraded"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 422 when trying to self-upgrade to enterprise (not self-upgradeable)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-upgrade-ent");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const token = await loginOrgUser(api, email, domain);
			const req: UpgradeOrgPlanRequest = { plan_id: "enterprise" };
			const res = await api.upgradeOrgPlan(token, req);
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 422 when trying to downgrade via self-upgrade", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-downgrade");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			// Set to silver first
			await setOrgPlan(orgId, "silver");
			const token = await loginOrgUser(api, email, domain);
			const req: UpgradeOrgPlanRequest = { plan_id: "free" };
			const res = await api.upgradeOrgPlan(token, req);
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 400 with invalid plan_id", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("sub-upgrade-bad");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			const token = await loginOrgUser(api, email, domain);
			const res = await api.upgradeOrgPlanRaw(token, {
				plan_id: "invalid-plan",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without authentication", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const req: UpgradeOrgPlanRequest = { plan_id: "silver" };
		const res = await api.upgradeOrgPlan("invalid-token", req);
		expect(res.status).toBe(401);
	});

	test.describe("RBAC", () => {
		test("user with org:manage_plan role can self-upgrade (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail(
				"sub-upgrade-rbac-manage"
			);
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const managerEmail = `manager@${domain}`;
			const { orgUserId } = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);
			try {
				await assignRoleToOrgUser(orgUserId, "org:manage_plan");
				const token = await loginOrgUser(api, managerEmail, domain);
				const req: UpgradeOrgPlanRequest = { plan_id: "silver" };
				const res = await api.upgradeOrgPlan(token, req);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("user with no roles cannot self-upgrade (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail(
				"sub-upgrade-rbac-none"
			);
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});
			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const req: UpgradeOrgPlanRequest = { plan_id: "silver" };
				const res = await api.upgradeOrgPlan(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});
});
