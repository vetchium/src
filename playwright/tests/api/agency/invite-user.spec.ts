import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyUserDirect,
	createTestAgencyAdminDirect,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { AgencyInviteUserRequest } from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/invite-user", () => {
	test("admin successfully invites a new user", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-admin"
		);
		const { email: inviteeEmail } =
			generateTestAgencyEmail("agency-invite-new");

		// Create test agency admin
		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: inviteeEmail,
				full_name: "Test Invitee",
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
		} finally {
			// Cleanup: delete both users
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(inviteeEmail);
		}
	});

	test("non-admin cannot invite users (403 forbidden)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail, domain } = generateTestAgencyEmail(
			"agency-invite-nonadmin"
		);
		const { email: inviteeEmail } = generateTestAgencyEmail(
			"agency-invite-forbidden"
		);

		// Create test agency user (non-admin)
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD);

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
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: inviteeEmail,
				full_name: "Test Invitee",
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(403);
		} finally {
			await deleteTestAgencyUser(userEmail);
		}
	});

	test("inviting existing user returns 409 conflict", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-dup-admin"
		);
		const { email: existingEmail } = generateTestAgencyEmail(
			"agency-invite-existing"
		);

		// Create test agency admin
		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		// Create existing user in same agency
		await createTestAgencyUserDirect(existingEmail, TEST_PASSWORD, "ind1", {
			agencyId,
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
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: existingEmail,
				full_name: "Existing User",
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(409);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(existingEmail);
		}
	});

	test("missing email_address returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-noemail"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("missing full_name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-noname"
		);
		const { email: inviteeEmail } = generateTestAgencyEmail(
			"agency-invite-noname-inv"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite without full_name
			const inviteResponse = await api.inviteUserRaw(sessionToken, {
				email_address: inviteeEmail,
			});

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("invalid email_address format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-bademail"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: "not-an-email",
				full_name: "Test User",
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("empty full_name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"agency-invite-emptyname"
		);
		const { email: inviteeEmail } = generateTestAgencyEmail(
			"agency-invite-emptyname-inv"
		);

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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

			// Try to invite with empty full_name
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: inviteeEmail,
				full_name: "",
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);

			expect(inviteResponse.status).toBe(400);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("without authorization header returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: inviteeEmail } = generateTestAgencyEmail(
			"agency-invite-noauth"
		);

		const inviteRequest: AgencyInviteUserRequest = {
			email_address: inviteeEmail,
			full_name: "Test User",
		};
		const inviteResponse = await api.inviteUserWithoutAuth(inviteRequest);

		expect(inviteResponse.status).toBe(401);
	});

	test("with invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: inviteeEmail } = generateTestAgencyEmail(
			"agency-invite-badsession"
		);

		const inviteRequest: AgencyInviteUserRequest = {
			email_address: inviteeEmail,
			full_name: "Test User",
		};
		const inviteResponse = await api.inviteUser(
			"IND1-invalidtoken123",
			inviteRequest
		);

		expect(inviteResponse.status).toBe(401);
	});
});
