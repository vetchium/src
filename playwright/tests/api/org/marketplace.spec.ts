import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
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
	ApplyProviderEnrollmentRequest,
	CreateProviderOfferRequest,
	ListMarketplaceCapabilitiesRequest,
	GetMarketplaceCapabilityRequest,
} from "vetchium-specs/org/marketplace";

function generateCapabilitySlug(prefix: string = "cap"): string {
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
	// Admin tokens for setup
	let adminToken: string;
	let adminEmail: string;
	let adminUserId: string;

	// Org user with manage_marketplace role
	let manageEmail: string;
	let manageToken: string;
	let manageOrgId: string;
	let manageOrgDomain: string;
	let manageOrgUserId: string;

	// Org user with view_marketplace role
	let viewEmail: string;
	let viewToken: string;
	let viewOrgId: string;
	let viewOrgDomain: string;
	let viewOrgUserId: string;

	// Org user with no roles (for 403 tests)
	let noRoleEmail: string;
	let noRoleToken: string;
	let noRoleOrgId: string;
	let noRoleOrgDomain: string;

	// Capability created for tests
	let capSlug: string;

	test.beforeAll(async ({ request }) => {
		const adminApi = new AdminAPIClient(request);
		const orgApi = new OrgAPIClient(request);

		// Create admin user with marketplace manage role
		adminEmail = generateTestEmail("mkt-admin");
		adminUserId = await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await assignRoleToAdminUser(adminUserId, "admin:manage_marketplace");
		await assignRoleToAdminUser(adminUserId, "admin:view_audit_logs");

		const alr = await adminApi.login({
			email: adminEmail,
			password: TEST_PASSWORD,
		});
		expect(alr.status).toBe(200);
		const atfa = await getTfaCodeFromEmail(adminEmail);
		const atr = await adminApi.verifyTFA({
			tfa_token: alr.body!.tfa_token,
			tfa_code: atfa,
		});
		expect(atr.status).toBe(200);
		adminToken = atr.body!.session_token;

		// Create a marketplace capability for tests
		capSlug = generateCapabilitySlug("org-test");
		await createTestMarketplaceCapability(capSlug, "active");

		// Create org user with manage_marketplace
		const manageOrgInfo = generateTestOrgEmail("mkt-manage-org");
		manageEmail = manageOrgInfo.email;
		const manageOrg = await createTestOrgAdminDirect(
			manageEmail,
			TEST_PASSWORD,
			"ind1",
			{ domain: manageOrgInfo.domain }
		);
		manageOrgId = manageOrg.orgId;
		manageOrgDomain = manageOrg.domain;
		manageOrgUserId = manageOrg.orgUserId;
		await assignRoleToOrgUser(manageOrgUserId, "org:manage_marketplace");
		await assignRoleToOrgUser(manageOrgUserId, "org:view_marketplace");
		manageToken = await loginOrgUser(orgApi, manageEmail, manageOrgDomain);

		// Create org user with view_marketplace only (use createTestOrgUserDirect to avoid superadmin bypass)
		const viewOrgInfo = generateTestOrgEmail("mkt-view-org");
		viewEmail = viewOrgInfo.email;
		const viewOrg = await createTestOrgUserDirect(
			viewEmail,
			TEST_PASSWORD,
			"ind1",
			{ domain: viewOrgInfo.domain }
		);
		viewOrgId = viewOrg.orgId;
		viewOrgDomain = viewOrg.domain;
		viewOrgUserId = viewOrg.orgUserId;
		await assignRoleToOrgUser(viewOrgUserId, "org:view_marketplace");
		viewToken = await loginOrgUser(orgApi, viewEmail, viewOrgDomain);

		// Create org user with no roles (use createTestOrgUserDirect to avoid superadmin bypass)
		const noRoleOrgInfo = generateTestOrgEmail("mkt-norole-org");
		noRoleEmail = noRoleOrgInfo.email;
		const noRoleOrg = await createTestOrgUserDirect(
			noRoleEmail,
			TEST_PASSWORD,
			"ind1",
			{ domain: noRoleOrgInfo.domain }
		);
		noRoleOrgId = noRoleOrg.orgId;
		noRoleOrgDomain = noRoleOrg.domain;
		noRoleToken = await loginOrgUser(orgApi, noRoleEmail, noRoleOrgDomain);
	});

	test.afterAll(async () => {
		await deleteTestMarketplaceCapability(capSlug).catch(() => {});
		await deleteTestOrgUser(manageEmail).catch(() => {});
		await deleteTestOrgUser(viewEmail).catch(() => {});
		await deleteTestOrgUser(noRoleEmail).catch(() => {});
		await deleteTestAdminUser(adminEmail).catch(() => {});
	});

	// ===========================================================================
	// POST /org/marketplace/capabilities/list
	// ===========================================================================

	test.describe("POST /org/marketplace/capabilities/list", () => {
		test("lists active consumer capabilities (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: ListMarketplaceCapabilitiesRequest = {};
			const res = await api.listMarketplaceCapabilities(manageToken, req);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.capabilities)).toBe(true);
		});

		test("returns 401 without auth", async ({ request }) => {
			const response = await request.post(
				"/org/marketplace/capabilities/list",
				{ data: {} }
			);
			expect(response.status()).toBe(401);
		});

		test("returns 403 without marketplace role", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listMarketplaceCapabilities(noRoleToken, {});
			expect(res.status).toBe(403);
		});

		test("view role can list capabilities (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listMarketplaceCapabilities(viewToken, {});
			expect(res.status).toBe(200);
		});
	});

	// ===========================================================================
	// POST /org/marketplace/capabilities/get
	// ===========================================================================

	test.describe("POST /org/marketplace/capabilities/get", () => {
		test("gets capability by slug (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: GetMarketplaceCapabilityRequest = { capability_slug: capSlug };
			const res = await api.getMarketplaceCapability(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.capability_slug).toBe(capSlug);
		});

		test("returns 404 for unknown slug", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getMarketplaceCapability(manageToken, {
				capability_slug: generateCapabilitySlug("notfound"),
			});
			expect(res.status).toBe(404);
		});

		test("returns 400 for invalid slug", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getMarketplaceCapability(manageToken, {
				capability_slug: "ab",
			});
			expect(res.status).toBe(400);
		});

		test("returns 401 without auth", async ({ request }) => {
			const response = await request.post("/org/marketplace/capabilities/get", {
				data: { capability_slug: capSlug },
			});
			expect(response.status()).toBe(401);
		});

		test("returns 403 without marketplace role", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getMarketplaceCapability(noRoleToken, {
				capability_slug: capSlug,
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /org/marketplace/provider-enrollments/apply
	// ===========================================================================

	test.describe("POST /org/marketplace/provider-enrollments/apply", () => {
		test.describe.configure({ mode: "serial" });

		let enrollCapSlug: string;

		test.beforeAll(async () => {
			enrollCapSlug = generateCapabilitySlug("enroll");
			await createTestMarketplaceCapability(enrollCapSlug, "active");
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(enrollCapSlug).catch(() => {});
		});

		test("applies for provider enrollment (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: ApplyProviderEnrollmentRequest = {
				capability_slug: enrollCapSlug,
				application_note: "We are experts in this area",
			};
			const res = await api.applyProviderEnrollment(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.capability_slug).toBe(enrollCapSlug);
			expect(res.body!.status).toBe("pending_review");
		});

		test("returns 400 for already enrolled (duplicate)", async ({
			request,
		}) => {
			// Second apply should fail (already enrolled)
			const api = new OrgAPIClient(request);
			const req: ApplyProviderEnrollmentRequest = {
				capability_slug: enrollCapSlug,
			};
			const res = await api.applyProviderEnrollment(manageToken, req);
			// Already enrolled → bad request or conflict
			expect([400, 409, 422]).toContain(res.status);
		});

		test("returns 401 without auth", async ({ request }) => {
			const response = await request.post(
				"/org/marketplace/provider-enrollments/apply",
				{ data: { capability_slug: enrollCapSlug } }
			);
			expect(response.status()).toBe(401);
		});

		test("returns 403 without manage role", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.applyProviderEnrollment(viewToken, {
				capability_slug: enrollCapSlug,
			});
			expect(res.status).toBe(403);
		});

		test("returns 403 without marketplace role", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.applyProviderEnrollment(noRoleToken, {
				capability_slug: enrollCapSlug,
			});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /org/marketplace/provider-enrollments/list and get
	// ===========================================================================

	test.describe("POST /org/marketplace/provider-enrollments/list", () => {
		test("lists enrollments (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listProviderEnrollments(manageToken, {});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.enrollments)).toBe(true);
		});

		test("returns 401 without auth", async ({ request }) => {
			const response = await request.post(
				"/org/marketplace/provider-enrollments/list",
				{ data: {} }
			);
			expect(response.status()).toBe(401);
		});

		test("returns 403 without marketplace role", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listProviderEnrollments(noRoleToken, {});
			expect(res.status).toBe(403);
		});
	});

	// ===========================================================================
	// Full provider flow: apply → admin approve → create offer → submit offer
	// ===========================================================================

	test.describe("Provider offer flow", () => {
		test.describe.configure({ mode: "serial" });

		let flowCapSlug: string;
		let adminManageEmail: string;
		let adminManageToken: string;
		let adminManageUserId: string;

		test.beforeAll(async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			flowCapSlug = generateCapabilitySlug("flow");
			await createTestMarketplaceCapability(flowCapSlug, "active");

			// Admin user for enrollment approval
			adminManageEmail = generateTestEmail("flow-admin");
			adminManageUserId = await createTestAdminUser(
				adminManageEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(
				adminManageUserId,
				"admin:manage_marketplace"
			);

			const alr = await adminApi.login({
				email: adminManageEmail,
				password: TEST_PASSWORD,
			});
			expect(alr.status).toBe(200);
			const atfa = await getTfaCodeFromEmail(adminManageEmail);
			const atr = await adminApi.verifyTFA({
				tfa_token: alr.body!.tfa_token,
				tfa_code: atfa,
			});
			expect(atr.status).toBe(200);
			adminManageToken = atr.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(flowCapSlug).catch(() => {});
			await deleteTestAdminUser(adminManageEmail).catch(() => {});
		});

		test("1. org applies for enrollment (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.applyProviderEnrollment(manageToken, {
				capability_slug: flowCapSlug,
				application_note: "Flow test application",
			});
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("pending_review");
		});

		test("2. admin approves enrollment (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminApproveEnrollment(adminManageToken, {
				org_domain: manageOrgDomain,
				capability_slug: flowCapSlug,
			});
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("approved");
		});

		test("3. org creates offer (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: CreateProviderOfferRequest = {
				capability_slug: flowCapSlug,
				headline: "Expert Talent Sourcing",
				summary: "We source top talent globally",
				description: "Full description of our talent sourcing service",
				regions_served: ["ind1", "usa1"],
				contact_mode: "external_url",
				contact_value: "https://example.com/contact",
			};
			const res = await api.createProviderOffer(manageToken, req);
			expect(res.status).toBe(201);
			expect(res.body!.capability_slug).toBe(flowCapSlug);
			expect(res.body!.status).toBe("draft");
		});

		test("4. org submits offer for review (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.submitProviderOffer(manageToken, {
				capability_slug: flowCapSlug,
			});
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("pending_review");
		});

		test("5. admin approves offer (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const res = await api.adminApproveOffer(adminManageToken, {
				org_domain: manageOrgDomain,
				capability_slug: flowCapSlug,
			});
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("active");
		});

		test("6. buyer org can list providers for capability (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const res = await api.listMarketplaceProviders(viewToken, {
				capability_slug: flowCapSlug,
			});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.providers)).toBe(true);
			// Provider's offer is now active — should appear in list
			const found = res.body!.providers.find(
				(p: any) => p.provider_org_domain === manageOrgDomain
			);
			expect(found).toBeDefined();
		});
	});

	// ===========================================================================
	// Consumer subscription flow
	// ===========================================================================

	test.describe("Consumer subscription flow", () => {
		test.describe.configure({ mode: "serial" });

		let subCapSlug: string;
		let subAdminEmail: string;
		let subAdminToken: string;
		let subAdminUserId: string;
		let providerEmail: string;
		let providerToken: string;
		let providerOrgId: string;
		let providerOrgDomain: string;
		let providerOrgUserId: string;

		test.beforeAll(async ({ request }) => {
			const adminApi = new AdminAPIClient(request);
			const orgApi = new OrgAPIClient(request);

			subCapSlug = generateCapabilitySlug("sub");
			await createTestMarketplaceCapability(subCapSlug, "active");

			// Admin user for approvals
			subAdminEmail = generateTestEmail("sub-admin");
			subAdminUserId = await createTestAdminUser(subAdminEmail, TEST_PASSWORD);
			await assignRoleToAdminUser(subAdminUserId, "admin:manage_marketplace");

			const alr = await adminApi.login({
				email: subAdminEmail,
				password: TEST_PASSWORD,
			});
			expect(alr.status).toBe(200);
			const atfa = await getTfaCodeFromEmail(subAdminEmail);
			const atr = await adminApi.verifyTFA({
				tfa_token: alr.body!.tfa_token,
				tfa_code: atfa,
			});
			expect(atr.status).toBe(200);
			subAdminToken = atr.body!.session_token;

			// Provider org
			const providerOrgInfo = generateTestOrgEmail("sub-provider");
			providerEmail = providerOrgInfo.email;
			const providerOrg = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD,
				"ind1",
				{ domain: providerOrgInfo.domain }
			);
			providerOrgId = providerOrg.orgId;
			providerOrgDomain = providerOrg.domain;
			providerOrgUserId = providerOrg.orgUserId;
			await assignRoleToOrgUser(providerOrgUserId, "org:manage_marketplace");
			await assignRoleToOrgUser(providerOrgUserId, "org:view_marketplace");
			providerToken = await loginOrgUser(
				orgApi,
				providerEmail,
				providerOrgDomain
			);

			// Provider: apply → admin approve → create offer → submit → admin approve
			const enrRes = await orgApi.applyProviderEnrollment(providerToken, {
				capability_slug: subCapSlug,
			});
			expect(enrRes.status).toBe(200);

			const apEnrRes = await adminApi.adminApproveEnrollment(subAdminToken, {
				org_domain: providerOrgDomain,
				capability_slug: subCapSlug,
			});
			expect(apEnrRes.status).toBe(200);

			const offerRes = await orgApi.createProviderOffer(providerToken, {
				capability_slug: subCapSlug,
				headline: "Sub Flow Provider",
				summary: "Summary",
				description: "Description",
				regions_served: ["ind1"],
				contact_mode: "external_url",
				contact_value: "https://provider.example.com",
			});
			expect(offerRes.status).toBe(201);

			const submitRes = await orgApi.submitProviderOffer(providerToken, {
				capability_slug: subCapSlug,
			});
			expect(submitRes.status).toBe(200);

			const apOfferRes = await adminApi.adminApproveOffer(subAdminToken, {
				org_domain: providerOrgDomain,
				capability_slug: subCapSlug,
			});
			expect(apOfferRes.status).toBe(200);
		});

		test.afterAll(async () => {
			await deleteTestMarketplaceCapability(subCapSlug).catch(() => {});
			await deleteTestAdminUser(subAdminEmail).catch(() => {});
			await deleteTestOrgUser(providerEmail).catch(() => {});
		});

		test("1. consumer org requests subscription (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.requestConsumerSubscription(manageToken, {
				provider_org_domain: providerOrgDomain,
				capability_slug: subCapSlug,
				request_note: "We'd like to subscribe",
			});
			expect(res.status).toBe(200);
			// Direct approval mode: goes straight to active
			expect(["requested", "active"]).toContain(res.body!.status);
		});

		test("2. consumer can list their subscriptions (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const res = await api.listConsumerSubscriptions(manageToken, {});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body!.subscriptions)).toBe(true);
		});

		test("3. consumer can get specific subscription (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const res = await api.getConsumerSubscription(manageToken, {
				provider_org_domain: providerOrgDomain,
				capability_slug: subCapSlug,
			});
			expect(res.status).toBe(200);
			expect(res.body!.provider_org_domain).toBe(providerOrgDomain);
		});

		test("4. consumer can cancel subscription (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.cancelConsumerSubscription(manageToken, {
				provider_org_domain: providerOrgDomain,
				capability_slug: subCapSlug,
			});
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("cancelled");
		});
	});

	// ===========================================================================
	// RBAC: view_marketplace cannot write
	// ===========================================================================

	test.describe("RBAC: view_marketplace cannot call write endpoints", () => {
		test("view role cannot apply for enrollment (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.applyProviderEnrollment(viewToken, {
				capability_slug: capSlug,
			});
			expect(res.status).toBe(403);
		});

		test("view role cannot request subscription (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.requestConsumerSubscription(viewToken, {
				provider_org_domain: "some.domain.com",
				capability_slug: capSlug,
			});
			expect(res.status).toBe(403);
		});
	});
});
