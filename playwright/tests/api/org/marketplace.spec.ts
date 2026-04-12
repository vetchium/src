import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	generateTestOrgEmail,
	assignRoleToAdminUser,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	assignRoleToOrgUser,
	createTestMarketplaceCapability,
	deleteTestMarketplaceCapability,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateListingRequest,
	UpdateListingRequest,
	GetMyListingRequest,
	PublishListingRequest,
	ArchiveListingRequest,
	ReopenListingRequest,
	RequestSubscriptionRequest,
	CancelSubscriptionRequest,
	GetSubscriptionRequest,
	GetClientRequest,
	ListMarketplaceCapabilitiesRequest,
	GetMarketplaceCapabilityRequest,
	DiscoverListingsRequest,
	GetListingRequest,
	ListSubscriptionsRequest,
} from "vetchium-specs/org/marketplace";
import type { FilterAuditLogsRequest } from "vetchium-specs/audit-logs/audit-logs";

function generateCapabilityId(prefix: string = "cap"): string {
	const hex = Math.random().toString(16).substring(2, 10);
	return `${prefix}-${hex}`;
}

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
	const lr = await api.login(loginReq);
	expect(lr.status).toBe(200);
	const tfa = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: lr.body!.tfa_token,
		tfa_code: tfa,
		remember_me: false,
	};
	const tr = await api.verifyTFA(tfaReq);
	expect(tr.status).toBe(200);
	return tr.body!.session_token;
}

test.describe("Org Marketplace API", () => {
	// Org user with manage_listings role
	let providerEmail: string;
	let providerToken: string;
	let providerOrgDomain: string;
	let providerOrgUserId: string;

	// Org user with manage_subscriptions role
	let consumerEmail: string;
	let consumerToken: string;
	let consumerOrgDomain: string;
	let consumerOrgUserId: string;

	// Provider with audit log access
	let providerAuditToken: string;

	// Capability created for tests
	let capId: string;

	// Org user with no roles (for 403 tests)
	let noRoleEmail: string;
	let noRoleToken: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		// Create a marketplace capability for tests
		capId = generateCapabilityId("org-test");
		await createTestMarketplaceCapability(capId, "active");

		// Create provider org user
		const providerOrgInfo = generateTestOrgEmail("mkt-provider");
		providerEmail = providerOrgInfo.email;
		const providerOrg = await createTestOrgAdminDirect(
			providerEmail,
			TEST_PASSWORD,
			"ind1",
			{ domain: providerOrgInfo.domain }
		);
		providerOrgDomain = providerOrg.domain;
		providerOrgUserId = providerOrg.orgUserId;
		await assignRoleToOrgUser(providerOrgUserId, "org:manage_listings");
		await assignRoleToOrgUser(providerOrgUserId, "org:view_audit_logs");
		providerToken = await loginOrgUser(
			orgApi,
			providerEmail,
			providerOrgDomain
		);
		providerAuditToken = providerToken;

		// Create consumer org user
		const consumerOrgInfo = generateTestOrgEmail("mkt-consumer");
		consumerEmail = consumerOrgInfo.email;
		const consumerOrg = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD,
			"ind1",
			{ domain: consumerOrgInfo.domain }
		);
		consumerOrgDomain = consumerOrg.domain;
		consumerOrgUserId = consumerOrg.orgUserId;
		await assignRoleToOrgUser(consumerOrgUserId, "org:manage_subscriptions");
		consumerToken = await loginOrgUser(
			orgApi,
			consumerEmail,
			consumerOrgDomain
		);

		// Create no-role user in the consumer org
		noRoleEmail = `norole-${Math.random().toString(16).substring(2, 10)}@${consumerOrgDomain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: consumerOrg.orgId,
			domain: consumerOrgDomain,
		});
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, consumerOrgDomain);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(capId).catch(() => {});
		await deleteTestOrgUser(providerEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(noRoleEmail).catch(() => {});
	});

	// ===========================================================================
	// Capability Discovery
	// ===========================================================================

	test("lists active capabilities (200)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listMarketplaceCapabilities(consumerToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.capabilities)).toBe(true);
		const found = res.body!.capabilities.find((c) => c.capability_id === capId);
		expect(found).toBeDefined();
	});

	test("gets capability details (200)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getMarketplaceCapability(consumerToken, {
			capability_id: capId,
		});
		expect(res.status).toBe(200);
		expect(res.body!.capability_id).toBe(capId);
	});

	test("get capability returns 404 for unknown id", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.getMarketplaceCapability(consumerToken, {
			capability_id: generateCapabilityId("notfound"),
		});
		expect(res.status).toBe(404);
	});

	test("list capabilities returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/capabilities/list", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	test("get capability returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/capabilities/get", {
			data: { capability_id: capId },
		});
		expect(res.status()).toBe(401);
	});

	// ===========================================================================
	// Listing Management (Provider)
	// ===========================================================================

	test.describe("Listing CRUD", () => {
		test.describe.configure({ mode: "serial" });

		let listingId: string;

		test("provider can create a draft listing (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);

			const createReq: CreateListingRequest = {
				capability_id: capId,
				headline: "Test Service Headline",
				description: "Full service description",
			};
			const createRes = await api.createListing(providerToken, createReq);
			expect(createRes.status).toBe(201);
			listingId = createRes.body!.listing_id;
			expect(createRes.body!.status).toBe("draft");
			expect(createRes.body!.headline).toBe("Test Service Headline");
			expect(createRes.body!.capability_id).toBe(capId);

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(providerAuditToken, {
				event_types: ["org.marketplace_listing_created"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
			expect(found!.event_type).toBe("org.marketplace_listing_created");
		});

		test("provider can get their listing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: GetMyListingRequest = { listing_id: listingId };
			const res = await api.getMyListing(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.listing_id).toBe(listingId);
			expect(res.body!.status).toBe("draft");
		});

		test("provider can list their listings (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listMyListings(providerToken, { limit: 20 });
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.listings)).toBe(true);
			const found = res.body!.listings.find((l) => l.listing_id === listingId);
			expect(found).toBeDefined();
		});

		test("provider can update their listing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: UpdateListingRequest = {
				listing_id: listingId,
				headline: "Updated Headline",
				description: "Updated full description",
			};
			const res = await api.updateListing(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.headline).toBe("Updated Headline");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(providerAuditToken, {
				event_types: ["org.marketplace_listing_updated"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
		});

		test("provider can publish their listing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: PublishListingRequest = { listing_id: listingId };
			const res = await api.publishListing(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("active");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(providerAuditToken, {
				event_types: ["org.marketplace_listing_published"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
		});

		test("published listing is discoverable by consumer (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const discoverRes = await api.discoverListings(consumerToken, {
				capability_id: capId,
			});
			expect(discoverRes.status).toBe(200);
			const found = discoverRes.body!.listings.find(
				(l) => l.listing_id === listingId
			);
			expect(found).toBeDefined();
			expect(found!.headline).toBe("Updated Headline");
		});

		test("consumer can get published listing details (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: GetListingRequest = { listing_id: listingId };
			const res = await api.getListing(consumerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.listing_id).toBe(listingId);
		});

		test("provider can archive their active listing (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: ArchiveListingRequest = { listing_id: listingId };
			const res = await api.archiveListing(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("archived");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(providerAuditToken, {
				event_types: ["org.marketplace_listing_archived"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
		});

		test("provider can reopen an archived listing (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: ReopenListingRequest = { listing_id: listingId };
			const res = await api.reopenListing(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("draft");
			expect(typeof res.body!.active_subscriber_count).toBe("number");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(providerAuditToken, {
				event_types: ["org.marketplace_listing_reopened"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
		});

		test("listing response includes active_subscriber_count", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			// get listing
			const getRes = await api.getMyListing(providerToken, {
				listing_id: listingId,
			});
			expect(getRes.status).toBe(200);
			expect(typeof getRes.body!.active_subscriber_count).toBe("number");

			// list listings
			const listRes = await api.listMyListings(providerToken, { limit: 20 });
			expect(listRes.status).toBe(200);
			const found = listRes.body!.listings.find(
				(l) => l.listing_id === listingId
			);
			expect(found).toBeDefined();
			expect(typeof found!.active_subscriber_count).toBe("number");
		});
	});

	// ===========================================================================
	// Subscription Flow (Consumer)
	// ===========================================================================

	test.describe("Subscription Flow", () => {
		test.describe.configure({ mode: "serial" });

		let subListingId: string;
		let subscriptionId: string;

		test.beforeAll(async ({ request }) => {
			// Provider creates and publishes a listing for subscription tests
			const api = new OrgAPIClient(request);
			const createRes = await api.createListing(providerToken, {
				capability_id: capId,
				headline: "Subscribable Service",
				description: "desc",
			});
			expect(createRes.status).toBe(201);
			subListingId = createRes.body!.listing_id;
			await api.publishListing(providerToken, { listing_id: subListingId });
		});

		test("consumer can subscribe to a listing (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const subReq: RequestSubscriptionRequest = {
				listing_id: subListingId,
				request_note: "I want to subscribe",
			};
			const subRes = await api.requestSubscription(consumerToken, subReq);
			expect(subRes.status).toBe(201);
			expect(subRes.body!.status).toBe("active");
			subscriptionId = subRes.body!.subscription_id;

			// Audit log for subscription on consumer side - consumer doesn't have view_audit_logs
			// so just check the subscription was created
			expect(subscriptionId).toBeDefined();
		});

		test("consumer can list their subscriptions (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const listRes = await api.listSubscriptions(consumerToken, {});
			expect(listRes.status).toBe(200);
			const found = listRes.body!.subscriptions.find(
				(s) => s.subscription_id === subscriptionId
			);
			expect(found).toBeDefined();
			expect(found!.status).toBe("active");
		});

		test("consumer can get a specific subscription (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: GetSubscriptionRequest = {
				subscription_id: subscriptionId,
			};
			const res = await api.getSubscription(consumerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.subscription_id).toBe(subscriptionId);
			expect(res.body!.listing_id).toBe(subListingId);
		});

		test("provider can list their clients (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const listRes = await api.listClients(providerToken, {});
			expect(listRes.status).toBe(200);
			const found = listRes.body!.clients.find(
				(c) => c.subscription_id === subscriptionId
			);
			expect(found).toBeDefined();
		});

		test("provider can get a specific client (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: GetClientRequest = { subscription_id: subscriptionId };
			const res = await api.getClient(providerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.subscription_id).toBe(subscriptionId);
		});

		test("consumer can list active-only subscriptions (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: ListSubscriptionsRequest = {
				include_historical: false,
			};
			const listRes = await api.listSubscriptions(consumerToken, req);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.subscriptions.find(
				(s) => s.subscription_id === subscriptionId
			);
			expect(found).toBeDefined();
			// all returned subscriptions should be active
			for (const s of listRes.body!.subscriptions) {
				expect(s.status).toBe("active");
			}
		});

		test("consumer can cancel their subscription (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: CancelSubscriptionRequest = {
				subscription_id: subscriptionId,
			};
			const res = await api.cancelSubscription(consumerToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("cancelled");
		});

		test("consumer can list historical subscriptions after cancel (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const req: ListSubscriptionsRequest = {
				include_historical: true,
			};
			const listRes = await api.listSubscriptions(consumerToken, req);
			expect(listRes.status).toBe(200);
			const found = listRes.body!.subscriptions.find(
				(s) => s.subscription_id === subscriptionId
			);
			expect(found).toBeDefined();
			expect(found!.status).toBe("cancelled");
		});
	});

	// ===========================================================================
	// Validation Tests
	// ===========================================================================

	test("create listing returns 400 for missing headline", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.createListing(providerToken, {
			capability_id: capId,
			headline: "",
			description: "desc",
		});
		expect(res.status).toBe(400);
	});

	test("create listing returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/listings/create", {
			data: {
				capability_id: capId,
				headline: "Test",
				description: "x",
			},
		});
		expect(res.status()).toBe(401);
	});

	test("list my listings returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/listings/list", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	test("get my listing returns 404 for unknown listing", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// Use a valid UUID that doesn't exist
		const res = await api.getMyListing(providerToken, {
			listing_id: "00000000-0000-0000-0000-000000000000",
		});
		expect(res.status).toBe(404);
	});

	test("discover listings returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/discover/list", {
			data: { capability_id: capId },
		});
		expect(res.status()).toBe(401);
	});

	test("list subscriptions returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/subscriptions/list", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	test("list clients returns 401 without auth", async ({ request }) => {
		const res = await request.post("/org/marketplace/clients/list", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});

	// ===========================================================================
	// RBAC Tests
	// ===========================================================================

	test("user without manage_listings cannot create listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.createListing(noRoleToken, {
			capability_id: capId,
			headline: "Unauthorized",
			description: "x",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_subscriptions cannot subscribe (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// noRoleToken doesn't have manage_subscriptions role
		const res = await api.requestSubscription(noRoleToken, {
			listing_id: "some-uuid",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_listings cannot update listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.updateListing(noRoleToken, {
			listing_id: "some-uuid",
			headline: "Updated",
			description: "x",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_listings cannot publish listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.publishListing(noRoleToken, {
			listing_id: "some-uuid",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_listings cannot archive listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.archiveListing(noRoleToken, {
			listing_id: "some-uuid",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_listings cannot reopen listing (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.reopenListing(noRoleToken, {
			listing_id: "some-uuid",
		});
		expect(res.status).toBe(403);
	});

	test("user without manage_subscriptions cannot cancel subscription (403)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.cancelSubscription(noRoleToken, {
			subscription_id: "some-uuid",
		});
		expect(res.status).toBe(403);
	});
});
