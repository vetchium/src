import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	deleteTestMarketplaceCapability,
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	createTestMarketplaceCapability,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminCreateCapabilityRequest,
	AdminUpdateCapabilityRequest,
	AdminEnableCapabilityRequest,
	AdminDisableCapabilityRequest,
	AdminGetCapabilityRequest,
	AdminListCapabilitiesRequest,
	AdminSuspendListingRequest,
	AdminReinstateListingRequest,
	AdminCancelSubscriptionRequest,
} from "vetchium-specs/admin/marketplace";
import { OrgAPIClient } from "../../../lib/org-api-client";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateListingRequest,
	PublishListingRequest,
	RequestSubscriptionRequest,
} from "vetchium-specs/org/marketplace";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
	const lr = await api.login(loginReq);
	const tfa = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: lr.body!.tfa_token,
		tfa_code: tfa,
		remember_me: false,
	};
	const tr = await api.verifyTFA(tfaReq);
	return tr.body!.session_token;
}

function generateCapabilityId(prefix: string = "cap"): string {
	const hex = Math.random().toString(16).substring(2, 10);
	return `${prefix}-${hex}`;
}

test.describe("Admin Marketplace API", () => {
	let manageEmail: string;
	let manageToken: string;
	let manageUserId: string;

	let viewEmail: string;
	let viewToken: string;

	let noRoleEmail: string;
	let noRoleToken: string;

	test.beforeAll(async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Admin user with manage_marketplace + view_audit_logs
		manageEmail = generateTestEmail("mkt-manage");
		manageUserId = await createTestAdminUser(manageEmail, TEST_PASSWORD);
		await assignRoleToAdminUser(manageUserId, "admin:manage_marketplace");
		await assignRoleToAdminUser(manageUserId, "admin:view_audit_logs");

		const lr1 = await api.login({
			email: manageEmail,
			password: TEST_PASSWORD,
		});
		expect(lr1.status).toBe(200);
		const tfa1 = await getTfaCodeFromEmail(manageEmail);
		const tr1 = await api.verifyTFA({
			tfa_token: lr1.body!.tfa_token,
			tfa_code: tfa1,
		});
		expect(tr1.status).toBe(200);
		manageToken = tr1.body!.session_token;

		// Admin user with view_marketplace only
		viewEmail = generateTestEmail("mkt-view");
		const viewUserId = await createTestAdminUser(viewEmail, TEST_PASSWORD);
		await assignRoleToAdminUser(viewUserId, "admin:view_marketplace");

		const lr2 = await api.login({ email: viewEmail, password: TEST_PASSWORD });
		expect(lr2.status).toBe(200);
		const tfa2 = await getTfaCodeFromEmail(viewEmail);
		const tr2 = await api.verifyTFA({
			tfa_token: lr2.body!.tfa_token,
			tfa_code: tfa2,
		});
		expect(tr2.status).toBe(200);
		viewToken = tr2.body!.session_token;

		// Admin user with no roles (for 403 tests)
		noRoleEmail = generateTestEmail("mkt-norole");
		await createTestAdminUser(noRoleEmail, TEST_PASSWORD);
		const lr3 = await api.login({
			email: noRoleEmail,
			password: TEST_PASSWORD,
		});
		expect(lr3.status).toBe(200);
		const tfa3 = await getTfaCodeFromEmail(noRoleEmail);
		const tr3 = await api.verifyTFA({
			tfa_token: lr3.body!.tfa_token,
			tfa_code: tfa3,
		});
		expect(tr3.status).toBe(200);
		noRoleToken = tr3.body!.session_token;
	});

	test.afterAll(async () => {
		await deleteTestAdminUser(manageEmail);
		await deleteTestAdminUser(viewEmail);
		await deleteTestAdminUser(noRoleEmail);
	});

	// ===========================================================================
	// POST /admin/marketplace/capabilities/create
	// ===========================================================================

	test.describe("POST /admin/marketplace/capabilities/create", () => {
		let capId: string;

		test.afterAll(async () => {
			if (capId) await deleteTestMarketplaceCapability(capId).catch(() => {});
		});

		test("creates capability successfully (201)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			capId = generateCapabilityId("create");
			const req: AdminCreateCapabilityRequest = {
				capability_id: capId,
				status: "draft",
				translations: [
					{
						locale: "en-US",
						display_name: "Test Capability",
						description: "A capability for testing",
					},
				],
			};
			const res = await api.adminCreateCapability(manageToken, req);
			expect(res.status).toBe(201);
			expect(res.body!.capability_id).toBe(capId);
			expect(res.body!.status).toBe("draft");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_capability_created"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const auditFound = auditRes.body!.audit_logs.find(
				(e) => e.event_data["capability_id"] === capId
			);
			expect(auditFound).toBeDefined();
			expect(auditFound!.event_type).toBe(
				"admin.marketplace_capability_created"
			);
		});

		test("returns 400 for invalid id (too short)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminCreateCapabilityRequest = {
				capability_id: "ab",
				status: "draft",
				translations: [{ locale: "en-US", display_name: "x", description: "" }],
			};
			const res = await api.adminCreateCapability(manageToken, req);
			expect(res.status).toBe(400);
		});

		test("returns 401 without auth", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminCreateCapabilityRequest = {
				capability_id: generateCapabilityId("noauth"),
				status: "draft",
				translations: [{ locale: "en-US", display_name: "x", description: "" }],
			};
			const response = await request.post(
				"/admin/marketplace/capabilities/create",
				{ data: req }
			);
			expect(response.status()).toBe(401);
		});

		test("returns 403 for user without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const req: AdminCreateCapabilityRequest = {
				capability_id: generateCapabilityId("norole"),
				status: "draft",
				translations: [{ locale: "en-US", display_name: "x", description: "" }],
			};
			const res = await api.adminCreateCapability(noRoleToken, req);
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/marketplace/capabilities/list
	// ===========================================================================

	test.describe("POST /admin/marketplace/capabilities/list", () => {
		test("lists capabilities (200) with view role", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminListCapabilitiesRequest = {};
			const res = await api.adminListCapabilities(viewToken, req);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.capabilities)).toBe(true);
		});

		test("returns 401 without auth", async ({ request }) => {
			const response = await request.post(
				"/admin/marketplace/capabilities/list",
				{ data: {} }
			);
			expect(response.status()).toBe(401);
		});

		test("returns 403 for user without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListCapabilities(noRoleToken, {});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/marketplace/capabilities/get
	// ===========================================================================

	test.describe("POST /admin/marketplace/capabilities/get", () => {
		let capId: string;

		test.beforeAll(async ({ request }) => {
			const api = new AdminAPIClient(request);
			capId = generateCapabilityId("get");
			const res = await api.adminCreateCapability(manageToken, {
				capability_id: capId,
				status: "active",
				translations: [
					{ locale: "en-US", display_name: "Get Test", description: "" },
				],
			});
			expect(res.status).toBe(201);
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(capId).catch(() => {});
		});

		test("gets capability by id (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminGetCapabilityRequest = { capability_id: capId };
			const res = await api.adminGetCapability(viewToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.capability_id).toBe(capId);
		});

		test("returns 404 for unknown id", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminGetCapability(viewToken, {
				capability_id: generateCapabilityId("notfound"),
			});
			expect(res.status).toBe(404);
		});

		test("returns 403 for user without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminGetCapability(noRoleToken, {
				capability_id: capId,
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/marketplace/capabilities/enable + /disable
	// ===========================================================================

	test.describe("POST /admin/marketplace/capabilities/enable and /disable", () => {
		test.describe.configure({ mode: "serial" });

		let capId: string;

		test.beforeAll(async ({ request }) => {
			const api = new AdminAPIClient(request);
			capId = generateCapabilityId("endis");
			const res = await api.adminCreateCapability(manageToken, {
				capability_id: capId,
				status: "draft",
				translations: [
					{
						locale: "en-US",
						display_name: "Enable/Disable Test",
						description: "",
					},
				],
			});
			expect(res.status).toBe(201);
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(capId).catch(() => {});
		});

		test("enables a draft capability (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminEnableCapabilityRequest = { capability_id: capId };
			const res = await api.adminEnableCapability(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("active");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_capability_enabled"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["capability_id"] === capId
			);
			expect(found).toBeDefined();
		});

		test("disables an active capability (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminDisableCapabilityRequest = { capability_id: capId };
			const res = await api.adminDisableCapability(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("disabled");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_capability_disabled"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["capability_id"] === capId
			);
			expect(found).toBeDefined();
		});

		test("returns 403 on enable for user without manage role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminEnableCapability(noRoleToken, {
				capability_id: capId,
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/marketplace/capabilities/update
	// ===========================================================================

	test.describe("POST /admin/marketplace/capabilities/update", () => {
		let capId: string;

		test.beforeAll(async ({ request }) => {
			const api = new AdminAPIClient(request);
			capId = generateCapabilityId("upd");
			await api.adminCreateCapability(manageToken, {
				capability_id: capId,
				status: "draft",
				translations: [
					{
						locale: "en-US",
						display_name: "Original Name",
						description: "original",
					},
				],
			});
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(capId).catch(() => {});
		});

		test("updates capability (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminUpdateCapabilityRequest = {
				capability_id: capId,
				translations: [
					{
						locale: "en-US",
						display_name: "Updated Name",
						description: "updated description",
					},
				],
			};
			const res = await api.adminUpdateCapability(manageToken, req);
			expect(res.status).toBe(200);
			const enUs = res.body!.translations.find((t) => t.locale === "en-US");
			expect(enUs!.display_name).toBe("Updated Name");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_capability_updated"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["capability_id"] === capId
			);
			expect(found).toBeDefined();
		});

		test("returns 403 for user without manage role", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminUpdateCapability(noRoleToken, {
				capability_id: capId,
				translations: [{ locale: "en-US", display_name: "x", description: "" }],
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// RBAC: view_marketplace can list/get but not create/update/enable/disable
	// ===========================================================================

	test.describe("RBAC: view_marketplace role", () => {
		test("view role can list capabilities (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListCapabilities(viewToken, {});
			expect(res.status).toBe(200);
		});

		test("view role cannot create capability (403)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminCreateCapability(viewToken, {
				capability_id: generateCapabilityId("viewblock"),
				status: "draft",
				translations: [{ locale: "en-US", display_name: "x", description: "" }],
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// Admin Listing Oversight: suspend and reinstate
	// ===========================================================================

	test.describe("Admin Listing Oversight", () => {
		test.describe.configure({ mode: "serial" });

		let oversightCapId: string;
		let providerEmail: string;
		let providerDomain: string;
		let listingId: string;

		test.beforeAll(async ({ request }) => {
			const orgApi = new OrgAPIClient(request);

			oversightCapId = generateCapabilityId("oversight");
			await createTestMarketplaceCapability(oversightCapId, "active");

			const orgInfo = generateTestOrgEmail("adm-listing-oversight");
			providerEmail = orgInfo.email;
			const providerOrg = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD,
				"ind1",
				{ domain: orgInfo.domain }
			);
			providerDomain = providerOrg.domain;

			const providerToken = await loginOrgUser(
				orgApi,
				providerEmail,
				providerDomain
			);

			const createRes = await orgApi.createListing(providerToken, {
				capability_id: oversightCapId,
				headline: "Oversight Test Service",
				description: "A listing for admin oversight tests",
			} satisfies CreateListingRequest);
			expect(createRes.status).toBe(201);
			listingId = createRes.body!.listing_id;

			const publishRes = await orgApi.publishListing(providerToken, {
				listing_id: listingId,
			} satisfies PublishListingRequest);
			expect(publishRes.status).toBe(200);
			expect(publishRes.body!.status).toBe("active");
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(oversightCapId).catch(() => {});
			await deleteTestOrgUser(providerEmail).catch(() => {});
		});

		test("admin can list active listings (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListListings(manageToken, {});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.listings)).toBe(true);
			const found = res.body!.listings.find((l) => l.listing_id === listingId);
			expect(found).toBeDefined();
		});

		test("admin can get listing details (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminGetListing(manageToken, {
				listing_id: listingId,
			});
			expect(res.status).toBe(200);
			expect(res.body!.listing_id).toBe(listingId);
			expect(res.body!.status).toBe("active");
		});

		test("admin can suspend an active listing (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminSuspendListingRequest = {
				listing_id: listingId,
				suspension_note: "Suspended for compliance review",
			};
			const res = await api.adminSuspendListing(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("suspended");
			expect(res.body!.suspension_note).toBe("Suspended for compliance review");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_listing_suspended"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
			expect(found!.event_type).toBe("admin.marketplace_listing_suspended");
		});

		test("suspended listing is not in discover results", async ({
			request,
		}) => {
			const orgApi = new OrgAPIClient(request);
			const orgInfo = generateTestOrgEmail("adm-oversight-check");
			const checkOrg = await createTestOrgAdminDirect(
				orgInfo.email,
				TEST_PASSWORD,
				"ind1",
				{ domain: orgInfo.domain }
			);
			const checkToken = await loginOrgUser(
				orgApi,
				orgInfo.email,
				orgInfo.domain
			);
			const discoverRes = await orgApi.discoverListings(checkToken, {
				capability_id: oversightCapId,
			});
			expect(discoverRes.status).toBe(200);
			const found = discoverRes.body!.listings.find(
				(l) => l.listing_id === listingId
			);
			expect(found).toBeUndefined();
			await deleteTestOrgUser(orgInfo.email).catch(() => {});
		});

		test("admin can reinstate a suspended listing (200)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const req: AdminReinstateListingRequest = { listing_id: listingId };
			const res = await api.adminReinstateListing(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("active");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_listing_reinstated"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["listing_id"] === listingId
			);
			expect(found).toBeDefined();
			expect(found!.event_type).toBe("admin.marketplace_listing_reinstated");
		});

		test("admin suspend returns 401 without auth", async ({ request }) => {
			const res = await request.post("/admin/marketplace/listings/suspend", {
				data: { listing_id: listingId, suspension_note: "x" },
			});
			expect(res.status()).toBe(401);
		});

		test("admin suspend returns 403 without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminSuspendListing(noRoleToken, {
				listing_id: listingId,
				suspension_note: "x",
			});
			expect(res.status).toBe(403);
		});

		test("admin reinstate returns 401 without auth", async ({ request }) => {
			const res = await request.post("/admin/marketplace/listings/reinstate", {
				data: { listing_id: listingId },
			});
			expect(res.status()).toBe(401);
		});

		test("admin reinstate returns 403 without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminReinstateListing(noRoleToken, {
				listing_id: listingId,
			});
			expect(res.status).toBe(403);
		});

		test("view role can list listings (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListListings(viewToken, {});
			expect(res.status).toBe(200);
		});

		test("view role cannot suspend listing (403)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminSuspendListing(viewToken, {
				listing_id: listingId,
				suspension_note: "x",
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// Admin Subscription Oversight: list, get, cancel
	// ===========================================================================

	test.describe("Admin Subscription Oversight", () => {
		test.describe.configure({ mode: "serial" });

		let subCapId: string;
		let subProviderEmail: string;
		let subProviderDomain: string;
		let subConsumerEmail: string;
		let subConsumerDomain: string;
		let subConsumerUserId: string;
		let subListingId: string;
		let subscriptionId: string;

		test.beforeAll(async ({ request }) => {
			const orgApi = new OrgAPIClient(request);

			subCapId = generateCapabilityId("sub-oversight");
			await createTestMarketplaceCapability(subCapId, "active");

			// Provider
			const providerInfo = generateTestOrgEmail("adm-sub-provider");
			subProviderEmail = providerInfo.email;
			const providerOrg = await createTestOrgAdminDirect(
				subProviderEmail,
				TEST_PASSWORD,
				"ind1",
				{ domain: providerInfo.domain }
			);
			subProviderDomain = providerOrg.domain;
			const providerToken = await loginOrgUser(
				orgApi,
				subProviderEmail,
				subProviderDomain
			);

			const createRes = await orgApi.createListing(providerToken, {
				capability_id: subCapId,
				headline: "Sub Oversight Service",
				description: "A listing for admin subscription oversight tests",
			} satisfies CreateListingRequest);
			expect(createRes.status).toBe(201);
			subListingId = createRes.body!.listing_id;
			await orgApi.publishListing(providerToken, {
				listing_id: subListingId,
			} satisfies PublishListingRequest);

			// Consumer
			const consumerInfo = generateTestOrgEmail("adm-sub-consumer");
			subConsumerEmail = consumerInfo.email;
			const consumerOrg = await createTestOrgAdminDirect(
				subConsumerEmail,
				TEST_PASSWORD,
				"ind1",
				{ domain: consumerInfo.domain }
			);
			subConsumerDomain = consumerOrg.domain;
			subConsumerUserId = consumerOrg.orgUserId;
			await assignRoleToOrgUser(subConsumerUserId, "org:manage_subscriptions");
			const consumerToken = await loginOrgUser(
				orgApi,
				subConsumerEmail,
				subConsumerDomain
			);

			const subRes = await orgApi.requestSubscription(consumerToken, {
				listing_id: subListingId,
				request_note: "Admin oversight test subscription",
			} satisfies RequestSubscriptionRequest);
			expect(subRes.status).toBe(201);
			subscriptionId = subRes.body!.subscription_id;
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(subCapId).catch(() => {});
			await deleteTestOrgUser(subProviderEmail).catch(() => {});
			await deleteTestOrgUser(subConsumerEmail).catch(() => {});
		});

		test("admin can list subscriptions (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListSubscriptions(manageToken, {});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.subscriptions)).toBe(true);
			const found = res.body!.subscriptions.find(
				(s) => s.subscription_id === subscriptionId
			);
			expect(found).toBeDefined();
		});

		test("admin can get subscription details (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminGetSubscription(manageToken, {
				subscription_id: subscriptionId,
			});
			expect(res.status).toBe(200);
			expect(res.body!.subscription_id).toBe(subscriptionId);
			expect(res.body!.status).toBe("active");
		});

		test("admin can cancel a subscription (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminCancelSubscriptionRequest = {
				subscription_id: subscriptionId,
			};
			const res = await api.adminCancelSubscription(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("cancelled");

			// Audit log assertion
			const auditRes = await api.filterAuditLogs(manageToken, {
				event_types: ["admin.marketplace_subscription_cancelled"],
				limit: 5,
			});
			expect(auditRes.status).toBe(200);
			const found = auditRes.body!.audit_logs.find(
				(e) => e.event_data["subscription_id"] === subscriptionId
			);
			expect(found).toBeDefined();
			expect(found!.event_type).toBe(
				"admin.marketplace_subscription_cancelled"
			);
		});

		test("admin subscriptions list returns 401 without auth", async ({
			request,
		}) => {
			const res = await request.post("/admin/marketplace/subscriptions/list", {
				data: {},
			});
			expect(res.status()).toBe(401);
		});

		test("admin subscriptions cancel returns 401 without auth", async ({
			request,
		}) => {
			const res = await request.post(
				"/admin/marketplace/subscriptions/cancel",
				{ data: { subscription_id: subscriptionId } }
			);
			expect(res.status()).toBe(401);
		});

		test("admin subscriptions cancel returns 403 without marketplace role", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminCancelSubscription(noRoleToken, {
				subscription_id: subscriptionId,
			});
			expect(res.status).toBe(403);
		});

		test("view role can list subscriptions (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminListSubscriptions(viewToken, {});
			expect(res.status).toBe(200);
		});

		test("view role cannot cancel subscription (403)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminCancelSubscription(viewToken, {
				subscription_id: subscriptionId,
			});
			expect(res.status).toBe(403);
		});
	});
});
