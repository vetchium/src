import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";

/**
 * Helper to perform full login flow and get session token.
 */
async function getSessionToken(
	api: AdminAPIClient,
	email: string,
	password: string
): Promise<string> {
	// Login
	const loginResponse = await api.login({ email, password });
	expect(loginResponse.status).toBe(200);
	const tfaToken = loginResponse.body.tfa_token;

	// Get TFA code from email (uses exponential backoff)
	const tfaCode = await getTfaCodeFromEmail(email);

	// Verify TFA
	const tfaResponse = await api.verifyTFA({
		tfa_token: tfaToken,
		tfa_code: tfaCode,
	});
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

test.describe("POST /admin/logout", () => {
	test("valid session token logout returns 200", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("logout-success");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.logout({ session_token: sessionToken });

			expect(response.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.logout({
			session_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
		});

		expect(response.status).toBe(401);
	});

	test("missing session token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.logoutRaw({});

		expect(response.status).toBe(400);
	});

	test("empty session token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.logoutRaw({
			session_token: "",
		});

		expect(response.status).toBe(400);
	});

	test("double logout - second attempt returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("logout-double");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			// First logout should succeed
			const firstResponse = await api.logout({ session_token: sessionToken });
			expect(firstResponse.status).toBe(200);

			// Second logout should fail (session already invalidated)
			const secondResponse = await api.logout({ session_token: sessionToken });
			expect(secondResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("malformed session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Token too short - treated as invalid (not found), returns 401
		const response1 = await api.logoutRaw({
			session_token: "abc123",
		});
		expect(response1.status).toBe(401);

		// Token with invalid hex characters - treated as invalid (not found), returns 401
		const response2 = await api.logoutRaw({
			session_token:
				"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
		});
		expect(response2.status).toBe(401);
	});
});
