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
	CreateOpeningRequest,
	ListOpeningsRequest,
	OpeningNumberRequest,
	UpdateOpeningRequest,
	RejectOpeningRequest,
} from "vetchium-specs/org/openings";
import type { CreateAddressRequest } from "vetchium-specs/org/company-addresses";

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

test.describe("Openings API", () => {
	// ============================================================================
	// POST /org/create-opening
	// ============================================================================
	test.describe("POST /org/create-opening", () => {
		test("Success: superadmin creates opening (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-create");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: recruiterEmail } = await createTestOrgUserDirect(
				`recruiter@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);

				// Create an address first
				const addrReq: CreateAddressRequest = {
					title: "HQ",
					address_line1: "123 Main St",
					city: "Chennai",
					country: "IN",
				};
				const addrRes = await api.createAddress(token, addrReq);
				expect(addrRes.status).toBe(201);
				const addressId = addrRes.body!.address_id;

				const before = new Date(Date.now() - 2000).toISOString();
				const req: CreateOpeningRequest = {
					title: "Software Engineer",
					description: "Build great software",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addressId],
					number_of_positions: 2,
					hiring_manager_email_address: adminEmail,
					recruiter_email_address: recruiterEmail,
				};
				const res = await api.createOpening(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.opening_number).toBeGreaterThan(0);

				// Audit log assertion
				const auditResp = await api.listAuditLogs(token, {
					event_types: ["org.create_opening"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"org.create_opening"
				);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(recruiterEmail);
			}
		});

		test("Unauthorized: no token (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.createOpeningRaw("", {
				title: "Engineer",
				description: "desc",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: ["00000000-0000-0000-0000-000000000001"],
				number_of_positions: 1,
				hiring_manager_email_address: "hm@example.com",
				recruiter_email_address: "rec@example.com",
			});
			expect(res.status).toBe(401);
		});

		test("Missing required fields (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("op-missing");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createOpeningRaw(token, {});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Hiring manager equals recruiter (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("op-same-user");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const addrRes = await api.createAddress(token, {
					title: "HQ",
					address_line1: "1 St",
					city: "Chennai",
					country: "IN",
				});
				expect(addrRes.status).toBe(201);

				const res = await api.createOpeningRaw(token, {
					title: "Engineer",
					description: "desc",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: email,
					recruiter_email_address: email,
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: no roles → 403", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-rbac-no");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: noRoleEmail } = await createTestOrgUserDirect(
				`norole@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.createOpeningRaw(token, {
					title: "Engineer",
					description: "desc",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: ["00000000-0000-0000-0000-000000000001"],
					number_of_positions: 1,
					hiring_manager_email_address: adminEmail,
					recruiter_email_address: noRoleEmail,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(noRoleEmail);
			}
		});

		test("RBAC: manage_openings role → 201", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-rbac-ok");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(
					`manager@${domain}`,
					TEST_PASSWORD,
					"ind1",
					{ orgId, domain }
				);
			const { email: recruiterEmail } = await createTestOrgUserDirect(
				`recruiter2@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				await assignRoleToOrgUser(managerUserId, "org:manage_openings");

				const adminToken = await loginOrgUser(api, adminEmail, domain);
				const addrRes = await api.createAddress(adminToken, {
					title: "Office",
					address_line1: "2 St",
					city: "Bangalore",
					country: "IN",
				});
				expect(addrRes.status).toBe(201);

				const token = await loginOrgUser(api, managerEmail, domain);
				const req: CreateOpeningRequest = {
					title: "Product Manager",
					description: "Lead products",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "on_site",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: managerEmail,
					recruiter_email_address: recruiterEmail,
				};
				const res = await api.createOpening(token, req);
				expect(res.status).toBe(201);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(recruiterEmail);
			}
		});
	});

	// ============================================================================
	// POST /org/list-openings
	// ============================================================================
	test.describe("POST /org/list-openings", () => {
		test("Success: list openings (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("op-list");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: ListOpeningsRequest = {};
				const res = await api.listOpenings(token, req);
				expect(res.status).toBe(200);
				expect(Array.isArray(res.body?.openings)).toBe(true);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Unauthorized: no token (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const response = await request.post("/org/list-openings", { data: {} });
			expect(response.status()).toBe(401);
		});

		test("RBAC: no roles → 403", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("op-list-rbac-no");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: noRoleEmail } = await createTestOrgUserDirect(
				`norole@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.listOpenings(token, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(noRoleEmail);
			}
		});

		test("RBAC: view_openings role → 200", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("op-list-rbac-ok");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: viewerEmail, orgUserId: viewerUserId } =
				await createTestOrgUserDirect(
					`viewer@${domain}`,
					TEST_PASSWORD,
					"ind1",
					{ orgId, domain }
				);

			try {
				await assignRoleToOrgUser(viewerUserId, "org:view_openings");
				const token = await loginOrgUser(api, viewerEmail, domain);
				const res = await api.listOpenings(token, {});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(viewerEmail);
			}
		});
	});

	// ============================================================================
	// Lifecycle: create → submit (superadmin → published) → pause → reopen → close → archive
	// ============================================================================
	test.describe("Opening lifecycle", () => {
		test.describe.configure({ mode: "serial" });

		let token = "";
		let openingNumber = 0;
		const { email: adminEmail, domain } = generateTestOrgEmail("op-lifecycle");
		let recruiterEmail = "";

		test.beforeAll(async ({ request }) => {
			const api = new OrgAPIClient(request);
			const result = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
			recruiterEmail = `recruiter@${domain}`;
			await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
				orgId: result.orgId,
				domain,
			});
			token = await loginOrgUser(api, adminEmail, domain);

			const addrRes = await api.createAddress(token, {
				title: "HQ",
				address_line1: "10 Main Rd",
				city: "Mumbai",
				country: "IN",
			});
			expect(addrRes.status).toBe(201);

			const req: CreateOpeningRequest = {
				title: "Lifecycle Test Opening",
				description: "Testing full lifecycle",
				is_internal: false,
				employment_type: "contract",
				work_location_type: "hybrid",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			};
			const createRes = await api.createOpening(token, req);
			expect(createRes.status).toBe(201);
			openingNumber = createRes.body!.opening_number;
		});

		test.afterAll(async () => {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		});

		test("get-opening returns draft (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const req: OpeningNumberRequest = { opening_number: openingNumber };
			const res = await api.getOpening(token, req);
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("draft");
			expect(res.body?.hiring_manager.email_address).toBe(adminEmail);
			expect(res.body?.recruiter.email_address).toBe(recruiterEmail);
		});

		test("update-opening (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const getRes = await api.getOpening(token, {
				opening_number: openingNumber,
			});
			expect(getRes.status).toBe(200);
			const opening = getRes.body!;

			const req: UpdateOpeningRequest = {
				opening_number: openingNumber,
				title: "Updated Lifecycle Opening",
				description: "Updated description",
				employment_type: opening.employment_type,
				work_location_type: opening.work_location_type,
				address_ids: opening.addresses.map((a) => a.address_id),
				number_of_positions: 3,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			};
			const res = await api.updateOpening(token, req);
			expect(res.status).toBe(200);
			expect(res.body?.title).toBe("Updated Lifecycle Opening");
			expect(res.body?.number_of_positions).toBe(3);
		});

		test("submit-opening: superadmin → published (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const before = new Date(Date.now() - 2000).toISOString();
			const req: OpeningNumberRequest = { opening_number: openingNumber };
			const res = await api.submitOpening(token, req);
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("published");

			// Audit log assertion
			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.publish_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
		});

		test("pause-opening (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.pauseOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("paused");
		});

		test("reopen-opening (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.reopenOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("published");
		});

		test("close-opening (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.closeOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("closed");
		});

		test("archive-opening (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.archiveOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("archived");
		});
	});

	// ============================================================================
	// discard-opening
	// ============================================================================
	test.describe("POST /org/discard-opening", () => {
		test("Success: discard a draft opening (204)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-discard");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: recruiterEmail } = await createTestOrgUserDirect(
				`rec@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);
				const addrRes = await api.createAddress(token, {
					title: "Office",
					address_line1: "5 St",
					city: "Delhi",
					country: "IN",
				});
				expect(addrRes.status).toBe(201);

				const createRes = await api.createOpening(token, {
					title: "To Be Discarded",
					description: "temp",
					is_internal: true,
					employment_type: "internship",
					work_location_type: "on_site",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: adminEmail,
					recruiter_email_address: recruiterEmail,
				});
				expect(createRes.status).toBe(201);

				const req: OpeningNumberRequest = {
					opening_number: createRes.body!.opening_number,
				};
				const discardRes = await api.discardOpening(token, req);
				expect(discardRes.status).toBe(204);

				// Verify it's gone
				const getRes = await api.getOpening(token, req);
				expect(getRes.status).toBe(404);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(recruiterEmail);
			}
		});

		test("Not found: discard non-existent opening (404)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("op-discard-404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.discardOpening(token, { opening_number: 99999 });
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// duplicate-opening
	// ============================================================================
	test.describe("POST /org/duplicate-opening", () => {
		test("Success: duplicate an opening (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-dup");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: recruiterEmail } = await createTestOrgUserDirect(
				`recdup@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);
				const addrRes = await api.createAddress(token, {
					title: "HQ",
					address_line1: "7 Blvd",
					city: "Pune",
					country: "IN",
				});
				expect(addrRes.status).toBe(201);

				const createRes = await api.createOpening(token, {
					title: "Original Opening",
					description: "The original",
					is_internal: false,
					employment_type: "part_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: adminEmail,
					recruiter_email_address: recruiterEmail,
				});
				expect(createRes.status).toBe(201);

				const dupRes = await api.duplicateOpening(token, {
					opening_number: createRes.body!.opening_number,
				});
				expect(dupRes.status).toBe(201);
				expect(dupRes.body?.opening_number).toBeGreaterThan(
					createRes.body!.opening_number
				);

				// Verify it's a draft
				const getRes = await api.getOpening(token, {
					opening_number: dupRes.body!.opening_number,
				});
				expect(getRes.status).toBe(200);
				expect(getRes.body?.status).toBe("draft");
				expect(getRes.body?.title).toBe("Original Opening");
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(recruiterEmail);
			}
		});
	});

	// ============================================================================
	// submit → pending_review → approve/reject (non-superadmin flow)
	// ============================================================================
	test.describe("Approval flow (non-superadmin)", () => {
		test.describe.configure({ mode: "serial" });

		let adminToken = "";
		let managerToken = "";
		let openingNumber = 0;
		const { email: adminEmail, domain } = generateTestOrgEmail("op-approval");
		let managerEmail = "";
		let recruiterEmail = "";

		test.beforeAll(async ({ request }) => {
			const api = new OrgAPIClient(request);
			const result = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
			const orgId = result.orgId;

			managerEmail = `mgr@${domain}`;
			recruiterEmail = `rec@${domain}`;
			const { orgUserId: managerUserId } = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);
			await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings");

			adminToken = await loginOrgUser(api, adminEmail, domain);
			managerToken = await loginOrgUser(api, managerEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "99 Ave",
				city: "Hyderabad",
				country: "IN",
			});
			expect(addrRes.status).toBe(201);

			const createRes = await api.createOpening(managerToken, {
				title: "Approval Flow Opening",
				description: "For approval test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: managerEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(createRes.status).toBe(201);
			openingNumber = createRes.body!.opening_number;
		});

		test.afterAll(async () => {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(recruiterEmail);
		});

		test("non-superadmin submit → pending_review (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const res = await api.submitOpening(managerToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("pending_review");
		});

		test("superadmin approve → published (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const before = new Date(Date.now() - 2000).toISOString();
			const res = await api.approveOpening(adminToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(200);
			expect(res.body?.status).toBe("published");

			const auditResp = await api.listAuditLogs(adminToken, {
				event_types: ["org.publish_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ============================================================================
	// reject-opening
	// ============================================================================
	test.describe("POST /org/reject-opening", () => {
		test("Success: reject a pending_review opening (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("op-reject");
			const { orgId } = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			const { email: recruiterEmail } = await createTestOrgUserDirect(
				`rec@${domain}`,
				TEST_PASSWORD,
				"ind1",
				{ orgId, domain }
			);
			await assignRoleToOrgUser(managerUserId, "org:manage_openings");

			try {
				const adminToken = await loginOrgUser(api, adminEmail, domain);
				const managerToken = await loginOrgUser(api, managerEmail, domain);

				const addrRes = await api.createAddress(adminToken, {
					title: "Branch",
					address_line1: "3 Lane",
					city: "Kolkata",
					country: "IN",
				});
				expect(addrRes.status).toBe(201);

				const createRes = await api.createOpening(managerToken, {
					title: "To Be Rejected",
					description: "Will be rejected",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: managerEmail,
					recruiter_email_address: recruiterEmail,
				});
				expect(createRes.status).toBe(201);

				// Submit to pending_review
				const submitRes = await api.submitOpening(managerToken, {
					opening_number: createRes.body!.opening_number,
				});
				expect(submitRes.status).toBe(200);
				expect(submitRes.body?.status).toBe("pending_review");

				// Superadmin rejects
				const rejectReq: RejectOpeningRequest = {
					opening_number: createRes.body!.opening_number,
					rejection_note: "Not enough detail in the job description",
				};
				const rejectRes = await api.rejectOpening(adminToken, rejectReq);
				expect(rejectRes.status).toBe(200);
				expect(rejectRes.body?.status).toBe("draft");
				expect(rejectRes.body?.rejection_note).toBe(
					"Not enough detail in the job description"
				);
			} finally {
				await deleteTestOrgUser(adminEmail);
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(recruiterEmail);
			}
		});
	});

	// ============================================================================
	// get-opening: not found
	// ============================================================================
	test.describe("POST /org/get-opening", () => {
		test("Not found: non-existent opening (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("op-get-404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getOpening(token, { opening_number: 99999 });
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Unauthorized: no token (401)", async ({ request }) => {
			const response = await request.post("/org/get-opening", {
				data: { opening_number: 1 },
			});
			expect(response.status()).toBe(401);
		});
	});
});
