import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	generateTestAdminEmail,
	deleteTestAdminUser,
	createTestAdminAdminDirect,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	getEmailContent,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminInviteUserRequest,
	AdminCompleteSetupRequest,
} from "vetchium-specs/admin/admin-users";

test.describe("POST /admin/complete-setup", () => {
	test("invited admin successfully completes setup", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-cs-admin");
		const inviteeEmail = generateTestAdminEmail("admin-cs-inv");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Invite new user
			const inviteRequest: AdminInviteUserRequest = {
				email_address: inviteeEmail,
			};
			const inviteResponse = await api.inviteUser(sessionToken, inviteRequest);
			expect(inviteResponse.status).toBe(201);

			// Get invitation token from email
			const invitationEmailSummary = await waitForEmail(inviteeEmail);
			const invitationEmail = await getEmailContent(invitationEmailSummary.ID);
			const invitationToken =
				invitationEmail.Text.match(/\b([a-f0-9]{64})\b/)?.[1];
			expect(invitationToken).toBeDefined();

			// Complete setup
			const setupRequest: AdminCompleteSetupRequest = {
				invitation_token: invitationToken!,
				password: "NewAdminPassword123!",
				full_name: "New Admin User",
			};
			const setupResponse = await api.completeSetup(setupRequest);

			expect(setupResponse.status).toBe(200);
			expect(setupResponse.body.message).toBeDefined();

			// Verify new admin can login
			const newLoginResponse = await api.login({
				email: inviteeEmail,
				password: "NewAdminPassword123!",
			});
			expect(newLoginResponse.status).toBe(200);
			expect(newLoginResponse.body.tfa_token).toBeDefined();
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(inviteeEmail);
		}
	});

	test("using invitation token twice returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestAdminEmail("admin-cs-twice-admin");
		const inviteeEmail = generateTestAdminEmail("admin-cs-twice-inv");

		await createTestAdminAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login and invite
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			const sessionToken = tfaResponse.body.session_token;

			const inviteRequest: AdminInviteUserRequest = {
				email_address: inviteeEmail,
			};
			await api.inviteUser(sessionToken, inviteRequest);

			const invitationEmailSummary = await waitForEmail(inviteeEmail);
			const invitationEmail = await getEmailContent(invitationEmailSummary.ID);
			const invitationToken =
				invitationEmail.Text.match(/\b([a-f0-9]{64})\b/)?.[1];
			expect(invitationToken).toBeDefined();

			// Complete setup once
			const setupRequest: AdminCompleteSetupRequest = {
				invitation_token: invitationToken!,
				password: "NewAdminPassword123!",
				full_name: "New Admin User",
			};
			const firstSetup = await api.completeSetup(setupRequest);
			expect(firstSetup.status).toBe(200);

			// Use same token again - should fail
			const secondSetup = await api.completeSetup(setupRequest);
			expect(secondSetup.status).toBe(401);
		} finally {
			await deleteTestAdminUser(adminEmail);
			await deleteTestAdminUser(inviteeEmail);
		}
	});

	test("fake non-existent token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const setupRequest: AdminCompleteSetupRequest = {
			invitation_token: "a".repeat(64),
			password: "Password123!",
			full_name: "Test User",
		};
		const response = await api.completeSetup(setupRequest);

		expect(response.status).toBe(401);
	});

	test("missing invitation_token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completeSetupRaw({
			password: "Password123!",
			full_name: "Test User",
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completeSetupRaw({
			invitation_token: "a".repeat(64),
			full_name: "Test User",
		});

		expect(response.status).toBe(400);
	});

	test("missing full_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.completeSetupRaw({
			invitation_token: "a".repeat(64),
			password: "Password123!",
		});

		expect(response.status).toBe(400);
	});

	test("weak password returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const setupRequest: AdminCompleteSetupRequest = {
			invitation_token: "a".repeat(64),
			password: "weak",
			full_name: "Test User",
		};
		const response = await api.completeSetup(setupRequest);

		expect(response.status).toBe(400);
	});

	test("empty full_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const setupRequest: AdminCompleteSetupRequest = {
			invitation_token: "a".repeat(64),
			password: "Password123!",
			full_name: "",
		};
		const response = await api.completeSetup(setupRequest);

		expect(response.status).toBe(400);
	});
});
