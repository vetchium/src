import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminLoginRequest,
	AdminInviteUserRequest,
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/admin/admin-users";

test.describe("Admin Portal RBAC Tests", () => {
	test.describe("Pure RBAC - No IsAdmin bypass", () => {
		let adminWithRoleEmail: string;
		let adminWithRoleId: string;
		let adminWithRoleToken: string;

		let adminWithoutRoleEmail: string;
		let adminWithoutRoleId: string;
		let adminWithoutRoleToken: string;

		test.beforeAll(async ({ request }) => {
			const api = new AdminAPIClient(request);

			// Create admin user WITH admin:manage_users role
			adminWithRoleEmail = generateTestEmail("rbac-with-role");
			adminWithRoleId = await createTestAdminUser(
				adminWithRoleEmail,
				TEST_PASSWORD
			);
			await assignRoleToAdminUser(adminWithRoleId, "admin:manage_users");

			// Login admin with role
			const loginReq1: AdminLoginRequest = {
				email: adminWithRoleEmail,
				password: TEST_PASSWORD,
			};
			const loginRes1 = await api.login(loginReq1);
			expect(loginRes1.status).toBe(200);

			const tfaCode1 = await getTfaCodeFromEmail(adminWithRoleEmail);
			const tfaRes1 = await api.verifyTFA({
				tfa_token: loginRes1.body!.tfa_token,
				tfa_code: tfaCode1,
			});
			expect(tfaRes1.status).toBe(200);
			adminWithRoleToken = tfaRes1.body!.session_token;

			// Create admin user WITHOUT admin:manage_users role
			adminWithoutRoleEmail = generateTestEmail("rbac-without-role");
			adminWithoutRoleId = await createTestAdminUser(
				adminWithoutRoleEmail,
				TEST_PASSWORD
			);

			// Login admin without role
			const loginReq2: AdminLoginRequest = {
				email: adminWithoutRoleEmail,
				password: TEST_PASSWORD,
			};
			const loginRes2 = await api.login(loginReq2);
			expect(loginRes2.status).toBe(200);

			const tfaCode2 = await getTfaCodeFromEmail(adminWithoutRoleEmail);
			const tfaRes2 = await api.verifyTFA({
				tfa_token: loginRes2.body!.tfa_token,
				tfa_code: tfaCode2,
			});
			expect(tfaRes2.status).toBe(200);
			adminWithoutRoleToken = tfaRes2.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestAdminUser(adminWithRoleEmail);
			await deleteTestAdminUser(adminWithoutRoleEmail);
		});

		test("Admin WITH admin:manage_users role can invite users", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const newAdminEmail = generateTestEmail("invited-by-role");

			try {
				const inviteReq: AdminInviteUserRequest = {
					email_address: newAdminEmail,
					full_name: "Invited Admin",
				};

				const response = await api.inviteUser(adminWithRoleToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestAdminUser(newAdminEmail);
			}
		});

		test("Admin WITHOUT admin:manage_users role gets 403 when inviting users", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const newAdminEmail = generateTestEmail("invite-attempt");

			const inviteReq: AdminInviteUserRequest = {
				email_address: newAdminEmail,
				full_name: "Invited Admin",
			};

			const response = await api.inviteUser(adminWithoutRoleToken, inviteReq);
			expect(response.status).toBe(403);
		});

		test("Admin WITH admin:manage_users role can assign roles", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			// Create an admin with admin:manage_users role
			const adminEmail = generateTestEmail("rbac-manager");
			const adminId = await createTestAdminUser(adminEmail, TEST_PASSWORD);
			await assignRoleToAdminUser(adminId, "admin:manage_users");

			try {
				// Login
				const loginReq: AdminLoginRequest = {
					email: adminEmail,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(adminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
				});
				expect(tfaRes.status).toBe(200);
				const sessionToken = tfaRes.body!.session_token;

				// Try to assign a role to another admin
				const assignReq: AssignRoleRequest = {
					target_user_id: adminWithoutRoleId,
					role_name: "admin:manage_users",
				};

				const response = await api.assignRole(sessionToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
			}
		});

		test("Admin WITHOUT admin:manage_users role gets 403 when assigning roles", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			// Try to assign a role using admin without admin:manage_users role
			const assignReq: AssignRoleRequest = {
				target_user_id: adminWithRoleId,
				role_name: "admin:manage_users",
			};

			const response = await api.assignRole(adminWithoutRoleToken, assignReq);
			expect(response.status).toBe(403);
		});

		test("Admin WITH admin:manage_users role can remove roles", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			// Create an admin with admin:manage_users role
			const adminEmail = generateTestEmail("rbac-remover");
			const adminId = await createTestAdminUser(adminEmail, TEST_PASSWORD);
			await assignRoleToAdminUser(adminId, "admin:manage_users");

			// Create a target admin with a role to remove
			const targetEmail = generateTestEmail("rbac-target");
			const targetId = await createTestAdminUser(targetEmail, TEST_PASSWORD);
			await assignRoleToAdminUser(targetId, "admin:manage_users");

			try {
				// Login
				const loginReq: AdminLoginRequest = {
					email: adminEmail,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(adminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
				});
				expect(tfaRes.status).toBe(200);
				const sessionToken = tfaRes.body!.session_token;

				// Try to remove a role
				const removeReq: RemoveRoleRequest = {
					target_user_id: targetId,
					role_name: "admin:manage_users",
				};

				const response = await api.removeRole(sessionToken, removeReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAdminUser(adminEmail);
				await deleteTestAdminUser(targetEmail);
			}
		});

		test("Admin WITHOUT admin:manage_users role gets 403 when removing roles", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			// Try to remove a role using admin without admin:manage_users role
			const removeReq: RemoveRoleRequest = {
				target_user_id: adminWithRoleId,
				role_name: "admin:manage_users",
			};

			const response = await api.removeRole(adminWithoutRoleToken, removeReq);
			expect(response.status).toBe(403);
		});
	});

	test.describe("Auth-only endpoints (no RBAC)", () => {
		let adminEmail: string;
		let adminToken: string;

		test.beforeAll(async ({ request }) => {
			const api = new AdminAPIClient(request);

			// Create a regular admin user without any special roles
			adminEmail = generateTestEmail("rbac-auth-only");
			await createTestAdminUser(adminEmail, TEST_PASSWORD);

			// Login
			const loginReq: AdminLoginRequest = {
				email: adminEmail,
				password: TEST_PASSWORD,
			};
			const loginRes = await api.login(loginReq);
			expect(loginRes.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body!.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaRes.status).toBe(200);
			adminToken = tfaRes.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestAdminUser(adminEmail);
		});

		test("Any authenticated admin can list approved domains", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			const response = await api.listApprovedDomains(adminToken);
			expect(response.status).toBe(200);
		});

		test("Any authenticated admin can change their own password", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			const response = await api.changePassword(adminToken, {
				current_password: TEST_PASSWORD,
				new_password: "NewPassword123$",
			});
			expect(response.status).toBe(200);

			// Change it back
			const revertResponse = await api.changePassword(adminToken, {
				current_password: "NewPassword123$",
				new_password: TEST_PASSWORD,
			});
			expect(revertResponse.status).toBe(200);
		});

		test("Any authenticated admin can set their language preference", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			const response = await api.setLanguage(adminToken, {
				language: "de-DE",
			});
			expect(response.status).toBe(200);
		});

		test("Any authenticated admin can logout", async ({ request }) => {
			const api = new AdminAPIClient(request);

			// Create a new admin just for logout test
			const logoutAdminEmail = generateTestEmail("rbac-logout");
			await createTestAdminUser(logoutAdminEmail, TEST_PASSWORD);

			try {
				// Login
				const loginReq: AdminLoginRequest = {
					email: logoutAdminEmail,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(logoutAdminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
				});
				expect(tfaRes.status).toBe(200);
				const tempToken = tfaRes.body!.session_token;

				// Logout
				const response = await api.logout(tempToken);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAdminUser(logoutAdminEmail);
			}
		});
	});

	test.describe("Unauthenticated requests", () => {
		test("Unauthenticated request to invite user returns 401", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const newAdminEmail = generateTestEmail("unauth-invite");

			const inviteReq: AdminInviteUserRequest = {
				email_address: newAdminEmail,
				full_name: "Invited Admin",
			};

			const response = await api.inviteUserWithoutAuth(inviteReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to assign role returns 401", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			const assignReq: AssignRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "admin:manage_users",
			};

			const response = await api.assignRoleWithoutAuth(assignReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to remove role returns 401", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);

			const removeReq: RemoveRoleRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "admin:manage_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
