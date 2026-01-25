import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	getTestAdminUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminDisableUserRequest,
	AdminEnableUserRequest,
} from "vetchium-specs/admin/admin-users";

// Note: "Last admin protection" tests are in a dedicated file:
// last-admin-protection.spec.ts

test.describe("POST /admin/disable-user", () => {
	test("admin successfully disables another admin user", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("disable-admin1");
		const admin2Email = generateTestEmail("disable-admin2");

		// Create two admin users
		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		await createTestAdminUser(admin2Email, TEST_PASSWORD);

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(admin1Email);

			// Verify TFA
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable admin2
			const disableRequest: AdminDisableUserRequest = {
				email_address: admin2Email,
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

	test("admin can disable themselves (when other admins exist)", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("disable-self-admin1");
		const admin2Email = generateTestEmail("disable-self-admin2");

		// Create two admins so disabling self is allowed
		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		await createTestAdminUser(admin2Email, TEST_PASSWORD);

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable self - should succeed since admin2 exists
			const disableRequest: AdminDisableUserRequest = {
				email_address: admin1Email,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(200);

			// Verify admin1 is disabled
			const admin1 = await getTestAdminUser(admin1Email);
			expect(admin1).not.toBeNull();
			expect(admin1!.status).toBe("disabled");
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("email_address is required (400)", async ({ request }) => {
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable without email_address
			const disableResponse = await api.disableUserRaw(sessionToken, {});

			expect(disableResponse.status).toBe(400);
			expect(disableResponse.errors).toBeDefined();
			expect(Array.isArray(disableResponse.errors)).toBe(true);
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent email
			const disableRequest: AdminDisableUserRequest = {
				email_address: "nonexistent@example.com",
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
		await createTestAdminUser(admin2Email, TEST_PASSWORD, {
			status: "disabled",
		});

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable already disabled admin2
			const disableRequest: AdminDisableUserRequest = {
				email_address: admin2Email,
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
			email_address: "some@email.com",
		});

		expect(disableResponse.status).toBe(401);
	});

	test("with invalid auth token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Try with invalid token
		const disableResponse = await api.disableUserRaw("invalid-token", {
			email_address: "some@email.com",
		});

		expect(disableResponse.status).toBe(401);
	});

	test("session invalidated after user is disabled", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("disable-session-admin1");
		const admin2Email = generateTestEmail("disable-session-admin2");

		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		await createTestAdminUser(admin2Email, TEST_PASSWORD);

		try {
			// Login as admin1
			const login1Response = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(login1Response.status).toBe(200);

			const tfa1Code = await getTfaCodeFromEmail(admin1Email);
			const tfa1Response = await api.verifyTFA({
				tfa_token: login1Response.body.tfa_token,
				tfa_code: tfa1Code,
			});
			expect(tfa1Response.status).toBe(200);
			const sessionToken1 = tfa1Response.body.session_token;

			// Login as admin2
			const login2Response = await api.login({
				email: admin2Email,
				password: TEST_PASSWORD,
			});
			expect(login2Response.status).toBe(200);

			const tfa2Code = await getTfaCodeFromEmail(admin2Email);
			const tfa2Response = await api.verifyTFA({
				tfa_token: login2Response.body.tfa_token,
				tfa_code: tfa2Code,
			});
			expect(tfa2Response.status).toBe(200);
			const sessionToken2 = tfa2Response.body.session_token;

			// Verify admin2's session works
			const checkResponse = await api.disableUser(sessionToken2, {
				email_address: "nonexistent@example.com",
			});
			expect(checkResponse.status).toBe(404); // Not found, but auth passed

			// Admin1 disables admin2
			const disableResponse = await api.disableUser(sessionToken1, {
				email_address: admin2Email,
			});
			expect(disableResponse.status).toBe(200);

			// Admin2's session should now be invalid
			const invalidResponse = await api.disableUser(sessionToken2, {
				email_address: "nonexistent@example.com",
			});
			expect(invalidResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
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
		await createTestAdminUser(admin2Email, TEST_PASSWORD, {
			status: "disabled",
		});

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable admin2
			const enableRequest: AdminEnableUserRequest = {
				email_address: admin2Email,
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

	test("enabled user can login again", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("enable-login-admin1");
		const admin2Email = generateTestEmail("enable-login-admin2");

		// Create two admins, admin2 is disabled
		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		await createTestAdminUser(admin2Email, TEST_PASSWORD, {
			status: "disabled",
		});

		try {
			// Verify admin2 cannot login while disabled
			const disabledLoginResponse = await api.login({
				email: admin2Email,
				password: TEST_PASSWORD,
			});
			expect(disabledLoginResponse.status).toBe(422);

			// Login as admin1 and enable admin2
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable admin2
			const enableResponse = await api.enableUser(sessionToken, {
				email_address: admin2Email,
			});
			expect(enableResponse.status).toBe(200);

			// Now admin2 should be able to login
			const enabledLoginResponse = await api.login({
				email: admin2Email,
				password: TEST_PASSWORD,
			});
			expect(enabledLoginResponse.status).toBe(200);
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
		await createTestAdminUser(admin2Email, TEST_PASSWORD); // active by default

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable already active admin2
			const enableRequest: AdminEnableUserRequest = {
				email_address: admin2Email,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("email_address is required (400)", async ({ request }) => {
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable without email_address
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent email
			const enableRequest: AdminEnableUserRequest = {
				email_address: "nonexistent@example.com",
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
			email_address: "some@email.com",
		});

		expect(enableResponse.status).toBe(401);
	});

	test("with invalid auth token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Try with invalid token
		const enableResponse = await api.enableUserRaw("invalid-token", {
			email_address: "some@email.com",
		});

		expect(enableResponse.status).toBe(401);
	});

	test("disable then enable workflow", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const admin1Email = generateTestEmail("workflow-admin1");
		const admin2Email = generateTestEmail("workflow-admin2");

		await createTestAdminUser(admin1Email, TEST_PASSWORD);
		await createTestAdminUser(admin2Email, TEST_PASSWORD);

		try {
			// Login as admin1
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Verify admin2 is initially active
			let admin2 = await getTestAdminUser(admin2Email);
			expect(admin2!.status).toBe("active");

			// Disable admin2
			const disableResponse = await api.disableUser(sessionToken, {
				email_address: admin2Email,
			});
			expect(disableResponse.status).toBe(200);

			// Verify admin2 is disabled
			admin2 = await getTestAdminUser(admin2Email);
			expect(admin2!.status).toBe("disabled");

			// Enable admin2
			const enableResponse = await api.enableUser(sessionToken, {
				email_address: admin2Email,
			});
			expect(enableResponse.status).toBe(200);

			// Verify admin2 is active again
			admin2 = await getTestAdminUser(admin2Email);
			expect(admin2!.status).toBe("active");
		} finally {
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});
});
