import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	generateTestAdminEmail,
	deleteTestAdminUser,
	createTestAdminUserDirect,
	createTestAdminAdminDirect,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { AdminInviteUserRequest } from "vetchium-specs/admin/admin-users";

test.describe("POST /admin/invite-user", () => {
	test("admin successfully invites a new user", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-invite-admin");
		const inviteeEmail = generateTestAdminEmail("admin-invite-new");

		// Create test admin
		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
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
			const inviteRequest: AdminInviteUserRequest = {
				email_address: inviteeEmail,
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
			const invitationToken =
				invitationEmail.Text.match(/\b([a-f0-9]{64})\b/)?.[1];
			expect(invitationToken).toBeDefined();
		} finally {
			// Cleanup: delete both users
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(inviteeEmail);
		}
	});

	test("non-admin cannot invite users (403 forbidden)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const userEmail = generateTestAdminEmail("admin-invite-nonadmin");
		const inviteeEmail = generateTestAdminEmail("admin-invite-forbidden");

		// Create test admin user (non-admin)
		await createTestAdminUserDirect(userEmail, TEST_PASSWORD);

		try {
			// Login as non-admin user
			const loginResponse = await api.login({
				email: userEmail,
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
			const inviteRequest: AdminInviteUserRequest = {
				email_address: inviteeEmail,
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(403);
		} finally {
			await deleteTestAdminUser(userEmail);
		}
	});

	test("inviting existing user returns 409 conflict", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-invite-dup-admin");
		const existingEmail = generateTestAdminEmail("admin-invite-existing");

		// Create test admin
		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);
		// Create existing user
		await createTestAdminUserDirect(existingEmail, TEST_PASSWORD);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
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
			const inviteRequest: AdminInviteUserRequest = {
				email_address: existingEmail,
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(409);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(existingEmail);
		}
	});

	test("missing email_address returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-invite-noemail");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

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
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to invite without email_address
			const inviteResponse = await api.inviteUserRaw(sessionToken, {
				full_name: "Test User",
			});

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid email_address format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-invite-bademail");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

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
				remember_me: false,
			});
			const sessionToken = tfaResponse.body.session_token;

			// Try to invite with invalid email
			const inviteRequest: AdminInviteUserRequest = {
				email_address: "not-an-email",
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const inviteeEmail = generateTestAdminEmail("admin-invite-noauth");

		const inviteRequest: AdminInviteUserRequest = {
			email_address: inviteeEmail,
		};
		const inviteResponse = await api.inviteUserWithoutAuth(inviteRequest);

		expect(inviteResponse.status).toBe(401);
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const inviteeEmail = generateTestAdminEmail("admin-invite-badsession");

		const inviteRequest: AdminInviteUserRequest = {
			email_address: inviteeEmail,
		};
		const inviteResponse = await api.inviteUser(
			"invalidtoken123",
			inviteRequest
		);

		expect(inviteResponse.status).toBe(401);
	});
});
