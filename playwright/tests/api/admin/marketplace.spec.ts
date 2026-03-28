import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestAdminUser,
	createTestAdminAdminDirect,
	createTestAdminUserDirect,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	grantMarketplaceProviderCapability,
	createTestServiceListingDirect,
	setOrgCapabilityStatus,
	setServiceListingState,
	setServiceListingAppealingState,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

async function loginAdmin(api: AdminAPIClient, email: string): Promise<string> {
	const loginRes = await api.login({ email, password: TEST_PASSWORD });
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaRes.status).toBe(200);
	return tfaRes.body.session_token;
}

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
		remember_me: true,
	};
	const tfaRes = await api.verifyTFA(tfaReq);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

test.describe("Marketplace Admin API", () => {
	// ============================================================================
	// List Marketplace Provider Capabilities
	// ============================================================================
	test.describe("POST /admin/list-marketplace-provider-capabilities", () => {
		test("Success: admin with admin:manage_marketplace can list (200)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-admin-list-caps");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } =
				generateTestOrgEmail("mkt-admin-list-org");
			await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				// Org applies for capability
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				await orgApi.applyMarketplaceProviderCapability(orgToken, {});

				// Admin lists capabilities
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listMarketplaceProviderCapabilities(
					adminToken,
					{}
				);
				expect(res.status).toBe(200);
				expect(res.body?.capabilities).toBeDefined();
				expect(Array.isArray(res.body?.capabilities)).toBe(true);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.listMarketplaceProviderCapabilities(
				"invalid-token",
				{}
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: admin without manage_marketplace role (403)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-list-caps-norole");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listMarketplaceProviderCapabilities(
					adminToken,
					{}
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Approve Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /admin/approve-marketplace-provider-capability", () => {
		test("Success: pending_approval -> active (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-approve-cap");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-approve-cap-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				// Org applies
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				const applyRes = await orgApi.applyMarketplaceProviderCapability(
					orgToken,
					{}
				);
				expect(applyRes.status).toBe(200);

				// Admin approves
				const before = new Date(Date.now() - 2000).toISOString();
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const approveRes = await adminApi.approveMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(approveRes.status).toBe(200);

				// Verify capability is now active
				const getRes = await orgApi.getMarketplaceProviderCapability(
					orgToken,
					{}
				);
				expect(getRes.status).toBe(200);
				expect(getRes.body?.status).toBe("active");

				// Verify audit log
				const auditResp = await adminApi.filterAuditLogs(adminToken, {
					event_types: ["admin.approve_marketplace_provider_capability"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe(
					"admin.approve_marketplace_provider_capability"
				);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: capability not pending_approval (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-approve-cap-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-approve-cap-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			// Grant capability directly (already active)
			await grantMarketplaceProviderCapability(orgResult.orgId);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.approveMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Not found: org not found (404)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-approve-cap-404");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.approveMarketplaceProviderCapability(
					adminToken,
					{
						org_id: "00000000-0000-0000-0000-000000000000",
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.approveMarketplaceProviderCapability(
				"invalid-token",
				{
					org_id: "00000000-0000-0000-0000-000000000000",
					subscription_price: 100,
					currency: "USD",
					subscription_period_days: 365,
				}
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: admin without manage_marketplace role (403)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-approve-cap-norole");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.approveMarketplaceProviderCapability(
					adminToken,
					{
						org_id: "00000000-0000-0000-0000-000000000000",
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Reject Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /admin/reject-marketplace-provider-capability", () => {
		test("Success: pending_approval -> rejected (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reject-cap");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } =
				generateTestOrgEmail("mkt-reject-cap-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				// Org applies
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				await orgApi.applyMarketplaceProviderCapability(orgToken, {});

				// Admin rejects
				const before = new Date(Date.now() - 2000).toISOString();
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.rejectMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						admin_note: "Does not meet our quality standards.",
					}
				);
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await adminApi.filterAuditLogs(adminToken, {
					event_types: ["admin.reject_marketplace_provider_capability"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: capability not pending_approval (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reject-cap-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-reject-cap-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId); // already active

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.rejectMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						admin_note: "Rejecting active capability should fail.",
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.rejectMarketplaceProviderCapability(
				"invalid-token",
				{
					org_id: "00000000-0000-0000-0000-000000000000",
					admin_note: "Some reason",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Revoke Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /admin/revoke-marketplace-provider-capability", () => {
		test("Success: active -> revoked (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-revoke-cap");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-revoke-cap-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.revokeMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						admin_note: "Revoking for policy violation.",
					}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: capability not active (422)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-revoke-cap-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-revoke-cap-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				// Org applies (puts it in pending_approval)
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				await orgApi.applyMarketplaceProviderCapability(orgToken, {});

				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.revokeMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						admin_note: "Should fail, not active.",
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.revokeMarketplaceProviderCapability(
				"invalid-token",
				{
					org_id: "00000000-0000-0000-0000-000000000000",
					admin_note: "Some reason",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Reinstate Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /admin/reinstate-marketplace-provider-capability", () => {
		test("Success: revoked -> active (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reinstate-cap");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-reinstate-cap-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);
			await setOrgCapabilityStatus(orgResult.orgId, "revoked");

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.reinstateMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: capability not revoked (422)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reinstate-cap-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-reinstate-cap-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				await orgApi.applyMarketplaceProviderCapability(orgToken, {});

				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.reinstateMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.reinstateMarketplaceProviderCapability(
				"invalid-token",
				{
					org_id: "00000000-0000-0000-0000-000000000000",
					subscription_price: 100,
					currency: "USD",
					subscription_period_days: 365,
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Renew Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /admin/renew-marketplace-provider-capability", () => {
		test("Success: active capability renewed (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-renew-cap");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-renew-cap-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.renewMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 150,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: capability not active or expired (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-renew-cap-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-renew-cap-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);

			try {
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				await orgApi.applyMarketplaceProviderCapability(orgToken, {});
				// Still pending_approval

				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.renewMarketplaceProviderCapability(
					adminToken,
					{
						org_id: orgResult.orgId,
						subscription_price: 100,
						currency: "USD",
						subscription_period_days: 365,
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.renewMarketplaceProviderCapability(
				"invalid-token",
				{
					org_id: "00000000-0000-0000-0000-000000000000",
					subscription_price: 100,
					currency: "USD",
					subscription_period_days: 365,
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// List Admin Service Listings
	// ============================================================================
	test.describe("POST /admin/list-marketplace-service-listings", () => {
		test("Success: returns all service listings (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-admin-list-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-admin-list-sl-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);
			await createTestServiceListingDirect(
				orgResult.orgId,
				"Admin List Test Listing",
				"active"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listAdminMarketplaceServiceListings(
					adminToken,
					{}
				);
				expect(res.status).toBe(200);
				expect(res.body?.service_listings).toBeDefined();
				expect(Array.isArray(res.body?.service_listings)).toBe(true);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Filter by state returns only matching listings (200)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-admin-filter-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-admin-filter-sl-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);
			await createTestServiceListingDirect(
				orgResult.orgId,
				"Admin Filter Active Listing",
				"active"
			);
			await createTestServiceListingDirect(
				orgResult.orgId,
				"Admin Filter Draft Listing",
				"draft"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listAdminMarketplaceServiceListings(
					adminToken,
					{ filter_state: "active" }
				);
				expect(res.status).toBe(200);
				const listings = res.body?.service_listings ?? [];
				// All returned listings should be active
				listings.forEach((l: any) => {
					expect(l.state).toBe("active");
				});
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.listAdminMarketplaceServiceListings(
				"invalid-token",
				{}
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: admin without manage_marketplace role (403)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-list-sl-norole");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listAdminMarketplaceServiceListings(
					adminToken,
					{}
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Approve Service Listing
	// ============================================================================
	test.describe("POST /admin/approve-marketplace-service-listing", () => {
		test("Success: pending_review -> active (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-approve-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } =
				generateTestOrgEmail("mkt-approve-sl-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);

			try {
				// Create and submit listing
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				const createRes = await orgApi.createMarketplaceServiceListing(
					orgToken,
					{
						name: "Listing for Admin Approval",
						short_blurb: "A short description",
						description: "Full description of the listing for approval test.",
						service_category: "talent_sourcing",
						countries_of_service: ["IN"],
						contact_url: "https://example.com/contact",
						industries_served: ["technology_software"],
						company_sizes_served: ["startup"],
						job_functions_sourced: ["engineering_technology"],
						seniority_levels_sourced: ["mid"],
						geographic_sourcing_regions: ["India"],
					}
				);
				expect(createRes.status).toBe(201);
				const listingId = createRes.body?.service_listing_id;

				const submitRes = await orgApi.submitMarketplaceServiceListing(
					orgToken,
					{ service_listing_id: listingId }
				);
				expect(submitRes.status).toBe(200);

				// Admin approves
				const before = new Date(Date.now() - 2000).toISOString();
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const approveRes = await adminApi.approveMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
						admin_verification_note: "Verified and approved.",
						verification_id: "VER-001",
					}
				);
				expect(approveRes.status).toBe(200);

				// Verify audit log
				const auditResp = await adminApi.filterAuditLogs(adminToken, {
					event_types: ["admin.approve_marketplace_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe(
					"admin.approve_marketplace_service_listing"
				);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not pending_review (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-approve-sl-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-approve-sl-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Already Active Listing",
				"active"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.approveMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
						admin_verification_note: "Should fail.",
						verification_id: "VER-002",
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.approveMarketplaceServiceListing(
				"invalid-token",
				{
					service_listing_id: "00000000-0000-0000-0000-000000000000",
					home_region: "ind1",
					admin_verification_note: "Some note",
					verification_id: "VER-000",
				}
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: admin without manage_marketplace role (403)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-approve-sl-norole");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.approveMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: "00000000-0000-0000-0000-000000000000",
						home_region: "ind1",
						admin_verification_note: "Some note",
						verification_id: "VER-000",
					}
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Reject Service Listing
	// ============================================================================
	test.describe("POST /admin/reject-marketplace-service-listing", () => {
		test("Success: pending_review -> rejected (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reject-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-reject-sl-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Listing to Reject",
				"pending_review"
			);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.rejectMarketplaceServiceListing(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_verification_note: "Does not meet quality standards.",
				});
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await adminApi.filterAuditLogs(adminToken, {
					event_types: ["admin.reject_marketplace_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not pending_review (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reject-sl-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-reject-sl-422-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Draft Cannot Be Rejected",
				"draft"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.rejectMarketplaceServiceListing(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_verification_note: "Should fail.",
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.rejectMarketplaceServiceListing(
				"invalid-token",
				{
					service_listing_id: "00000000-0000-0000-0000-000000000000",
					home_region: "ind1",
					admin_verification_note: "Some note",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Suspend Service Listing
	// ============================================================================
	test.describe("POST /admin/suspend-marketplace-service-listing", () => {
		test("Success: active -> suspended (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-suspend-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-suspend-sl-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Listing to Suspend",
				"active"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.suspendMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
						admin_verification_note: "Suspended for policy violation.",
					}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not active (422)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-suspend-sl-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-suspend-sl-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Draft Cannot Be Suspended",
				"draft"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.suspendMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
						admin_verification_note: "Should fail.",
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.suspendMarketplaceServiceListing(
				"invalid-token",
				{
					service_listing_id: "00000000-0000-0000-0000-000000000000",
					home_region: "ind1",
					admin_verification_note: "Some note",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Reinstate Service Listing
	// ============================================================================
	test.describe("POST /admin/reinstate-marketplace-service-listing", () => {
		test("Success: suspended -> active (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reinstate-sl");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail("mkt-reinstate-sl-org");
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Suspended Listing to Reinstate",
				"suspended"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.reinstateMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
					}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not suspended (422)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-reinstate-sl-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-reinstate-sl-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Active Listing Cannot Be Reinstated",
				"active"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.reinstateMarketplaceServiceListing(
					adminToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
					}
				);
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.reinstateMarketplaceServiceListing(
				"invalid-token",
				{
					service_listing_id: "00000000-0000-0000-0000-000000000000",
					home_region: "ind1",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Grant Marketplace Appeal
	// ============================================================================
	test.describe("POST /admin/grant-marketplace-appeal", () => {
		test("Success: appealing -> active (200)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-grant-appeal");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-grant-appeal-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);
			// Create a suspended listing and submit appeal via API
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Listing for Grant Appeal",
				"suspended"
			);

			try {
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				const appealRes = await orgApi.submitMarketplaceServiceListingAppeal(
					orgToken,
					{
						service_listing_id: listingId,
						appeal_reason: "We have corrected the issues.",
					}
				);
				expect(appealRes.status).toBe(200);

				// Admin grants appeal
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const grantRes = await adminApi.grantMarketplaceAppeal(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_note: "Appeal granted, issues verified fixed.",
				});
				expect(grantRes.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not in appealing state (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-grant-appeal-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-grant-appeal-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Active Listing Cannot Grant Appeal",
				"active"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.grantMarketplaceAppeal(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_note: "Should fail.",
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.grantMarketplaceAppeal("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
				home_region: "ind1",
				admin_note: "Some note",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Deny Marketplace Appeal
	// ============================================================================
	test.describe("POST /admin/deny-marketplace-appeal", () => {
		test("Success: appealing -> suspended with appeal_exhausted=true (200)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			const adminEmail = generateTestEmail("mkt-deny-appeal");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail, domain: orgDomain } = generateTestOrgEmail(
				"mkt-deny-appeal-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(orgResult.orgId);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Listing for Deny Appeal",
				"suspended"
			);

			try {
				const orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);
				const appealRes = await orgApi.submitMarketplaceServiceListingAppeal(
					orgToken,
					{
						service_listing_id: listingId,
						appeal_reason: "We believe the suspension was wrong.",
					}
				);
				expect(appealRes.status).toBe(200);

				// Admin denies appeal
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const denyRes = await adminApi.denyMarketplaceAppeal(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_note: "Appeal denied, policy violation confirmed.",
				});
				expect(denyRes.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Invalid state: listing not in appealing state (422)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);

			const adminEmail = generateTestEmail("mkt-deny-appeal-422");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			const { email: orgEmail } = generateTestOrgEmail(
				"mkt-deny-appeal-422-org"
			);
			const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				orgResult.orgId,
				"Suspended Listing Not Appealing",
				"suspended"
			);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.denyMarketplaceAppeal(adminToken, {
					service_listing_id: listingId,
					home_region: "ind1",
					admin_note: "Should fail, not appealing.",
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestOrgUser(orgEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const res = await adminApi.denyMarketplaceAppeal("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
				home_region: "ind1",
				admin_note: "Some note",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// RBAC Tests
	// ============================================================================
	test.describe("RBAC", () => {
		test("Positive: admin WITH admin:manage_marketplace can list capabilities (200)", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-rbac-pos-admin");
			const { userId: adminUserId } = await createTestAdminUserDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
			await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listMarketplaceProviderCapabilities(
					adminToken,
					{}
				);
				expect(res.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});

		test("Negative: admin WITHOUT admin:manage_marketplace role gets 403", async ({
			request,
		}) => {
			const adminApi = new AdminAPIClient(request);
			const adminEmail = generateTestEmail("mkt-rbac-neg-admin");
			await createTestAdminUserDirect(adminEmail, TEST_PASSWORD);

			try {
				const adminToken = await loginAdmin(adminApi, adminEmail);
				const res = await adminApi.listMarketplaceProviderCapabilities(
					adminToken,
					{}
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});
	});
});
