import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateAddressRequest,
	UpdateAddressRequest,
	DisableAddressRequest,
	EnableAddressRequest,
	GetAddressRequest,
	ListAddressesRequest,
	OrgAddress,
} from "vetchium-specs/org/company-addresses";

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

test.describe("Company Addresses API", () => {
	// ============================================================================
	// Create Address
	// ============================================================================
	test.describe("POST /org/create-address", () => {
		test("Success: create address with required fields only (201)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-create");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();
				const req: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const res = await api.createAddress(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.title).toBe("HQ");
				expect(res.body?.address_line1).toBe("123 Main St");
				expect(res.body?.city).toBe("San Francisco");
				expect(res.body?.country).toBe("USA");
				expect(res.body?.status).toBe("active");
				expect(res.body?.map_urls).toEqual([]);

				// Verify org.create_address audit log entry was created
				const auditResp = await api.listAuditLogs(token, {
					event_types: ["org.create_address"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.create_address");
				expect(auditEntry.event_data).toHaveProperty("address_id");
				expect(auditEntry.event_data).toHaveProperty("title");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: create address with all optional fields (201)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-full");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: CreateAddressRequest = {
					title: "London Office",
					address_line1: "123 Main St",
					address_line2: "Floor 5",
					city: "London",
					state: "England",
					postal_code: "SW1A 1AA",
					country: "United Kingdom",
					map_urls: [
						"https://maps.google.com/?q=123+Main+St",
						"https://www.openstreetmap.org",
					],
				};
				const res = await api.createAddress(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.title).toBe("London Office");
				expect(res.body?.address_line2).toBe("Floor 5");
				expect(res.body?.state).toBe("England");
				expect(res.body?.postal_code).toBe("SW1A 1AA");
				expect(res.body?.map_urls).toHaveLength(2);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing title (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-notitle");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing address_line1 (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-noaddr");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "HQ",
					city: "San Francisco",
					country: "USA",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing city (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-nocity");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "HQ",
					address_line1: "123 Main St",
					country: "USA",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing country (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-nocountry");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: title too long (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-titlelong");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "a".repeat(101),
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: map_urls > 5 entries (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-mapurlcount");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
					map_urls: ["url1", "url2", "url3", "url4", "url5", "url6"],
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: map_url entry > 500 chars (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-mapurllen");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createAddressRaw(token, {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
					map_urls: ["a".repeat(501)],
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: CreateAddressRequest = {
				title: "HQ",
				address_line1: "123 Main St",
				city: "San Francisco",
				country: "USA",
			};
			const res = await api.createAddressRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-noroles");
			const { orgUserId } = await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const res = await api.createAddress(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: with manage_addresses role (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain, orgUserId } = await createTestOrgUserDirect(
				generateTestOrgEmail("addr-managerole").email,
				TEST_PASSWORD
			);

			try {
				await assignRoleToOrgUser(orgUserId, "org:manage_addresses");
				const token = await loginOrgUser(api, email, domain);
				const req: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const res = await api.createAddress(token, req);
				expect(res.status).toBe(201);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Get Address
	// ============================================================================
	test.describe("POST /org/get-address", () => {
		test("Success: get existing address (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-get");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);
				expect(createRes.status).toBe(201);

				const getReq: GetAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const getRes = await api.getAddress(token, getReq);
				expect(getRes.status).toBe(200);
				expect(getRes.body?.address_id).toBe(createRes.body?.address_id);
				expect(getRes.body?.title).toBe("HQ");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing address_id (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-getnoaddr");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getAddressRaw(token, {});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: GetAddressRequest = {
				address_id: "invalid-id",
			};
			const res = await api.getAddressRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-getnoauth");
			await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: GetAddressRequest = {
					address_id: "random-id",
				};
				const res = await api.getAddress(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: with view_addresses role (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			// Create the admin first to get the orgId, then add the viewer to the same org.
			const { email: adminEmail, domain: adminDomain } =
				generateTestOrgEmail("addr-getadmin");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const viewerGenerated = generateTestOrgEmail("addr-getviewrole");
			const viewerResult = await createTestOrgUserDirect(
				viewerGenerated.email,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain: adminDomain }
			);

			try {
				await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_addresses");
				const viewerToken = await loginOrgUser(
					api,
					viewerGenerated.email,
					adminDomain
				);

				const adminToken = await loginOrgUser(api, adminEmail, adminDomain);
				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(adminToken, createReq);
				expect(createRes.status).toBe(201);

				const getReq: GetAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const getRes = await api.getAddress(viewerToken, getReq);
				expect(getRes.status).toBe(200);
			} finally {
				await deleteTestOrgUser(viewerGenerated.email);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Not found: non-existent address_id (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-get404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: GetAddressRequest = {
					address_id: "00000000-0000-0000-0000-000000000000",
				};
				const res = await api.getAddress(token, req);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Update Address
	// ============================================================================
	test.describe("POST /org/update-address", () => {
		test("Success: update address (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-update");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);
				expect(createRes.status).toBe(201);

				const updateReq: UpdateAddressRequest = {
					address_id: createRes.body!.address_id,
					title: "Headquarters",
					address_line1: "456 Main St",
					city: "New York",
					country: "USA",
				};
				const updateRes = await api.updateAddress(token, updateReq);
				expect(updateRes.status).toBe(200);
				expect(updateRes.body?.title).toBe("Headquarters");
				expect(updateRes.body?.address_line1).toBe("456 Main St");
				expect(updateRes.body?.city).toBe("New York");

				// Verify org.update_address audit log entry was created
				const auditResp = await api.listAuditLogs(token, {
					event_types: ["org.update_address"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.update_address");
				expect(auditEntry.event_data).toHaveProperty("address_id");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing required field (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-updateval");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const res = await api.updateAddressRaw(token, {
					address_id: createRes.body?.address_id,
					title: "Headquarters",
					address_line1: "456 Main St",
					city: "New York",
					// missing country
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: UpdateAddressRequest = {
				address_id: "invalid-id",
				title: "HQ",
				address_line1: "123 Main St",
				city: "San Francisco",
				country: "USA",
			};
			const res = await api.updateAddressRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-updatenoauth");
			await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: UpdateAddressRequest = {
					address_id: "random-id",
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const res = await api.updateAddress(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent address_id (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-update404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: UpdateAddressRequest = {
					address_id: "00000000-0000-0000-0000-000000000000",
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const res = await api.updateAddress(token, req);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Disable Address
	// ============================================================================
	test.describe("POST /org/disable-address", () => {
		test("Success: disable active address (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-disable");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);
				expect(createRes.status).toBe(201);

				const disableReq: DisableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const disableRes = await api.disableAddress(token, disableReq);
				expect(disableRes.status).toBe(200);
				expect(disableRes.body?.status).toBe("disabled");

				// Verify org.disable_address audit log entry was created
				const auditResp = await api.listAuditLogs(token, {
					event_types: ["org.disable_address"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.disable_address");
				expect(auditEntry.event_data).toHaveProperty("address_id");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing address_id (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-disableval");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.disableAddressRaw(token, {});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: DisableAddressRequest = {
				address_id: "invalid-id",
			};
			const res = await api.disableAddressRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-disablenoauth");
			await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: DisableAddressRequest = {
					address_id: "random-id",
				};
				const res = await api.disableAddress(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent address_id (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-disable404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: DisableAddressRequest = {
					address_id: "00000000-0000-0000-0000-000000000000",
				};
				const res = await api.disableAddress(token, req);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: already disabled (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-disable422");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const disableReq: DisableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const disableRes1 = await api.disableAddress(token, disableReq);
				expect(disableRes1.status).toBe(200);

				const disableRes2 = await api.disableAddress(token, disableReq);
				expect(disableRes2.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Enable Address
	// ============================================================================
	test.describe("POST /org/enable-address", () => {
		test("Success: enable disabled address (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-enable");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const disableReq: DisableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				await api.disableAddress(token, disableReq);

				const enableReq: EnableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const enableRes = await api.enableAddress(token, enableReq);
				expect(enableRes.status).toBe(200);
				expect(enableRes.body?.status).toBe("active");

				// Verify org.enable_address audit log entry was created
				const auditResp = await api.listAuditLogs(token, {
					event_types: ["org.enable_address"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.enable_address");
				expect(auditEntry.event_data).toHaveProperty("address_id");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing address_id (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-enableval");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.enableAddressRaw(token, {});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: EnableAddressRequest = {
				address_id: "invalid-id",
			};
			const res = await api.enableAddressRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-enablenoauth");
			await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: EnableAddressRequest = {
					address_id: "random-id",
				};
				const res = await api.enableAddress(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent address_id (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-enable404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: EnableAddressRequest = {
					address_id: "00000000-0000-0000-0000-000000000000",
				};
				const res = await api.enableAddress(token, req);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: already active (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-enable422");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const enableReq: EnableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				const enableRes = await api.enableAddress(token, enableReq);
				expect(enableRes.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// List Addresses
	// ============================================================================
	test.describe("POST /org/list-addresses", () => {
		test("Success: list all addresses (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-listall");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				await api.createAddress(token, createReq);

				const listReq: ListAddressesRequest = {};
				const listRes = await api.listAddresses(token, listReq);
				expect(listRes.status).toBe(200);
				expect(listRes.body?.addresses).toBeDefined();
				expect(listRes.body?.addresses.length).toBeGreaterThanOrEqual(1);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: filter by active status (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-listactive");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const disableReq: DisableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				await api.disableAddress(token, disableReq);

				// Create another active address
				const createReq2: CreateAddressRequest = {
					title: "Office",
					address_line1: "456 Main St",
					city: "New York",
					country: "USA",
				};
				await api.createAddress(token, createReq2);

				const listReq: ListAddressesRequest = {
					filter_status: "active",
				};
				const listRes = await api.listAddresses(token, listReq);
				expect(listRes.status).toBe(200);
				expect(
					listRes.body?.addresses.every((a) => a.status === "active")
				).toBe(true);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: filter by disabled status (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-listdisabled");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "San Francisco",
					country: "USA",
				};
				const createRes = await api.createAddress(token, createReq);

				const disableReq: DisableAddressRequest = {
					address_id: createRes.body!.address_id,
				};
				await api.disableAddress(token, disableReq);

				const listReq: ListAddressesRequest = {
					filter_status: "disabled",
				};
				const listRes = await api.listAddresses(token, listReq);
				expect(listRes.status).toBe(200);
				expect(
					listRes.body?.addresses.every((a) => a.status === "disabled")
				).toBe(true);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: ListAddressesRequest = {};
			const res = await api.listAddressesRaw("invalid-token", req);
			expect(res.status).toBe(401);
		});

		test("RBAC: no roles (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("addr-listnoauth");
			await createTestOrgUserDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: ListAddressesRequest = {};
				const res = await api.listAddresses(token, req);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: with view_addresses role (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain, orgUserId } = await createTestOrgUserDirect(
				generateTestOrgEmail("addr-listviewrole").email,
				TEST_PASSWORD
			);

			try {
				await assignRoleToOrgUser(orgUserId, "org:view_addresses");
				const token = await loginOrgUser(api, email, domain);
				const req: ListAddressesRequest = {};
				const res = await api.listAddresses(token, req);
				expect(res.status).toBe(200);
				expect(res.body?.addresses).toBeDefined();
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});
});
