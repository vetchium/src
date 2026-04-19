import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestSuperadmin,
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	createTestMarketplaceCapability,
	deleteTestMarketplaceCapability,
	createTestMarketplaceListingDirect,
	setOrgTier,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CapabilityStatus,
	MarketplaceListingStatus,
} from "vetchium-specs/admin/marketplace";

async function loginAdmin(api: AdminAPIClient, email: string): Promise<string> {
	const loginRes = await api.login({ email, password: TEST_PASSWORD });
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

async function loginOrg(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginRes = await api.login({
		email,
		domain,
		password: TEST_PASSWORD,
	} as OrgLoginRequest);
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

// ============================================================================
// Capability lifecycle: draft -> active -> disabled
// ============================================================================
test.describe("Admin Marketplace Capability Lifecycle", () => {
	test("Create draft capability, activate, then disable (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-cap");
		const { userId: adminUserId } = await createTestSuperadmin(
			adminEmail,
			TEST_PASSWORD
		);
		const capId = `mp-admin-test-${Math.random().toString(36).slice(2, 10)}`;

		try {
			const token = await loginAdmin(api, adminEmail);

			// Create capability as draft
			const createRes = await api.createMarketplaceCapability(token, {
				capability_id: capId,
				display_name: "Admin Test Capability",
				description: "For admin test",
			});
			expect(createRes.status).toBe(201);
			const draftStatus: CapabilityStatus = createRes.body!.status;
			expect(draftStatus).toBe("draft");

			// Activate it
			const activateRes = await api.updateMarketplaceCapability(token, {
				capability_id: capId,
				status: "active",
				display_name: "Admin Test Capability",
			});
			expect(activateRes.status).toBe(200);
			const activeStatus: CapabilityStatus = activateRes.body!.status;
			expect(activeStatus).toBe("active");

			// Disable it
			const disableRes = await api.updateMarketplaceCapability(token, {
				capability_id: capId,
				status: "disabled",
			});
			expect(disableRes.status).toBe(200);
			const disabledStatus: CapabilityStatus = disableRes.body!.status;
			expect(disabledStatus).toBe("disabled");

			// Admin can list all capabilities including disabled
			const listRes = await api.listMarketplaceCapabilities(token);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.capabilities.find(
				(c) => c.capability_id === capId
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestMarketplaceCapability(capId);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Missing capability_id -> 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-cap-invalid");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, adminEmail);
			const res = await api.createMarketplaceCapabilityRaw(token, {
				display_name: "No ID",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});
});

// ============================================================================
// Admin suspend/reinstate listing
// ============================================================================
test.describe("Admin Marketplace Listing Suspend/Reinstate", () => {
	const TEST_CAP_ID = `mp-admin-spec-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(
			TEST_CAP_ID,
			"active",
			"Admin Spec Cap"
		);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(TEST_CAP_ID);
	});

	test("Admin suspend active listing -> suspended; reinstate -> active (200)", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-admin-suspend");
		const { userId: adminUserId } = await createTestSuperadmin(
			adminEmail,
			TEST_PASSWORD
		);
		const { email: orgEmail, domain: orgDomain, orgId } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-suspend-org").email,
				TEST_PASSWORD
			);
		try {
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const orgToken = await loginOrg(orgApi, orgEmail, orgDomain);

			// Create and publish listing as org superadmin -> active
			const createRes = await orgApi.createListing(orgToken, {
				headline: "Suspend Test Listing",
				description: "To be suspended by admin",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const pubRes = await orgApi.publishListing(orgToken, {
				listing_number: listingNum,
			});
			expect(pubRes.status).toBe(200);
			const pubStatus: MarketplaceListingStatus = pubRes.body!.status;
			expect(pubStatus).toBe("active");

			// Admin suspends
			const suspendRes = await adminApi.adminSuspendListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNum,
				suspension_note: "Policy violation test",
			});
			expect(suspendRes.status).toBe(200);
			const suspendedStatus: MarketplaceListingStatus =
				suspendRes.body!.status;
			expect(suspendedStatus).toBe("suspended");
			expect(suspendRes.body!.suspension_note).toBe("Policy violation test");

			// Admin reinstates
			const reinstateRes = await adminApi.adminReinstateListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNum,
			});
			expect(reinstateRes.status).toBe(200);
			const reinstatedStatus: MarketplaceListingStatus =
				reinstateRes.body!.status;
			expect(reinstatedStatus).toBe("active");
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});
});

// ============================================================================
// Admin cancel subscription
// ============================================================================
test.describe("Admin Marketplace Cancel Subscription", () => {
	const TEST_CAP_ID = `mp-admin-sub-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(
			TEST_CAP_ID,
			"active",
			"Admin Sub Cap"
		);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(TEST_CAP_ID);
	});

	test("Admin cancel active subscription -> 204", async ({ request }) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-admin-cancel-sub");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const { email: provEmail, domain: provDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-admin-cancel-prov").email,
				TEST_PASSWORD
			);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-admin-cancel-con").email,
				TEST_PASSWORD
			);
		try {
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const provToken = await loginOrg(orgApi, provEmail, provDomain);
			const conToken = await loginOrg(orgApi, conEmail, conDomain);

			const createRes = await orgApi.createListing(provToken, {
				headline: "Admin Cancel Sub Test",
				description: "For admin subscription cancel test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await orgApi.publishListing(provToken, { listing_number: listingNum });

			const subRes = await orgApi.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			});
			expect(subRes.status).toBe(200);
			const subId = subRes.body!.subscription_id;

			// Admin cancels the subscription
			const cancelRes = await adminApi.adminCancelSubscription(adminToken, {
				subscription_id: subId,
			});
			expect(cancelRes.status).toBe(204);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});
});

// ============================================================================
// RBAC tests
// ============================================================================
test.describe("RBAC — Admin Marketplace", () => {
	const TEST_CAP_ID = `mp-rbac-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(
			TEST_CAP_ID,
			"active",
			"RBAC Test Cap"
		);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(TEST_CAP_ID);
	});

	test("Positive: admin with manage_marketplace can create capability (201)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-admin-pos");
		const { userId } = await createTestAdminUser(email, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:manage_marketplace");
		const capId = `mp-rbac-create-${Math.random().toString(36).slice(2, 10)}`;
		try {
			const token = await loginAdmin(api, email);
			const res = await api.createMarketplaceCapability(token, {
				capability_id: capId,
				display_name: "RBAC Positive Test Cap",
			});
			expect(res.status).toBe(201);
		} finally {
			await deleteTestMarketplaceCapability(capId).catch(() => {});
			await deleteTestAdminUser(email);
		}
	});

	test("Negative: admin with no roles cannot create capability (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-admin-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		const capId = `mp-rbac-neg-${Math.random().toString(36).slice(2, 10)}`;
		try {
			const token = await loginAdmin(api, email);
			const res = await api.createMarketplaceCapability(token, {
				capability_id: capId,
				display_name: "RBAC Negative Test Cap",
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Positive: admin with view_marketplace can list capabilities (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-view-pos");
		const { userId } = await createTestAdminUser(email, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:view_marketplace");
		try {
			const token = await loginAdmin(api, email);
			const res = await api.listMarketplaceCapabilities(token);
			expect(res.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Negative: admin with no roles cannot list capabilities (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-view-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.listMarketplaceCapabilities(token);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
