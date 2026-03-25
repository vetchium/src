import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	assignRoleToOrgUser,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { OrgInviteUserRequest } from "vetchium-specs/org/org-users";

test.describe("POST /org/invite-user", () => {
	test("admin successfully invites a new user", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("org-invite-admin");
		const { email: inviteeEmail } = generateTestOrgEmail("org-invite-new");

		// Create test org admin
		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			expect(tfaCode).toBeDefined();

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Invite new user
			const before = new Date(Date.now() - 2000).toISOString();
			const inviteRequest: OrgInviteUserRequest = {
				email_address: inviteeEmail,
				roles: ["org:manage_users"],
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(201);
			expect(inviteResponse.body.invitation_id).toBeDefined();
			expect(inviteResponse.body.expires_at).toBeDefined();

			// Verify invitation email was sent
			const invitationEmailSummary = await waitForEmail(inviteeEmail);
			expect(invitationEmailSummary).toBeDefined();
			expect(invitationEmailSummary.To[0].Address).toBe(inviteeEmail);
			expect(invitationEmailSummary.Subject).toContain("Invited");

			// Verify invitation token is in the email
			const invitationEmail = await getEmailContent(invitationEmailSummary.ID);
			const invitationToken = invitationEmail.Text.match(
				/token=([A-Z]{3}\d-[a-f0-9]{64})/
			)?.[1];
			expect(invitationToken).toBeDefined();

			// Verify org.invite_user audit log entry was created
			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["org.invite_user"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"org.invite_user"
			);
			// Invited email hash should be in event_data, not raw email
			expect(auditResp.body.audit_logs[0].event_data).toBeDefined();
			expect(
				JSON.stringify(auditResp.body.audit_logs[0].event_data)
			).not.toContain(inviteeEmail);
		} finally {
			// Cleanup: delete both users
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(inviteeEmail);
		}
	});

	test("non-admin cannot invite users (403 forbidden)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail, domain } = generateTestOrgEmail(
			"org-invite-nonadmin"
		);
		const { email: inviteeEmail } = generateTestOrgEmail(
			"org-invite-forbidden"
		);

		// Create test org user (non-admin)
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD);

		try {
			// Login as non-admin user
			const loginResponse = await api.login({
				email: userEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(userEmail);
			expect(tfaCode).toBeDefined();

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to invite new user (should fail)
			const inviteRequest: OrgInviteUserRequest = {
				email_address: inviteeEmail,
				roles: ["org:manage_users"],
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(403);
		} finally {
			await deleteTestOrgUser(userEmail);
		}
	});

	test("inviting existing user returns 409 conflict", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"org-invite-dup-admin"
		);
		const { email: existingEmail } = generateTestOrgEmail(
			"org-invite-existing"
		);

		// Create test org admin
		const { orgId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		// Create existing user in same org
		await createTestOrgUserDirect(existingEmail, TEST_PASSWORD, "ind1", {
			orgId,
			domain,
		});

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			expect(tfaCode).toBeDefined();

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to invite existing user
			const inviteRequest: OrgInviteUserRequest = {
				email_address: existingEmail,
				roles: ["org:manage_users"],
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(409);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(existingEmail);
		}
	});

	test("missing email_address returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("org-invite-noemail");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite without email_address
			const inviteResponse = await api.inviteUserRaw(sessionToken, {
				full_name: "Test User",
			});

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("invalid email_address format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"org-invite-bademail"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite with invalid email
			const inviteRequest: OrgInviteUserRequest = {
				email_address: "not-an-email",
				roles: ["org:manage_users"],
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: inviteeEmail } = generateTestOrgEmail("org-invite-noauth");

		const inviteRequest: OrgInviteUserRequest = {
			email_address: inviteeEmail,
			roles: ["org:manage_users"],
		};
		const inviteResponse = await api.inviteUserWithoutAuth(inviteRequest);

		expect(inviteResponse.status).toBe(401);
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: inviteeEmail } = generateTestOrgEmail(
			"org-invite-badsession"
		);

		const inviteRequest: OrgInviteUserRequest = {
			email_address: inviteeEmail,
			roles: ["org:manage_users"],
		};
		const inviteResponse = await api.inviteUser(
			"IND1-invalidtoken123",
			inviteRequest
		);

		expect(inviteResponse.status).toBe(401);
	});

	test("missing roles returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("org-invite-noroles");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite without roles field
			const inviteResponse = await api.inviteUserRaw(sessionToken, {
				email_address: `noroles-invitee@${domain}`,
			});

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("wrong-portal role in roles returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"org-invite-wrongrole"
		);
		const { email: inviteeEmail } = generateTestOrgEmail(
			"org-invite-wrongrole-invitee"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite with a hub role (wrong portal)
			const inviteResponse = await api.inviteUserRaw(sessionToken, {
				email_address: inviteeEmail,
				roles: ["hub:write_posts"],
			});

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});
});

test.describe("RBAC: POST /org/invite-user", () => {
	test("org user WITH org:manage_users can invite users (201)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-inv-org-adm");
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

		try {
			const loginRes = await api.login({
				email: managerEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginRes.status).toBe(200);
			const tfaCode = await getTfaCodeFromEmail(managerEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaRes.status).toBe(200);
			const sessionToken = tfaRes.body.session_token;

			const inviteeEmail = `inv-${crypto.randomUUID().substring(0, 8)}@${domain}`;
			const inviteRequest: OrgInviteUserRequest = {
				email_address: inviteeEmail,
				roles: ["org:manage_users"],
			};
			const response = await api.inviteUser(sessionToken, inviteRequest);
			expect(response.status).toBe(201);
		} finally {
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	// Negative RBAC (no role → 403) is covered by
	// "non-admin cannot invite users (403 forbidden)" above.
});
