import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgTier,
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
	SubscribeRequest,
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
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
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
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
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
			const auditRes = await api.filterAuditLogs(token, {
				event_types: ["org.marketplace_listing_created"],
				start_time: before,
			});
			expect(auditRes.status).toBe(200);
			expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
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
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-approve").email,
			TEST_PASSWORD
		);
		const { email: adminEmail, domain: adminDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-approve-admin", domain).email,
				TEST_PASSWORD,
				"ind1",
				{ domain, orgId: undefined }
			);
		await assignRoleToOrgUser(orgUserId, "org:manage_listings");

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
		const { email, domain, orgUserId } = await createTestOrgUserDirect(
			generateTestOrgEmail("mp-reject").email,
			TEST_PASSWORD
		);
		const { email: adminEmail } = await createTestOrgAdminDirect(
			generateTestOrgEmail("mp-reject-admin", domain).email,
			TEST_PASSWORD,
			"ind1",
			{ domain, orgId: undefined }
		);
		await assignRoleToOrgUser(orgUserId, "org:manage_listings");

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
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
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
			await setOrgTier(orgId, "silver");
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
			expect(subRes.status).toBe(200);
			const subStatus: MarketplaceSubscriptionStatus = subRes.body!.status;
			expect(subStatus).toBe("active");

			const subId = subRes.body!.subscription_id;

			// Cancel
			const cancelRes = await api.cancelSubscription(conToken, {
				subscription_id: subId,
			});
			expect(cancelRes.status).toBe(204);

			// Re-subscribe reactivates
			const resubRes = await api.subscribe(conToken, subReq);
			expect(resubRes.status).toBe(200);
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
		const { email: provEmail, domain: provDomain } =
			await createTestOrgAdminDirect(
				generateTestOrgEmail("mp-rbac-prov").email,
				TEST_PASSWORD
			);
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
			expect(subRes.status).toBe(200);
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
});

// ============================================================================
// Audit log assertions
// ============================================================================
test.describe("Audit logs for marketplace write operations", () => {
	test("Create listing -> audit log recorded", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("mp-audit");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		try {
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
});
