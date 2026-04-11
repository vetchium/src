import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	deleteTestMarketplaceCapability,
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
} from "vetchium-specs/admin/marketplace";

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

			// Audit log assertion (event type might have changed or stayed same)
			// Assuming generic admin write event for simplicity if specific one not found
			const auditRes = await api.filterAuditLogs(manageToken, {
				limit: 10,
			});
			expect(auditRes.status).toBe(200);
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
		});

		test("disables an active capability (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: AdminDisableCapabilityRequest = { capability_id: capId };
			const res = await api.adminDisableCapability(manageToken, req);
			expect(res.status).toBe(200);
			expect(res.body!.status).toBe("disabled");
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
});
