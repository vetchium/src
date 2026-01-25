import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyAdminDirect,
	createTestAgencyUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/assign-role", () => {
	test("admin successfully assigns role to another agency user", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("role-assign-admin");
		const { email: targetEmail } =
			generateTestAgencyEmail("role-assign-target");

		// Create admin and target user in same agency
		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
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
				role_name: "invite_users",
			};
			const assignResponse = await api.assignRole(sessionToken, assignRequest);

			expect(assignResponse.status).toBe(200);
			expect(assignResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("assigning same role twice returns 409 conflict", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"role-conflict-admin"
		);
		const { email: targetEmail } = generateTestAgencyEmail(
			"role-conflict-target"
		);

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
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
				role_name: "manage_users",
			};
			await api.assignRole(sessionToken, assignRequest);

			// Try to assign same role again
			const conflictResponse = await api.assignRole(
				sessionToken,
				assignRequest
			);

			expect(conflictResponse.status).toBe(409);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("non-admin cannot assign roles (403 forbidden)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail, domain } =
			generateTestAgencyEmail("role-nonadmin-user");
		const { email: targetEmail } = generateTestAgencyEmail(
			"role-nonadmin-target"
		);

		// Create non-admin user and target user in same agency
		// Admin creates the agency and domain
		const adminEmail = `admin@${domain}`;
		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			agencyId,
			domain,
		});
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
		);

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain: domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);
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
				role_name: "invite_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(403);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(userEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("assigning role to non-existent user returns 404", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"role-notfound-admin"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
				role_name: "invite_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("assigning invalid role name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("role-invalid-admin");
		const { email: targetEmail } = generateTestAgencyEmail(
			"role-invalid-target"
		);

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
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
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("missing target_user_id returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"role-notarget-admin"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
				role_name: "invite_users",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: targetEmail } =
			generateTestAgencyEmail("role-noauth-target");

		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "invite_users",
			};
			const response = await api.assignRoleWithoutAuth(assignRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: targetEmail } = generateTestAgencyEmail(
			"role-badsession-target"
		);

		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "invite_users",
			};
			const response = await api.assignRole(
				"IND1-invalid-token",
				assignRequest
			);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(targetEmail);
		}
	});
});

test.describe("POST /agency/remove-role", () => {
	test("admin successfully removes role from another agency user", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("role-remove-admin");
		const { email: targetEmail } =
			generateTestAgencyEmail("role-remove-target");

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
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
				role_name: "invite_users",
			});

			// Then remove it
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "invite_users",
			};
			const removeResponse = await api.removeRole(sessionToken, removeRequest);

			expect(removeResponse.status).toBe(200);
			expect(removeResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("removing role user doesn't have returns 409", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("role-notrole-admin");
		const { email: targetEmail } = generateTestAgencyEmail(
			"role-notrole-target"
		);

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId, domain }
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
				role_name: "manage_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(409);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("removing role from non-existent user returns 404", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"role-remove404-admin"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
				role_name: "invite_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: targetEmail } =
			generateTestAgencyEmail("role-remove-noauth");

		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "invite_users",
			};
			const response = await api.removeRoleWithoutAuth(removeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: targetEmail } = generateTestAgencyEmail("role-remove-bad");

		const { agencyUserId: targetUserId } = await createTestAgencyUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "invite_users",
			};
			const response = await api.removeRole(
				"IND1-invalid-token",
				removeRequest
			);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(targetEmail);
		}
	});
});
