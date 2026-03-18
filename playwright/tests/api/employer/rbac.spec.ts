import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	generateTestDomainName,
	assignRoleToOrgUser,
	deleteTestGlobalEmployerDomain,
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
					roles: ["employer:manage_users"],
				};

				const response = await api.inviteUser(adminToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITH employer:manage_users role can invite users", async ({
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
			await assignRoleToOrgUser(userResult.orgUserId, "employer:manage_users");

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
					roles: ["employer:manage_users"],
				};

				const response = await api.inviteUser(userToken, inviteReq);
				expect(response.status).toBe(201);
			} finally {
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Regular user WITHOUT employer:manage_users role gets 403 when inviting", async ({
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
					roles: ["employer:manage_users"],
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
					role_name: "employer:manage_users",
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
					role_name: "employer:manage_users",
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
					role_name: "employer:manage_users",
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
				"employer:manage_users"
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
					role_name: "employer:manage_users",
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
				"employer:manage_users"
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
					role_name: "employer:manage_users",
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

	test.describe("employer:manage_domains role", () => {
		test("user without role cannot claim-domain (403)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("rbac-mgr-dom");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});
			try {
				const loginRes = await api.login({
					email: noRoleEmail,
					domain,
					password: TEST_PASSWORD,
				});
				const tfaCode = await getTfaCodeFromEmail(noRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				const noRoleToken = tfaRes.body!.session_token;
				const resp = await api.claimDomain(noRoleToken, { domain });
				expect(resp.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("user without role cannot verify-domain (403)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("rbac-vfy-dom");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});
			try {
				const loginRes = await api.login({
					email: noRoleEmail,
					domain,
					password: TEST_PASSWORD,
				});
				const tfaCode = await getTfaCodeFromEmail(noRoleEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				const noRoleToken = tfaRes.body!.session_token;
				const resp = await api.verifyDomain(noRoleToken, { domain });
				expect(resp.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("user with manage_domains can claim-domain (201)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("rbac-mdom-pos");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);
			const managerEmail = `domgr@${domain}`;
			const managerResult = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
					domain,
				}
			);
			await assignRoleToOrgUser(
				managerResult.orgUserId,
				"employer:manage_domains"
			);
			const freshDomain = generateTestDomainName("rbac-emp-clm");
			try {
				const loginRes = await api.login({
					email: managerEmail,
					domain,
					password: TEST_PASSWORD,
				});
				const tfaCode = await getTfaCodeFromEmail(managerEmail);
				const tfaRes = await api.verifyTFA({
					tfa_token: loginRes.body!.tfa_token,
					tfa_code: tfaCode,
					remember_me: false,
				});
				const managerToken = tfaRes.body!.session_token;
				const resp = await api.claimDomain(managerToken, {
					domain: freshDomain,
				});
				expect(resp.status).toBe(201);
			} finally {
				await deleteTestGlobalEmployerDomain(freshDomain);
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	test.describe("employer:view_domains role", () => {
		let viewerToken: string;
		let noRoleToken: string;
		let adminEmail: string;
		let viewerEmail: string;
		let noRoleEmail: string;
		let domain: string;
		let claimedDomain: string;

		test.beforeAll(async ({ request }) => {
			const api = new EmployerAPIClient(request);

			const generated = generateTestOrgEmail("rbac-vdom-emp");
			adminEmail = generated.email;
			domain = generated.domain;
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD,
				"ind1"
			);

			// Claim a fresh domain (different from org email domain which is already in global_employer_domains)
			claimedDomain = generateTestDomainName("rbac-vdom-cl");
			const adminLoginRes = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const adminTfaCode = await getTfaCodeFromEmail(adminEmail);
			const adminTfaRes = await api.verifyTFA({
				tfa_token: adminLoginRes.body!.tfa_token,
				tfa_code: adminTfaCode,
				remember_me: false,
			});
			const adminToken = adminTfaRes.body!.session_token;
			await api.claimDomain(adminToken, { domain: claimedDomain });

			viewerEmail = `viewer@${domain}`;
			const viewerResult = await createTestOrgUserDirect(
				viewerEmail,
				TEST_PASSWORD,
				"ind1",
				{
					employerId: adminResult.employerId,
					domain,
				}
			);
			await assignRoleToOrgUser(
				viewerResult.orgUserId,
				"employer:view_domains"
			);
			const viewerLoginRes = await api.login({
				email: viewerEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const viewerTfaCode = await getTfaCodeFromEmail(viewerEmail);
			const viewerTfaRes = await api.verifyTFA({
				tfa_token: viewerLoginRes.body!.tfa_token,
				tfa_code: viewerTfaCode,
				remember_me: false,
			});
			viewerToken = viewerTfaRes.body!.session_token;

			noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				employerId: adminResult.employerId,
				domain,
			});
			const noRoleLoginRes = await api.login({
				email: noRoleEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const noRoleTfaCode = await getTfaCodeFromEmail(noRoleEmail);
			const noRoleTfaRes = await api.verifyTFA({
				tfa_token: noRoleLoginRes.body!.tfa_token,
				tfa_code: noRoleTfaCode,
				remember_me: false,
			});
			noRoleToken = noRoleTfaRes.body!.session_token;
		});

		test.afterAll(async () => {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			await deleteTestOrgUser(viewerEmail);
			await deleteTestOrgUser(noRoleEmail);
			await deleteTestOrgUser(adminEmail);
		});

		test("user with view_domains can list-domains (200)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const resp = await api.listDomains(viewerToken, {});
			expect(resp.status).toBe(200);
		});

		test("user with view_domains can get-domain-status (200)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const resp = await api.getDomainStatus(viewerToken, {
				domain: claimedDomain,
			});
			expect(resp.status).toBe(200);
		});

		test("user without role cannot list-domains (403)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const resp = await api.listDomains(noRoleToken, {});
			expect(resp.status).toBe(403);
		});

		test("user without role cannot get-domain-status (403)", async ({
			request,
		}) => {
			const api = new EmployerAPIClient(request);
			const resp = await api.getDomainStatus(noRoleToken, {
				domain: claimedDomain,
			});
			expect(resp.status).toBe(403);
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
				roles: ["employer:manage_users"],
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
				role_name: "employer:manage_users",
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
				role_name: "employer:manage_users",
			};

			const response = await api.removeRoleWithoutAuth(removeReq);
			expect(response.status).toBe(401);
		});
	});
});
