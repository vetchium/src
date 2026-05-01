import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	setOrgPlan,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateSubOrgRequest,
	RenameSubOrgRequest,
	DisableSubOrgRequest,
	EnableSubOrgRequest,
	AddSubOrgMemberRequest,
	RemoveSubOrgMemberRequest,
} from "vetchium-specs/org/suborgs";

async function loginOrgUser(
	api: OrgAPIClient,
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
	test.describe("POST /org/create-suborg", () => {
		test("Success: create a SubOrg (201)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-create");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");

			try {
				const token = await loginOrgUser(api, email, domain);
				const before = new Date(Date.now() - 2000).toISOString();
				const req: CreateSubOrgRequest = {
					name: "Acme Corp LLC",
					pinned_region: "ind1",
				};
				const res = await api.createSubOrg(token, req);
				expect(res.status).toBe(201);
				expect(res.body?.name).toBe("Acme Corp LLC");
				expect(res.body?.pinned_region).toBe("ind1");
				expect(res.body?.status).toBe("active");
				expect(res.body?.created_at).toBeDefined();

				// Audit log: org.create_suborg
				const auditRes = await api.listAuditLogs(token, {
					event_types: ["org.create_suborg"],
					start_time: before,
				});
				expect(auditRes.status).toBe(200);
				expect(auditRes.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditRes.body.audit_logs[0];
				expect(entry.event_type).toBe("org.create_suborg");
				expect(entry.actor_email).toBeDefined();
				expect(entry.event_data).toHaveProperty("suborg_name");
				expect(entry.event_data).toHaveProperty("pinned_region");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing name (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-noname");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createSubOrgRaw(token, { pinned_region: "ind1" });
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: name too long (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-namelong");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
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
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-noregion");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
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
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-badregion");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
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
			const api = new OrgAPIClient(request);
			const res = await api.createSubOrgRaw("invalid-token", {
				name: "Test",
				pinned_region: "ind1",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs role returns 403", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-create-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
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
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// list-suborgs
	// ============================================================================
	test.describe("POST /org/list-suborgs", () => {
		test("Success: empty list for new org (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list-empty");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.listSubOrgs(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.suborgs).toEqual([]);
				expect(res.body?.next_pagination_key).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: list returns created SubOrgs (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				await api.createSubOrg(token, {
					name: "Alpha Division",
					pinned_region: "ind1",
				});
				await api.createSubOrg(token, {
					name: "Beta Division",
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
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-filter-active");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Active SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soName = createRes.body!.name;

				const createRes2 = await api.createSubOrg(token, {
					name: "To Be Disabled",
					pinned_region: "usa1",
				});
				expect(createRes2.status).toBe(201);
				const soName2 = createRes2.body!.name;
				await api.disableSubOrg(token, { name: soName2 });

				const activeRes = await api.listSubOrgs(token, {
					filter_status: "active",
				});
				expect(activeRes.status).toBe(200);
				const activeNames = activeRes.body!.suborgs.map((s) => s.name);
				expect(activeNames).toContain(soName);
				expect(activeNames).not.toContain(soName2);

				const disabledRes = await api.listSubOrgs(token, {
					filter_status: "disabled",
				});
				expect(disabledRes.status).toBe(200);
				const disabledNames = disabledRes.body!.suborgs.map((s) => s.name);
				expect(disabledNames).toContain(soName2);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Pagination: keyset pagination works (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-pages");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "gold");
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
				expect(page1.body?.next_pagination_key).not.toBe("");

				const page2 = await api.listSubOrgs(token, {
					limit: 3,
					pagination_key: page1.body?.next_pagination_key,
				});
				expect(page2.status).toBe(200);
				expect(page2.body?.suborgs).toHaveLength(2);
				expect(page2.body?.next_pagination_key).toBe("");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: view_suborgs can list suborgs (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list-view");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const viewerEmail = `viewer@${domain}`;
			const viewerResult = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_suborgs");
			try {
				const viewerToken = await loginOrgUser(api, viewerEmail, domain);
				const res = await api.listSubOrgs(viewerToken, {});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(viewerEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: no view_suborgs or manage_suborgs returns 403", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list-norole");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});
			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.listSubOrgs(userToken, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listSubOrgsRaw("bad-token", {});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// rename-suborg
	// ============================================================================
	test.describe("POST /org/rename-suborg", () => {
		test("Success: rename a SubOrg (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-rename");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Old Name",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);

				const before = new Date(Date.now() - 2000).toISOString();
				const req: RenameSubOrgRequest = {
					name: "Old Name",
					new_name: "New Name",
				};
				const res = await api.renameSubOrg(token, req);
				expect(res.status).toBe(200);
				expect(res.body?.name).toBe("New Name");

				// Audit log: org.rename_suborg
				const auditRes = await api.listAuditLogs(token, {
					event_types: ["org.rename_suborg"],
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

		test("Not found: non-existent suborg name (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-ren404");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.renameSubOrg(token, {
					name: "nonexistent-suborg-name",
					new_name: "Ghost",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing name (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-ren-noid");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.renameSubOrgRaw(token, { new_name: "New Name" });
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.renameSubOrgRaw("bad-token", {
				name: "nonexistent-suborg-name",
				new_name: "X",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs returns 403", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-ren-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "Rename Test",
				pinned_region: "ind1",
			});
			expect(createRes.status).toBe(201);

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.renameSubOrg(userToken, {
					name: createRes.body!.name,
					new_name: "Hacked Name",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// disable-suborg / enable-suborg
	// ============================================================================
	test.describe("POST /org/disable-suborg and enable-suborg", () => {
		test("Success: disable then re-enable a SubOrg (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis-en");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Toggle SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soName = createRes.body!.name;

				// Disable
				const beforeDisable = new Date(Date.now() - 2000).toISOString();
				const disableRes = await api.disableSubOrg(token, {
					name: soName,
				});
				expect(disableRes.status).toBe(200);

				// Verify status via list
				const listRes = await api.listSubOrgs(token, {
					filter_status: "disabled",
				});
				expect(listRes.body!.suborgs.map((s) => s.name)).toContain(soName);

				// Audit log: org.disable_suborg
				const auditDisable = await api.listAuditLogs(token, {
					event_types: ["org.disable_suborg"],
					start_time: beforeDisable,
				});
				expect(auditDisable.body.audit_logs.length).toBeGreaterThanOrEqual(1);

				// Re-enable
				const beforeEnable = new Date(Date.now() - 2000).toISOString();
				const enableRes = await api.enableSubOrg(token, { name: soName });
				expect(enableRes.status).toBe(200);

				const auditEnable = await api.listAuditLogs(token, {
					event_types: ["org.enable_suborg"],
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
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis-twice");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Double Disable",
					pinned_region: "ind1",
				});
				const soName = createRes.body!.name;
				await api.disableSubOrg(token, { name: soName });
				const res = await api.disableSubOrg(token, { name: soName });
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: enable an already active SubOrg (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-en-twice");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Double Enable",
					pinned_region: "ind1",
				});
				const res = await api.enableSubOrg(token, {
					name: createRes.body!.name,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: disable non-existent SubOrg (404)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis404");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.disableSubOrg(token, {
					name: "nonexistent-suborg-name",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated disable (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.disableSubOrgRaw("bad-token", {
				name: "nonexistent-suborg-name",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs returns 403 for disable-suborg", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-dis-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "RBAC Disable SubOrg",
				pinned_region: "ind1",
			});
			expect(createRes.status).toBe(201);

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.disableSubOrg(userToken, {
					name: createRes.body!.name,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: no manage_suborgs returns 403 for enable-suborg", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-en-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "RBAC Enable SubOrg",
				pinned_region: "ind1",
			});
			expect(createRes.status).toBe(201);
			await api.disableSubOrg(adminToken, { name: createRes.body!.name });

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.enableSubOrg(userToken, {
					name: createRes.body!.name,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// add-suborg-member / remove-suborg-member
	// ============================================================================
	test.describe("POST /org/add-suborg-member and remove-suborg-member", () => {
		test("Success: add then remove a member (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-member");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const memberEmail = `member@${domain}`;
			await createTestOrgUserDirect(memberEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, email, domain);

				const createRes = await api.createSubOrg(token, {
					name: "Member Test SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soName = createRes.body!.name;

				// Add member
				const beforeAdd = new Date(Date.now() - 2000).toISOString();
				const req: AddSubOrgMemberRequest = {
					name: soName,
					email_address: memberEmail,
				};
				const addRes = await api.addSubOrgMember(token, req);
				expect(addRes.status).toBe(200);

				// Audit log: org.add_suborg_member
				const auditAdd = await api.listAuditLogs(token, {
					event_types: ["org.add_suborg_member"],
					start_time: beforeAdd,
				});
				expect(auditAdd.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const addEntry = auditAdd.body.audit_logs[0];
				expect(addEntry.target_email).toBeDefined();

				// Remove member
				const beforeRemove = new Date(Date.now() - 2000).toISOString();
				const removeReq: RemoveSubOrgMemberRequest = {
					name: soName,
					email_address: memberEmail,
				};
				const removeRes = await api.removeSubOrgMember(token, removeReq);
				expect(removeRes.status).toBe(200);

				// Audit log: org.remove_suborg_member
				const auditRemove = await api.listAuditLogs(token, {
					event_types: ["org.remove_suborg_member"],
					start_time: beforeRemove,
				});
				expect(auditRemove.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditRemove.body.audit_logs[0].target_email).toBeDefined();
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("Conflict: add same member twice (409)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-mem-dup");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const memberEmail = `member@${domain}`;
			await createTestOrgUserDirect(memberEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Dup Member SubOrg",
					pinned_region: "ind1",
				});
				const soName = createRes.body!.name;
				const req: AddSubOrgMemberRequest = {
					name: soName,
					email_address: memberEmail,
				};
				const first = await api.addSubOrgMember(token, req);
				expect(first.status).toBe(200);
				const second = await api.addSubOrgMember(token, req);
				expect(second.status).toBe(409);
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: remove non-member (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-rem404");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const nonMemberEmail = `nonmember@${domain}`;
			await createTestOrgUserDirect(nonMemberEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "Remove 404 SubOrg",
					pinned_region: "ind1",
				});
				const soName = createRes.body!.name;

				const res = await api.removeSubOrgMember(token, {
					name: soName,
					email_address: nonMemberEmail,
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(nonMemberEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing name (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-mem-noid");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.addSubOrgMemberRaw(token, {
					email_address: "test@example.com",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated add member (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.addSubOrgMemberRaw("bad-token", {
				name: "nonexistent-suborg-name",
				email_address: "test@example.com",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: no manage_suborgs returns 403 for remove-suborg-member", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-rem-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const memberEmail = `member@${domain}`;
			const memberResult = await createTestOrgUserDirect(
				memberEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "RBAC Remove Member SubOrg",
				pinned_region: "ind1",
			});
			await api.addSubOrgMember(adminToken, {
				name: createRes.body!.name,
				email_address: memberEmail,
			});

			try {
				const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.removeSubOrgMember(noRoleToken, {
					name: createRes.body!.name,
					email_address: memberEmail,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: no manage_suborgs returns 403", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-mem-rbac");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "RBAC SubOrg",
				pinned_region: "ind1",
			});

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.addSubOrgMember(userToken, {
					name: createRes.body!.name,
					email_address: userEmail,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// list-suborg-members
	// ============================================================================
	test.describe("POST /org/list-suborg-members", () => {
		test("Success: list members of a SubOrg (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-list-mem");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const m1Email = `m1@${domain}`;
			const m2Email = `m2@${domain}`;
			const m1Result = await createTestOrgUserDirect(
				m1Email,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			const m2Result = await createTestOrgUserDirect(
				m2Email,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const createRes = await api.createSubOrg(token, {
					name: "List Members SubOrg",
					pinned_region: "ind1",
				});
				const soName = createRes.body!.name;

				await api.addSubOrgMember(token, {
					name: soName,
					email_address: m1Email,
				});
				await api.addSubOrgMember(token, {
					name: soName,
					email_address: m2Email,
				});

				const res = await api.listSubOrgMembers(token, { name: soName });
				expect(res.status).toBe(200);
				expect(res.body?.members).toHaveLength(2);
				const emails = res.body!.members.map((m) => m.email_address);
				expect(emails).toContain(m1Email);
				expect(emails).toContain(m2Email);
			} finally {
				await deleteTestOrgUser(m1Email);
				await deleteTestOrgUser(m2Email);
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent suborg name (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-lm404");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(orgId, "silver");
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.listSubOrgMembers(token, {
					name: "nonexistent-suborg-name",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: view_suborgs can list members (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-lm-view");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const viewerEmail = `viewer@${domain}`;
			const viewerResult = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_suborgs");

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "Viewer Test SubOrg",
				pinned_region: "ind1",
			});
			const soName = createRes.body!.name;

			try {
				const viewerToken = await loginOrgUser(api, viewerEmail, domain);
				const res = await api.listSubOrgMembers(viewerToken, {
					name: soName,
				});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(viewerEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("RBAC: no view_suborgs or manage_suborgs returns 403", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-lm-norole");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const userEmail = `norole@${domain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			const adminToken = await loginOrgUser(api, email, domain);
			const createRes = await api.createSubOrg(adminToken, {
				name: "No Role SubOrg",
				pinned_region: "ind1",
			});

			try {
				const userToken = await loginOrgUser(api, userEmail, domain);
				const res = await api.listSubOrgMembers(userToken, {
					name: createRes.body!.name,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(userEmail);
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listSubOrgMembersRaw("bad-token", {
				name: "nonexistent-suborg-name",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// RBAC: manage_suborgs positive test
	// ============================================================================
	test.describe("RBAC: manage_suborgs positive tests", () => {
		test("non-superadmin WITH manage_suborgs can create and manage suborgs (201/200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-rbac-pos");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const managerEmail = `manager@${domain}`;
			const managerResult = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(managerResult.orgUserId, "org:manage_suborgs");

			try {
				const managerToken = await loginOrgUser(api, managerEmail, domain);

				// create-suborg
				const createRes = await api.createSubOrg(managerToken, {
					name: "RBAC Positive SubOrg",
					pinned_region: "ind1",
				});
				expect(createRes.status).toBe(201);
				const soName = createRes.body!.name;

				// rename-suborg
				const renameRes = await api.renameSubOrg(managerToken, {
					name: soName,
					new_name: "RBAC Positive Renamed",
				});
				expect(renameRes.status).toBe(200);

				// add-suborg-member (add self)
				const addRes = await api.addSubOrgMember(managerToken, {
					name: "RBAC Positive Renamed",
					email_address: managerEmail,
				});
				expect(addRes.status).toBe(200);

				// remove-suborg-member
				const removeRes = await api.removeSubOrgMember(managerToken, {
					name: "RBAC Positive Renamed",
					email_address: managerEmail,
				});
				expect(removeRes.status).toBe(200);

				// disable-suborg
				const disableRes = await api.disableSubOrg(managerToken, {
					name: "RBAC Positive Renamed",
				});
				expect(disableRes.status).toBe(200);

				// enable-suborg
				const enableRes = await api.enableSubOrg(managerToken, {
					name: "RBAC Positive Renamed",
				});
				expect(enableRes.status).toBe(200);
			} finally {
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// SubOrg assignments revoked on user disable
	// ============================================================================
	test.describe("SubOrg assignments revoked when user is disabled", () => {
		test("Member assignments are revoked when the user is disabled", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("so-revoke");
			const adminResult = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await setOrgPlan(adminResult.orgId, "silver");
			const memberEmail = `member@${domain}`;
			const memberResult = await createTestOrgUserDirect(
				memberEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);

			try {
				const token = await loginOrgUser(api, email, domain);

				const createRes = await api.createSubOrg(token, {
					name: "Revoke Test SubOrg",
					pinned_region: "ind1",
				});
				const soName = createRes.body!.name;

				// Assign member
				await api.addSubOrgMember(token, {
					name: soName,
					email_address: memberEmail,
				});

				// Verify member is listed
				const beforeDisable = await api.listSubOrgMembers(token, {
					name: soName,
				});
				expect(
					beforeDisable.body!.members.map((m) => m.email_address)
				).toContain(memberEmail);

				// Disable the user
				const disableRes = await api.disableUser(token, {
					email_address: memberEmail,
				});
				expect(disableRes.status).toBe(200);

				// Verify member is no longer listed
				const afterDisable = await api.listSubOrgMembers(token, {
					name: soName,
				});
				expect(
					afterDisable.body!.members.map((m) => m.email_address)
				).not.toContain(memberEmail);
			} finally {
				await deleteTestOrgUser(memberEmail);
				await deleteTestOrgUser(email);
			}
		});
	});
});
