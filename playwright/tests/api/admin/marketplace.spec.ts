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
	setOrgPlan,
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
	AdminListListingsRequest,
	AdminListSubscriptionsRequest,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/admin/marketplace";
import type { SubscribeRequest } from "vetchium-specs/org/marketplace";

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

	test("Auth: create capability without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.createMarketplaceCapabilityRaw("invalid-token", {
			capability_id: "some-cap",
			display_name: "No Auth",
		});
		expect(res.status).toBe(401);
	});

	test("Auth: update capability without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.updateMarketplaceCapabilityRaw("invalid-token", {
			capability_id: "some-cap",
			status: "active",
		});
		expect(res.status).toBe(401);
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
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-suspend-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
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
			const suspendedStatus: MarketplaceListingStatus = suspendRes.body!.status;
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

	test("Auth: suspend listing without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.adminSuspendListingRaw("invalid-token", {
			org_domain: "example.com",
			listing_number: 1,
			suspension_note: "test",
		});
		expect(res.status).toBe(401);
	});

	test("Auth: reinstate listing without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.adminReinstateListingRaw("invalid-token", {
			org_domain: "example.com",
			listing_number: 1,
		});
		expect(res.status).toBe(401);
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
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-admin-cancel-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-admin-cancel-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
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
			expect(subRes.status).toBe(201);
			const subId = subRes.body!.subscription_id;

			// Admin cancels the subscription
			const cancelRes = await adminApi.adminCancelSubscription(adminToken, {
				subscription_id: subId,
			});
			expect(cancelRes.status).toBe(200);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Auth: admin cancel subscription without token -> 401", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const res = await api.adminCancelSubscriptionRaw("invalid-token", {
			subscription_id: "00000000-0000-0000-0000-000000000000",
		});
		expect(res.status).toBe(401);
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

	test("Positive: admin with manage_marketplace can update capability (200)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-update-cap-pos");
		const { userId } = await createTestAdminUser(email, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:manage_marketplace");
		try {
			const token = await loginAdmin(api, email);
			const res = await api.updateMarketplaceCapability(token, {
				capability_id: TEST_CAP_ID,
				status: "active",
			});
			expect(res.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Negative: admin with no roles cannot update capability (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-update-cap-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.updateMarketplaceCapability(token, {
				capability_id: TEST_CAP_ID,
				status: "active",
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Positive: admin with manage_marketplace can suspend listing (200)", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);
		const adminEmail = generateTestEmail("mp-rbac-suspend-pos");
		const { userId } = await createTestAdminUser(adminEmail, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:manage_marketplace");
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-suspend-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const orgToken = await loginOrg(orgApi, orgEmail, orgDomain);

			const { listingId, listingNumber } =
				await createTestMarketplaceListingDirect(
					orgId,
					orgDomain,
					[TEST_CAP_ID],
					"active",
					"RBAC Suspend Listing"
				);

			const suspendRes = await adminApi.adminSuspendListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
				suspension_note: "RBAC suspend test",
			});
			expect(suspendRes.status).toBe(200);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});

	test("Negative: admin with no roles cannot suspend listing (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-suspend-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminSuspendListing(token, {
				org_domain: "example.com",
				listing_number: 1,
				suspension_note: "RBAC suspend negative",
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Positive: admin with manage_marketplace can reinstate listing (200)", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-rbac-reinstate-pos");
		const superAdminEmail = generateTestEmail("mp-rbac-reinstate-super");
		const { userId } = await createTestAdminUser(adminEmail, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:manage_marketplace");
		await createTestSuperadmin(superAdminEmail, TEST_PASSWORD);
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-reinstate-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const superToken = await loginAdmin(adminApi, superAdminEmail);

			const { listingNumber } = await createTestMarketplaceListingDirect(
				orgId,
				orgDomain,
				[TEST_CAP_ID],
				"active",
				"RBAC Reinstate Listing"
			);

			// First suspend via superadmin
			await adminApi.adminSuspendListing(superToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
				suspension_note: "For RBAC reinstate test",
			});

			const reinstateRes = await adminApi.adminReinstateListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
			});
			expect(reinstateRes.status).toBe(200);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(superAdminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});

	test("Negative: admin with no roles cannot reinstate listing (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-reinstate-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminReinstateListing(token, {
				org_domain: "example.com",
				listing_number: 1,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("Positive: admin with manage_marketplace can cancel subscription (200)", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);
		const adminEmail = generateTestEmail("mp-rbac-cancel-sub-pos");
		const { userId } = await createTestAdminUser(adminEmail, TEST_PASSWORD).then(
			(id) => ({ userId: id })
		);
		await assignRoleToAdminUser(userId, "admin:manage_marketplace");
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-cancel-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-rbac-cancel-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const provToken = await loginOrg(orgApi, provEmail, provDomain);
			const conToken = await loginOrg(orgApi, conEmail, conDomain);

			const createRes = await orgApi.createListing(provToken, {
				headline: "RBAC Cancel Sub Listing",
				description: "For RBAC cancel subscription test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			await orgApi.publishListing(provToken, {
				listing_number: createRes.body!.listing_number,
			});

			const subRes = await orgApi.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: createRes.body!.listing_number,
			});
			expect(subRes.status).toBe(201);

			const cancelRes = await adminApi.adminCancelSubscription(adminToken, {
				subscription_id: subRes.body!.subscription_id,
			});
			expect(cancelRes.status).toBe(200);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Negative: admin with no roles cannot cancel subscription (403)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-rbac-cancel-sub-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminCancelSubscription(token, {
				subscription_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// POST /admin/marketplace/listing/list
// ============================================================================
test.describe("POST /admin/marketplace/listing/list", () => {
	const TEST_CAP_ID = `mp-admin-list-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(
			TEST_CAP_ID,
			"active",
			"Admin List Cap"
		);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(TEST_CAP_ID);
	});

	test("Success: publish a listing -> admin list -> 200, listing appears", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-adminlist-ok");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminlist-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const orgToken = await loginOrg(orgApi, orgEmail, orgDomain);

			const createRes = await orgApi.createListing(orgToken, {
				headline: "Admin List Test Listing",
				description: "For admin list test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await orgApi.publishListing(orgToken, { listing_number: listingNum });

			const listRes = await adminApi.adminListListings(
				adminToken,
				{} as AdminListListingsRequest
			);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.listings.find(
				(l) => l.org_domain === orgDomain && l.listing_number === listingNum
			);
			expect(found).toBeDefined();
			const status: MarketplaceListingStatus = found!.status;
			expect(status).toBe("active");
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});

	test("Filter by filter_org_domain: two orgs, filter by one -> one result", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-adminlist-filt");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: org1Email,
			domain: org1Domain,
			orgId: org1Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminlist-org1").email,
			TEST_PASSWORD
		);
		const {
			email: org2Email,
			domain: org2Domain,
			orgId: org2Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminlist-org2").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(org1Id, "silver");
			await setOrgPlan(org2Id, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const org1Token = await loginOrg(orgApi, org1Email, org1Domain);
			const org2Token = await loginOrg(orgApi, org2Email, org2Domain);

			const createRes1 = await orgApi.createListing(org1Token, {
				headline: "Org1 Listing",
				description: "From org 1",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			await orgApi.publishListing(org1Token, {
				listing_number: createRes1.body!.listing_number,
			});

			const createRes2 = await orgApi.createListing(org2Token, {
				headline: "Org2 Listing",
				description: "From org 2",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes2.status).toBe(201);
			await orgApi.publishListing(org2Token, {
				listing_number: createRes2.body!.listing_number,
			});

			const listRes = await adminApi.adminListListings(adminToken, {
				filter_org_domain: org1Domain,
			} as AdminListListingsRequest);
			expect(listRes.status).toBe(200);
			const allDomains = listRes.body!.listings.map((l) => l.org_domain);
			expect(allDomains.every((d) => d === org1Domain)).toBe(true);
			expect(allDomains.includes(org2Domain)).toBe(false);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(org1Email);
			await deleteTestOrgUser(org2Email);
		}
	});

	test("Filter by filter_capability_id: listings with different capabilities -> correct subset", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const EXTRA_CAP_ID = `mp-adminlist-extracap-${Math.random().toString(36).slice(2, 10)}`;
		await createTestMarketplaceCapability(EXTRA_CAP_ID, "active", "Extra Cap");

		const adminEmail = generateTestEmail("mp-adminlist-capfilt");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: org1Email,
			domain: org1Domain,
			orgId: org1Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminlist-caporg1").email,
			TEST_PASSWORD
		);
		const {
			email: org2Email,
			domain: org2Domain,
			orgId: org2Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminlist-caporg2").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(org1Id, "silver");
			await setOrgPlan(org2Id, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const org1Token = await loginOrg(orgApi, org1Email, org1Domain);
			const org2Token = await loginOrg(orgApi, org2Email, org2Domain);

			const createRes1 = await orgApi.createListing(org1Token, {
				headline: "CapFilt Listing 1",
				description: "With TEST_CAP_ID",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			await orgApi.publishListing(org1Token, {
				listing_number: createRes1.body!.listing_number,
			});

			const createRes2 = await orgApi.createListing(org2Token, {
				headline: "CapFilt Listing 2",
				description: "With EXTRA_CAP_ID",
				capabilities: [EXTRA_CAP_ID],
			});
			expect(createRes2.status).toBe(201);
			await orgApi.publishListing(org2Token, {
				listing_number: createRes2.body!.listing_number,
			});

			const listRes = await adminApi.adminListListings(adminToken, {
				filter_capability_id: TEST_CAP_ID,
			} as AdminListListingsRequest);
			expect(listRes.status).toBe(200);
			const found1 = listRes.body!.listings.find(
				(l) => l.org_domain === org1Domain
			);
			const found2 = listRes.body!.listings.find(
				(l) => l.org_domain === org2Domain
			);
			expect(found1).toBeDefined();
			expect(found2).toBeUndefined();
		} finally {
			await deleteTestMarketplaceCapability(EXTRA_CAP_ID).catch(() => {});
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(org1Email);
			await deleteTestOrgUser(org2Email);
		}
	});

	test("Auth: list listings without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.adminListListings(
			"invalid-token",
			{} as AdminListListingsRequest
		);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: admin with admin:view_marketplace can list listings -> 200", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-adminlist-rbac-pos");
		const userId = await createTestAdminUser(email, TEST_PASSWORD).then(
			(id) => id
		);
		await assignRoleToAdminUser(userId, "admin:view_marketplace");
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminListListings(
				token,
				{} as AdminListListingsRequest
			);
			expect(res.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("RBAC negative: admin with no roles cannot list listings -> 403", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-adminlist-rbac-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminListListings(
				token,
				{} as AdminListListingsRequest
			);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// POST /admin/marketplace/subscription/list
// ============================================================================
test.describe("POST /admin/marketplace/subscription/list", () => {
	const TEST_CAP_ID = `mp-admin-sublist-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(
			TEST_CAP_ID,
			"active",
			"Admin SubList Cap"
		);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(TEST_CAP_ID);
	});

	test("Success: org A publishes; org B subscribes; admin lists -> 200, subscription appears", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-adminsublist-ok");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminsublist-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-adminsublist-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const provToken = await loginOrg(orgApi, provEmail, provDomain);
			const conToken = await loginOrg(orgApi, conEmail, conDomain);

			const createRes = await orgApi.createListing(provToken, {
				headline: "Admin SubList Listing",
				description: "For admin subscription list test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await orgApi.publishListing(provToken, { listing_number: listingNum });

			const subRes = await orgApi.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);
			expect(subRes.status).toBe(201);

			const listRes = await adminApi.adminListSubscriptions(adminToken, {
				filter_provider_org_domain: provDomain,
			} as AdminListSubscriptionsRequest);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.subscriptions.find(
				(s) => s.subscription_id === subRes.body!.subscription_id
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Filter by filter_provider_org_domain: two providers; filter by one -> only that org's subs", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		const adminEmail = generateTestEmail("mp-adminsublist-filt");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: prov1Email,
			domain: prov1Domain,
			orgId: prov1Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminsublist-prov1").email,
			TEST_PASSWORD
		);
		const {
			email: prov2Email,
			domain: prov2Domain,
			orgId: prov2Id,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-adminsublist-prov2").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-adminsublist-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(prov1Id, "silver");
			await setOrgPlan(prov2Id, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const prov1Token = await loginOrg(orgApi, prov1Email, prov1Domain);
			const prov2Token = await loginOrg(orgApi, prov2Email, prov2Domain);
			const conToken = await loginOrg(orgApi, conEmail, conDomain);

			const createRes1 = await orgApi.createListing(prov1Token, {
				headline: "Prov1 SubList Listing",
				description: "From prov1",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			await orgApi.publishListing(prov1Token, {
				listing_number: createRes1.body!.listing_number,
			});

			const createRes2 = await orgApi.createListing(prov2Token, {
				headline: "Prov2 SubList Listing",
				description: "From prov2",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes2.status).toBe(201);
			await orgApi.publishListing(prov2Token, {
				listing_number: createRes2.body!.listing_number,
			});

			await orgApi.subscribe(conToken, {
				provider_org_domain: prov1Domain,
				provider_listing_number: createRes1.body!.listing_number,
			} as SubscribeRequest);
			await orgApi.subscribe(conToken, {
				provider_org_domain: prov2Domain,
				provider_listing_number: createRes2.body!.listing_number,
			} as SubscribeRequest);

			const listRes = await adminApi.adminListSubscriptions(adminToken, {
				filter_provider_org_domain: prov1Domain,
			} as AdminListSubscriptionsRequest);
			expect(listRes.status).toBe(200);
			const subs = listRes.body!.subscriptions;
			expect(subs.length).toBeGreaterThanOrEqual(1);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(prov1Email);
			await deleteTestOrgUser(prov2Email);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Auth: list subscriptions without token -> 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const res = await api.adminListSubscriptions(
			"invalid-token",
			{} as AdminListSubscriptionsRequest
		);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: admin with admin:view_marketplace can list subscriptions -> 200", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-adminsublist-rbac-pos");
		const userId = await createTestAdminUser(email, TEST_PASSWORD).then(
			(id) => id
		);
		await assignRoleToAdminUser(userId, "admin:view_marketplace");
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminListSubscriptions(
				token,
				{} as AdminListSubscriptionsRequest
			);
			expect(res.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("RBAC negative: admin with no roles cannot list subscriptions -> 403", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("mp-adminsublist-rbac-neg");
		await createTestAdminUser(email, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, email);
			const res = await api.adminListSubscriptions(
				token,
				{} as AdminListSubscriptionsRequest
			);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Audit log assertions for admin marketplace write operations
// ============================================================================
test.describe("Audit logs for admin marketplace write operations", () => {
	const AUDIT_CAP_ID = `mp-admin-audit-cap-${Math.random().toString(36).slice(2, 10)}`;

	test.beforeAll(async () => {
		await createTestMarketplaceCapability(AUDIT_CAP_ID, "active", "Audit Cap");
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(AUDIT_CAP_ID);
	});

	test("Create capability -> admin.marketplace_capability_created audit recorded", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-audit-cap-create");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const capId = `mp-audit-create-${Math.random().toString(36).slice(2, 10)}`;
		try {
			const token = await loginAdmin(api, adminEmail);
			const before = new Date(Date.now() - 2000).toISOString();

			const res = await api.createMarketplaceCapability(token, {
				capability_id: capId,
				display_name: "Audit Create Cap",
			});
			expect(res.status).toBe(201);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["admin.marketplace_capability_created"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"admin.marketplace_capability_created"
			);
		} finally {
			await deleteTestMarketplaceCapability(capId).catch(() => {});
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Update capability -> admin.marketplace_capability_updated audit recorded", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-audit-cap-update");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		try {
			const token = await loginAdmin(api, adminEmail);
			const before = new Date(Date.now() - 2000).toISOString();

			const res = await api.updateMarketplaceCapability(token, {
				capability_id: AUDIT_CAP_ID,
				status: "active",
			});
			expect(res.status).toBe(200);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["admin.marketplace_capability_updated"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"admin.marketplace_capability_updated"
			);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Suspend listing -> admin.marketplace_listing_suspended audit recorded", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-audit-suspend");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-admin-audit-susp-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const before = new Date(Date.now() - 2000).toISOString();

			const { listingNumber } = await createTestMarketplaceListingDirect(
				orgId,
				orgDomain,
				[AUDIT_CAP_ID],
				"active",
				"Audit Suspend Listing"
			);

			const suspendRes = await adminApi.adminSuspendListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
				suspension_note: "Audit suspend test",
			});
			expect(suspendRes.status).toBe(200);

			const auditRes = await adminApi.filterAuditLogs(adminToken, {
				event_types: ["admin.marketplace_listing_suspended"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"admin.marketplace_listing_suspended"
			);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});

	test("Reinstate listing -> admin.marketplace_listing_reinstated audit recorded", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-audit-reinstate");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: orgEmail,
			domain: orgDomain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-admin-audit-reinst-org").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);

			const { listingNumber } = await createTestMarketplaceListingDirect(
				orgId,
				orgDomain,
				[AUDIT_CAP_ID],
				"active",
				"Audit Reinstate Listing"
			);

			await adminApi.adminSuspendListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
				suspension_note: "Setup for reinstate audit test",
			});

			const before = new Date(Date.now() - 2000).toISOString();

			const reinstateRes = await adminApi.adminReinstateListing(adminToken, {
				org_domain: orgDomain,
				listing_number: listingNumber,
			});
			expect(reinstateRes.status).toBe(200);

			const auditRes = await adminApi.filterAuditLogs(adminToken, {
				event_types: ["admin.marketplace_listing_reinstated"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"admin.marketplace_listing_reinstated"
			);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(orgEmail);
		}
	});

	test("Admin cancel subscription -> admin.marketplace_subscription_cancelled audit recorded", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);
		const adminEmail = generateTestEmail("mp-admin-audit-cancel-sub");
		await createTestSuperadmin(adminEmail, TEST_PASSWORD);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-admin-audit-cancel-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-admin-audit-cancel-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const adminToken = await loginAdmin(adminApi, adminEmail);
			const provToken = await loginOrg(orgApi, provEmail, provDomain);
			const conToken = await loginOrg(orgApi, conEmail, conDomain);

			const createRes = await orgApi.createListing(provToken, {
				headline: "Audit Cancel Sub Listing",
				description: "For admin cancel subscription audit test",
				capabilities: [AUDIT_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			await orgApi.publishListing(provToken, {
				listing_number: createRes.body!.listing_number,
			});

			const subRes = await orgApi.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: createRes.body!.listing_number,
			});
			expect(subRes.status).toBe(201);
			const subId = subRes.body!.subscription_id;

			const before = new Date(Date.now() - 2000).toISOString();

			const cancelRes = await adminApi.adminCancelSubscription(adminToken, {
				subscription_id: subId,
			});
			expect(cancelRes.status).toBe(200);

			const auditRes = await adminApi.filterAuditLogs(adminToken, {
				event_types: ["admin.marketplace_subscription_cancelled"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"admin.marketplace_subscription_cancelled"
			);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});
});
