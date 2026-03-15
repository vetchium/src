import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
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
} from "vetchium-specs/employer/employer-users";
import type {
	CreateSubOrgRequest,
	RenameSubOrgRequest,
	DisableSubOrgRequest,
	EnableSubOrgRequest,
	AddSubOrgMemberRequest,
	RemoveSubOrgMemberRequest,
} from "vetchium-specs/employer/suborgs";

async function loginOrgUser(
	api: EmployerAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
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

test.describe("SubOrgs API", () => {
	// ============================================================================
	// create-suborg
	// ============================================================================
	test.describe("POST /employer/create-suborg", () => {
		test("Success: create a SubOrg (201)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-create");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();
				const req: CreateSubOrgRequest = {
					name: "Amazon India Private Ltd",
					pinned_region: "ind1",
				};
				const res = await api.createSubOrg(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.name).toBe("Amazon India Private Ltd");
				expect(res.body?.pinned_region).toBe("ind1");
				expect(res.body?.status).toBe("active");
				expect(res.body?.id).toBeDefined();
				expect(res.body?.created_at).toBeDefined();

				// Audit log: employer.create_suborg
				const auditRes = await api.filterAuditLogs(token, {
					event_types: ["employer.create_suborg"],
					start_time: before,
				});
				expect(auditRes.status).toBe(200);
				expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditRes.body.audit_logs[0];
				expect(entry.event_type).toBe("employer.create_suborg");
				expect(entry.actor_user_id).toBeDefined();
				expect(entry.event_data).toHaveProperty("suborg_id");
				expect(entry.event_data).toHaveProperty("suborg_name");
				expect(entry.event_data).toHaveProperty("pinned_region");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing name (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-noname");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createSubOrgRaw(token, { pinned_region: "ind1" });
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: name too long (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-namelong");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createSubOrgRaw(token, {
					name: "a".repeat(65),
					pinned_region: "ind1",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing pinned_region (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-noregion");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createSubOrgRaw(token, {
					name: "Test SubOrg",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: invalid pinned_region (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-badregion");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createSubOrgRaw(token, {
					name: "Test SubOrg",
					pinned_region: "mars1",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.createSubOrgRaw("invalid-token", {
				name: "Test",
				pinned_region: "ind1",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs role returns 403", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("so-create-rbac");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});
			try {
				const token = await loginOrgUser(api, userEmail, domain);
				const res = await api.createSubOrg(token, {
					name: "Should Fail",
					pinned_region: "ind1",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// list-suborgs
	// ============================================================================
	test.describe("POST /employer/list-suborgs", () => {
		test("Success: empty list for new employer (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list-empty");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.listSubOrgs(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.suborgs).toEqual([]);
				expect(res.body?.next_cursor).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: list returns created SubOrgs (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				await api.createSubOrg(token, {
					name: "India Office",
					pinned_region: "ind1",
				});
				await api.createSubOrg(token, {
					name: "US Office",
					pinned_region: "usa1",
				});

				const res = await api.listSubOrgs(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.suborgs).toHaveLength(2);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: filter by status active (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-filter-active");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Active SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soId = createRes.body!.id;

				const createRes2 = await api.createSubOrg(token, {
					name: "To Be Disabled",
					pinned_region: "usa1",
				});
				expect(createRes2.status).toBe(201);
				const soId2 = createRes2.body!.id;
				await api.disableSubOrg(token, { suborg_id: soId2 });

				const activeRes = await api.listSubOrgs(token, {
					filter_status: "active",
				});
				expect(activeRes.status).toBe(200);
				const activeIds = activeRes.body!.suborgs.map((s) => s.id);
				expect(activeIds).toContain(soId);
				expect(activeIds).not.toContain(soId2);

				const disabledRes = await api.listSubOrgs(token, {
					filter_status: "disabled",
				});
				expect(disabledRes.status).toBe(200);
				const disabledIds = disabledRes.body!.suborgs.map((s) => s.id);
				expect(disabledIds).toContain(soId2);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Pagination: keyset pagination works (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-pages");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				for (let i = 1; i <= 5; i++) {
					await api.createSubOrg(token, {
						name: `SubOrg ${i}`,
						pinned_region: "ind1",
					});
				}

				const page1 = await api.listSubOrgs(token, { limit: 3 });
				expect(page1.status).toBe(200);
				expect(page1.body?.suborgs).toHaveLength(3);
				expect(page1.body?.next_cursor).not.toBe("");

				const page2 = await api.listSubOrgs(token, {
					limit: 3,
					cursor: page1.body?.next_cursor,
				});
				expect(page2.status).toBe(200);
				expect(page2.body?.suborgs).toHaveLength(2);
				expect(page2.body?.next_cursor).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: any authenticated user can list (200)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("so-list-anyuser");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const userEmail = `member@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});
			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.listSubOrgs(userToken, {});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.listSubOrgsRaw("bad-token", {});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// rename-suborg
	// ============================================================================
	test.describe("POST /employer/rename-suborg", () => {
		test("Success: rename a SubOrg (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-rename");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Old Name",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);

				const before = new Date(Date.now() - 2000).toISOString();
				const req: RenameSubOrgRequest = {
					suborg_id: createRes.body!.id,
					name: "New Name",
				};
				const res = await api.renameSubOrg(token, req);
				expect(res.status).toBe(200);
				expect(res.body?.name).toBe("New Name");
				expect(res.body?.id).toBe(createRes.body!.id);

				// Audit log: employer.rename_suborg
				const auditRes = await api.filterAuditLogs(token, {
					event_types: ["employer.rename_suborg"],
					start_time: before,
				});
				expect(auditRes.status).toBe(200);
				expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditRes.body.audit_logs[0];
				expect(entry.event_data).toHaveProperty("old_name", "Old Name");
				expect(entry.event_data).toHaveProperty("new_name", "New Name");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent suborg_id (404)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-ren404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.renameSubOrg(token, {
					suborg_id: "00000000-0000-0000-0000-000000000000",
					name: "Ghost",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing suborg_id (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-ren-noid");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.renameSubOrgRaw(token, { name: "New Name" });
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.renameSubOrgRaw("bad-token", {
				suborg_id: "00000000-0000-0000-0000-000000000000",
				name: "X",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs returns 403", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-ren-rbac");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});

			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "Rename Test",
				pinned_region: "ind1",
			});
			expect(createRes.status).toBe(201);

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.renameSubOrg(userToken, {
					suborg_id: createRes.body!.id,
					name: "Hacked Name",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// disable-suborg / enable-suborg
	// ============================================================================
	test.describe("POST /employer/disable-suborg and enable-suborg", () => {
		test("Success: disable then re-enable a SubOrg (200)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis-en");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Toggle SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soId = createRes.body!.id;

				// Disable
				const beforeDisable = new Date(Date.now() - 2000).toISOString();
				const disableRes = await api.disableSubOrg(token, {
					suborg_id: soId,
				});
				expect(disableRes.status).toBe(200);

				// Verify status via list
				const listRes = await api.listSubOrgs(token, {
					filter_status: "disabled",
				});
				expect(listRes.body!.suborgs.map((s) => s.id)).toContain(soId);

				// Audit log: employer.disable_suborg
				const auditDisable = await api.filterAuditLogs(token, {
					event_types: ["employer.disable_suborg"],
					start_time: beforeDisable,
				});
				expect(auditDisable.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditDisable.body.audit_logs[0].event_data).toHaveProperty(
					"suborg_id"
				);

				// Re-enable
				const beforeEnable = new Date(Date.now() - 2000).toISOString();
				const enableRes = await api.enableSubOrg(token, { suborg_id: soId });
				expect(enableRes.status).toBe(200);

				const auditEnable = await api.filterAuditLogs(token, {
					event_types: ["employer.enable_suborg"],
					start_time: beforeEnable,
				});
				expect(auditEnable.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: disable an already disabled SubOrg (422)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis-twice");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Double Disable",
					pinned_region: "ind1",
				});
				const soId = createRes.body!.id;
				await api.disableSubOrg(token, { suborg_id: soId });
				const res = await api.disableSubOrg(token, { suborg_id: soId });
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: enable an already active SubOrg (422)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-en-twice");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Double Enable",
					pinned_region: "ind1",
				});
				const res = await api.enableSubOrg(token, {
					suborg_id: createRes.body!.id,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: disable non-existent SubOrg (404)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.disableSubOrg(token, {
					suborg_id: "00000000-0000-0000-0000-000000000000",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated disable (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.disableSubOrgRaw("bad-token", {
				suborg_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// add-suborg-member / remove-suborg-member
	// ============================================================================
	test.describe("POST /employer/add-suborg-member and remove-suborg-member", () => {
		test("Success: add then remove a member (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-member");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const memberEmail = `member@${domain}`;
			const memberResult = await createTestOrgUserDirect(
				memberEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);

				const createRes = await api.createSubOrg(token, {
					name: "Member Test SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soId = createRes.body!.id;

				// Add member
				const beforeAdd = new Date(Date.now() - 2000).toISOString();
				const req: AddSubOrgMemberRequest = {
					suborg_id: soId,
					org_user_id: memberResult.orgUserId,
				};
				const addRes = await api.addSubOrgMember(token, req);
				expect(addRes.status).toBe(200);

				// Audit log: employer.add_suborg_member
				const auditAdd = await api.filterAuditLogs(token, {
					event_types: ["employer.add_suborg_member"],
					start_time: beforeAdd,
				});
				expect(auditAdd.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const addEntry = auditAdd.body.audit_logs[0];
				expect(addEntry.target_user_id).toBe(memberResult.orgUserId);
				expect(addEntry.event_data).toHaveProperty("suborg_id");

				// Remove member
				const beforeRemove = new Date(Date.now() - 2000).toISOString();
				const removeReq: RemoveSubOrgMemberRequest = {
					suborg_id: soId,
					org_user_id: memberResult.orgUserId,
				};
				const removeRes = await api.removeSubOrgMember(token, removeReq);
				expect(removeRes.status).toBe(200);

				// Audit log: employer.remove_suborg_member
				const auditRemove = await api.filterAuditLogs(token, {
					event_types: ["employer.remove_suborg_member"],
					start_time: beforeRemove,
				});
				expect(auditRemove.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditRemove.body.audit_logs[0].target_user_id).toBe(
					memberResult.orgUserId
				);
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Conflict: add same member twice (409)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-mem-dup");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const memberEmail = `member@${domain}`;
			const memberResult = await createTestOrgUserDirect(
				memberEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Dup Member SubOrg",
					pinned_region: "ind1",
				});
				const soId = createRes.body!.id;
				const req: AddSubOrgMemberRequest = {
					suborg_id: soId,
					org_user_id: memberResult.orgUserId,
				};
				const first = await api.addSubOrgMember(token, req);
				expect(first.status).toBe(200);
				const second = await api.addSubOrgMember(token, req);
				expect(second.status).toBe(409);
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Not found: remove non-member (404)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-rem404");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const nonMemberEmail = `nonmember@${domain}`;
			const nonMemberResult = await createTestOrgUserDirect(
				nonMemberEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Remove 404 SubOrg",
					pinned_region: "ind1",
				});
				const soId = createRes.body!.id;

				const res = await api.removeSubOrgMember(token, {
					suborg_id: soId,
					org_user_id: nonMemberResult.orgUserId,
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(nonMemberEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Validation: missing suborg_id (400)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-mem-noid");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addSubOrgMemberRaw(token, {
					org_user_id: "00000000-0000-0000-0000-000000000000",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated add member (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.addSubOrgMemberRaw("bad-token", {
				suborg_id: "00000000-0000-0000-0000-000000000000",
				org_user_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs returns 403", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-mem-rbac");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const userEmail = `norole@${domain}`;
			const userResult = await createTestOrgUserDirect(
				userEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "RBAC SubOrg",
				pinned_region: "ind1",
			});

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.addSubOrgMember(userToken, {
					suborg_id: createRes.body!.id,
					org_user_id: userResult.orgUserId,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// list-suborg-members
	// ============================================================================
	test.describe("POST /employer/list-suborg-members", () => {
		test("Success: list members of a SubOrg (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-list-mem");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const m1Email = `m1@${domain}`;
			const m2Email = `m2@${domain}`;
			const m1Result = await createTestOrgUserDirect(
				m1Email,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);
			const m2Result = await createTestOrgUserDirect(
				m2Email,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);
				const createRes = await api.createSubOrg(token, {
					name: "List Members SubOrg",
					pinned_region: "ind1",
				});
				const soId = createRes.body!.id;

				await api.addSubOrgMember(token, {
					suborg_id: soId,
					org_user_id: m1Result.orgUserId,
				});
				await api.addSubOrgMember(token, {
					suborg_id: soId,
					org_user_id: m2Result.orgUserId,
				});

				const res = await api.listSubOrgMembers(token, { suborg_id: soId });
				expect(res.status).toBe(200);
				expect(res.body?.members).toHaveLength(2);
				const ids = res.body!.members.map((m) => m.org_user_id);
				expect(ids).toContain(m1Result.orgUserId);
				expect(ids).toContain(m2Result.orgUserId);
				// email_address_hash must be present and not raw email
				expect(res.body!.members[0].email_address_hash).toBeDefined();
				expect(res.body!.members[0].email_address_hash).not.toContain("@");
			} finally {
				await deleteTestOrgUser(m1Email);
				await deleteTestOrgUser(m2Email);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Not found: non-existent suborg_id (404)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-lm404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.listSubOrgMembers(token, {
					suborg_id: "00000000-0000-0000-0000-000000000000",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: view_suborgs can list members (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-lm-view");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const viewerEmail = `viewer@${domain}`;
			const viewerResult = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);
			await assignRoleToOrgUser(
				viewerResult.orgUserId,
				"employer:view_suborgs"
			);

			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "Viewer Test SubOrg",
				pinned_region: "ind1",
			});
			const soId = createRes.body!.id;

			try {
				const viewerToken = await loginOrgUser(api, viewerEmail, domain);
				const res = await api.listSubOrgMembers(viewerToken, {
					suborg_id: soId,
				});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(viewerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("RBAC: no view_suborgs or manage_suborgs returns 403", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("so-lm-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});

			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "No Role SubOrg",
				pinned_region: "ind1",
			});

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.listSubOrgMembers(userToken, {
					suborg_id: createRes.body!.id,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const res = await api.listSubOrgMembersRaw("bad-token", {
				suborg_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// SubOrg assignments revoked on user disable
	// ============================================================================
	test.describe("SubOrg assignments revoked when user is disabled", () => {
		test("Member assignments are revoked when the user is disabled", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } = generateTestOrgEmail("so-revoke");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const memberEmail = `member@${domain}`;
			const memberResult = await createTestOrgUserDirect(
				memberEmail,
				TEST_PASSWORD,
				"ind1",
				{ employerId: adminResult.employerId, domain }
			);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);

				const createRes = await api.createSubOrg(token, {
					name: "Revoke Test SubOrg",
					pinned_region: "ind1",
				});
				const soId = createRes.body!.id;

				// Assign member
				await api.addSubOrgMember(token, {
					suborg_id: soId,
					org_user_id: memberResult.orgUserId,
				});

				// Verify member is listed
				const beforeDisable = await api.listSubOrgMembers(token, {
					suborg_id: soId,
				});
				expect(beforeDisable.body!.members.map((m) => m.org_user_id)).toContain(
					memberResult.orgUserId
				);

				// Disable the user
				const disableRes = await api.disableUser(token, {
					email_address: memberEmail,
				});
				expect(disableRes.status).toBe(200);

				// Verify member is no longer listed
				const afterDisable = await api.listSubOrgMembers(token, {
					suborg_id: soId,
				});
				expect(
					afterDisable.body!.members.map((m) => m.org_user_id)
				).not.toContain(memberResult.orgUserId);
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});
});
