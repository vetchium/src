import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	generateTestAdminEmail,
	deleteTestAdminUser,
	createTestAdminAdminDirect,
	createTestAdminUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/admin/admin-users";

test.describe("POST /admin/assign-role", () => {
	test("admin successfully assigns role to another admin", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-assign-admin");
		const targetEmail = generateTestAdminEmail("role-assign-target");

		// Create admin and target user
		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Assign role
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const assignResponse = await api.assignRole(sessionToken, assignRequest);

			expect(assignResponse.status).toBe(200);
			expect(assignResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("assigning same role twice returns 409 conflict", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-conflict-admin");
		const targetEmail = generateTestAdminEmail("role-conflict-target");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Assign role first time
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:manage_users",
			};
			await api.assignRole(sessionToken, assignRequest);

			// Try to assign same role again
			const conflictResponse = await api.assignRole(
				sessionToken,
				assignRequest
			);

			expect(conflictResponse.status).toBe(409);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("assigning role to non-existent user returns 404", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-notfound-admin");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign role to non-existent user
			const assignRequest: AssignRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "admin:invite_users",
			};
			const response = await api.assignRole(sessionToken, assignRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("assigning invalid role name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-invalid-admin");
		const targetEmail = generateTestAdminEmail("role-invalid-target");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
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
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("missing target_user_id returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-notarget-admin");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign without target_user_id
			const response = await api.assignRoleRaw(sessionToken, {
				role_name: "admin:invite_users",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("missing role_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-norole-admin");
		const targetEmail = generateTestAdminEmail("role-norole-target");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to assign without role_name
			const response = await api.assignRoleRaw(sessionToken, {
				target_user_id: targetUserId,
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const targetEmail = generateTestAdminEmail("role-noauth-target");

		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const response = await api.assignRoleWithoutAuth(assignRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const targetEmail = generateTestAdminEmail("role-badsession-target");

		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const assignRequest: AssignRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const response = await api.assignRole("invalid-token", assignRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(targetEmail);
		}
	});
});

test.describe("POST /admin/remove-role", () => {
	test("admin successfully removes role from another admin", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-remove-admin");
		const targetEmail = generateTestAdminEmail("role-remove-target");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// First assign a role
			await api.assignRole(sessionToken, {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			});

			// Then remove it
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const removeResponse = await api.removeRole(sessionToken, removeRequest);

			expect(removeResponse.status).toBe(200);
			expect(removeResponse.body.message).toContain("successfully");
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("removing role user doesn't have returns 409", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-notrole-admin");
		const targetEmail = generateTestAdminEmail("role-notrole-target");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove role user doesn't have
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:manage_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(409);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("removing role from non-existent user returns 404", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("role-remove404-admin");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove from non-existent user
			const removeRequest: RemoveRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "admin:invite_users",
			};
			const response = await api.removeRole(sessionToken, removeRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const targetEmail = generateTestAdminEmail("role-remove-noauth");

		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const response = await api.removeRoleWithoutAuth(removeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(targetEmail);
		}
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const targetEmail = generateTestAdminEmail("role-remove-bad");

		const { userId: targetUserId } = await createTestAdminUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			const removeRequest: RemoveRoleRequest = {
				target_user_id: targetUserId,
				role_name: "admin:invite_users",
			};
			const response = await api.removeRole("invalid-token", removeRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(targetEmail);
		}
	});
});
