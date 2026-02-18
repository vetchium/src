import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgInviteUserRequest,
} from "vetchium-specs/employer/employer-users";

test.describe("Org Portal RBAC Tests", () => {
	test.describe("superadmin role bypass pattern", () => {
		test("Org admin (superadmin role) can invite users without specific role", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			try {
				// Login admin
				const loginReq: OrgLoginRequest = {
					email: adminEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(adminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const adminToken = tfaRes.body!.session_token;

				// Invite user
				const newUserEmail = `invited-${crypto.randomUUID().substring(0, 8)}@${domain}`;
				const inviteReq: OrgInviteUserRequest = {
					email_address: newUserEmail,
					full_name: "Invited User",
				};

				const response = await api.inviteUser(adminToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITH employer:invite_users role can invite users", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user with role
			const userWithRoleEmail = `user-with-role@${domain}`;
			const userResult = await createTestOrgUserDirect(
				userWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);
			await assignRoleToOrgUser(userResult.orgUserId, "employer:invite_users");

			try {
				// Login user with role
				const loginReq: OrgLoginRequest = {
					email: userWithRoleEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(userWithRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const userToken = tfaRes.body!.session_token;

				// Invite user
				const newUserEmail = `invited-${crypto.randomUUID().substring(0, 8)}@${domain}`;
				const inviteReq: OrgInviteUserRequest = {
					email_address: newUserEmail,
					full_name: "Invited User",
				};

				const response = await api.inviteUser(userToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITHOUT employer:invite_users role gets 403 when inviting", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user WITHOUT role
			const userWithoutRoleEmail = `user-without-role@${domain}`;
			await createTestOrgUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			try {
				// Login user without role
				const loginReq: OrgLoginRequest = {
					email: userWithoutRoleEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(userWithoutRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const userToken = tfaRes.body!.session_token;

				// Try to invite user
				const newUserEmail = `invited-${crypto.randomUUID().substring(0, 8)}@${domain}`;
				const inviteReq: OrgInviteUserRequest = {
					email_address: newUserEmail,
					full_name: "Invited User",
				};

				const response = await api.inviteUser(userToken, inviteReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Org admin (superadmin role) can assign roles without specific role", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestOrgUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			try {
				// Login admin
				const loginReq: OrgLoginRequest = {
					email: adminEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(adminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const adminToken = tfaRes.body!.session_token;

				// Assign role
				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(adminToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITH employer:manage_users role can assign roles", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create manager user with employer:manage_users role
			const managerEmail = `manager-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const managerResult = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);
			await assignRoleToOrgUser(
				managerResult.orgUserId,
				"employer:manage_users"
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestOrgUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			try {
				// Login manager
				const loginReq: OrgLoginRequest = {
					email: managerEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(managerEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const managerToken = tfaRes.body!.session_token;

				// Assign role
				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(managerToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITHOUT employer:manage_users role gets 403 when assigning roles", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user WITHOUT role
			const userWithoutRoleEmail = `user-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			await createTestOrgUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestOrgUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			try {
				// Login user without role
				const loginReq: OrgLoginRequest = {
					email: userWithoutRoleEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(userWithoutRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const userToken = tfaRes.body!.session_token;

				// Try to assign role
				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(userToken, assignReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Org admin (superadmin role) can remove roles without specific role", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create target user with a role
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestOrgUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);
			await assignRoleToOrgUser(
				targetResult.orgUserId,
				"employer:invite_users"
			);

			try {
				// Login admin
				const loginReq: OrgLoginRequest = {
					email: adminEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(adminEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const adminToken = tfaRes.body!.session_token;

				// Remove role
				const removeReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.removeRole(adminToken, removeReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITHOUT employer:manage_users role gets 403 when removing roles", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org admin
			const domain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create user with role
			const userWithRoleEmail = `user-with-role-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const userWithRoleResult = await createTestOrgUserDirect(
				userWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);
			await assignRoleToOrgUser(
				userWithRoleResult.orgUserId,
				"employer:invite_users"
			);

			// Create regular user WITHOUT manage_users role
			const userWithoutRoleEmail = `user-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			await createTestOrgUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
				}
			);

			try {
				// Login user without role
				const loginReq: OrgLoginRequest = {
					email: userWithoutRoleEmail,
					domain: domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(userWithoutRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: true,
				});
				expect(tfaRes.status).toBe(200);
				const userToken = tfaRes.body!.session_token;

				// Try to remove role
				const removeReq = {
					target_user_id: userWithRoleResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.removeRole(userToken, removeReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	test.describe("Auth-only endpoints (no RBAC)", () => {
		test("Any authenticated org user can change their password", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org user
			const userData = generateTestOrgEmail("rbac-auth-only");
			const adminEmail = `admin@${userData.domain}`;
			await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const orgUserEmail = adminEmail;
			const orgUserDomain = userData.domain;

			try {
				// Login
				const loginReq: OrgLoginRequest = {
					email: orgUserEmail,
					domain: orgUserDomain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(orgUserEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const orgUserToken = tfaRes.body!.session_token;

				// Change password
				const response = await api.changePassword(orgUserToken, {
					current_password: TEST_PASSWORD,
					new_password: "NewPassword123$",
				});
				expect(response.status).toBe(200);

				// Change it back
				const revertResponse = await api.changePassword(orgUserToken, {
					current_password: "NewPassword123$",
					new_password: TEST_PASSWORD,
				});
				expect(revertResponse.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Any authenticated org user can set their language", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			// Create unique org user
			const userData = generateTestOrgEmail("rbac-auth-lang");
			const adminEmail = `admin@${userData.domain}`;
			await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const orgUserEmail = adminEmail;
			const orgUserDomain = userData.domain;

			try {
				// Login
				const loginReq: OrgLoginRequest = {
					email: orgUserEmail,
					domain: orgUserDomain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(orgUserEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const orgUserToken = tfaRes.body!.session_token;

				// Set language
				const response = await api.setLanguage(orgUserToken, {
					language: "de-DE",
				});
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Any authenticated org user can logout", async ({ request }) => {
			const api = new EmployerAPIClient(request);

			// Create unique org user
			const userData = generateTestOrgEmail("rbac-auth-logout");
			const adminEmail = `admin@${userData.domain}`;
			await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const orgUserEmail = adminEmail;
			const orgUserDomain = userData.domain;

			try {
				// Login
				const loginReq: OrgLoginRequest = {
					email: orgUserEmail,
					domain: orgUserDomain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(orgUserEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const tempToken = tfaRes.body!.session_token;

				// Logout
				const response = await api.logout(tempToken);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	test.describe("Unauthenticated requests", () => {
		test("Unauthenticated request to invite user returns 401", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const newUserData = generateTestOrgEmail("unauth-invite");

			const inviteReq: OrgInviteUserRequest = {
				email_address: newUserData.email,
				full_name: "Test User",
			};

			const response = await api.inviteUserWithoutAuth(inviteReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to assign role returns 401", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			const assignReq = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "employer:invite_users",
			};

			const response = await api.assignRoleWithoutAuth(assignReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to remove role returns 401", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);

			const removeReq = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "employer:invite_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
