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
	test.describe("IsAdmin OR role bypass pattern", () => {
		let agencyAdminEmail: string;
		let agencyAdminDomain: string;
		let agencyAdminToken: string = "";

		let regularUserWithRoleEmail: string;
		let regularUserWithRoleDomain: string;
		let regularUserWithRoleId: string;
		let regularUserWithRoleToken: string = "";

		let regularUserWithoutRoleEmail: string;
		let regularUserWithoutRoleDomain: string;
		let regularUserWithoutRoleToken: string;

		let agencyId: string;

		test.beforeAll(async ({ request }) => {
			const api = new AgencyAPIClient(request);

			// Create agency ADMIN user (is_admin=TRUE) - this will create the agency
			const sharedDomain = `rbac-agency-${crypto.randomUUID().substring(0, 8)}.test.vetchium.com`;
			agencyAdminEmail = `admin@${sharedDomain}`;
			agencyAdminDomain = sharedDomain;
			const adminResult = await createTestAgencyAdminDirect(
				agencyAdminEmail,
				TEST_PASSWORD,
				"ind1"
			);
			agencyId = adminResult.agencyId;
			agencyId = adminResult.agencyId;
			agencyId = adminResult.agencyId;
			const loginReq1: AgencyLoginRequest = {
				email: agencyAdminEmail,
				domain: agencyAdminDomain,
				password: TEST_PASSWORD,
			};
			const loginRes1 = await api.login(loginReq1);
			expect(loginRes1.status).toBe(200);

			const tfaCode1 = await getTfaCodeFromEmail(agencyAdminEmail);
			const tfaRes1 = await api.verifyTFA({
				tfa_token: loginRes1.body!.tfa_token,
				tfa_code: tfaCode1,
				remember_me: true,
			});
			expect(tfaRes1.status).toBe(200);
			agencyAdminToken = tfaRes1.body!.session_token;

			regularUserWithRoleEmail = `user-with-role@${sharedDomain}`;
			regularUserWithRoleDomain = sharedDomain;
			regularUserWithRoleDomain = sharedDomain;
			regularUserWithRoleDomain = sharedDomain;
			const result1 = await createTestAgencyUserDirect(
				regularUserWithRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
				}
			);
			regularUserWithRoleId = result1.agencyUserId;
			await assignRoleToAgencyUser(
				regularUserWithRoleId,
				"agency:invite_users"
			);

			// Login user with role
			const loginReq2: AgencyLoginRequest = {
				email: regularUserWithRoleEmail,
				domain: regularUserWithRoleDomain,
				password: TEST_PASSWORD,
			};
			await deleteEmailsFor(loginReq2.email);
			const loginRes2 = await api.login(loginReq2);
			expect(loginRes2.status).toBe(200);

			const tfaCode2 = await getTfaCodeFromEmail(regularUserWithRoleEmail);
			const tfaRes2 = await api.verifyTFA({
				tfa_token: loginRes2.body!.tfa_token,
				tfa_code: tfaCode2,
				remember_me: true,
			});
			expect(tfaRes2.status).toBe(200);
			regularUserWithoutRoleEmail = `user-without-role@${sharedDomain}`;
			regularUserWithoutRoleDomain = sharedDomain;
			await createTestAgencyUserDirect(
				regularUserWithoutRoleEmail,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
				}
			);

			// Login user without role
			const loginReq3: AgencyLoginRequest = {
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
			if (agencyAdminEmail) await deleteTestAgencyUser(agencyAdminEmail);
			if (regularUserWithRoleEmail)
				await deleteTestAgencyUser(regularUserWithRoleEmail);
			if (regularUserWithoutRoleEmail)
				await deleteTestAgencyUser(regularUserWithoutRoleEmail);
		});

		test("Agency admin (IsAdmin=TRUE) can invite users without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);
			const newUserData = generateTestAgencyEmail("invited-by-admin");

			try {
				const inviteReq: AgencyInviteUserRequest = {
					email_address: newUserData.email,
					full_name: "Invited User",
				};

				const response = await api.inviteUser(agencyAdminToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				// Note: invited users need to complete setup before they exist, so no cleanup needed
			}
		});

		test("Regular user WITH agency:invite_users role can invite users", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);
			const newUserData = generateTestAgencyEmail("invited-by-role");

			const inviteReq: AgencyInviteUserRequest = {
				email_address: newUserData.email,
				full_name: "Invited User",
			};

			const response = await api.inviteUser(
				regularUserWithRoleToken,
				inviteReq
			);
			expect(response.status).toBe(201);
		});

		test("Regular user WITHOUT agency:invite_users role gets 403 when inviting", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);
			const newUserData = generateTestAgencyEmail("invite-attempt");

			const inviteReq: AgencyInviteUserRequest = {
				email_address: newUserData.email,
				full_name: "Invited User",
			};

			const response = await api.inviteUser(
				regularUserWithoutRoleToken,
				inviteReq
			);
			expect(response.status).toBe(403);
		});

		test("Agency admin (IsAdmin=TRUE) can assign roles without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create a target user
			const targetData = generateTestAgencyEmail("rbac-target-assign");
			const targetResult = await createTestAgencyUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
				}
			);

			try {
				const assignReq = {
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:invite_users",
				};

				const response = await api.assignRole(agencyAdminToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(targetData.email);
			}
		});

		test("Regular user WITH agency:manage_users role can assign roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create a user with agency:manage_users role
			const managerData = generateTestAgencyEmail("rbac-manager");
			const managerResult = await createTestAgencyUserDirect(
				managerData.email,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
					domain: agencyAdminDomain,
				}
			);
			await assignRoleToAgencyUser(
				managerResult.agencyUserId,
				"agency:manage_users"
			);

			// Create a target user
			const targetData = generateTestAgencyEmail("rbac-target-assign2");
			const targetResult = await createTestAgencyUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
					domain: agencyAdminDomain,
				}
			);

			try {
				// Login manager
				const loginReq: AgencyLoginRequest = {
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
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:invite_users",
				};

				const response = await api.assignRole(managerToken, assignReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(managerData.email);
				await deleteTestAgencyUser(targetData.email);
			}
		});

		test("Regular user WITHOUT agency:manage_users role gets 403 when assigning roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create a target user
			const targetData = generateTestAgencyEmail("rbac-target-assign3");
			const targetResult = await createTestAgencyUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
				}
			);

			try {
				const assignReq = {
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:invite_users",
				};

				const response = await api.assignRole(
					regularUserWithoutRoleToken,
					assignReq
				);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestAgencyUser(targetData.email);
			}
		});

		test("Agency admin (IsAdmin=TRUE) can remove roles without specific role", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Create a target user with a role
			const targetData = generateTestAgencyEmail("rbac-target-remove");
			const targetResult = await createTestAgencyUserDirect(
				targetData.email,
				TEST_PASSWORD,
				"ind1",
				{
					agencyId: agencyId,
				}
			);
			await assignRoleToAgencyUser(
				targetResult.agencyUserId,
				"agency:invite_users"
			);

			try {
				const removeReq = {
					target_user_id: targetResult.agencyUserId,
					role_name: "agency:invite_users",
				};

				const response = await api.removeRole(agencyAdminToken, removeReq);
				expect(response.status).toBe(200);
			} finally {
				await deleteTestAgencyUser(targetData.email);
			}
		});

		test("Regular user WITHOUT agency:manage_users role gets 403 when removing roles", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const removeReq = {
				target_user_id: regularUserWithRoleId,
				role_name: "agency:invite_users",
			};

			const response = await api.removeRole(
				regularUserWithoutRoleToken,
				removeReq
			);
			expect(response.status).toBe(403);
		});
	});

	test.describe("Auth-only endpoints (no RBAC)", () => {
		let agencyUserEmail: string;
		let agencyUserDomain: string;
		let agencyUserToken: string;

		test.beforeAll(async ({ request }) => {
			const api = new AgencyAPIClient(request);

			// Create a regular agency user without any special roles
			const userData = generateTestAgencyEmail("rbac-auth-only");
			agencyUserEmail = userData.email;
			agencyUserDomain = userData.domain;
			await createTestAgencyUserDirect(agencyUserEmail, TEST_PASSWORD);

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
			agencyUserToken = tfaRes.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestAgencyUser(agencyUserEmail);
		});

		test("Any authenticated agency user can change their password", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

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
		});

		test("Any authenticated agency user can set their language", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.setLanguage(agencyUserToken, {
				language: "de-DE",
			});
			expect(response.status).toBe(200);
		});

		test("Any authenticated agency user can logout", async ({ request }) => {
			const api = new AgencyAPIClient(request);

			// Create another session to logout
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

			const response = await api.logout(tempToken);
			expect(response.status).toBe(200);
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
				full_name: "Test User",
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
				role_name: "agency:invite_users",
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
				role_name: "agency:invite_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
