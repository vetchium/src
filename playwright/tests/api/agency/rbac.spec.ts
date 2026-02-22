import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	createTestAgencyAdminDirect,
	createTestAgencyUserDirect,
	deleteTestAgencyUser,
	generateTestAgencyEmail,
	assignRoleToAgencyUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyInviteUserRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("Agency Portal RBAC Tests", () => {
	test.describe("superadmin role bypass pattern", () => {
		test("Agency admin (superadmin role) can invite users without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			try {
				// Login admin
				const loginReq: AgencyLoginRequest = {
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
				const inviteReq: AgencyInviteUserRequest = {
					email_address: newUserEmail,
					roles: ["agency:manage_users"],
				};

				const response = await api.inviteUser(adminToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Regular user WITH agency:manage_users role can invite users", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user with role
			const userWithRoleEmail = `user-with-role@${domain}`;
			const userResult = await createTestAgencyUserDirect(
				userWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);
			await assignRoleToAgencyUser(
				userResult.agencyUserId,
				"agency:manage_users"
			);

			try {
				// Login user with role
				const loginReq: AgencyLoginRequest = {
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
				const inviteReq: AgencyInviteUserRequest = {
					email_address: newUserEmail,
					roles: ["agency:manage_users"],
				};

				const response = await api.inviteUser(userToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Regular user WITHOUT agency:manage_users role gets 403 when inviting", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user WITHOUT role
			const userWithoutRoleEmail = `user-without-role@${domain}`;
			await createTestAgencyUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			try {
				// Login user without role
				const loginReq: AgencyLoginRequest = {
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
				const inviteReq: AgencyInviteUserRequest = {
					email_address: newUserEmail,
					roles: ["agency:manage_users"],
				};

				const response = await api.inviteUser(userToken, inviteReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Agency admin (superadmin role) can assign roles without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestAgencyUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			try {
				// Login admin
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:manage_users",
				};

				const response = await api.assignRole(adminToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Regular user WITH agency:manage_users role can assign roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create manager user with agency:manage_users role
			const managerEmail = `manager-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const managerResult = await createTestAgencyUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);
			await assignRoleToAgencyUser(
				managerResult.agencyUserId,
				"agency:manage_users"
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestAgencyUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			try {
				// Login manager
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:manage_users",
				};

				const response = await api.assignRole(managerToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Regular user WITHOUT agency:manage_users role gets 403 when assigning roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create regular user WITHOUT role
			const userWithoutRoleEmail = `user-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			await createTestAgencyUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			// Create target user
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestAgencyUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			try {
				// Login user without role
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:manage_users",
				};

				const response = await api.assignRole(userToken, assignReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Agency admin (superadmin role) can remove roles without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create target user with a role
			const targetEmail = `target-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const targetResult = await createTestAgencyUserDirect(
				targetEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);
			await assignRoleToAgencyUser(
				targetResult.agencyUserId,
				"agency:manage_users"
			);

			try {
				// Login admin
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:manage_users",
				};

				const response = await api.removeRole(adminToken, removeReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Regular user WITHOUT agency:manage_users role gets 403 when removing roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency admin
			const domain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			const adminEmail = `admin@${domain}`;
			const adminResult = await createTestAgencyAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Create user with role
			const userWithRoleEmail = `user-with-role-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const userWithRoleResult = await createTestAgencyUserDirect(
				userWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);
			await assignRoleToAgencyUser(
				userWithRoleResult.agencyUserId,
				"agency:manage_users"
			);

			// Create regular user WITHOUT manage_users role
			const userWithoutRoleEmail = `user-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			await createTestAgencyUserDirect(
				userWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: adminResult.agencyId,
				}
			);

			try {
				// Login user without role
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: userWithRoleResult.agencyUserId,
					role_name: "agency:manage_users",
				};

				const response = await api.removeRole(userToken, removeReq);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});
	});

	test.describe("Auth-only endpoints (no RBAC)", () => {
		test("Any authenticated agency user can change their password", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency user
			const userData = generateTestAgencyEmail("rbac-auth-only");
			const adminEmail = `admin@${userData.domain}`;
			await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const agencyUserEmail = adminEmail;
			const agencyUserDomain = userData.domain;

			try {
				// Login
				const loginReq: AgencyLoginRequest = {
					email: agencyUserEmail,
					domain: agencyUserDomain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(agencyUserEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const agencyUserToken = tfaRes.body!.session_token;

				// Change password
				const response = await api.changePassword(agencyUserToken, {
					current_password: TEST_PASSWORD,
					new_password: "NewPassword123$",
				});
				expect(response.status).toBe(200);

				// Change it back
				const revertResponse = await api.changePassword(agencyUserToken, {
					current_password: "NewPassword123$",
					new_password: TEST_PASSWORD,
				});
				expect(revertResponse.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Any authenticated agency user can set their language", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency user
			const userData = generateTestAgencyEmail("rbac-auth-lang");
			const adminEmail = `admin@${userData.domain}`;
			await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const agencyUserEmail = adminEmail;
			const agencyUserDomain = userData.domain;

			try {
				// Login
				const loginReq: AgencyLoginRequest = {
					email: agencyUserEmail,
					domain: agencyUserDomain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(agencyUserEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const agencyUserToken = tfaRes.body!.session_token;

				// Set language
				const response = await api.setLanguage(agencyUserToken, {
					language: "de-DE",
				});
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(adminEmail);
			}
		});

		test("Any authenticated agency user can logout", async ({ request }) => {
			const api = new AgencyAPIClient(request);

			// Create unique agency user
			const userData = generateTestAgencyEmail("rbac-auth-logout");
			const adminEmail = `admin@${userData.domain}`;
			await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD, "ind1");

			const agencyUserEmail = adminEmail;
			const agencyUserDomain = userData.domain;

			try {
				// Login
				const loginReq: AgencyLoginRequest = {
					email: agencyUserEmail,
					domain: agencyUserDomain,
					password: TEST_PASSWORD,
				};
				await deleteEmailsFor(loginReq.email);
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(agencyUserEmail);
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
				await deleteTestAgencyUser(adminEmail);
			}
		});
	});

	test.describe("Unauthenticated requests", () => {
		test("Unauthenticated request to invite user returns 401", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);
			const newUserData = generateTestAgencyEmail("unauth-invite");

			const inviteReq: AgencyInviteUserRequest = {
				email_address: newUserData.email,
				roles: ["agency:manage_users"],
			};

			const response = await api.inviteUserWithoutAuth(inviteReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to assign role returns 401", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const assignReq = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "agency:manage_users",
			};

			const response = await api.assignRoleWithoutAuth(assignReq);
			expect(response.status).toBe(401);
		});

		test("Unauthenticated request to remove role returns 401", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const removeReq = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "agency:manage_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
