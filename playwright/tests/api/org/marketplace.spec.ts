import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgPlan,
	createTestMarketplaceCapability,
	deleteTestMarketplaceCapability,
	createTestMarketplaceListingDirect,
	createTestSuperadmin,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateListingRequest,
	PublishListingRequest,
	ArchiveListingRequest,
	ReopenListingRequest,
	UpdateListingRequest,
	AddListingCapabilityRequest,
	RemoveListingCapabilityRequest,
	AdminApproveListingRequest,
	AdminRejectListingRequest,
	GetListingRequest,
	DiscoverListingsRequest,
	SubscribeRequest,
	CancelSubscriptionRequest,
	GetSubscriptionRequest,
	ListMySubscriptionsRequest,
	ListMyClientsRequest,
	MarketplaceListingStatus,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";

async function loginOrg(
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

// Seed a unique capability for tests in this file
const TEST_CAP_ID = `mp-spec-cap-${Math.random().toString(36).slice(2, 10)}`;
const TEST_CAP2_ID = `mp-spec-cap2-${Math.random().toString(36).slice(2, 10)}`;

test.beforeAll(async () => {
	await createTestMarketplaceCapability(TEST_CAP_ID, "active", "MP Test Cap");
	await createTestMarketplaceCapability(
		TEST_CAP2_ID,
		"active",
		"MP Test Cap 2"
	);
});

test.afterAll(async () => {
	await deleteTestMarketplaceCapability(TEST_CAP_ID);
	await deleteTestMarketplaceCapability(TEST_CAP2_ID);
});

// ============================================================================
// Capability list
// ============================================================================
test.describe("POST /org/marketplace/list-capabilities", () => {
	test("Success: authenticated org user gets active capabilities (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("mp-cap-list");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const res = await api.listMarketplaceCapabilities(token);
			expect(res.status).toBe(200);
			expect(res.body!.capabilities).toBeDefined();
			const seeded = res.body!.capabilities.find(
				(c) => c.capability_id === TEST_CAP_ID
			);
			expect(seeded).toBeDefined();
			expect(seeded!.status).toBe("active");
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("returns 401 without auth", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMarketplaceCapabilities("invalid-token");
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// Listing CRUD happy path — superadmin publishes directly to active
// ============================================================================
test.describe("Listing CRUD — superadmin publish to active", () => {
	test("Success: create draft -> publish as superadmin -> active (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("mp-crud");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createReq: CreateListingRequest = {
				headline: "Test Listing",
				description: "A test listing description",
				capabilities: [TEST_CAP_ID],
			};
			const createRes = await api.createListing(token, createReq);
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			const listingStatus: MarketplaceListingStatus = createRes.body!.status;
			expect(listingStatus).toBe("draft");

			const publishRes = await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);
			expect(publishRes.status).toBe(200);
			const publishedStatus: MarketplaceListingStatus = publishRes.body!.status;
			expect(publishedStatus).toBe("active");
			expect(publishRes.body!.listed_at).toBeDefined();

			// Audit log: org.marketplace_listing_created
			const auditCreateRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_created"],
				start_time: before,
			});
			expect(auditCreateRes.status).toBe(200);
			expect(auditCreateRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);

			// Audit log: org.marketplace_listing_published
			const auditPubRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_published"],
				start_time: before,
			});
			expect(auditPubRes.status).toBe(200);
			expect(auditPubRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			const pubLog = auditPubRes.body.audit_logs[0];
			expect(pubLog.event_data.listing_number).toBe(listingNum);
			expect(pubLog.event_data.status).toBe("active");
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// Non-superadmin with org:manage_listings: create -> publish -> pending_review
// Superadmin approves -> active
// ============================================================================
test.describe("Listing approval flow (non-superadmin -> pending_review -> active)", () => {
	test("Success: non-superadmin publish sends to pending_review; superadmin approve -> active", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId, orgId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-approve").email,
			TEST_PASSWORD
		);
		const adminEmail = `admin-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD, "ind1", {
			domain,
			orgId,
		});
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");

		try {
			const memberToken = await loginOrg(api, email, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);

			const createReq: CreateListingRequest = {
				headline: "Pending Review Listing",
				description: "For approval flow test",
				capabilities: [TEST_CAP_ID],
			};
			const createRes = await api.createListing(memberToken, createReq);
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const publishRes = await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);
			expect(publishRes.status).toBe(200);
			const pendingStatus: MarketplaceListingStatus = publishRes.body!.status;
			expect(pendingStatus).toBe("pending_review");

			const approveRes = await api.approveListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
			});
			expect(approveRes.status).toBe(200);
			const approvedStatus: MarketplaceListingStatus = approveRes.body!.status;
			expect(approvedStatus).toBe("active");
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("Reject flow: pending_review -> reject -> draft with rejection_note", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId, orgId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-reject").email,
			TEST_PASSWORD
		);
		const adminEmail = `admin-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD, "ind1", {
			domain,
			orgId,
		});
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");

		try {
			const memberToken = await loginOrg(api, email, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);

			const createRes = await api.createListing(memberToken, {
				headline: "Reject Me",
				description: "To be rejected",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const publishRes = await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);
			expect(publishRes.status).toBe(200);
			expect(publishRes.body!.status as MarketplaceListingStatus).toBe(
				"pending_review"
			);

			const rejectRes = await api.rejectListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
				rejection_note: "Not ready for marketplace yet.",
			});
			expect(rejectRes.status).toBe(200);
			const rejectedStatus: MarketplaceListingStatus = rejectRes.body!.status;
			expect(rejectedStatus).toBe("draft");
			expect(rejectRes.body!.rejection_note).toBe(
				"Not ready for marketplace yet."
			);
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("Auth: approve without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.approveListing("invalid-token", {
			org_domain: "example.com",
			listing_number: 1,
		} as AdminApproveListingRequest);
		expect(res.status).toBe(401);
	});

	test("Auth: reject without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.rejectListing("invalid-token", {
			org_domain: "example.com",
			listing_number: 1,
			rejection_note: "test",
		} as AdminRejectListingRequest);
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// Multi-capability listing
// ============================================================================
test.describe("Multi-capability listing", () => {
	test("Create with 2 capabilities; update removes one; removing last -> 422", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("mp-multicap");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Multi-cap Listing",
				description: "Has two capabilities",
				capabilities: [TEST_CAP_ID, TEST_CAP2_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			expect(createRes.body!.capabilities.length).toBe(2);

			const removeRes = await api.removeListingCapability(token, {
				listing_number: listingNum,
				capability_id: TEST_CAP2_ID,
			});
			expect(removeRes.status).toBe(200);
			expect(removeRes.body!.capabilities.length).toBe(1);

			const removeLast = await api.removeListingCapability(token, {
				listing_number: listingNum,
				capability_id: TEST_CAP_ID,
			});
			expect(removeLast.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: update listing without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.updateListing("invalid-token", {
			listing_number: 1,
			headline: "Updated",
			description: "Updated description",
		} as UpdateListingRequest);
		expect(res.status).toBe(401);
	});

	test("Auth: add capability without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.addListingCapability("invalid-token", {
			listing_number: 1,
			capability_id: "some-cap",
		} as AddListingCapabilityRequest);
		expect(res.status).toBe(401);
	});

	test("Auth: remove capability without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.removeListingCapability("invalid-token", {
			listing_number: 1,
			capability_id: "some-cap",
		} as RemoveListingCapabilityRequest);
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// Quota exceeded: silver tier allows 5 listings; 6th publish -> 403
// ============================================================================
test.describe("Quota: marketplace_listings cap enforced on publish", () => {
	test("Silver org: 5 active listings, 6th publish -> 403 with quota payload", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-quota").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			// Create 5 active listings via DB helper (bypassing API)
			for (let i = 0; i < 5; i++) {
				await createTestMarketplaceListingDirect(
					orgId,
					domain,
					[TEST_CAP_ID],
					"active",
					`Quota Listing ${i + 1}`
				);
			}

			// Create a 6th draft via API then try to publish
			const draftRes = await api.createListing(token, {
				headline: "6th Listing",
				description: "Should fail to publish",
				capabilities: [TEST_CAP_ID],
			});
			expect(draftRes.status).toBe(201);
			const listingNum = draftRes.body!.listing_number;

			const publishRes = await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);
			expect(publishRes.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// Subscribe: consumer org subscribes -> active
// Re-subscribe after cancellation reactivates
// ============================================================================
test.describe("Subscription flows", () => {
	test("Subscribe -> active; cancel; re-subscribe reactivates", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-sub-provider").email,
			TEST_PASSWORD
		);
		await setOrgPlan(provOrgId, "silver");
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-sub-consumer").email,
				TEST_PASSWORD
			);
		try {
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			// Provider creates and publishes (superadmin -> active)
			const createRes = await api.createListing(provToken, {
				headline: "Service Listing",
				description: "A service for consumers",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const pubRes = await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);
			expect(pubRes.status).toBe(200);
			expect(pubRes.body!.status as MarketplaceListingStatus).toBe("active");

			// Consumer subscribes
			const subReq: SubscribeRequest = {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
				request_note: "I need this service",
			};
			const subRes = await api.subscribe(conToken, subReq);
			expect(subRes.status).toBe(201);
			const subStatus: MarketplaceSubscriptionStatus = subRes.body!.status;
			expect(subStatus).toBe("active");

			const subId = subRes.body!.subscription_id;

			// Cancel
			const cancelRes = await api.cancelSubscription(conToken, {
				subscription_id: subId,
			});
			expect(cancelRes.status).toBe(200);

			// Re-subscribe reactivates
			const resubRes = await api.subscribe(conToken, subReq);
			expect(resubRes.status).toBe(201);
			const resubStatus: MarketplaceSubscriptionStatus = resubRes.body!.status;
			expect(resubStatus).toBe("active");
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Self-subscription rejected -> 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-self-sub").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Self Sub Test",
				description: "Testing self subscription rejection",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(token, {
				provider_org_domain: domain,
				provider_listing_number: listingNum,
			});
			expect(subRes.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: subscribe without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.subscribe("invalid-token", {
			provider_org_domain: "example.com",
			provider_listing_number: 1,
		} as SubscribeRequest);
		expect(res.status).toBe(401);
	});

	test("Auth: cancel subscription without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.cancelSubscription("invalid-token", {
			subscription_id: "00000000-0000-0000-0000-000000000000",
		} as CancelSubscriptionRequest);
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// RBAC tests
// ============================================================================
test.describe("RBAC — Marketplace Listings", () => {
	test("Positive: user with org:manage_listings can create listing (201)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-pos").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(orgUserId, "org:manage_listings");
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.createListing(token, {
				headline: "RBAC Test Listing",
				description: "Testing RBAC positive",
				capabilities: [TEST_CAP_ID],
			});
			expect(res.status).toBe(201);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Negative: user with no roles cannot create listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.createListing(token, {
				headline: "RBAC Test Listing",
				description: "Testing RBAC negative",
				capabilities: [TEST_CAP_ID],
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Positive: user with org:view_listings can list listings (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-view").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(orgUserId, "org:view_listings");
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMyListings(token, {});
			expect(res.status).toBe(200);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Negative: user with no roles cannot list listings (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-view-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMyListings(token, {});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Positive: user with org:manage_subscriptions can subscribe (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-prov").email,
			TEST_PASSWORD
		);
		await setOrgPlan(provOrgId, "silver");
		const {
			email: conEmail,
			domain: conDomain,
			orgUserId: conUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-con").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(conUserId, "org:manage_subscriptions");
		try {
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "RBAC Sub Listing",
				description: "For RBAC subscription test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			});
			expect(subRes.status).toBe(201);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Negative: user with no roles cannot subscribe (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: provEmail, domain: provDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-rbac-prov2").email,
				TEST_PASSWORD
			);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgUserDirect(
				generateTestOrgEmail("mp-rbac-con2").email,
				TEST_PASSWORD
			);
		try {
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "RBAC Sub Listing 2",
				description: "For RBAC subscription negative test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			});
			expect(subRes.status).toBe(403);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Positive: user with org:manage_listings can update listing (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: adminEmail,
			domain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-upd-admin").email,
			TEST_PASSWORD
		);
		const { email: userEmail, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-upd-user").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");
		try {
			const adminToken = await loginOrg(api, adminEmail, domain);
			const userToken = await loginOrg(api, userEmail, domain);

			const createRes = await api.createListing(adminToken, {
				headline: "Update RBAC Listing",
				description: "For update RBAC test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const updateRes = await api.updateListing(userToken, {
				listing_number: listingNum,
				headline: "Updated Headline",
				description: "Updated description",
			} as UpdateListingRequest);
			expect(updateRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("Negative: user with no roles cannot update listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-upd-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.updateListing(token, {
				listing_number: 1,
				headline: "Updated",
				description: "Updated",
			} as UpdateListingRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Positive: user with org:manage_listings can add capability (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: adminEmail,
			domain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-addcap-admin").email,
			TEST_PASSWORD
		);
		const { email: userEmail, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-addcap-user").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");
		try {
			const adminToken = await loginOrg(api, adminEmail, domain);
			const userToken = await loginOrg(api, userEmail, domain);

			const createRes = await api.createListing(adminToken, {
				headline: "Add Cap RBAC Listing",
				description: "For add-cap RBAC test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const addRes = await api.addListingCapability(userToken, {
				listing_number: listingNum,
				capability_id: TEST_CAP2_ID,
			} as AddListingCapabilityRequest);
			expect(addRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("Negative: user with no roles cannot add capability (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-addcap-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.addListingCapability(token, {
				listing_number: 1,
				capability_id: "some-cap",
			} as AddListingCapabilityRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Positive: user with org:manage_listings can remove capability (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: adminEmail,
			domain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-remcap-admin").email,
			TEST_PASSWORD
		);
		const { email: userEmail, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-remcap-user").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");
		try {
			const adminToken = await loginOrg(api, adminEmail, domain);
			const userToken = await loginOrg(api, userEmail, domain);

			const createRes = await api.createListing(adminToken, {
				headline: "Remove Cap RBAC Listing",
				description: "For remove-cap RBAC test",
				capabilities: [TEST_CAP_ID, TEST_CAP2_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const removeRes = await api.removeListingCapability(userToken, {
				listing_number: listingNum,
				capability_id: TEST_CAP2_ID,
			} as RemoveListingCapabilityRequest);
			expect(removeRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("Negative: user with no roles cannot remove capability (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-remcap-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.removeListingCapability(token, {
				listing_number: 1,
				capability_id: "some-cap",
			} as RemoveListingCapabilityRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Positive: org superadmin can approve pending_review listing (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-approve-member").email,
			TEST_PASSWORD
		);
		const { email: adminEmail } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-approve-admin").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);

			const createRes = await api.createListing(memberToken, {
				headline: "RBAC Approve Listing",
				description: "For approve RBAC test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const approveRes = await api.approveListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
			} as AdminApproveListingRequest);
			expect(approveRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(memberEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("Negative: user with only manage_listings cannot approve (non-superadmin) (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-approve-neg").email,
			TEST_PASSWORD
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const approveRes = await api.approveListing(memberToken, {
				org_domain: domain,
				listing_number: 1,
			} as AdminApproveListingRequest);
			expect(approveRes.status).toBe(403);
		} finally {
			await deleteTestOrgUser(memberEmail);
		}
	});

	test("Positive: org superadmin can reject pending_review listing (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-reject-member").email,
			TEST_PASSWORD
		);
		const { email: adminEmail } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-reject-admin").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);

			const createRes = await api.createListing(memberToken, {
				headline: "RBAC Reject Listing",
				description: "For reject RBAC test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const rejectRes = await api.rejectListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
				rejection_note: "RBAC reject test",
			} as AdminRejectListingRequest);
			expect(rejectRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(memberEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("Negative: user with only manage_listings cannot reject (non-superadmin) (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-reject-neg").email,
			TEST_PASSWORD
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const rejectRes = await api.rejectListing(memberToken, {
				org_domain: domain,
				listing_number: 1,
				rejection_note: "RBAC reject negative",
			} as AdminRejectListingRequest);
			expect(rejectRes.status).toBe(403);
		} finally {
			await deleteTestOrgUser(memberEmail);
		}
	});

	test("Positive: user with org:manage_subscriptions can cancel subscription (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-cancel-prov").email,
			TEST_PASSWORD
		);
		await setOrgPlan(provOrgId, "silver");
		const {
			email: conAdminEmail,
			domain: conDomain,
			orgId: conOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-rbac-cancel-conadmin").email,
			TEST_PASSWORD
		);
		const { email: conUserEmail, orgUserId: conUserId } =
			await createTestOrgUserDirect(
				generateTestOrgEmail("mp-rbac-cancel-conuser").email,
				TEST_PASSWORD,
				"ind1",
				{ domain: conDomain, orgId: conOrgId }
			);
		await assignRoleToOrgUser(conUserId, "org:manage_subscriptions", "ind1");
		try {
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conAdminToken = await loginOrg(api, conAdminEmail, conDomain);
			const conUserToken = await loginOrg(api, conUserEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "RBAC Cancel Sub Listing",
				description: "For cancel subscription RBAC test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(conAdminToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);
			expect(subRes.status).toBe(201);
			const subId = subRes.body!.subscription_id;

			const cancelRes = await api.cancelSubscription(conUserToken, {
				subscription_id: subId,
			} as CancelSubscriptionRequest);
			expect(cancelRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conAdminEmail);
			await deleteTestOrgUser(conUserEmail);
		}
	});

	test("Negative: user with no roles cannot cancel subscription (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-rbac-cancel-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.cancelSubscription(token, {
				subscription_id: "00000000-0000-0000-0000-000000000000",
			} as CancelSubscriptionRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// Audit log assertions
// ============================================================================
test.describe("Audit logs for marketplace write operations", () => {
	test("Create listing -> audit log recorded", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("mp-audit");
		const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			await api.createListing(token, {
				headline: "Audit Test Listing",
				description: "Testing audit log",
				capabilities: [TEST_CAP_ID],
			});

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_created"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			const entry = auditRes.body.audit_logs[0];
			expect(entry.event_type).toBe("org.marketplace_listing_created");
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Update listing -> audit log recorded (org.marketplace_listing_updated)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-upd").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(token, {
				headline: "Update Audit Listing",
				description: "For update audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.updateListing(token, {
				listing_number: listingNum,
				headline: "Updated Audit Headline",
				description: "Updated audit description",
			} as UpdateListingRequest);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_updated"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_updated"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Add capability -> audit log recorded (org.marketplace_listing_updated)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-addcap").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(token, {
				headline: "Add Cap Audit Listing",
				description: "For add-cap audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.addListingCapability(token, {
				listing_number: listingNum,
				capability_id: TEST_CAP2_ID,
			} as AddListingCapabilityRequest);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_updated"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_updated"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Remove capability -> audit log recorded (org.marketplace_listing_updated)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-remcap").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(token, {
				headline: "Remove Cap Audit Listing",
				description: "For remove-cap audit test",
				capabilities: [TEST_CAP_ID, TEST_CAP2_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.removeListingCapability(token, {
				listing_number: listingNum,
				capability_id: TEST_CAP2_ID,
			} as RemoveListingCapabilityRequest);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_updated"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_updated"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Subscribe -> audit log recorded (org.marketplace_subscription_created)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-sub-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-audit-sub-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(provToken, {
				headline: "Subscribe Audit Listing",
				description: "For subscribe audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);
			expect(subRes.status).toBe(201);

			const auditRes = await api.filterAuditLogs(conToken, {
				event_types: ["org.marketplace_subscription_created"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_subscription_created"
			);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Cancel subscription -> audit log recorded (org.marketplace_subscription_cancelled)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-cancel-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-audit-cancel-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "Cancel Audit Listing",
				description: "For cancel audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const subRes = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);
			expect(subRes.status).toBe(201);
			const subId = subRes.body!.subscription_id;

			const before = new Date(Date.now() - 2000).toISOString();

			await api.cancelSubscription(conToken, {
				subscription_id: subId,
			} as CancelSubscriptionRequest);

			const auditRes = await api.filterAuditLogs(conToken, {
				event_types: ["org.marketplace_subscription_cancelled"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_subscription_cancelled"
			);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Approve listing -> audit log recorded (org.marketplace_listing_approved)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-audit-approve-member").email,
			TEST_PASSWORD
		);
		const { email: adminEmail } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-approve-admin").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(memberToken, {
				headline: "Approve Audit Listing",
				description: "For approve audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const approveRes = await api.approveListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
			} as AdminApproveListingRequest);
			expect(approveRes.status).toBe(200);

			const auditRes = await api.filterAuditLogs(adminToken, {
				event_types: ["org.marketplace_listing_approved"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_approved"
			);
		} finally {
			await deleteTestOrgUser(memberEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("Reject listing -> audit log recorded (org.marketplace_listing_rejected)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: memberEmail,
			domain,
			orgId,
			orgUserId: memberUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-audit-reject-member").email,
			TEST_PASSWORD
		);
		const { email: adminEmail } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-audit-reject-admin").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(memberUserId, "org:manage_listings", "ind1");
		try {
			const memberToken = await loginOrg(api, memberEmail, domain);
			const adminToken = await loginOrg(api, adminEmail, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(memberToken, {
				headline: "Reject Audit Listing",
				description: "For reject audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(memberToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const rejectRes = await api.rejectListing(adminToken, {
				org_domain: domain,
				listing_number: listingNum,
				rejection_note: "Audit reject test",
			} as AdminRejectListingRequest);
			expect(rejectRes.status).toBe(200);

			const auditRes = await api.filterAuditLogs(adminToken, {
				event_types: ["org.marketplace_listing_rejected"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_rejected"
			);
		} finally {
			await deleteTestOrgUser(memberEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});
});

// ============================================================================
// POST /org/marketplace/listing/archive
// ============================================================================
test.describe("POST /org/marketplace/listing/archive", () => {
	test("Success: active listing archived -> 200, status is archived", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-archive-ok").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Archive Test Listing",
				description: "To be archived",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const archiveRes = await api.archiveListing(token, {
				listing_number: listingNum,
			} as ArchiveListingRequest);
			expect(archiveRes.status).toBe(200);

			const getRes = await api.getListing(token, {
				org_domain: domain,
				listing_number: listingNum,
			} as GetListingRequest);
			expect(getRes.status).toBe(200);
			const status: MarketplaceListingStatus = getRes.body!.status;
			expect(status).toBe("archived");
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Wrong state (draft): archive draft -> 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-archive-draft").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Draft Archive Listing",
				description: "Should not be archivable",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);

			const archiveRes = await api.archiveListing(token, {
				listing_number: createRes.body!.listing_number,
			} as ArchiveListingRequest);
			expect(archiveRes.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: archive without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.archiveListing("invalid-token", {
			listing_number: 1,
		} as ArchiveListingRequest);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: org:manage_listings can archive active listing -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: adminEmail,
			domain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-archive-rbac-admin").email,
			TEST_PASSWORD
		);
		const { email: userEmail, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-archive-rbac-user").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");
		try {
			const adminToken = await loginOrg(api, adminEmail, domain);
			const userToken = await loginOrg(api, userEmail, domain);

			const createRes = await api.createListing(adminToken, {
				headline: "RBAC Archive Listing",
				description: "For RBAC archive test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(adminToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const archiveRes = await api.archiveListing(userToken, {
				listing_number: listingNum,
			} as ArchiveListingRequest);
			expect(archiveRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("RBAC negative: user with no roles cannot archive -> 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-archive-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.archiveListing(token, {
				listing_number: 1,
			} as ArchiveListingRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Audit log: archive records org.marketplace_listing_archived", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-archive-audit").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(token, {
				headline: "Archive Audit Listing",
				description: "For archive audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);
			const archiveRes = await api.archiveListing(token, {
				listing_number: listingNum,
			} as ArchiveListingRequest);
			expect(archiveRes.status).toBe(200);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_archived"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_archived"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// POST /org/marketplace/listing/reopen
// ============================================================================
test.describe("POST /org/marketplace/listing/reopen", () => {
	test("Success: archived listing reopened -> 200, status is draft", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-reopen-ok").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Reopen Test Listing",
				description: "To be reopened",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);
			await api.archiveListing(token, {
				listing_number: listingNum,
			} as ArchiveListingRequest);

			const reopenRes = await api.reopenListing(token, {
				listing_number: listingNum,
			} as ReopenListingRequest);
			expect(reopenRes.status).toBe(200);
			const status: MarketplaceListingStatus = reopenRes.body!.status;
			expect(status).toBe("draft");
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Wrong state (active): reopen active listing -> 422", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-reopen-active").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Active Reopen Listing",
				description: "Active listing should not reopen",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const reopenRes = await api.reopenListing(token, {
				listing_number: listingNum,
			} as ReopenListingRequest);
			expect(reopenRes.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: reopen without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.reopenListing("invalid-token", {
			listing_number: 1,
		} as ReopenListingRequest);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: org:manage_listings can reopen archived listing -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: adminEmail,
			domain,
			orgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-reopen-rbac-admin").email,
			TEST_PASSWORD
		);
		const { email: userEmail, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-reopen-rbac-user").email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId }
		);
		await setOrgPlan(orgId, "silver");
		await assignRoleToOrgUser(orgUserId, "org:manage_listings", "ind1");
		try {
			const adminToken = await loginOrg(api, adminEmail, domain);
			const userToken = await loginOrg(api, userEmail, domain);

			const createRes = await api.createListing(adminToken, {
				headline: "RBAC Reopen Listing",
				description: "For RBAC reopen test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(adminToken, {
				listing_number: listingNum,
			} as PublishListingRequest);
			await api.archiveListing(adminToken, {
				listing_number: listingNum,
			} as ArchiveListingRequest);

			const reopenRes = await api.reopenListing(userToken, {
				listing_number: listingNum,
			} as ReopenListingRequest);
			expect(reopenRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("RBAC negative: user with no roles cannot reopen -> 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-reopen-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.reopenListing(token, {
				listing_number: 1,
			} as ReopenListingRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Audit log: reopen records org.marketplace_listing_reopened", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-reopen-audit").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const before = new Date(Date.now() - 2000).toISOString();

			const createRes = await api.createListing(token, {
				headline: "Reopen Audit Listing",
				description: "For reopen audit test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);
			await api.archiveListing(token, {
				listing_number: listingNum,
			} as ArchiveListingRequest);
			const reopenRes = await api.reopenListing(token, {
				listing_number: listingNum,
			} as ReopenListingRequest);
			expect(reopenRes.status).toBe(200);

			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_reopened"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditRes.body.audit_logs[0].event_type).toBe(
				"org.marketplace_listing_reopened"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// POST /org/marketplace/listing/get
// ============================================================================
test.describe("POST /org/marketplace/listing/get", () => {
	test("Own listing: get own listing (any status) -> 200, returns status field", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-get-own").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "Own Listing Get",
				description: "Getting own listing",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;

			const getRes = await api.getListing(token, {
				org_domain: domain,
				listing_number: listingNum,
			} as GetListingRequest);
			expect(getRes.status).toBe(200);
			expect(getRes.body!.status).toBeDefined();
			const status: MarketplaceListingStatus = getRes.body!.status;
			expect(status).toBe("draft");
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Cross-org active: org B gets org A active listing -> 200, is_subscribed false", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-get-xa-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-get-xa-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "Cross Org Get Listing",
				description: "For cross-org get test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const getRes = await api.getListing(conToken, {
				org_domain: provDomain,
				listing_number: listingNum,
			} as GetListingRequest);
			expect(getRes.status).toBe(200);
			expect(getRes.body!.is_subscribed).toBe(false);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Cross-org subscribed: org B subscribes then gets -> 200, is_subscribed true", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-get-sub-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-get-sub-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "Subscribed Get Listing",
				description: "For subscribed get test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);

			const getRes = await api.getListing(conToken, {
				org_domain: provDomain,
				listing_number: listingNum,
			} as GetListingRequest);
			expect(getRes.status).toBe(200);
			expect(getRes.body!.is_subscribed).toBe(true);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Cross-org not active: draft listing not in catalog -> org B gets -> 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-get-draft-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-get-draft-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "Draft Not Catalogued",
				description: "Draft listing not visible cross-org",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);

			const getRes = await api.getListing(conToken, {
				org_domain: provDomain,
				listing_number: createRes.body!.listing_number,
			} as GetListingRequest);
			expect(getRes.status).toBe(404);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Validation: missing required fields -> 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-get-val").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const res = await api.getListing(token, {
				org_domain: "",
				listing_number: 0,
			} as GetListingRequest);
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: get listing without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getListing("invalid-token", {
			org_domain: "example.com",
			listing_number: 1,
		} as GetListingRequest);
		expect(res.status).toBe(401);
	});
});

// ============================================================================
// POST /org/marketplace/discover
// ============================================================================
test.describe("POST /org/marketplace/discover", () => {
	test("Success (no filter): published listing appears in discover results", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-discover-ok").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-discover-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(token, {
				headline: "Discoverable Listing",
				description: "Should appear in discover",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(token, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const discoverRes = await api.discoverListings(
				conToken,
				{} as DiscoverListingsRequest
			);
			expect(discoverRes.status).toBe(200);
			const found = discoverRes.body!.listings.find(
				(l) => l.org_domain === domain && l.listing_number === listingNum
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Filter by capability_id: only matching listing returned", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: prov1Email,
			domain: prov1Domain,
			orgId: prov1OrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-disc-cap1-prov").email,
			TEST_PASSWORD
		);
		const {
			email: prov2Email,
			domain: prov2Domain,
			orgId: prov2OrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-disc-cap2-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-disc-cap-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(prov1OrgId, "silver");
			await setOrgPlan(prov2OrgId, "silver");
			const prov1Token = await loginOrg(api, prov1Email, prov1Domain);
			const prov2Token = await loginOrg(api, prov2Email, prov2Domain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes1 = await api.createListing(prov1Token, {
				headline: "Cap1 Listing",
				description: "Has TEST_CAP_ID",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			await api.publishListing(prov1Token, {
				listing_number: createRes1.body!.listing_number,
			} as PublishListingRequest);

			const createRes2 = await api.createListing(prov2Token, {
				headline: "Cap2 Listing",
				description: "Has TEST_CAP2_ID",
				capabilities: [TEST_CAP2_ID],
			});
			expect(createRes2.status).toBe(201);
			await api.publishListing(prov2Token, {
				listing_number: createRes2.body!.listing_number,
			} as PublishListingRequest);

			const discoverRes = await api.discoverListings(conToken, {
				capability_id: TEST_CAP_ID,
			} as DiscoverListingsRequest);
			expect(discoverRes.status).toBe(200);

			const found1 = discoverRes.body!.listings.find(
				(l) => l.org_domain === prov1Domain
			);
			const found2 = discoverRes.body!.listings.find(
				(l) => l.org_domain === prov2Domain
			);
			expect(found1).toBeDefined();
			expect(found2).toBeUndefined();
		} finally {
			await deleteTestOrgUser(prov1Email);
			await deleteTestOrgUser(prov2Email);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Filter by search_text: matching listing returned", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const uniqueWord = `uniq${Math.random().toString(36).slice(2, 10)}`;
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-disc-text").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-disc-text-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(token, {
				headline: `Searchable ${uniqueWord} Listing`,
				description: "For text search test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			await api.publishListing(token, {
				listing_number: createRes.body!.listing_number,
			} as PublishListingRequest);

			const discoverRes = await api.discoverListings(conToken, {
				search_text: uniqueWord,
			} as DiscoverListingsRequest);
			expect(discoverRes.status).toBe(200);
			const found = discoverRes.body!.listings.find(
				(l) => l.org_domain === domain
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Empty result: no active listings for filter -> 200, empty listings", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-disc-empty").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const discoverRes = await api.discoverListings(token, {
				search_text: `no-match-${crypto.randomUUID()}`,
			} as DiscoverListingsRequest);
			expect(discoverRes.status).toBe(200);
			expect(discoverRes.body!.listings).toHaveLength(0);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: discover without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.discoverListings(
			"invalid-token",
			{} as DiscoverListingsRequest
		);
		expect(res.status).toBe(401);
	});

	test("Validation: invalid pagination_key -> 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-disc-invpag").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.discoverListingsRaw(token, {
				pagination_key: "not-a-uuid",
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// POST /org/marketplace/subscription/list
// ============================================================================
test.describe("POST /org/marketplace/subscription/list", () => {
	test("Success: subscribed listing appears in list -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-sublist-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-sublist-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "SubList Provider Listing",
				description: "For subscription list test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);

			const listRes = await api.listMySubscriptions(
				conToken,
				{} as ListMySubscriptionsRequest
			);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.subscriptions.find(
				(s) => s.provider_listing_number === listingNum
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Filter by status: active + cancelled; filter active returns only active", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-subfilt-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-subfilt-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes1 = await api.createListing(provToken, {
				headline: "Active Sub Listing",
				description: "For status filter test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			await api.publishListing(provToken, {
				listing_number: createRes1.body!.listing_number,
			} as PublishListingRequest);

			const subRes1 = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: createRes1.body!.listing_number,
			} as SubscribeRequest);
			expect(subRes1.status).toBe(201);

			const createRes2 = await api.createListing(provToken, {
				headline: "Cancelled Sub Listing",
				description: "For cancelled status test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes2.status).toBe(201);
			await api.publishListing(provToken, {
				listing_number: createRes2.body!.listing_number,
			} as PublishListingRequest);

			const subRes2 = await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: createRes2.body!.listing_number,
			} as SubscribeRequest);
			expect(subRes2.status).toBe(201);
			await api.cancelSubscription(conToken, {
				subscription_id: subRes2.body!.subscription_id,
			});

			const listRes = await api.listMySubscriptions(conToken, {
				filter_status: "active" as MarketplaceSubscriptionStatus,
			} as ListMySubscriptionsRequest);
			expect(listRes.status).toBe(200);
			const allStatuses = listRes.body!.subscriptions.map((s) => s.status);
			expect(allStatuses.every((s) => s === "active")).toBe(true);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Auth: list subscriptions without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMySubscriptions(
			"invalid-token",
			{} as ListMySubscriptionsRequest
		);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: org:view_subscriptions can list subscriptions -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-sublist-rbac-pos").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(orgUserId, "org:view_subscriptions");
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMySubscriptions(
				token,
				{} as ListMySubscriptionsRequest
			);
			expect(res.status).toBe(200);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("RBAC negative: user with no roles cannot list subscriptions -> 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-sublist-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMySubscriptions(
				token,
				{} as ListMySubscriptionsRequest
			);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// POST /org/marketplace/subscription/get
// ============================================================================
test.describe("POST /org/marketplace/subscription/get", () => {
	test("Success: subscribe then get by provider domain + listing number -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-subget-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-subget-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "SubGet Listing",
				description: "For subscription get test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);

			const getRes = await api.getSubscription(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as GetSubscriptionRequest);
			expect(getRes.status).toBe(200);
			expect(getRes.body!.provider_listing_number).toBe(listingNum);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Not subscribed: valid active listing, no subscription -> 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-subget-nosub-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-subget-nosub-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "NoSub Listing",
				description: "Active but not subscribed",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			const getRes = await api.getSubscription(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as GetSubscriptionRequest);
			expect(getRes.status).toBe(404);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Non-existent listing: bogus domain/number -> 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-subget-bogus").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.getSubscription(token, {
				provider_org_domain: "bogus-domain-xyz.com",
				provider_listing_number: 99999,
			} as GetSubscriptionRequest);
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: get subscription without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getSubscription("invalid-token", {
			provider_org_domain: "example.com",
			provider_listing_number: 1,
		} as GetSubscriptionRequest);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: org:view_subscriptions can get subscription -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-subget-rbac-prov").email,
			TEST_PASSWORD
		);
		const {
			email: conEmail,
			domain: conDomain,
			orgUserId: conUserId,
		} = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-subget-rbac-user").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(conUserId, "org:view_subscriptions");
		await assignRoleToOrgUser(conUserId, "org:manage_subscriptions");
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "RBAC SubGet Listing",
				description: "For RBAC subget test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);

			const getRes = await api.getSubscription(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as GetSubscriptionRequest);
			expect(getRes.status).toBe(200);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("RBAC negative: user with no roles cannot get subscription -> 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-subget-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.getSubscription(token, {
				provider_org_domain: "example.com",
				provider_listing_number: 1,
			} as GetSubscriptionRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});

// ============================================================================
// POST /org/marketplace/clients/list
// ============================================================================
test.describe("POST /org/marketplace/clients/list", () => {
	test("Success: provider lists clients after consumer subscribes -> 200, consumer appears", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-clients-prov").email,
			TEST_PASSWORD
		);
		const { email: conEmail, domain: conDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-clients-con").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const conToken = await loginOrg(api, conEmail, conDomain);

			const createRes = await api.createListing(provToken, {
				headline: "Clients Test Listing",
				description: "For clients list test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			const listingNum = createRes.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum,
			} as PublishListingRequest);

			await api.subscribe(conToken, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum,
			} as SubscribeRequest);

			const clientsRes = await api.listMyClients(
				provToken,
				{} as ListMyClientsRequest
			);
			expect(clientsRes.status).toBe(200);
			const found = clientsRes.body!.clients.find(
				(c) => c.listing_number === listingNum
			);
			expect(found).toBeDefined();
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(conEmail);
		}
	});

	test("Filter by listing_number: two listings, two subscribers; filter by one listing_number -> one client", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const {
			email: provEmail,
			domain: provDomain,
			orgId: provOrgId,
		} = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-clients-filt-prov").email,
			TEST_PASSWORD
		);
		const { email: con1Email, domain: con1Domain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-clients-filt-con1").email,
				TEST_PASSWORD
			);
		const { email: con2Email, domain: con2Domain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-clients-filt-con2").email,
				TEST_PASSWORD
			);
		try {
			await setOrgPlan(provOrgId, "silver");
			const provToken = await loginOrg(api, provEmail, provDomain);
			const con1Token = await loginOrg(api, con1Email, con1Domain);
			const con2Token = await loginOrg(api, con2Email, con2Domain);

			const createRes1 = await api.createListing(provToken, {
				headline: "Clients Filter Listing 1",
				description: "First listing",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes1.status).toBe(201);
			const listingNum1 = createRes1.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum1,
			} as PublishListingRequest);

			const createRes2 = await api.createListing(provToken, {
				headline: "Clients Filter Listing 2",
				description: "Second listing",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes2.status).toBe(201);
			const listingNum2 = createRes2.body!.listing_number;
			await api.publishListing(provToken, {
				listing_number: listingNum2,
			} as PublishListingRequest);

			await api.subscribe(con1Token, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum1,
			} as SubscribeRequest);
			await api.subscribe(con2Token, {
				provider_org_domain: provDomain,
				provider_listing_number: listingNum2,
			} as SubscribeRequest);

			const clientsRes = await api.listMyClients(provToken, {
				listing_number: listingNum1,
			} as ListMyClientsRequest);
			expect(clientsRes.status).toBe(200);
			const allNums = clientsRes.body!.clients.map((c) => c.listing_number);
			expect(allNums.every((n) => n === listingNum1)).toBe(true);
		} finally {
			await deleteTestOrgUser(provEmail);
			await deleteTestOrgUser(con1Email);
			await deleteTestOrgUser(con2Email);
		}
	});

	test("Empty when no subscribers: fresh listing, no subscriptions -> 200, empty clients", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgId } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-clients-empty").email,
			TEST_PASSWORD
		);
		try {
			await setOrgPlan(orgId, "silver");
			const token = await loginOrg(api, email, domain);

			const createRes = await api.createListing(token, {
				headline: "No Subscribers Listing",
				description: "For empty clients test",
				capabilities: [TEST_CAP_ID],
			});
			expect(createRes.status).toBe(201);
			await api.publishListing(token, {
				listing_number: createRes.body!.listing_number,
			} as PublishListingRequest);

			const clientsRes = await api.listMyClients(token, {
				listing_number: createRes.body!.listing_number,
			} as ListMyClientsRequest);
			expect(clientsRes.status).toBe(200);
			expect(clientsRes.body!.clients).toHaveLength(0);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("Auth: list clients without token -> 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMyClients(
			"invalid-token",
			{} as ListMyClientsRequest
		);
		expect(res.status).toBe(401);
	});

	test("RBAC positive: org:view_listings can list clients -> 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-clients-rbac-pos").email,
			TEST_PASSWORD
		);
		await assignRoleToOrgUser(orgUserId, "org:view_listings");
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMyClients(token, {} as ListMyClientsRequest);
			expect(res.status).toBe(200);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("RBAC negative: user with no roles cannot list clients -> 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-clients-rbac-neg").email,
			TEST_PASSWORD
		);
		try {
			const token = await loginOrg(api, email, domain);
			const res = await api.listMyClients(token, {} as ListMyClientsRequest);
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});
