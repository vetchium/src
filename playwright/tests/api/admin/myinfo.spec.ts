import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper to perform full login flow and get session token.
 */
async function getSessionToken(
	api: AdminAPIClient,
	email: string,
	password: string
): Promise<string> {
	const loginResponse = await api.login({ email, password });
	expect(loginResponse.status).toBe(200);
	const tfaToken = loginResponse.body.tfa_token;

	const tfaCode = await getTfaCodeFromEmail(email);

	const tfaResponse = await api.verifyTFA({
		tfa_token: tfaToken,
		tfa_code: tfaCode,
	});
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

test.describe("GET /admin/myinfo", () => {
	test("returns admin user info with roles for valid session", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("myinfo-success");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.admin_user_id).toBeDefined();
			expect(response.body.email_address).toBe(email);
			expect(response.body.full_name).toBeDefined();
			expect(response.body.preferred_language).toBeDefined();
			expect(Array.isArray(response.body.roles)).toBe(true);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns 401 for missing session token", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.getMyInfoWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("returns 401 for invalid session token", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.getMyInfo(
			"0000000000000000000000000000000000000000000000000000000000000000"
		);

		expect(response.status).toBe(401);
	});

	test("returns 401 for expired session token", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("myinfo-expired");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			// Logout to invalidate the session
			const logoutResponse = await api.logout(sessionToken);
			expect(logoutResponse.status).toBe(200);

			// Try to use the expired token
			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("returns empty roles array for user with no roles", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("myinfo-no-roles");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.roles).toEqual([]);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
