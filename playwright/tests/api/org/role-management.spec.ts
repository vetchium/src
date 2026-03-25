import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/org/org-users";

test.describe("POST /org/assign-role", () => {
	test("admin successfully assigns role to another org user", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-assign-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-assign-target");

		// Create admin and target user in same org
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Assign role
			const before = new Date(Date.now() - 2000).toISOString();
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const assignResponse = await api.assignRole(sessionToken, assignRequest);

			expect(assignResponse.status).toBe(200);
			expect(assignResponse.body.message).toContain("successfully");

			// Verify org.assign_role audit log entry was created
			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["org.assign_role"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.assign_role");
			expect(auditResp.body.audit_logs[0].target_user_id).toBe(targetUserId);
			expect(auditResp.body.audit_logs[0].event_data).toHaveProperty(
				"target_email_hash"
			);
			expect(
				JSON.stringify(auditResp.body.audit_logs[0].event_data)
			).not.toContain(targetEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("assigning same role twice returns 409 conflict", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-conflict-admin"
		);
		const { email: targetEmail } = generateTestOrgEmail("role-conflict-target");

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Assign role first time
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			await api.assignRole(sessionToken, assignRequest);

			// Try to assign same role again
			const conflictResponse = await api.assignRole(
				sessionToken,
				assignRequest
			);

			expect(conflictResponse.status).toBe(409);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("non-admin cannot assign roles (403 forbidden)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail, domain } =
			generateTestOrgEmail("role-nonadmin-user");
		const { email: targetEmail } = generateTestOrgEmail("role-nonadmin-target");

		// Create non-admin user and target user in same org
		// Admin creates the org and domain
		const adminEmail = `admin@${domain}`;
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain,
		});
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(userEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign role (should fail)
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("assigning role to non-existent user returns 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-notfound-admin"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign role to non-existent user
			const assignRequest: AssignRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "org:manage_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("assigning invalid role name returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-invalid-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-invalid-target");

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign invalid role
			const assignRequest = {
				target_user_id: targetUserId,
				role_name: "invalid_role_name",
			};
			const response = await api.assignRoleRaw(sessionToken, assignRequest);

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("missing target_user_id returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-notarget-admin"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign without target_user_id
			const response = await api.assignRoleRaw(sessionToken, {
				role_name: "org:manage_users",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-noauth-target");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.assignRoleWithoutAuth(assignRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail(
			"role-badsession-target"
		);

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.assignRole(
				"IND1-invalid-token",
				assignRequest
			);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("can assign all valid org roles via API (200)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-all-valid-admin"
		);
		const { email: targetEmail } = generateTestOrgEmail(
			"role-all-valid-target"
		);

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// These roles were previously missing from roles.go and would return 400
			const newRoles = [
				"org:view_costcenters",
				"org:manage_costcenters",
				"org:view_suborgs",
				"org:manage_suborgs",
				"org:view_audit_logs",
			];
			for (const role of newRoles) {
				const res = await api.assignRole(sessionToken, {
					target_user_id: targetUserId,
					role_name: role,
				});
				expect(res.status, `assigning ${role} should succeed`).toBe(200);
				// Clean up: remove role before assigning next
				await api.removeRole(sessionToken, {
					target_user_id: targetUserId,
					role_name: role,
				});
			}
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("assigning hub role to org user returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-wrong-portal-admin"
		);
		const { email: targetEmail } = generateTestOrgEmail(
			"role-wrong-portal-target"
		);

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign a hub role (wrong portal)
			const response = await api.assignRoleRaw(sessionToken, {
				target_user_id: targetUserId,
				role_name: "hub:write_posts",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});
});

test.describe("POST /org/remove-role", () => {
	test("admin successfully removes role from another org user", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-remove-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-remove-target");

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// First assign a role
			await api.assignRole(sessionToken, {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			});

			// Then remove it
			const before = new Date(Date.now() - 2000).toISOString();
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const removeResponse = await api.removeRole(sessionToken, removeRequest);

			expect(removeResponse.status).toBe(200);
			expect(removeResponse.body.message).toContain("successfully");

			// Verify org.remove_role audit log entry was created
			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["org.remove_role"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.remove_role");
			expect(auditResp.body.audit_logs[0].target_user_id).toBe(targetUserId);
			expect(auditResp.body.audit_logs[0].event_data).toHaveProperty(
				"target_email_hash"
			);
			expect(
				JSON.stringify(auditResp.body.audit_logs[0].event_data)
			).not.toContain(targetEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("removing role user doesn't have returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-notrole-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-notrole-target");

		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove role user doesn't have
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(409);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("removing role from non-existent user returns 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-remove404-admin"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove from non-existent user
			const removeRequest: RemoveRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "org:manage_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-remove-noauth");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.removeRoleWithoutAuth(removeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-remove-bad");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "org:manage_users",
			};
			const response = await api.removeRole(
				"IND1-invalid-token",
				removeRequest
			);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("cannot remove superadmin role from last active superadmin (422)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"last-sa-remove-admin"
		);

		// Create only one superadmin
		const { orgUserId: adminId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove superadmin role from self (last superadmin)
			const removeRequest: RemoveRoleRequest = {
				target_user_id: adminId,
				role_name: "org:superadmin",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("can remove superadmin role when another superadmin exists (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: admin1Email, domain } = generateTestOrgEmail(
			"sa-remove-two-admin1"
		);
		const { email: admin2Email } = generateTestOrgEmail("sa-remove-two-admin2");

		// Create two superadmins in the same org
		const { orgId } = await createTestOrgAdminDirect(
			admin1Email,
			TEST_PASSWORD
		);
		const { orgUserId: admin2Id } = await createTestOrgAdminDirect(
			admin2Email,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Remove superadmin role from admin2 (admin1 still remains as superadmin)
			const removeRequest: RemoveRoleRequest = {
				target_user_id: admin2Id,
				role_name: "org:superadmin",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(200);
		} finally {
			await deleteTestOrgUser(admin1Email);
			await deleteTestOrgUser(admin2Email);
		}
	});
});

test.describe("RBAC: POST /org/assign-role and /org/remove-role", () => {
	test("org user WITH org:manage_users can assign-role (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-ar-org-adm");
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		const managerEmail = `mgr-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId }
		);
		await assignRoleToOrgUser(managerResult.orgUserId, "org:manage_users");

		const targetEmail = `tgt-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const targetResult = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId }
		);

		try {
			const loginRes = await api.login({
				email: managerEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(managerEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaRes.body.session_token;

			const assignRequest: AssignRoleRequest = {
				target_user_id: targetResult.orgUserId,
				role_name: "org:view_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);
			expect(response.status).toBe(200);
		} finally {
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(targetEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("org user WITH org:manage_users can remove-role (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-rr-org-adm");
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		const managerEmail = `mgr-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId }
		);
		await assignRoleToOrgUser(managerResult.orgUserId, "org:manage_users");

		const targetEmail = `tgt-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const targetResult = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId }
		);
		await assignRoleToOrgUser(targetResult.orgUserId, "org:view_users");

		try {
			const loginRes = await api.login({
				email: managerEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(managerEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaRes.body.session_token;

			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetResult.orgUserId,
				role_name: "org:view_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);
			expect(response.status).toBe(200);
		} finally {
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(targetEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("org user WITHOUT role gets 403 on remove-role", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-rr-norole");
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		const noRoleEmail = `norole-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: adminResult.orgId,
		});

		const targetEmail = `tgt-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const targetResult = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId }
		);
		await assignRoleToOrgUser(targetResult.orgUserId, "org:view_users");

		try {
			const loginRes = await api.login({
				email: noRoleEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(noRoleEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const noRoleToken = tfaRes.body.session_token;

			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetResult.orgUserId,
				role_name: "org:view_users",
			};
			const response = await api.removeRole(noRoleToken, removeRequest);
			expect(response.status).toBe(403);
		} finally {
			await deleteTestOrgUser(noRoleEmail);
			await deleteTestOrgUser(targetEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	// Negative RBAC for assign-role (no role → 403) is covered by
	// "non-admin cannot assign roles (403 forbidden)" above.
});
