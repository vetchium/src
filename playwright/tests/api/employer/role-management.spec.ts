import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/employer/employer-users";

test.describe("POST /employer/assign-role", () => {
	test("admin successfully assigns role to another org user", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-assign-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-assign-target");

		// Create admin and target user in same employer
		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "employer:manage_users",
			};
			const assignResponse = await api.assignRole(sessionToken, assignRequest);

			expect(assignResponse.status).toBe(200);
			expect(assignResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("assigning same role twice returns 409 conflict", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-conflict-admin"
		);
		const { email: targetEmail } = generateTestOrgEmail("role-conflict-target");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
				role_name: "employer:manage_users",
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
		const api = new EmployerAPIClient(request);
		const { email: userEmail, domain } =
			generateTestOrgEmail("role-nonadmin-user");
		const { email: targetEmail } = generateTestOrgEmail("role-nonadmin-target");

		// Create non-admin user and target user in same employer
		// Admin creates the employer and domain
		const adminEmail = `admin@${domain}`;
		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
				role_name: "employer:manage_users",
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
		const api = new EmployerAPIClient(request);
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
				role_name: "employer:manage_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("assigning invalid role name returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-invalid-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-invalid-target");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
		const api = new EmployerAPIClient(request);
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
				role_name: "employer:manage_users",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-noauth-target");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "employer:manage_users",
			};
			const response = await api.assignRoleWithoutAuth(assignRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);
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
				role_name: "employer:manage_users",
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

	test("assigning agency role to employer user returns 400", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"role-wrong-portal-admin"
		);
		const { email: targetEmail } = generateTestOrgEmail(
			"role-wrong-portal-target"
		);

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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

			// Try to assign an agency role (wrong portal)
			const response = await api.assignRoleRaw(sessionToken, {
				target_user_id: targetUserId,
				role_name: "agency:invite_users",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});
});

test.describe("POST /employer/remove-role", () => {
	test("admin successfully removes role from another org user", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-remove-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-remove-target");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
				role_name: "employer:manage_users",
			});

			// Then remove it
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "employer:manage_users",
			};
			const removeResponse = await api.removeRole(sessionToken, removeRequest);

			expect(removeResponse.status).toBe(200);
			expect(removeResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("removing role user doesn't have returns 409", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("role-notrole-admin");
		const { email: targetEmail } = generateTestOrgEmail("role-notrole-target");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
				role_name: "employer:manage_users",
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
		const api = new EmployerAPIClient(request);
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
				role_name: "employer:manage_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-remove-noauth");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "employer:manage_users",
			};
			const response = await api.removeRoleWithoutAuth(removeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email: targetEmail } = generateTestOrgEmail("role-remove-bad");

		const { orgUserId: targetUserId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "employer:manage_users",
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
		const api = new EmployerAPIClient(request);
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
				role_name: "employer:superadmin",
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
		const api = new EmployerAPIClient(request);
		const { email: admin1Email, domain } = generateTestOrgEmail(
			"sa-remove-two-admin1"
		);
		const { email: admin2Email } = generateTestOrgEmail("sa-remove-two-admin2");

		// Create two superadmins in the same employer
		const { employerId } = await createTestOrgAdminDirect(
			admin1Email,
			TEST_PASSWORD
		);
		const { orgUserId: admin2Id } = await createTestOrgAdminDirect(
			admin2Email,
			TEST_PASSWORD,
			"ind1",
			{ employerId, domain }
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
				role_name: "employer:superadmin",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(200);
		} finally {
			await deleteTestOrgUser(admin1Email);
			await deleteTestOrgUser(admin2Email);
		}
	});
});
