import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
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
} from "vetchium-specs/org/org-users";

test.describe("Org Portal RBAC Tests", () => {
	test.describe("IsAdmin OR role bypass pattern", () => {
		let orgAdminEmail: string;
		let orgAdminDomain: string;
		let orgAdminToken: string;

		let regularUserWithRoleEmail: string;
		let regularUserWithRoleDomain: string;
		let regularUserWithRoleId: string;
		let regularUserWithRoleToken: string;

		let regularUserWithoutRoleEmail: string;
		let regularUserWithoutRoleDomain: string;
		let regularUserWithoutRoleToken: string;

		let employerId: string;

		test.beforeAll(async ({ request }) => {
			const api = new OrgAPIClient(request);

			// Create org ADMIN user (is_admin=TRUE) - this will create the employer and domain
			const sharedDomain = `rbac-org-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			orgAdminEmail = `admin@${sharedDomain}`;
			orgAdminDomain = sharedDomain;
			const adminResult = await createTestOrgAdminDirect(
				orgAdminEmail,
				TEST_PASSWORD,
				"ind1"
			);
			employerId = adminResult.employerId;

			// Login admin
			const loginReq1: OrgLoginRequest = {
				email: orgAdminEmail,
				domain: orgAdminDomain,
				password: TEST_PASSWORD,
			};
			const loginRes1 = await api.login(loginReq1);
			expect(loginRes1.status).toBe(200);

			const tfaCode1 = await getTfaCodeFromEmail(orgAdminEmail);
			const tfaRes1 = await api.verifyTFA({
				tfa_token: loginRes1.body!.tfa_token,
				tfa_code: tfaCode1,
				remember_me: true,
			});
			expect(tfaRes1.status).toBe(200);
			orgAdminToken = tfaRes1.body!.session_token;

			// Create regular user WITH employer:invite_users role (is_admin=FALSE) - same domain
			regularUserWithRoleEmail = `user-with-role@${sharedDomain}`;
			regularUserWithRoleDomain = sharedDomain;
			const result1 = await createTestOrgUserDirect(
				regularUserWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);
			regularUserWithRoleId = result1.orgUserId;
			await assignRoleToOrgUser(regularUserWithRoleId, "employer:invite_users");

			// Login user with role
			const loginReq: OrgLoginRequest = {
				email: regularUserWithRoleEmail,
				domain: regularUserWithRoleDomain,
				password: TEST_PASSWORD,
			};
			await deleteEmailsFor(loginReq.email);
			const loginRes = await api.login(loginReq);
			expect(loginRes.status).toBe(200);

			const tfaCode2 = await getTfaCodeFromEmail(regularUserWithRoleEmail);
			const tfaRes2 = await api.verifyTFA({
				tfa_token: loginRes.body!.tfa_token,
				tfa_code: tfaCode2,
				remember_me: true,
			});
			expect(tfaRes2.status).toBe(200);
			regularUserWithRoleToken = tfaRes2.body!.session_token;

			// Create regular user WITHOUT employer:invite_users role (is_admin=FALSE) - same domain
			regularUserWithoutRoleEmail = `user-without-role@${sharedDomain}`;
			regularUserWithoutRoleDomain = sharedDomain;
			await createTestOrgUserDirect(
				regularUserWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);

			// Login user without role
			const loginReq3: OrgLoginRequest = {
				email: regularUserWithoutRoleEmail,
				domain: regularUserWithoutRoleDomain,
				password: TEST_PASSWORD,
			};
			const loginRes3 = await api.login(loginReq3);
			expect(loginRes3.status).toBe(200);

			const tfaCode3 = await getTfaCodeFromEmail(regularUserWithoutRoleEmail);
			const tfaRes3 = await api.verifyTFA({
				tfa_token: loginRes3.body!.tfa_token,
				tfa_code: tfaCode3,
				remember_me: true,
			});
			expect(tfaRes3.status).toBe(200);
			regularUserWithoutRoleToken = tfaRes3.body!.session_token;
		});

		test.afterAll(async () => {
			if (orgAdminEmail) await deleteTestOrgUser(orgAdminEmail);
			if (regularUserWithRoleEmail)
				await deleteTestOrgUser(regularUserWithRoleEmail);
			if (regularUserWithoutRoleEmail)
				await deleteTestOrgUser(regularUserWithoutRoleEmail);
		});

		test("Org admin (IsAdmin=TRUE) can invite users without specific role", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const newUserData = generateTestOrgEmail("invited-by-admin");

			try {
				const inviteReq: OrgInviteUserRequest = {
					email_address: newUserData.email,
					full_name: "Invited User",
				};

				const response = await api.inviteUser(orgAdminToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				// Note: invited users need to complete setup before they exist, so no cleanup needed
			}
		});

		test("Regular user WITH employer:invite_users role can invite users", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const newUserData = generateTestOrgEmail("invited-by-role");

			const inviteReq: OrgInviteUserRequest = {
				email_address: newUserData.email,
				full_name: "Invited User",
			};

			const response = await api.inviteUser(
				regularUserWithRoleToken,
				inviteReq
			);
			expect(response.status).toBe(201);
		});

		test("Regular user WITHOUT employer:invite_users role gets 403 when inviting", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const newUserData = generateTestOrgEmail("invite-attempt");

			const inviteReq: OrgInviteUserRequest = {
				email_address: newUserData.email,
				full_name: "Invited User",
			};

			const response = await api.inviteUser(
				regularUserWithoutRoleToken,
				inviteReq
			);
			expect(response.status).toBe(403);
		});

		test("Org admin (IsAdmin=TRUE) can assign roles without specific role", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Create a target user
			const targetData = generateTestOrgEmail("rbac-target-assign");
			const targetResult = await createTestOrgUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);

			try {
				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(orgAdminToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(targetData.email);
			}
		});

		test("Regular user WITH employer:manage_users role can assign roles", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Create a user with employer:manage_users role
			const managerData = generateTestOrgEmail("rbac-manager");
			const managerResult = await createTestOrgUserDirect(
				managerData.email,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);
			await assignRoleToOrgUser(
				managerResult.orgUserId,
				"employer:manage_users"
			);

			// Create a target user
			const targetData = generateTestOrgEmail("rbac-target-assign2");
			const targetResult = await createTestOrgUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
					domain: orgAdminDomain,
				}
			);

			try {
				// Login manager
				const loginReq: OrgLoginRequest = {
					email: managerData.email,
					domain: managerData.domain,
					password: TEST_PASSWORD,
				};
				const loginRes = await api.login(loginReq);
				expect(loginRes.status).toBe(200);

				const tfaCode = await getTfaCodeFromEmail(managerData.email);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				expect(tfaRes.status).toBe(200);
				const managerToken = tfaRes.body!.session_token;

				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(managerToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(managerData.email);
				await deleteTestOrgUser(targetData.email);
			}
		});

		test("Regular user WITHOUT employer:manage_users role gets 403 when assigning roles", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Create a target user
			const targetData = generateTestOrgEmail("rbac-target-assign3");
			const targetResult = await createTestOrgUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);

			try {
				const assignReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.assignRole(
					regularUserWithoutRoleToken,
					assignReq
				);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestOrgUser(targetData.email);
			}
		});

		test("Org admin (IsAdmin=TRUE) can remove roles without specific role", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Create a target user with a role
			const targetData = generateTestOrgEmail("rbac-target-remove");
			const targetResult = await createTestOrgUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: employerId,
				}
			);
			await assignRoleToOrgUser(
				targetResult.orgUserId,
				"employer:invite_users"
			);

			try {
				const removeReq = {
					target_user_id: targetResult.orgUserId,
					role_name: "employer:invite_users",
				};

				const response = await api.removeRole(orgAdminToken, removeReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestOrgUser(targetData.email);
			}
		});

		test("Regular user WITHOUT employer:manage_users role gets 403 when removing roles", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			const removeReq = {
				target_user_id: regularUserWithRoleId,
				role_name: "employer:invite_users",
			};

			const response = await api.removeRole(
				regularUserWithoutRoleToken,
				removeReq
			);
			expect(response.status).toBe(403);
		});
	});

	test.describe("Auth-only endpoints (no RBAC)", () => {
		let orgUserEmail: string;
		let orgUserDomain: string;
		let orgUserToken: string;

		test.beforeAll(async ({ request }) => {
			const api = new OrgAPIClient(request);

			// Create a regular org user without any special roles
			const userData = generateTestOrgEmail("rbac-auth-only");
			orgUserEmail = userData.email;
			orgUserDomain = userData.domain;
			await createTestOrgUserDirect(orgUserEmail, TEST_PASSWORD);

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
			orgUserToken = tfaRes.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestOrgUser(orgUserEmail);
		});

		test("Any authenticated org user can change their password", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

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
		});

		test("Any authenticated org user can set their language", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			const response = await api.setLanguage(orgUserToken, {
				language: "de-DE",
			});
			expect(response.status).toBe(200);
		});

		test("Any authenticated org user can logout", async ({ request }) => {
			const api = new OrgAPIClient(request);

			// Create another session to logout
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

			const response = await api.logout(tempToken);
			expect(response.status).toBe(200);
		});
	});

	test.describe("Unauthenticated requests", () => {
		test("Unauthenticated request to invite user returns 401", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

			const removeReq = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
				role_name: "employer:invite_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
