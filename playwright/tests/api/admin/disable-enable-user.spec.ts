import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	getTestAdminUser,
} from "../../../lib/db";
import { waitForEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminDisableUserRequest,
	AdminEnableUserRequest,
} from "vetchium-specs/admin/admin-users";

test.describe("POST /admin/disable-user", () => {
	test("admin successfully disables another admin user", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("disable-admin1");
		const admin2Email = generateTestEmail("disable-admin2");

		// Create two admin users
		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		const admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD);

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaEmail = await waitForEmail(admin1Email);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable admin2
			const disableRequest: AdminDisableUserRequest = {
				target_user_id: admin2Id,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(200);

			// Verify admin2 is disabled
			const admin2 = await getTestAdminUser(admin2Email);
			expect(admin2).not.toBeNull();
			expect(admin2!.status).toBe("disabled");
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("cannot disable the last admin user (422)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("disable-last-admin");

		// Create only one admin
		const adminId = await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable self (last admin)
			const disableRequest: AdminDisableUserRequest = {
				target_user_id: adminId,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);

			// Verify admin is still active
			const admin = await getTestAdminUser(adminEmail);
			expect(admin).not.toBeNull();
			expect(admin!.status).toBe("active");
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("target_user_id is required (400)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("disable-req-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable without target_user_id
			const disableResponse = await api.disableUserRaw(sessionToken, {});

			expect(disableResponse.status).toBe(400);
			expect(disableResponse.errors).toBeDefined();
			expect(Array.isArray(disableResponse.errors)).toBe(true);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid target_user_id format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("disable-invalid-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with invalid UUID
			const disableResponse = await api.disableUserRaw(sessionToken, {
				target_user_id: "not-a-uuid",
			});

			expect(disableResponse.status).toBe(400);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("disable-notfound-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent user ID
			const disableRequest: AdminDisableUserRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(404);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("cannot disable already disabled user (422)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("disable-twice-admin1");
		const admin2Email = generateTestEmail("disable-twice-admin2");

		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		const admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD, {
			status: "disabled",
		});

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(admin1Email);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable already disabled admin2
			const disableRequest: AdminDisableUserRequest = {
				target_user_id: admin2Id,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Try without authentication
		const disableResponse = await api.disableUserRaw("", {
			target_user_id: "00000000-0000-0000-0000-000000000000",
		});

		expect(disableResponse.status).toBe(401);
	});
});

test.describe("POST /admin/enable-user", () => {
	test("admin successfully enables a disabled admin user", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("enable-admin1");
		const admin2Email = generateTestEmail("enable-admin2");

		// Create two admins, admin2 is disabled
		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		const admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD, {
			status: "disabled",
		});

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(admin1Email);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable admin2
			const enableRequest: AdminEnableUserRequest = {
				target_user_id: admin2Id,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(200);

			// Verify admin2 is enabled
			const admin2 = await getTestAdminUser(admin2Email);
			expect(admin2).not.toBeNull();
			expect(admin2!.status).toBe("active");
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("cannot enable already active user (404)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("enable-active-admin1");
		const admin2Email = generateTestEmail("enable-active-admin2");

		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		const admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD); // active by default

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(admin1Email);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable already active admin2
			const enableRequest: AdminEnableUserRequest = {
				target_user_id: admin2Id,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("target_user_id is required (400)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("enable-req-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable without target_user_id
			const enableResponse = await api.enableUserRaw(sessionToken, {});

			expect(enableResponse.status).toBe(400);
			expect(enableResponse.errors).toBeDefined();
			expect(Array.isArray(enableResponse.errors)).toBe(true);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const adminEmail = generateTestEmail("enable-notfound-admin");

		await createTestAdminUser(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent user ID
			const enableRequest: AdminEnableUserRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Try without authentication
		const enableResponse = await api.enableUserRaw("", {
			target_user_id: "00000000-0000-0000-0000-000000000000",
		});

		expect(enableResponse.status).toBe(401);
	});
});
