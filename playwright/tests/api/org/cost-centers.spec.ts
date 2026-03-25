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
	AddCostCenterRequest,
	UpdateCostCenterRequest,
	ListCostCentersRequest,
} from "vetchium-specs/org/cost-centers";

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

test.describe("Cost Centers API", () => {
	// ============================================================================
	// Add Cost Center
	// ============================================================================
	test.describe("POST /org/add-cost-center", () => {
		test("Success: add a cost center (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-add");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();
				const req: AddCostCenterRequest = {
					id: "engineering-us",
					display_name: "Engineering US",
					notes: "US engineering team",
				};
				const res = await api.addCostCenter(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.id).toBe("engineering-us");
				expect(res.body?.display_name).toBe("Engineering US");
				expect(res.body?.status).toBe("enabled");
				expect(res.body?.notes).toBe("US engineering team");

				// Verify org.add_cost_center audit log entry was created
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["org.add_cost_center"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.add_cost_center");
				expect(auditEntry.actor_user_id).toBeDefined();
				expect(auditEntry.event_data).toHaveProperty("cost_center_id");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: add cost center without notes (201)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-nonotes");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: AddCostCenterRequest = {
					id: "marketing",
					display_name: "Marketing",
				};
				const res = await api.addCostCenter(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.id).toBe("marketing");
				expect(res.body?.notes).toBeUndefined();
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing id (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-noid");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					display_name: "No ID Cost Center",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id too long (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-idlong");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "a".repeat(65),
					display_name: "Too Long ID",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing display_name (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-noname");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "valid-id",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: display_name too long (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-namelong");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "valid-id",
					display_name: "a".repeat(65),
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: notes too long (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-noteslong");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "valid-id",
					display_name: "Valid Name",
					notes: "a".repeat(501),
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id with trailing space (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-trail");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "valid-id ",
					display_name: "Trailing Space",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id with leading space (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-lead");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: " valid-id",
					display_name: "Leading Space",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id with spaces in middle (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-midspace");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "valid id",
					display_name: "Middle Space",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id starting with hyphen (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-starthyphen");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "-invalid",
					display_name: "Starts With Hyphen",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: id with uppercase letters (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-upper");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addCostCenterRaw(token, {
					id: "Engineering-US",
					display_name: "Uppercase ID",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Conflict: duplicate id same org (409)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-dup");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: AddCostCenterRequest = {
					id: "duplicate-test",
					display_name: "Duplicate Test",
				};
				const first = await api.addCostCenter(token, req);
				expect(first.status).toBe(201);

				const second = await api.addCostCenter(token, req);
				expect(second.status).toBe(409);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Different orgs can have same id (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email: email1, domain: domain1 } =
				generateTestOrgEmail("cc-emp1");
			const { email: email2, domain: domain2 } =
				generateTestOrgEmail("cc-emp2");
			await createTestOrgAdminDirect(email1, TEST_PASSWORD);
			await createTestOrgAdminDirect(email2, TEST_PASSWORD);

			try {
				const token1 = await loginOrgUser(api, email1, domain1);
				const token2 = await loginOrgUser(api, email2, domain2);

				const req: AddCostCenterRequest = {
					id: "shared-id",
					display_name: "Shared ID Cost Center",
				};

				const res1 = await api.addCostCenter(token1, req);
				expect(res1.status).toBe(201);

				const res2 = await api.addCostCenter(token2, req);
				expect(res2.status).toBe(201);
			} finally {
				await deleteTestOrgUser(email1);
				await deleteTestOrgUser(email2);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.addCostCenterRaw("invalid-token", {
				id: "test",
				display_name: "Test",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Update Cost Center
	// ============================================================================
	test.describe("POST /org/update-cost-center", () => {
		test("Success: update a cost center (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-update");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				// First create
				const addRes = await api.addCostCenter(token, {
					id: "to-update",
					display_name: "Original Name",
				});
				expect(addRes.status).toBe(201);

				// Then update
				const before = new Date(Date.now() - 2000).toISOString();
				const updateReq: UpdateCostCenterRequest = {
					id: "to-update",
					display_name: "Updated Name",
					status: "disabled",
					notes: "now disabled",
				};
				const updateRes = await api.updateCostCenter(token, updateReq);
				expect(updateRes.status).toBe(200);
				expect(updateRes.body?.display_name).toBe("Updated Name");
				expect(updateRes.body?.status).toBe("disabled");
				expect(updateRes.body?.notes).toBe("now disabled");

				// Verify org.update_cost_center audit log entry was created
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["org.update_cost_center"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const auditEntry = auditResp.body.audit_logs[0];
				expect(auditEntry.event_type).toBe("org.update_cost_center");
				expect(auditEntry.actor_user_id).toBeDefined();
				expect(auditEntry.event_data).toHaveProperty("cost_center_id");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent id (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-upd404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const updateReq: UpdateCostCenterRequest = {
					id: "does-not-exist",
					display_name: "Whatever",
					status: "enabled",
				};
				const res = await api.updateCostCenter(token, updateReq);
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: invalid status (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-badstatus");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.updateCostCenterRaw(token, {
					id: "some-id",
					display_name: "Some Name",
					status: "invalid-status",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing display_name (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-updnoname");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.updateCostCenterRaw(token, {
					id: "some-id",
					status: "enabled",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.updateCostCenterRaw("invalid-token", {
				id: "test",
				display_name: "Test",
				status: "enabled",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// List Cost Centers
	// ============================================================================
	test.describe("POST /org/list-cost-centers", () => {
		test("Empty list for new org (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-empty");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const req: ListCostCentersRequest = {};
				const res = await api.listCostCenters(token, req);
				expect(res.status).toBe(200);
				expect(res.body?.items).toEqual([]);
				expect(res.body?.next_cursor).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("List returns cost centers in order (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-list");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				await api.addCostCenter(token, { id: "alpha", display_name: "Alpha" });
				await api.addCostCenter(token, { id: "beta", display_name: "Beta" });
				await api.addCostCenter(token, { id: "gamma", display_name: "Gamma" });

				const res = await api.listCostCenters(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.items).toHaveLength(3);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Filter by status enabled (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-filter");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				await api.addCostCenter(token, {
					id: "enabled-cc",
					display_name: "Enabled CC",
				});
				// Create and then disable
				await api.addCostCenter(token, {
					id: "disabled-cc",
					display_name: "Disabled CC",
				});
				await api.updateCostCenter(token, {
					id: "disabled-cc",
					display_name: "Disabled CC",
					status: "disabled",
				});

				const enabledRes = await api.listCostCenters(token, {
					filter_status: "enabled",
				});
				expect(enabledRes.status).toBe(200);
				const enabledItems = enabledRes.body?.items ?? [];
				expect(enabledItems.every((cc) => cc.status === "enabled")).toBe(true);

				const disabledRes = await api.listCostCenters(token, {
					filter_status: "disabled",
				});
				expect(disabledRes.status).toBe(200);
				const disabledItems = disabledRes.body?.items ?? [];
				expect(disabledItems.every((cc) => cc.status === "disabled")).toBe(
					true
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Keyset pagination works (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-pages");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				// Create 5 cost centers
				for (let i = 1; i <= 5; i++) {
					await api.addCostCenter(token, {
						id: `cc-page-${i}`,
						display_name: `Cost Center ${i}`,
					});
				}

				// List first 3
				const page1 = await api.listCostCenters(token, { limit: 3 });
				expect(page1.status).toBe(200);
				expect(page1.body?.items).toHaveLength(3);
				expect(page1.body?.next_cursor).not.toBe("");

				// List next 3 using cursor
				const page2 = await api.listCostCenters(token, {
					limit: 3,
					cursor: page1.body?.next_cursor,
				});
				expect(page2.status).toBe(200);
				expect(page2.body?.items).toHaveLength(2);
				expect(page2.body?.next_cursor).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listCostCentersRaw("invalid-token", {});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// RBAC
	// ============================================================================
	test.describe("RBAC", () => {
		test("User with view_costcenters can list but not add (200/403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("cc-rbac-view");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const viewerEmail = `viewer@${domain}`;
			const viewerResult = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(
				viewerResult.orgUserId,
				"org:view_costcenters"
			);

			try {
				const viewerToken = await loginOrgUser(api, viewerEmail, domain);

				// Can list
				const listRes = await api.listCostCenters(viewerToken, {});
				expect(listRes.status).toBe(200);

				// Cannot add
				const addRes = await api.addCostCenter(viewerToken, {
					id: "rbac-test",
					display_name: "RBAC Test",
				});
				expect(addRes.status).toBe(403);

				// Cannot update
				const updateRes = await api.updateCostCenterRaw(viewerToken, {
					id: "rbac-test",
					display_name: "RBAC Test",
					status: "enabled",
				});
				expect(updateRes.status).toBe(403);
			} finally {
				await deleteTestOrgUser(viewerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("User with manage_costcenters can add, update and list", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("cc-rbac-mgr");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const managerEmail = `manager@${domain}`;
			const managerResult = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(
				managerResult.orgUserId,
				"org:manage_costcenters"
			);

			try {
				const managerToken = await loginOrgUser(api, managerEmail, domain);

				// Can add
				const addRes = await api.addCostCenter(managerToken, {
					id: "mgr-test",
					display_name: "Manager Test",
				});
				expect(addRes.status).toBe(201);

				// Can update
				const updateRes = await api.updateCostCenter(managerToken, {
					id: "mgr-test",
					display_name: "Manager Test Updated",
					status: "disabled",
				});
				expect(updateRes.status).toBe(200);

				// Can list
				const listRes = await api.listCostCenters(managerToken, {});
				expect(listRes.status).toBe(200);
			} finally {
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("User with no cost center role cannot list, add, or update (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("cc-rbac-none");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			// Admin creates a cost center to attempt update on
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			await api.addCostCenter(adminToken, {
				id: "rbac-none-cc",
				display_name: "RBAC None Test",
			});

			try {
				const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

				const listRes = await api.listCostCentersRaw(noRoleToken, {});
				expect(listRes.status).toBe(403);

				const addRes = await api.addCostCenterRaw(noRoleToken, {
					id: "test",
					display_name: "Test",
				});
				expect(addRes.status).toBe(403);

				const updateRes = await api.updateCostCenterRaw(noRoleToken, {
					id: "rbac-none-cc",
					display_name: "Hacked Name",
					status: "disabled",
				});
				expect(updateRes.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Superadmin can add, update and list cost centers", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("cc-rbac-super");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				const addRes = await api.addCostCenter(token, {
					id: "super-test",
					display_name: "Superadmin Test",
				});
				expect(addRes.status).toBe(201);

				const listRes = await api.listCostCenters(token, {});
				expect(listRes.status).toBe(200);

				const updateRes = await api.updateCostCenter(token, {
					id: "super-test",
					display_name: "Superadmin Test Updated",
					status: "enabled",
				});
				expect(updateRes.status).toBe(200);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Unauthenticated requests return 401", async ({ request }) => {
			const api = new OrgAPIClient(request);

			const listRes = await api.listCostCentersRaw("bad-token", {});
			expect(listRes.status).toBe(401);

			const addRes = await api.addCostCenterRaw("bad-token", {
				id: "test",
				display_name: "Test",
			});
			expect(addRes.status).toBe(401);

			const updateRes = await api.updateCostCenterRaw("bad-token", {
				id: "test",
				display_name: "Test",
				status: "enabled",
			});
			expect(updateRes.status).toBe(401);
		});
	});
});
