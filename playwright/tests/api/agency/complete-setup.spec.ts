import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyAdminDirect,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyInviteUserRequest,
	AgencyCompleteSetupRequest,
	AgencyLoginRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/complete-setup", () => {
	test("invited user successfully completes setup", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("ag-setup-admin");
		const { email: inviteeEmail } = generateTestAgencyEmail("ag-setup-inv");

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

			// Invite new user
			const inviteRequest: AgencyInviteUserRequest = {
				email_address: inviteeEmail,
				roles: ["agency:invite_users"],
			};
			const inviteResponse = await api.inviteUser(
				tfaResponse.body.session_token,
				inviteRequest
			);
			expect(inviteResponse.status).toBe(201);

			// Get invitation token from email
			const invitationEmailSummary = await waitForEmail(inviteeEmail);
			const invitationEmail = await getEmailContent(invitationEmailSummary.ID);
			const invitationToken = invitationEmail.Text.match(
				/token=([A-Z]{3}\d-[a-f0-9]{64})/
			)?.[1];
			expect(invitationToken).toBeDefined();

			// Complete setup with invitation token
			const setupRequest: AgencyCompleteSetupRequest = {
				invitation_token: invitationToken!,
				password: "NewUserPassword123!",
				full_name: "Updated Name",
			};
			const setupResponse = await api.completeSetup(setupRequest);

			expect(setupResponse.status).toBe(200);
			expect(setupResponse.body.message).toBeDefined();

			// Verify user can now login with new credentials
			const loginRequest: AgencyLoginRequest = {
				email: inviteeEmail,
				domain,
				password: "NewUserPassword123!",
			};
			const userLoginResponse = await api.login(loginRequest);

			expect(userLoginResponse.status).toBe(200);
			expect(userLoginResponse.body.tfa_token).toBeDefined();
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(inviteeEmail);
		}
	});

	test("using invitation token twice fails (401)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"ag-setup-twice-admin"
		);
		const { email: inviteeEmail } =
			generateTestAgencyEmail("ag-setup-twice-inv");

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login and invite
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

			const inviteRequest: AgencyInviteUserRequest = {
				email_address: inviteeEmail,
				roles: ["agency:invite_users"],
			};
			await api.inviteUser(tfaResponse.body.session_token, inviteRequest);

			const invitationEmailSummary = await waitForEmail(inviteeEmail);
			const invitationEmail = await getEmailContent(invitationEmailSummary.ID);
			const invitationToken = invitationEmail.Text.match(
				/token=([A-Z]{3}\d-[a-f0-9]{64})/
			)?.[1];

			// Complete setup once
			const setupRequest: AgencyCompleteSetupRequest = {
				invitation_token: invitationToken!,
				password: "NewPassword123!",
				full_name: "Test User",
			};
			const firstSetup = await api.completeSetup(setupRequest);
			expect(firstSetup.status).toBe(200);

			// Try to use same token again (should fail)
			const secondSetup = await api.completeSetup(setupRequest);
			expect(secondSetup.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(inviteeEmail);
		}
	});

	test("invalid invitation token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupRequest: AgencyCompleteSetupRequest = {
			invitation_token:
				"IND1-invalidtoken1234567890abcdef1234567890abcdef1234567890abcdef",
			password: "Password123!",
			full_name: "Test User",
		};
		const setupResponse = await api.completeSetup(setupRequest);

		expect(setupResponse.status).toBe(401);
	});

	test("missing invitation_token returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupResponse = await api.completeSetupRaw({
			password: "Password123!",
			full_name: "Test User",
		});

		expect(setupResponse.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupResponse = await api.completeSetupRaw({
			invitation_token: "IND1-" + "a".repeat(64),
			full_name: "Test User",
		});

		expect(setupResponse.status).toBe(400);
	});

	test("missing full_name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupResponse = await api.completeSetupRaw({
			invitation_token: "IND1-" + "a".repeat(64),
			password: "Password123!",
		});

		expect(setupResponse.status).toBe(400);
	});

	test("weak password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupRequest: AgencyCompleteSetupRequest = {
			invitation_token: "IND1-" + "a".repeat(64),
			password: "weak",
			full_name: "Test User",
		};
		const setupResponse = await api.completeSetup(setupRequest);

		expect(setupResponse.status).toBe(400);
	});

	test("empty full_name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupRequest: AgencyCompleteSetupRequest = {
			invitation_token: "IND1-" + "a".repeat(64),
			password: "Password123!",
			full_name: "",
		};
		const setupResponse = await api.completeSetup(setupRequest);

		expect(setupResponse.status).toBe(400);
	});

	test("whitespace-only full_name returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupRequest: AgencyCompleteSetupRequest = {
			invitation_token: "IND1-" + "a".repeat(64),
			password: "Password123!",
			full_name: "   ",
		};
		const setupResponse = await api.completeSetup(setupRequest);

		expect(setupResponse.status).toBe(400);
	});

	test("full_name with invalid characters returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const setupRequest: AgencyCompleteSetupRequest = {
			invitation_token: "IND1-" + "a".repeat(64),
			password: "Password123!",
			full_name: "Test@User#123",
		};
		const setupResponse = await api.completeSetup(setupRequest);

		expect(setupResponse.status).toBe(400);
	});
});
