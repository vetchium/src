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
	RequestSubscriptionRequest,
	ListMarketplaceCapabilitiesRequest,
	GetMarketplaceCapabilityRequest,
} from "vetchium-specs/org/marketplace";

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
		providerToken = await loginOrgUser(
			orgApi,
			providerEmail,
			providerOrgDomain
		);

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

	// ===========================================================================
	// Listing Management (Provider)
	// ===========================================================================

	test("provider can create and publish a listing (201/200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		// 1. Create draft
		const createReq: CreateListingRequest = {
			capability_id: capId,
			headline: "Test Service Headline",
			summary: "Service summary",
			description: "Full service description",
			regions_served: ["ind1"],
			contact_mode: "email",
			contact_value: "contact@provider.com",
		};
		const createRes = await api.createListing(providerToken, createReq);
		expect(createRes.status).toBe(201);
		const listingId = createRes.body!.listing_id;
		expect(createRes.body!.status).toBe("draft");

		// 2. Publish
		const publishRes = await api.publishListing(providerToken, {
			listing_id: listingId,
		});
		expect(publishRes.status).toBe(200);
		expect(publishRes.body!.status).toBe("active");

		// 3. Buyer can discover it
		const discoverRes = await api.discoverListings(consumerToken, {
			capability_id: capId,
		});
		expect(discoverRes.status).toBe(200);
		const found = discoverRes.body!.listings.find(
			(l) => l.listing_id === listingId
		);
		expect(found).toBeDefined();
		expect(found!.headline).toBe("Test Service Headline");
	});

	// ===========================================================================
	// Subscription Flow (Consumer)
	// ===========================================================================

	test("consumer can subscribe to a listing (200)", async ({ request }) => {
		const api = new OrgAPIClient(request);

		// 1. Provider creates and publishes a listing
		const createRes = await api.createListing(providerToken, {
			capability_id: capId,
			headline: "Subscribable Service",
			summary: "summary",
			description: "desc",
			regions_served: ["all"],
			contact_mode: "external_url",
			contact_value: "https://example.com",
		});
		const listingId = createRes.body!.listing_id;
		await api.publishListing(providerToken, { listing_id: listingId });

		// 2. Consumer subscribes
		const subReq: RequestSubscriptionRequest = {
			listing_id: listingId,
			request_note: "I want to subscribe",
		};
		const subRes = await api.requestSubscription(consumerToken, subReq);
		expect(subRes.status).toBe(201);
		expect(subRes.body!.status).toBe("active"); // Direct to active in simplified model

		// 3. Verify in my subscriptions
		const listRes = await api.listSubscriptions(consumerToken, {});
		expect(listRes.status).toBe(200);
		const found = listRes.body!.subscriptions.find(
			(s) => s.listing_id === listingId
		);
		expect(found).toBeDefined();
		expect(found!.status).toBe("active");
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
			summary: "x",
			description: "x",
			regions_served: ["ind1"],
			contact_mode: "email",
			contact_value: "x@x.com",
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
});
